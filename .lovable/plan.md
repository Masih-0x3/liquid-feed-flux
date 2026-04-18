

Let me explore the codebase to understand the translation pipeline and Twitter integration before planning.
<lov-tool-use id="toolu_vrtx_01RyFXGjWqe1ivN4oAtRjhJC" name="code--view" integration-id="code" data="{\"file_path\": \"supabase/functions/worker/index.ts\", \"lines\": \"1-100\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01A81HpCWGG9F6XCuU1NKQdB" name="code--search_files" integration-id="code" data="{\"query\": \"TWITTER_CONSUMER|TWITTER_ACCESS|api.x.com|twitter.*oauth\", \"search_dir\": \"supabase/functions\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_013NZx2KpgGHqnGD731cgN4L" name="code--search_files" integration-id="code" data="{\"query\": \"translate|text_original\", \"search_dir\": \"supabase/functions/worker\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01TA7WBpLvseCtRUzP5uwPgo" name="code--search_files" integration-id="code" data="{\"query\": \"TWITTER_CONSUMER|api.x.com|note_tweet\", \"search_dir\": \"supabase/functions\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_019hG4mkgeaftwbVqprzQwzh" name="code--search_files" integration-id="code" data="{\"query\": \"translate\", \"search_dir\": \"supabase/functions/worker\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01MEx9TLU1ckYyfz1NxZZvat" name="code--list_dir" integration-id="code" data="{\"dir_path\": \"supabase/functions/worker\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01HeqjZpYtK7HhCL66B4w9re" name="code--view" integration-id="code" data="{\"file_path\": \"supabase/functions/worker/index.ts\", \"lines\": \"180-260\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01REe3uwhSzPWi4YmFU8ZtCT" name="code--view" integration-id="code" data="{\"file_path\": \"supabase/functions/worker/index.ts\", \"lines\": \"820-900\"}">
</lov-tool-use>
I have enough context. Let me present the plan.

<lov-plan>

## Plan: Hydrate Truncated Tweets via X API Before Translation

### Goal
When RSS delivers a truncated tweet, fetch the full text from the X API v2 (`note_tweet` field) **before** translation runs — so we never translate the truncated version, then re-translate the full version. Surface API usage on the dashboard.

### Strategy: Gate translation behind hydration

The cleanest way to avoid duplicate translation work is to **insert a new pipeline step** between ingest and translate, but only for posts flagged as truncated. Non-truncated posts skip the new step entirely and behave exactly as today.

```text
Current: webhook → translate job → deliver job
New:     webhook → [if truncated] hydrate_tweet job → translate job → deliver job
                  [if not]        translate job → deliver job
```

The translate job already reads `text_original` from the DB at runtime, so once `hydrate_tweet` updates `text_original`, translate sees the full text — no logic change inside translate itself.

---

### Step 1 — Schema additions (single migration)

Add three columns to `posts` (all nullable, no defaults that affect existing rows):

- `is_truncated boolean default false` — set by the webhook based on detection
- `hydrated_at timestamptz` — set by the new hydrate job on success
- `hydration_source text` — `'x_api'` when fetched, null otherwise

Add one column to `settings` data (no schema change — uses existing `settings` table) via a seeded row:
- `key = 'twitter_hydration'`, value = `{ enabled: true, max_attempts: 3 }`

No changes to existing columns. No index changes.

---

### Step 2 — Truncation detection in `webhooks-rssapp`

Add a small `detectTruncation(text)` helper. A post is flagged truncated if **any** of:
- Ends with `…`, `...`, `[…]`, or `[...]`
- Ends with (case-insensitive) `Show more`, `Show this thread`, `Read more`
- Length ≥ 270 chars AND no terminal punctuation (`.`, `!`, `?`, `؟`, `"`, `)`)

When detected:
1. Set `is_truncated = true` on the post upsert
2. **Do NOT** create a `translate` job (the new flow is what creates it)
3. Create a new `hydrate_tweet` job instead, with idempotency key `hydrate:${tweetId}`
4. Pipeline event: `step='hydrate', status='queued'`

When NOT truncated: behavior is unchanged — translate job is created exactly as today.

---

### Step 3 — New worker handler `handleHydrateTweetJob`

Lives in `supabase/functions/worker/index.ts` alongside the others. Logic:

