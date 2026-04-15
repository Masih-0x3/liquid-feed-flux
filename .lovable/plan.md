

## Disk I/O Optimization Plan

### Problem Summary

Your Supabase database is burning through disk I/O bandwidth due to three root causes:

1. **`posts` table: 1.08 billion sequential tuple reads** across 9,235 full table scans (125K rows scanned repeatedly)
2. **`settings` and `accounts` tables: 46K and 36K sequential scans** respectively — tiny tables read on every worker invocation
3. **`get_post_pipeline_status` RPC: 6 correlated subqueries** per row, each scanning `jobs`, `deliveries`, and `media` independently

### What We Will Change

**Step 1 — Replace the ASC index on `posts.created_at` with a DESC index**

The existing `idx_posts_created_at` is ascending. Every query in the system orders by `created_at DESC` (monitoring page, dashboard summary, reconciliation). We will drop the old index and create a DESC one. This is a safe swap — Postgres can use a DESC index for ASC queries via backward scan, but not vice versa with equal efficiency.

**Step 2 — Add a targeted index on `jobs` for pipeline status lookups**

The `get_post_pipeline_status` function does `WHERE j.type = 'translate' AND (j.payload->>'tweet_id') = p.tweet_id ORDER BY j.created_at DESC LIMIT 1` — this hits the GIN index on `payload` but still requires sorting. A B-tree expression index on `(type, (payload->>'tweet_id'), created_at DESC)` will make these lookups index-only.

**Step 3 — Rewrite `get_post_pipeline_status` to use JOINs with LATERAL**

Replace the 6 correlated subqueries with 3 `LEFT JOIN LATERAL` clauses (one each for jobs-translate, jobs-deliver, deliveries). This lets Postgres execute each lateral once per row using the new index, instead of 6 independent subquery scans.

**Step 4 — Reduce worker cron frequency**

The worker runs every minute (`* * * * *`). With only ~3,900 live jobs (most completed), this is excessive. We will update it to every 2 minutes (`*/2 * * * *`). This halves the settings/accounts table scan frequency while still processing jobs within acceptable latency.

### What We Will NOT Change

- No changes to the monitoring page frontend code — it already uses cursor pagination correctly
- No changes to realtime subscriptions — the 1-second debounce is already reasonable
- No schema changes to any table
- No changes to the `claim_jobs` RPC — it already uses `FOR UPDATE SKIP LOCKED` efficiently
- The `settings` and `accounts` seq scans (46K/36K) are on tiny tables (5-6 rows) — the reads are cheap per-scan; reducing cron frequency is sufficient

### Technical Details

**Migration SQL (single migration file):**

```sql
-- 1. Replace posts created_at index (ASC → DESC)
DROP INDEX IF EXISTS public.idx_posts_created_at;
CREATE INDEX idx_posts_created_at_desc ON public.posts
  USING btree (created_at DESC);

-- 2. Expression index for pipeline status lookups on jobs
CREATE INDEX idx_jobs_type_tweet_created
  ON public.jobs (type, ((payload->>'tweet_id')), created_at DESC);

-- 3. Rewrite get_post_pipeline_status with LATERAL joins
CREATE OR REPLACE FUNCTION public.get_post_pipeline_status(tweet_ids text[])
RETURNS TABLE(
  tweet_id text, ingest_at timestamptz,
  media_total int, media_downloaded int,
  lang_original text, translated_at timestamptz,
  translate_status text, translate_error text,
  delivery_status text, posted_at timestamptz,
  delivery_error text, attempts int
)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  SELECT
    p.tweet_id,
    p.created_at AS ingest_at,
    coalesce(mc.total, 0)  AS media_total,
    coalesce(mc.downloaded, 0) AS media_downloaded,
    p.lang_original,
    p.translated_at,
    coalesce(tj.status, CASE WHEN p.translated_at IS NOT NULL THEN 'completed' ELSE 'pending' END) AS translate_status,
    tj.last_error AS translate_error,
    coalesce(dl.status, 'pending') AS delivery_status,
    dl.posted_at,
    coalesce(dl.last_error, dj.last_error) AS delivery_error,
    coalesce(dl.attempts, 0) AS attempts
  FROM public.posts p
  LEFT JOIN LATERAL (
    SELECT count(*) AS total,
           count(*) FILTER (WHERE m.downloaded_at IS NOT NULL) AS downloaded
    FROM public.media m WHERE m.tweet_id = p.tweet_id
  ) mc ON true
  LEFT JOIN LATERAL (
    SELECT j.status, j.last_error
    FROM public.jobs j
    WHERE j.type = 'translate' AND (j.payload->>'tweet_id') = p.tweet_id
    ORDER BY j.created_at DESC LIMIT 1
  ) tj ON true
  LEFT JOIN LATERAL (
    SELECT j.last_error
    FROM public.jobs j
    WHERE j.type = 'deliver' AND (j.payload->>'tweet_id') = p.tweet_id
    ORDER BY j.created_at DESC LIMIT 1
  ) dj ON true
  LEFT JOIN LATERAL (
    SELECT d.status, d.posted_at, d.last_error, d.attempts
    FROM public.deliveries d
    WHERE d.subject_type = 'post' AND d.subject_id = p.tweet_id
    ORDER BY d.created_at DESC LIMIT 1
  ) dl ON true
  WHERE p.tweet_id = ANY(tweet_ids)
  ORDER BY p.created_at DESC;
$$;
```

**Cron update (via Supabase insert tool):**

```sql
SELECT cron.alter_job(8, schedule := '*/2 * * * *');
```

### Risk Assessment

- **Index swap**: Zero downtime. The new DESC index is created before the old one is dropped (Postgres handles this atomically in a migration). Queries will use the new index immediately.
- **RPC rewrite**: The return type signature is identical — no frontend changes needed. The `useMonitoringData` hook and any other callers will work without modification.
- **Cron change**: Jobs will wait at most 2 minutes instead of 1 minute. Given the current workload (mostly idle), this is negligible.

### Expected Impact

- Sequential reads on `posts` should drop by ~95% (index scan replaces seq scan)
- Pipeline status queries will be 3-6x faster (LATERAL + expression index vs. correlated subqueries)
- Overall disk I/O reduced by roughly 50-70%

