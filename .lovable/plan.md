
# Make PR1 + PR2 + PR3 production-ready

Everything is built, but nothing is **active**, and there are real bugs that would bite the moment you turn it on. This plan finishes the wiring, fixes the bugs, adds the missing visibility, and seeds defaults so the three systems start working without manual JSON editing.

## What's broken today (audit results)

| # | Issue | Where | Severity |
|---|-------|-------|----------|
| 1 | `editorial_profiles` and `story_memory` settings rows do not exist → worker silently falls back to legacy filter | DB `settings` table | High |
| 2 | Story Memory runs **inside `deliver`** → filtered/skipped posts never get a signature, leaving holes in the dedup memory window | `worker/index.ts` line ~1300 | High |
| 3 | "Backfill last 24h" enqueues `deliver` jobs → already-delivered posts short-circuit and never compute a signature; the button is effectively a no-op for the common case | `admin-actions/index.ts` line ~854 | High |
| 4 | `coverage_count` bump on the original signature is wrong: `update({ coverage_count: 1 })` overwrites to 1 instead of incrementing; also contains a dead `exec_sql` placeholder | `worker/index.ts` lines ~434-438 | Medium |
| 5 | Only 864 of 4077 posts have axes → no historical visibility, dry-runs based on profile weights look empty | `posts` table | Medium |
| 6 | Monitoring UI shows nothing for duplicates — no `dup_of` chip, no cluster link | `useMonitoringData.ts` / row renderer | Medium |
| 7 | X Automation tab is blank in the browser (likely stale `x_posting_config` missing newer fields) | `XPostingConfig.tsx` initial-prop guard | Medium |
| 8 | No seeded initial Editorial Profile → activating requires hand-filling axis weights, threshold, etc. | UI default | Low |
| 9 | `find_similar_story` returns one row but `runStoryDedup` doesn't tie-break on simhash distance for the 0.85–0.87 fuzzy zone | `worker/index.ts` | Low |

## Scope — what this PR does

### A. Refactor Story Memory to its own job (fixes #2, #3, #4)

1. **New job type `compute_signature`** in worker. Runs after `translate` completes for any post (regardless of decision). Steps:
   - Normalize translated text → SimHash → OpenAI embedding (`text-embedding-3-small`).
   - Upsert into `story_signatures`.
   - Run `find_similar_story` lookup; if a match is found, set `posts.dup_of_tweet_id`, `posts.story_cluster_id`, `posts.dup_similarity` and `coverage_count++` on the **original** signature via a new `bump_coverage_count(tweet_id text)` SQL function (atomic, race-free).
2. **Pipeline sequencing**: `translate` handler enqueues `compute_signature` (priority 11) before `deliver`. `deliver` only **reads** `posts.dup_of_tweet_id` to decide whether to skip — no embedding work happens at deliver time anymore.
3. **`backfill_signatures` admin action**: replace the broken `deliver` enqueue with `compute_signature` enqueues, so it actually populates signatures even for already-delivered posts. Default 48h, max 168h.
4. **Idempotency**: `compute_signature:<tweet_id>` (no Date.now suffix needed — re-running is safe because of upsert).

### B. Seed and activate Editorial Profiles + Story Memory (fixes #1, #8)

1. **One-time SQL seeding migration** that inserts default rows into `settings` if missing:
   - `editorial_profiles` ⇒ a single profile named **"Iran-war default"** mirroring the user's current legacy `content_filter` (threshold 14, the existing priority/low_priority topic lists, balanced axis weights with `iran_relevance: 4`, `severity: 3`, `novelty: 2`, `credibility: 2`, `actionability: 1`, `noise: 4`, `corroboration` defaults).
   - `active_profile_id` ⇒ pointing to that profile.
   - `story_memory` ⇒ `{ enabled: true, window_hours: 12, similarity_threshold: 0.86, action: "skip", bypass_authors: [] }`.
2. **UI affordance**: in `EditorialProfilesCard`, when no profiles exist show a one-click **"Create from current filter"** button instead of forcing the user to hand-build.
3. **Backfill axes**: new admin action `rescore_recent` (hours param, default 48, max 168) that enqueues `score_only` jobs for posts missing `score_axes`. Surfaced as a button on the Editorial Profiles card.

### C. Make duplicates visible in Monitoring (fixes #6)

