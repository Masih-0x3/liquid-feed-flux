---
name: Multi-axis scoring (PR1)
description: 6-axis AI scoring schema (iran_relevance, severity, novelty, credibility, actionability, noise — each 0–10), persisted to posts.score_axes; final_score derived in worker
type: feature
---

PR1 of the Editorial Console rollout.

- **Tool schema**: `classify_importance` requires both `importance_score` (1–20, legacy) AND `axes` (object with 6 0–10 fields). Worker auto-injects `axes` into customized schemas at runtime if missing — so user-saved `classifier_tool_schema` keeps working.
- **`noise` is INVERTED** — high = bad (spam/promo/sports). Subtracts from final_score.
- **`final_score`** computed in worker via `computeFinalScore(axes, weights)` with uniform default weights for now. PR2 (editorial profiles) will swap in per-profile weights.
- **`decision_reason`** is a short tag explaining the gate outcome: `score_pass:N>=T`, `below_threshold:N<T`, `author_rule:always_skip:@x`, `score_only_mode`, `filter_disabled`. Stored on posts and shown in Monitoring.
- **Backward compat**: when AI returns only `importance_score` (no axes), filtering still uses it; `final_score` falls back to `importance_score`.
- **Helpers exported** from `worker/index.ts`: `SCORE_AXIS_KEYS`, `parseScoreAxes`, `computeFinalScore`, `DEFAULT_AXIS_WEIGHTS` (only `DEFAULT_AXIS_WEIGHTS` is internal). PR2 will move them to `_shared/` and add a `weights` arg sourced from the active profile.
