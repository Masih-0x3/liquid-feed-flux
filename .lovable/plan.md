# PR3 — Story Memory (Semantic Dedup)

Detect when two different outlets report the same story in different words (e.g. two news sites covering the same Israeli strike). Today we only dedupe on exact tweet_id / URL.

## Scope

### 1. Database
- Enable `pgvector` extension.
- New table `story_signatures`:
  - `tweet_id text PK`
  - `simhash bigint` (64-bit fingerprint of normalized translated text)
  - `embedding vector(1536)` (OpenAI `text-embedding-3-small`)
  - `story_cluster_id uuid` (groups duplicates)
  - `coverage_count int default 1`
  - `created_at timestamptz`
- ivfflat index on `embedding`, btree on `(created_at desc)`.
- New columns on `posts`: `dup_of_tweet_id text`, `story_cluster_id uuid` (so Monitoring can show "dup of …").
- RLS: admin-only, mirrors existing tables.

### 2. Settings
New `story_memory` setting (or nest under each profile — see Decision below):
```jsonc
{
  "enabled": true,
  "window_hours": 12,
  "similarity_threshold": 0.86,
  "action": "skip",                 // skip | mark_and_deliver
  "bypass_authors": ["@OfficialIRGCEN"]
}
```

**Decision to confirm**: Put it on each Editorial Profile (richer, matches PR2) **or** as a single global `story_memory` setting (simpler). I'll go with **per-profile, with a global fallback** — matches the PR2 architecture.

### 3. Worker — new job type `compute_signature`
- Enqueued automatically after `translate` completes, priority 11.
- Steps: normalize text → simhash → call OpenAI embeddings (`text-embedding-3-small`, ~$0.00002/post) → upsert `story_signatures`.
- Two-tier match against rows within `window_hours`:
  1. **Tier 1 — SimHash**: Hamming distance ≤ 6 → fast match.
  2. **Tier 2 — Cosine**: `1 - (embedding <=> candidate)` ≥ `similarity_threshold` → match.
- On match: assign existing `story_cluster_id`, set the new post's `dup_of_tweet_id`, increment original's `coverage_count`.

### 4. Deliver gate
Before publishing in `worker` deliver step:
- If `dup_of_tweet_id IS NOT NULL` and active profile's `story_memory.action = 'skip'` and author not in `bypass_authors`:
  - Set `delivery_decision='skip'`, `decision_reason='dup_of <tweet_id> (cosine 0.91)'`, finish.
- If `action = 'mark_and_deliver'`: still publish, but tag is preserved.

### 5. Edge functions
- `admin-actions`: add `backfill_signatures` action — enqueues `compute_signature` for any post in last N days missing a row.
- Validation for new `story_memory` settings keys.

### 6. UI — new "Story Memory" card on Settings → Filter tab
- Enable toggle, window slider (1–48h), similarity slider (0.80–0.95), action select, bypass-authors chip input.
- "Recent duplicate clusters" list: original post + N suppressed duplicates + expand to view.
- "Backfill signatures (last 24h)" button.

### 7. Monitoring
- Show `dup_of` chip in row when present, with cosine score.

## Out of scope (reserved for PR4)
- `corroboration` axis feeding back into scoring.
- Impact preview / re-score.
- Dashboard "editorial decisions" widget.

## Files touched
- New migration: extension + table + columns + RLS.
- New: `src/components/settings/StoryMemoryCard.tsx`.
- Edited: `supabase/functions/worker/index.ts` (new handler + deliver gate), `supabase/functions/admin-actions/index.ts` (validation + backfill), `src/pages/Settings.tsx` (mount card), `src/hooks/useSettingsData.ts` (types/defaults), `src/components/monitoring/*` (dup chip), `src/components/settings/EditorialProfilesCard.tsx` (story_memory section per profile).

## Risks / notes
- pgvector adds ~10MB per 10k posts. Auto-cleanup hooked into existing 7-day retention.
- Embeddings cost: ~$0.02 per 1000 posts. Negligible.
- Worker latency: +~300ms per post for embedding call. Acceptable since it's parallel to deliver gating.