1. Extend `useMonitoringData` to include `dup_of_tweet_id`, `story_cluster_id`, `dup_similarity` on each entry.
2. In the Monitoring row renderer, add a small purple **"dup"** chip when present, with hover tooltip showing `dup_of <tweet_id> · cosine N.NN`. Clicking the chip filters the list to that cluster.
3. Add a top-level **"Story clusters (24h)"** count badge on Monitoring header showing how many posts were skipped as duplicates.

### D. Unblock the X Automation tab (fixes #7)

1. Add a runtime guard at the top of `XPostingConfig.tsx` that wraps `initial` through a defensive normalizer (`normalizeXPostingConfig`) which fills missing fields from `DEFAULTS` without throwing on unexpected shape.
2. Wrap the tab content in an error boundary so a bad setting can't blank the whole page.
3. Add an inline **"Reset config to defaults"** button in case a user's stored value is unrecoverable.

### E. Hardening + tests (fixes #9 + general)

1. SimHash tie-break: when cosine is in [threshold, threshold+0.02], require Hamming distance ≤ 12 to accept the match.
2. Cap embedding API failures: don't insert an embedding-less row that would silently never match later — instead enqueue a one-off retry job (priority 12) with backoff.
3. Add `vitest` test for `applyProfileDecision` precedence (author override > blocked tags > required tags > must_exclude > threshold).
4. Add Deno test for `simHash64` + `normalizeForHash` (deterministic across runs, distance triangle-inequality sanity).

## Out of scope (explicitly deferred)

- Per-profile Story Memory tuning (currently global is fine for one-account use).
- `corroboration` axis feedback into `final_score` (would require re-balancing weights; do after we have signature data flowing).
- Editorial Console redesign (PR4 in the original plan).
- Anything in the X aggregator-penalty plan (separate effort).

## Rollout order

1. Migration: `bump_coverage_count` SQL function + `settings` seed rows (skipped if already present).
2. Worker: new `compute_signature` handler, remove dedup from deliver, deliver only reads `posts.dup_of_tweet_id`.
3. `admin-actions`: rewrite `backfill_signatures`, add `rescore_recent`.
4. `EditorialProfilesCard`: "Create from current filter" + "Re-score last 48h" buttons.
5. `Monitoring`: dup chip, cluster filter, header badge.
6. `XPostingConfig`: normalizer guard + error boundary + reset button.
7. Tests + memory file updates.

## Verification (how you'll check it after merge)

| Check | Expected |
|-------|----------|
| Settings → Filter tab | Editorial Profiles card shows "Iran-war default" as active; Story Memory card shows enabled |
| Click "Re-score last 48h" | Toast: "Queued N posts" — within ~5 min, `posts.score_axes` count climbs |
| Click "Backfill signatures (48h)" | Toast: "Queued N" — within ~5 min, `story_signatures` row count climbs from 0 |
| Monitoring | Posts skipped as duplicates show a purple "dup" chip; header shows "X duplicates today" |
| Settings → X Automation | Card renders even with stale config; "Reset" button visible |
| New incoming post that paraphrases an existing one | Gets `delivery_decision='skip'`, `decision_reason='dup_of <id>'`, visible in Monitoring |

## Files to touch

- New migration: `bump_coverage_count` function + idempotent `INSERT ... ON CONFLICT DO NOTHING` for the three settings rows.
- `supabase/functions/worker/index.ts`: new `compute_signature` job handler, remove deliver-time dedup, simplify deliver to read-only check, fix coverage bump call.
- `supabase/functions/admin-actions/index.ts`: rewrite `backfill_signatures` (enqueue `compute_signature`), add `rescore_recent`.
- `src/components/settings/EditorialProfilesCard.tsx`: "Create from current filter" + "Re-score last 48h" buttons.
- `src/hooks/useMonitoringData.ts`: surface dup fields.
- `src/pages/Monitoring.tsx`: dup chip + header badge + cluster filter.
- `src/components/settings/XPostingConfig.tsx`: defensive normalizer + reset button.
- `src/pages/Settings.tsx`: wrap X Automation tab in error boundary.
- New: `supabase/functions/worker/_test/profile_decision_test.ts`, `supabase/functions/worker/_test/simhash_test.ts`, `src/test/profile-decision.test.ts`.
- Memory: update `mem://features/multi-axis-scoring` and add `mem://features/story-memory`.

## Risk / cost notes

- Re-scoring 3,200 posts (`4077 - 864`) at gpt-4o-mini: ~$0.40 total.
- Backfilling embeddings for 4,000 posts at `text-embedding-3-small`: ~$0.08.
- pg_cron retention already prunes `story_signatures` after 7 days, so storage growth is bounded.

