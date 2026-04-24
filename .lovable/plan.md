

## Fix: Improve truncation detection so RSS-cut tweets get hydrated

### Root cause

The example tweet ends with:

```
…If Iran doesn't want to make a… pic.
```

Two things made the current detector in `webhooks-rssapp/index.ts` (`detectTruncation`) say "not truncated":

1. The ellipsis `…` is **mid-text** (`make a…`), not at the very end, so the "trailing ellipsis" rule doesn't match.
2. The string ends with `.` (the leftover dot from `pic.twitter.com/...` that RSS.app chopped). `.` is in the "terminal punctuation" allowlist, so the "hard length cliff" rule also bails out.

Result: `is_truncated=false` → no `hydrate_tweet` job queued → translation runs on the truncated text → Telegram/X get the cut version. The earlier hydration fix only handles cases where the cut is clean (ellipsis at the very end or no terminal punct).

### Fix (one-file change)

Tighten `detectTruncation` in `supabase/functions/webhooks-rssapp/index.ts` with three additional, conservative signals that target the exact RSS.app failure modes we see:

1. **Trailing-`pic.` / `pic.t…` artifact** — RSS.app routinely cuts inside the auto-appended `pic.twitter.com/<id>` URL. If the trimmed text ends with the regex `/\bpic\.?(\s|$)|\bpic\.t(\s|$)|\bpic\.tw(itter)?(\.com)?\/?$/i`, mark truncated. This is a near-certain truncation indicator and very low false-positive risk (real sentences don't end with the bare token "pic." after long content).
2. **Mid-text ellipsis + length** — if any `…` / `[…]` / `...` appears in the body AND `length >= 240` AND last char isn't a closing quote/paren, mark truncated. Catches cases where Twitter's own "show more" replacement leaves an inline ellipsis followed by a chopped fragment.
3. **Trailing single-letter or article token after long text** — if `length >= 240` and the last whitespace-separated token matches `/^(a|an|the|to|of|in|on|for|and|or|but|with|by)\.?$/i`, mark truncated. Sentences don't naturally end on dangling articles/prepositions; this is a very strong "cut mid-sentence" signal even when followed by a stray period.

These three rules are added **in addition to** the existing two; nothing existing is loosened.

### Backfill (one-shot, optional but recommended)

Add a one-shot admin action `rehydrate_recent_truncated` in `admin-actions/index.ts` that:

- Scans `posts` from the last 24h where `hydrated_at IS NULL` AND text matches the new heuristics (re-runs the same predicate in SQL via `text_original ILIKE` patterns).
- For each match, sets `is_truncated=true` and inserts a `hydrate_tweet` job with idempotency key `hydrate:backfill:<tweet_id>`.
- Returns `{ scanned, queued }`.

UI: a small "Re-hydrate recent truncated tweets" button in Settings → Twitter Hydration card that calls this action. Lets you fix the existing tweet (and any others from the past day) without waiting for new ones.

### Verification plan

After the change:
1. New tweets ingested via webhook with `pic.` / dangling-article endings will be flagged `is_truncated=true` and routed through `hydrate_tweet` → full text from X API v2 → translate → deliver.
2. Run the backfill action once to reprocess the example tweet and any siblings from the last 24h.
3. Watch Monitoring: affected posts should show `hydrated_at` populated and `hydration_source = 'x_api'`, with the Persian translation reflecting the full tweet.

### Files touched

**Modified (3)**:
- `supabase/functions/webhooks-rssapp/index.ts` — extend `detectTruncation` with the three new rules.
- `supabase/functions/admin-actions/index.ts` — add `rehydrate_recent_truncated` action.
- `src/components/settings/PromptEditor.tsx` (or wherever the Twitter Hydration card lives — I'll confirm during implementation) — add the "Re-hydrate recent truncated tweets" button wired to the new action.

No DB migration, no schema changes, no new secrets.

