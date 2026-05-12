---
name: Editorial profiles & multi-axis scoring (PR1+PR2)
description: 6-axis AI scoring (PR1) plus editorial profiles with per-profile weights, threshold, hard rules, and author overrides (PR2)
type: feature
---

## PR1 — Multi-axis scoring
- Tool schema: `classify_importance` requires both `importance_score` (1–20, legacy) AND `axes` (object with 6 0–10 fields). Worker auto-injects `axes` into customized schemas at runtime if missing — so user-saved `classifier_tool_schema` keeps working.
- `noise` is INVERTED — high = bad (spam/promo/sports). Subtracts from final_score.
- Helpers exported from `worker/index.ts`: `SCORE_AXIS_KEYS`, `parseScoreAxes`, `computeFinalScore`. `DEFAULT_AXIS_WEIGHTS` is internal only.
- Backward compat: when AI returns only `importance_score` (no axes), filtering still uses it; `final_score` falls back to `importance_score`.

## PR2 — Editorial Profiles
- Two new settings keys (validated in `admin-actions`): `editorial_profiles` = `{ profiles: EditorialProfile[] }`, `active_profile_id` = `{ id: string|null }`.
- An `EditorialProfile` bundles `weights` (per-axis 0–5), `threshold` (0–20), `must_include_keywords` (+2 boost each, capped at 20), `must_exclude_keywords` (auto-skip), `required_tags_any` (auto-skip if no match), `blocked_tags` (auto-skip), `author_overrides` (`always_deliver`/`always_skip`).
- Decision precedence (in `applyProfileDecision`, exported from worker): author_override → blocked_tags → required_tags_any → must_exclude_keywords → final_score = `computeFinalScore(axes, profile.weights)` + must_include boost → threshold gate.
- Worker uses active profile when set; falls back to legacy `content_filter` (default_threshold + author_rules) otherwise. Both pre-translation gate (split_calls=true) and post-translation gate use the same helper.
- UI: `EditorialProfilesCard` mounted above legacy `ContentFilterSettings` in the Filter tab. Profile CRUD (new/duplicate/delete/set-active) + name/threshold/axis sliders + 4 chip lists + editorial note.
- Save flow: single button writes `editorial_profiles` then `active_profile_id` via `useSaveSettings`.
- Types live in `src/hooks/useSettingsData.ts` (`EditorialProfile`, `ScoreAxisKey`, `SCORE_AXIS_KEYS`, `DEFAULT_AXIS_WEIGHTS`, `makeDefaultProfile`).
