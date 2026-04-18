

## Goal
Fix scoring so substantive Iran-related content (polls about the Iran war, public-opinion shifts, leadership statements) doesn't get buried at 8. Two structural problems must be solved together:

**Problem A — Live worker ignores the editable rubric.** `supabase/functions/worker/index.ts` hardcodes the rubric (lines 360–392). The Settings UI saves `scoring_system_prompt` and `classifier_tool_schema` to the `settings` table, but only the *playground* uses them. So no matter how you edit the rubric, the production pipeline keeps using the old hardcoded one. This must be fixed first or any rubric change is cosmetic.

**Problem B — The rubric itself misclassifies the Politico tweet.**
The current rubric has these gaps:
- No tier for **public-opinion polls / sentiment data** about ongoing wars or Iran policy.
- The "Iran/Middle East Relevance Gate" is binary and over-aggressive: a tweet framed around "Trump / Americans" can trip the cap-at-8 rule even when the *subject* is the Iran war.
- The "13–14 IMPORTANT" tier requires a "diplomatic meeting / policy change" — a poll about war legitimacy slips through the cracks.
- No tier for **leadership rhetoric, contested narratives, war-legitimacy shifts**.

## Plan

### Step 1 — Wire worker to editable rubric (parity fix)
Change `supabase/functions/worker/index.ts` (the `filterEnabled` branch around lines 353–467) to:
- Read `scoring_system_prompt` and `classifier_tool_schema` from settings (the loader at the top of the file already loads `translation_prompt`; extend it to load these two fields).
- Build the system prompt by substituting `{translation_prompt}`, `{priority_topics}`, `{low_priority_topics}`, `{editorial_guidelines_block}` placeholders — same logic the playground already uses in `admin-actions/index.ts`.
- Fall back to the current hardcoded text if the setting is empty (safety net).
- Use the editable tool schema if present, else fall back to the hardcoded one.

This makes the playground and live worker behave identically — the whole point of the playground.

### Step 2 — Rewrite the default scoring rubric
Update `DEFAULT_SCORING_SYSTEM_PROMPT` in `src/hooks/useSettingsData.ts` and the matching block in the worker. New rubric introduces:

**New explicit tier descriptions** that include polls/sentiment/legitimacy:
- **15–16 HIGH** — adds: *"public-opinion shifts on active wars/conflicts where Iran or US-Iran relations are the subject; major polling that contradicts official narratives on Iran policy; significant leadership rhetoric on Iran."*
- **13–14 IMPORTANT** — adds: *"polling/sentiment data on Iran-related foreign policy; contested-narrative reporting on Iran war goals or strikes; notable analyst/think-tank assessments."*
- **11–12 ABOVE AVERAGE** — adds: *"general US/Western public-opinion data with indirect Iran relevance."*

**Replace the binary Iran-gate with a 3-level relevance scale:**
- **Direct Iran subject** (Iran government, IRGC, Iranian territory, nuclear program, Hormuz, proxies, sanctions on Iran, Israel-Iran, US-Iran war/strikes): no cap, score on merit.
- **Indirect Iran-adjacent** (Iran is the *subject* of foreign discussion, e.g. polls about the Iran war, Western debate over Iran policy, analyst reports on Iran): cap at **16**, not 8.
- **No Iran nexus** (pure US domestic, EU internal, China domestic, etc.): cap at **8**.

This single change fixes the Politico tweet — it's "indirect Iran-adjacent" (US polling about the *Iran war*), so it can score 13–15 instead of being capped at 8.

**Add anti-bias guardrails:**
- "Do not down-score because the framing is American or Western — score on whether the subject matter is Iran/Middle East."
- "A poll, leak, or analyst report can be as important as a primary event if it materially changes the public or political picture of an active Iran-related conflict."
- "When in doubt between two adjacent tiers, prefer the higher tier."

**Tighten the reasoning requirement:**
- Require the model to state, in `reasoning`, (a) which relevance level it assigned, (b) which rubric tier and why, (c) any cap applied.

### Step 3 — Re-tune threshold defaults
- Lower `default_threshold` from **14 → 12** in `content_filter` so "important Iran-adjacent" content (13–14 band) is delivered. Anything below 12 still gets filtered.
- This is editable in Settings; just changing the default.

### Step 4 — Backfill / re-score the Politico tweet (verification)
Add a one-off action: re-run the translation+scoring on that specific tweet using the new rubric so you can see the new score immediately, without waiting for a fresh tweet. Reuse the existing `preview_translation` plumbing but add an `apply: true` flag that writes the new score back to `posts`.

### Step 5 — Surface scoring reasoning in Monitoring
Right now `reasoning` is logged but not visible. Add a small "Why this score?" expandable row in the Monitoring table showing the AI's reasoning text (already stored in worker logs; we'll persist it on the `posts` row via a new nullable `importance_reasoning` column). This gives you a debug loop next time a score looks wrong.

---

## Files to change

| File | Change |
|---|---|
| `supabase/functions/worker/index.ts` | Load editable scoring prompt + tool schema from settings; substitute placeholders; persist `importance_reasoning` |
| `src/hooks/useSettingsData.ts` | New `DEFAULT_SCORING_SYSTEM_PROMPT` (3-tier relevance, poll/sentiment tiers, anti-bias notes); lower `default_threshold` to 12 |
| `supabase/functions/admin-actions/index.ts` | Add `rescore_post` action (re-runs scoring for a given `tweet_id` and writes back) |
| `src/pages/Monitoring.tsx` (+ `useMonitoringData.ts`) | Show `importance_reasoning` in expandable row; add "Re-score" button per post |
| Migration | Add `posts.importance_reasoning text` column |
| `mem://ai/translation-settings` + `mem://features/ai-content-curation` | Update memory: rubric now has 3-level relevance gate, default threshold 12, worker reads rubric from settings |

## Expected outcome for the Politico tweet
Under the new rubric: subject = US public opinion on the **Iran war** + Trump's claimed Iran war goals → "indirect Iran-adjacent" (cap 16) → falls in 13–15 band (significant polling that contradicts official narrative on an active Iran conflict) → **delivered** at threshold 12.

