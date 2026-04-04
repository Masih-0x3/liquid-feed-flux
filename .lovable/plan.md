

## Plan: Automated Twitter Digest (30-Minute Summary Posts)

### What This Does

Every 30 minutes, the system collects all recently ingested and translated tweets, sends them to OpenAI for summarization into concise bullet points, pairs each bullet with its relevant image, and posts the compiled digest as a thread on Twitter/X.

---

### Architecture

```text
┌─────────────────────────────────────────────────┐
│  pg_cron (every 30 min)                         │
│  → net.http_post → digest-compiler function     │
└──────────────────┬──────────────────────────────┘
                   │
     ┌─────────────▼──────────────┐
     │  Edge Function:            │
     │  digest-compiler           │
     │                            │
     │  1. Query posts from last  │
     │     30 min (translated)    │
     │  2. Send to OpenAI for     │
     │     bullet-point summary   │
     │  3. Download relevant      │
     │     images from storage    │
     │  4. Post thread to X via   │
     │     Twitter API v2         │
     │  5. Record digest in DB    │
     └───────────────────────────┘
```

---

### Components to Build

**1. New database table: `digests`**

Tracks each compiled digest for history, debugging, and preventing duplicates.

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid (PK) | |
| period_start | timestamptz | Window start |
| period_end | timestamptz | Window end |
| post_ids | text[] | Tweet IDs included |
| summary_text | text | AI-generated summary |
| twitter_tweet_ids | text[] | Posted tweet IDs on X |
| status | text | pending / posted / failed / skipped |
| error | text | Last error if failed |
| created_at | timestamptz | |

RLS: same pattern as other tables (admin manage, authenticated view).

**2. New Edge Function: `digest-compiler/index.ts`**

Steps executed in sequence:

1. **Collect posts**: Query `posts` table for rows where `created_at` is within the last 30 minutes, `text_translated IS NOT NULL`, and optionally `delivery_decision = 'deliver'` (only include posts that passed the content filter).

2. **Skip if empty**: If fewer than 2 posts, skip this cycle (insert a `skipped` digest record).

3. **Build OpenAI prompt**: Send all translated texts + author handles + original URLs to OpenAI, asking for a structured JSON response with bullet-point summaries (each bullet referencing which tweet it came from).

4. **Compose tweet thread**: Format the summary into tweet-sized chunks (max 280 chars each). The first tweet is a header ("📰 News Digest — HH:MM"), subsequent tweets are bullet points. Attach the first relevant image to each tweet where available.

5. **Upload media to Twitter**: For each tweet with an image, download the image from Supabase storage, upload to Twitter's media upload endpoint (`https://upload.twitter.com/1.1/media/upload.json`), get the `media_id`.

6. **Post thread to X**: Use Twitter API v2 (`POST https://api.x.com/2/tweets`) to post each tweet in sequence, using `reply.in_reply_to_tweet_id` to chain them into a thread.

7. **Record result**: Insert into `digests` table with status and tweet IDs.

**3. Twitter API Authentication (OAuth 1.0a)**

The Twitter v2 API requires OAuth 1.0a for posting tweets. This needs:
- `TWITTER_CONSUMER_KEY`
- `TWITTER_CONSUMER_SECRET`
- `TWITTER_ACCESS_TOKEN`
- `TWITTER_ACCESS_TOKEN_SECRET`

These must be added as Supabase Edge Function secrets. The edge function will implement OAuth 1.0a signature generation (HMAC-SHA1) inline — no external library needed for Deno.

**4. Cron job (pg_cron)**

A `cron.schedule` entry to invoke the `digest-compiler` function every 30 minutes:
```sql
SELECT cron.schedule('digest-every-30min', '*/30 * * * *', $$
  SELECT net.http_post(
    url := 'https://jzirqfzzvlbxwfzndaer.supabase.co/functions/v1/digest-compiler',
    headers := '{"Authorization": "Bearer <anon_key>"}'::jsonb,
    body := '{}'::jsonb
  );
$$);
```

**5. Config entry in `supabase/config.toml`**

```toml
[functions.digest-compiler]
verify_jwt = false
```

---

### New Secrets Required

| Secret | Source |
|--------|--------|
| `TWITTER_CONSUMER_KEY` | Twitter Developer Portal → App → Keys |
| `TWITTER_CONSUMER_SECRET` | Same |
| `TWITTER_ACCESS_TOKEN` | Same (with Read+Write permissions) |
| `TWITTER_ACCESS_TOKEN_SECRET` | Same |

`OPENAI_API_KEY` is already configured and will be reused.

---

### Edge Cases Handled

- **No posts in window**: Skip, log a `skipped` digest
- **Thread too long**: Cap at 10 bullet points, add "... and N more"
- **Image download fails**: Post tweet without media, log warning
- **Twitter rate limit (429)**: Retry with backoff, mark digest as `failed` if exhausted
- **Duplicate prevention**: Check `digests` table for existing record with same `period_start` before processing

---

### Files Changed / Created

| File | Action |
|------|--------|
| `supabase/functions/digest-compiler/index.ts` | **Create** — main logic |
| `supabase/config.toml` | **Edit** — add `[functions.digest-compiler]` |
| Migration SQL | **Create** — `digests` table + RLS |
| Cron SQL (via SQL editor) | **Insert** — 30-min schedule |

No frontend UI changes in this phase (digest history could be added to the Dashboard later).

---

### Implementation Order

1. Add Twitter API secrets (will prompt you)
2. Create `digests` table migration
3. Build `digest-compiler` edge function
4. Add config.toml entry and deploy
5. Set up cron job
6. Test end-to-end with a manual invocation

