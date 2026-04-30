## Goal

Stop spending X API reads on tweets that get filtered out anyway. Hydrate only after a tweet has been translated, scored, and confirmed to be above the delivery threshold.

## Why this works

Last 7 days of real data:

- 477 tweets were hydrated (= 477 X API reads)
- Only 149 of them (31%) ended up delivered
- 328 (69%) were hydrated and then skipped because their score was below 14

Hydrating only winners projects to **~149 reads/week** instead of ~477 — roughly a **70% reduction** in X API read usage, with no loss in published content quality.

## New pipeline order

```text
RSS webhook
  └─> ingest post (mark is_truncated if detected, but DO NOT enqueue hydration)
        └─> translate + score the truncated text (1 OpenAI call, no X read)
              ├─ score < threshold  → mark skip, done. Zero X reads spent.
              └─ score >= threshold AND is_truncated
                    └─> enqueue hydrate_tweet  (1 X API read)
                          └─> re-translate + re-score the full text (1 OpenAI call)
                                └─> enqueue deliver
```

Tweets that aren't truncated keep the current flow (translate -> score -> deliver, no hydration ever needed).

## Changes required

### 1. `webhooks-rssapp/index.ts` — stop pre-hydrating
- Keep `detectTruncation()` and keep persisting `is_truncated` on the post (we still need the flag).
- Remove the block that enqueues a `hydrate_tweet` job when `isTruncated && hydration enabled`.
- Always enqueue a `translate` job instead, even for truncated posts.

### 2. `worker/index.ts` — gate hydration on score
- After the `translate` step computes `importance_score` and `delivery_decision`:
  - If `delivery_decision === 'deliver'` AND `post.is_truncated === true` AND `post.hydrated_at IS NULL` AND hydration is enabled:
    - Do NOT enqueue `deliver` yet.
    - Enqueue `hydrate_tweet` (priority 15) with idempotency key `hydrate:post-translate:<tweet_id>`.
  - Otherwise behave exactly as today (enqueue `deliver` if approved, or skip).
- After `hydrate_tweet` completes successfully, the existing logic already enqueues a follow-up `translate` job — keep that. The re-translation will re-score on the full text and then go through the same gate; the second time `is_truncated` is `false` (we set it false on hydration success) so it falls through to `deliver`.

### 3. `reconcile_stuck_jobs()` RPC — narrow the safety net
- Currently re-creates `hydrate_tweet` for every truncated, un-hydrated post in the last 7 days. That re-introduces wasted reads.
- Change it to only re-enqueue hydration for posts that ALSO have `delivery_decision = 'deliver'` (or are still un-translated and un-scored — those will re-enter the new flow naturally).
- Tighten window from 7 days to 24 hours.

### 4. Add a daily hydration budget (defensive)
- Add `hydrations_per_day` (default 100) to the existing `x_rate_limits` settings row.
- In `worker/index.ts` `hydrate_tweet` handler, before calling X API: count `pipeline_events` of step `hydrate` with status `running`/`completed` in the last 24h. If >= budget, mark the job completed with `hydration_source = 'budget_exhausted_fallback'`, leave `text_translated` as the truncated translation, and enqueue `deliver`.
- Surface the budget + today's usage in the dashboard later (out of scope for this change).

### 5. UI surfacing (small)
- Add a tooltip / helper text on the X API metric card explaining "Reads only fire for tweets that pass the score threshold."
- No new screens or settings UI in this round — the budget can be tuned via SQL until we add a control.

## What stays the same

- Truncation detection heuristics (no changes; we still need the flag).
- Translation model, scoring rubric, threshold, author rules.
- Telegram delivery formatting.
- X posting (write) flow — completely untouched.

## Trade-off to be aware of

The first translation/score is done on truncated text, which is slightly less informative than the full tweet. A small number of tweets that *would* have scored ≥14 with full text might score 12–13 on the truncated version and get dropped. To mitigate:
- The score is "best signal available" — RSS.app truncation usually preserves the lede, which is what scoring keys on.
- We can lower the threshold by 1 (e.g. 14 -> 13) for posts where `is_truncated = true` to compensate. I recommend NOT doing this in v1 — let's measure first. If we see legitimate news being filtered, we add the truncated-tweet score bonus in a follow-up.

## Expected impact

| Metric | Today (7d) | After change | Change |
|---|---|---|---|
| X API reads | ~477 | ~150 | -69% |
| OpenAI translate calls | ~2,622 | ~2,770 (slight increase: re-translate winners) | +6% |
| Delivered tweets | 484 | ~484 (unchanged) | 0% |

Net: large drop in your most-expensive resource (X API), tiny increase in OpenAI cost, identical user-facing output.
