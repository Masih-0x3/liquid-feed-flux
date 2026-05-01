---
name: Hydration re-translation invariants
description: Idempotency key + stale-translation invalidation rules that prevent truncated tweets from being delivered after hydration
type: constraint
---
When a truncated tweet is hydrated to its full text, two invariants MUST hold to prevent delivering the stale truncated translation:

1. **Distinct idempotency key for re-translation.** The post-hydrate translate job MUST use key `translate:hydrate:${tweetId}` — never `translate:${tweetId}`. The latter collides with the initial truncated translation job and the upsert is silently ignored, so the full text never gets translated. See `queueTranslateAfterHydrate` in `supabase/functions/worker/index.ts`.

2. **Invalidate stale translation on hydration.** When `handleHydrateTweetJob` writes the full `text_original` + `hydrated_at` + `is_truncated=false`, it MUST also set `translated_at = null` and `text_translated = null`. Both `x-poster` and the Telegram delivery path filter on `text_translated is not null`, so nulling these fields acts as a hard gate that blocks publishing until the new translation lands.

**Why:** Without rule 1 the re-translation never runs. Without rule 2 there is a multi-second window after hydration where the old truncated `text_translated` is still in the row and downstream cron-driven publishers (especially `x-poster`) will pick it up. Both rules are required — neither alone is sufficient.