1. Load post by `tweet_id`. If `hydrated_at` already set → success (idempotent).
2. Read Twitter creds from env (already wired: `TWITTER_CONSUMER_KEY/SECRET`, `TWITTER_ACCESS_TOKEN/SECRET`) — same OAuth 1.0a signing helper that `digest-compiler` uses (we'll extract it into a shared call within the worker file, no new file).
3. Call `GET https://api.x.com/2/tweets/{id}?tweet.fields=note_tweet,text,lang`
4. Extract `data.note_tweet.text` if present, else `data.text`. Update post:
   - `text_original = <full text>`
   - `is_truncated = false` (now resolved)
   - `hydrated_at = now()`
   - `hydration_source = 'x_api'`
   - `lang_original = response lang if available`
5. Increment a counter in `settings` row `key='x_api_usage'` (JSONB: `{ total: N, last_24h: [...timestamps], last_call_at: ... }`) — single row, atomic via `update ... set value = ...`. Worker reads-modifies-writes inside the same job, fine for low volume.
6. Insert the `translate` job with idempotency key `translate:${tweetId}` (same key the webhook would have used — guarantees no duplicate even if the webhook had also inserted one).
7. Pipeline event: `hydrate / completed`.

**Failure handling:**
- 404 (tweet deleted) → mark hydrated with `hydration_source = 'x_api_404'`, fall through to translate the truncated version (better than nothing). Do NOT retry.
- 429 (rate limited) → respect `x-rate-limit-reset` header for backoff. Reuse existing `handleJobFailure` retry path.
- 401/403 (creds bad) → fail fast, dead-letter after 3 attempts. Translate job is NOT created — admin must intervene.
- Network/5xx → exponential backoff up to `MAX_ATTEMPTS.hydrate_tweet = 3`.

After max attempts: **fallback path** — create translate job for the truncated text anyway, log `result_meta = { fallback: 'truncated' }`. We never silently lose a post.

`MAX_ATTEMPTS` gets a new entry: `hydrate_tweet: 3`.

---

### Step 4 — Anti-duplicate guarantees

Three layers ensure no double-translate:

1. **Webhook**: only creates `translate:${tweetId}` if `is_truncated = false`. If truncated, only creates `hydrate:${tweetId}`.
2. **Hydrate job**: creates translate job with `idempotency_key = translate:${tweetId}` and `onConflict: idempotency_key, ignoreDuplicates: true` — so even if a translate job somehow exists, it's a no-op.
3. **Translate handler**: already checks `text_translated` is null before working. We add an early return if `is_truncated = true AND hydrated_at IS NULL` (defense in depth — should never trigger).

---

### Step 5 — Reconciliation safety

Update `reconcile_stuck_jobs()` RPC to also reconcile posts where `is_truncated = true AND hydrated_at IS NULL AND created_at > now() - interval '7 days'` and no pending/running `hydrate_tweet` job exists → re-queue hydration. Identical pattern to existing missing-deliveries reconciliation.

---

### Step 6 — Dashboard & Monitoring metrics

**Dashboard** (`get_dashboard_summary` RPC):
Add to the `metrics` JSON:
- `posts_truncated_24h` — count of posts with `is_truncated = true OR hydrated_at IS NOT NULL` in last 24h
- `posts_hydrated_24h` — count where `hydration_source = 'x_api'` in last 24h
- `x_api_calls_24h` — read from the `settings` `x_api_usage` row, filtered to last 24h

Add a small card to `DashboardMetrics.tsx`: "X API calls (24h)" + "Hydrated tweets (24h)".

**Monitoring page** (`get_post_pipeline_status` RPC):
Add two columns to the return type:
- `is_truncated boolean`
- `hydrated_at timestamptz`

Render a small badge on each post row in the Monitoring table: "Truncated" (amber) or "Hydrated" (green) when applicable. Type signature change → frontend hook `useMonitoringData` types regenerate automatically from `types.ts` after migration.

---

### Step 7 — Settings UI (small)

Add a toggle in `Settings.tsx` (under existing content filter / digest section): **"Hydrate truncated tweets via X API"** — writes to the `twitter_hydration.enabled` settings row through the existing `admin-actions` Edge Function. When disabled, the webhook skips creating `hydrate_tweet` jobs and falls back to today's behavior (translate the truncated text directly).

Add a read-only status line: "X API calls this month: N" (from `x_api_usage` settings row).

---

### What we will NOT change

- `handleTranslateJob` internals — unchanged
- `handleDeliverJob` — unchanged
- Cron schedules — unchanged (worker still runs every 2 min, picks up `hydrate_tweet` jobs alongside others)
- Existing indexes
- OAuth signing for the digest function (we reuse the same pattern locally in worker)
- Any RLS policy

---

### Risk Assessment

- **Truncated detection false positives**: A normal tweet ending in `...` would trigger hydration and burn 1 API call. Mitigation: detection rules require ellipsis-at-end **plus** length ≥ 200, OR explicit "Show more" markers — tuned conservative.
- **X API outage**: Fallback path translates truncated text after 3 failed attempts → no posts lost.
- **Rate limit (Basic tier = 15K reads/mo ≈ 500/day)**: With current ingest volume (~dozens/day) this is well within budget. Settings counter exposes usage for monitoring.
- **Schema migration**: All new columns nullable with safe defaults → zero impact on existing posts.
- **Deploy order**: Migration first → worker deploy → webhook deploy. Until webhook is updated, no `hydrate_tweet` jobs are created, so worker handler sits idle. Until worker is deployed, the migration alone is harmless. Order is safe in either direction.

---

### Required Secret Confirmation

The X API call needs the four `TWITTER_*` secrets. From the existing config they appear to be **already used by `digest-compiler`** but I do not see them in the secrets list in this context. **Before implementation**, I will verify they exist; if missing, I will request you add them via the secrets tool before deploying the worker change.

---

### Files to be touched

- `supabase/migrations/<new>.sql` — schema additions, RPC updates (`get_dashboard_summary`, `get_post_pipeline_status`, `reconcile_stuck_jobs`), seed `twitter_hydration` + `x_api_usage` settings rows
- `supabase/functions/webhooks-rssapp/index.ts` — truncation detection + branched job creation
- `supabase/functions/worker/index.ts` — new `handleHydrateTweetJob`, OAuth helper, `MAX_ATTEMPTS.hydrate_tweet`, switch case
- `supabase/functions/admin-actions/index.ts` — validation for `twitter_hydration` settings key
- `src/components/dashboard/DashboardMetrics.tsx` — two new metric cards
- `src/pages/Monitoring.tsx` (and/or `useMonitoringData.ts` consumer) — render truncated/hydrated badges
- `src/pages/Settings.tsx` — toggle + usage display
- `mem://features/twitter-hydration` (new memory) + index update

