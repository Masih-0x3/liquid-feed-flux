# Plan: Granular Scoring, Day-to-Day Filtering, and Story Memory (Dedup)

Now that scoring is its own OpenAI call, we make it richer (multi-axis), more steerable (a "today's focus" dial), more transparent (per-axis thresholds + dry-run preview), and we add a real **Story Memory** so the same event from multiple outlets isn't published twice.

## Goals
1. **Granular scoring** — replace one 1–20 number with a small set of axes the model fills in.
2. **Day-to-day customization** — change priorities/weights/keywords from the UI without touching prompts; preview impact instantly.
3. **Better filtering** — combine axes via a weighted formula plus rules (must-have / must-not-have / author overrides).
4. **Semantic dedup** — detect near-duplicate stories across outlets (Story Memory) and either skip or boost coverage.

---

## 1. Multi-axis scoring (replace the single score)

Have the scoring tool return a structured object instead of one number. Default axes (each 0–10):

| Axis | What it measures |
|---|---|
| `iran_relevance` | DIRECT=8–10, INDIRECT=4–7, NONE=0–3 |
| `severity` | strike/war > policy > analysis > routine |
| `novelty` | breaking > update > recap |
| `credibility` | official > reporter > anon |
| `actionability` | does it shift policy/markets/war? |
| `noise` | inverted — high = spammy/promo/personal |

Plus existing fields: `tags[]`, `reasoning`, and a derived `final_score` computed **client/server-side** from a weights formula (so re-tuning doesn't require re-scoring).

`final_score = Σ(axis × weight) − noise × noise_weight`, normalized to 0–20.

Why axes-then-formula: today the model conflates "Iran-relevant", "important", and "breaking". Splitting them lets you say "today I only care about novelty + severity" without rewriting the rubric.

## 2. Editorial Profiles (the day-to-day dial)

New `editorial_profiles` setting (JSON) holds named profiles, e.g. `default`, `war_mode`, `quiet_day`, `sanctions_focus`. One is `active_profile_id`.

Each profile bundles everything you'd swap in a day:

```jsonc
{
  "id": "war_mode",
  "name": "War mode",
  "weights": { "iran_relevance": 1.5, "severity": 2.0, "novelty": 1.0,
               "credibility": 0.5, "actionability": 1.0, "noise": 1.5 },
  "threshold": 13,
  "must_include_keywords": ["strike","missile","ceasefire"],
  "must_exclude_keywords": ["crypto","celebrity"],
  "required_tags_any": ["iran","middle_east"],
  "blocked_tags": ["sports","entertainment"],
  "author_overrides": { "@SomeHandle": "always_deliver" },
  "priority_topics": [...],
  "low_priority_topics": [...],
  "editorial_note": "Focus on kinetic events and ceasefire signals today",
  "story_memory": {                       // §4 — per-profile dedup tuning
    "enabled": true,
    "window_hours": 12,
    "similarity_threshold": 0.86,
    "action": "skip",                     // skip | mark_and_deliver | collapse
    "bypass_authors": ["@OfficialIRGCEN"]
  }
}
```

Profile selector lives at top of the Filter page: dropdown + Duplicate / Rename / Save-as-new. Switching is a single setting write — the worker reads the active profile per job.

## 3. Filtering pipeline (worker side)

Order after scoring returns:

1. **Hard rules** (cheap, deterministic): author overrides → blocked_tags → required_tags_any → must_exclude_keywords.
2. **Story Memory check** (§4) — if duplicate and action=skip, stop here.
3. **Boosts** (additive): must_include_keywords (+N), priority_topics (+N), low_priority_topics (−N).
4. **Final score** via active profile's `weights`.
5. **Threshold** check vs `profile.threshold`.
6. Decision + `decision_reason` persisted on `posts` (Monitoring shows *why*).

## 4. Story Memory (semantic dedup) — NEW

Today we only have exact-match dedup (tweet_id, canonical URL, x_deliveries time-window). Two outlets reporting the same Israeli strike in different words both pass. Story Memory fixes this.

**Separate module, same pipeline gate, same UX surface as profiles.**

### Storage
- New `story_signatures` table: `tweet_id` (PK), `simhash bigint`, `embedding vector(1536)` (pgvector), `story_cluster_id uuid`, `coverage_count int default 1`, `created_at`.
- pgvector ivfflat index on `embedding`.
- BTREE on `(created_at desc)` for window scans.

### Two-tier check (cheap → expensive)
- **Tier 1 — SimHash** of normalized translated text (~1ms). Hamming distance ≤ 6 over the configured window → match.
- **Tier 2 — Embedding cosine** via OpenAI `text-embedding-3-small` (~$0.00002/post). Cosine ≥ `similarity_threshold` → match. Catches paraphrases and translation drift.

### Pipeline placement
- New job type `compute_signature` enqueued after `translate` completes (priority 11, runs in parallel with deliver gating).
- `deliver` checks `story_signatures` before publishing:
  - **No match** → assign new `story_cluster_id`, proceed.
  - **Match + action=skip** → mark `decision_reason: dup_of <tweet_id>`, increment original's `coverage_count`, **skip**.
  - **Match + action=mark_and_deliver** → still publish but tag with the cluster (useful for analytics).
  - **Match + action=collapse** → reserved for future "thread updates" feature.
  - **Author in `bypass_authors`** → skip dedup entirely (e.g. always mirror official accounts).

### Coupling back to scoring (optional, valuable)
- Expose `coverage_count` as a 7th scoring axis (`corroboration`): a story 5 outlets picked up gets a small boost; a single anonymous repost stays low. Implemented purely in the scoring formula, no extra OpenAI cost.

### UI — new "Story Memory" tab in Editorial Console
- Toggle, window slider (1–48h), similarity slider (0.80–0.95), action picker, bypass-authors chips.
- "Recent duplicate clusters" list: each cluster shows the original + how many duplicates were suppressed + a link to view them.

## 5. UI: a single "Editorial Console" page (replaces current Content Filter card)

Four tabs:

- **Today** — daily dial. Big profile dropdown, threshold slider, weight sliders for the 6 axes, keyword chips (include/exclude), required/blocked tag chips. Live "Predicted impact" panel (§6).
- **Profiles** — list/edit/duplicate/delete profiles.
- **Story Memory** — §4.
- **Advanced** — scoring system prompt, tool schema, per-author rules table, axis definitions.

Day-to-day flow: open Today → pick `war_mode` → nudge severity weight → save. No prompt editing, no JSON.

## 6. Dry-run preview (so you trust the dial before saving)

"Preview impact" button:
- Loads last N=200 scored posts (axes already cached on `posts`).
- Re-applies the **current unsaved** profile formula in the browser (no API calls).
- Re-applies the dedup decisions from `story_signatures`.
- Shows: "would deliver 47 / 200 (vs 62 currently). 12 newly included, 27 newly excluded, 8 deduped." Click to see the diff.

This is the killer feature: A/B a weight change in one second.

## 7. Backfill & re-scoring

- "Re-score recent" button enqueues `score_only` jobs for last 24h/7d (uses split scoring call, skips translation).
- "Backfill signatures" button enqueues `compute_signature` for any post missing one.
- Old single-score posts: missing axes default to neutral 5; `final_score` falls back to legacy `importance_score`.

## 8. Observability

- Monitoring row shows axis bars + which rule fired ("blocked_tag: sports", "boost: +2 'ceasefire'", "dup_of @abc/123 (cosine 0.91)").
- Dashboard "Editorial decisions (24h)" widget: delivered vs filtered vs deduped, top skip reasons, active profile, dedup hit rate.

---

## Technical sketch

**DB migrations**
- `posts`: add `score_axes jsonb`, `final_score numeric`, `decision_reason text`.
- New `story_signatures` table (see §4) — needs `create extension if not exists vector`.
- New settings keys: `editorial_profiles` (array), `active_profile_id` (string). Keep `content_filter` as legacy fallback for one release.

**Scoring tool schema (worker)**
```json
{
  "name": "classify_importance",
  "parameters": { "type":"object", "properties": {
    "axes": { "type":"object", "properties": {
      "iran_relevance":{"type":"integer","minimum":0,"maximum":10},
      "severity":{"type":"integer","minimum":0,"maximum":10},
      "novelty":{"type":"integer","minimum":0,"maximum":10},
      "credibility":{"type":"integer","minimum":0,"maximum":10},
      "actionability":{"type":"integer","minimum":0,"maximum":10},
      "noise":{"type":"integer","minimum":0,"maximum":10}
    }, "required":["iran_relevance","severity","novelty","credibility","actionability","noise"]},
    "tags":{"type":"array","items":{"type":"string"}},
    "reasoning":{"type":"string"}
  }, "required":["axes","tags","reasoning"] }
}
```

**Worker changes**
- After scoring: persist axes, compute `final_score` via active profile, run hard rules + Story Memory check, persist `decision_reason`. Translation only fires if decision = deliver (already split, keeps cost down).

**Edge functions**
- `admin-actions`: `set_active_profile`, `save_profile`, `delete_profile`, `preview_profile_impact`, `rescore_recent`, `backfill_signatures`.
- New job handler `compute_signature` inside `worker` (calls embeddings API, computes simhash, upserts row, links cluster).

**Frontend**
- Replace `ContentFilterSettings.tsx` with `EditorialConsole.tsx` (4 tabs).
- New `useEditorialProfiles()`, `useStoryMemory()` hooks (React Query).
- New `<AxisWeightSliders />`, `<KeywordChips />`, `<ProfileSwitcher />`, `<ImpactPreview />`, `<DuplicateClusters />` components.

**Migration of existing config**: on first load, wrap current `content_filter` settings into a `default` profile so nothing breaks.

---

## Rollout (4 small PRs)

1. **PR1 — schema + axes**: DB migration, worker emits axes, Monitoring shows them. UI still uses single threshold.
2. **PR2 — Editorial Profiles + new UI**: profile CRUD, weight sliders, hard rules, active-profile selector. Worker uses formula.
3. **PR3 — Story Memory**: pgvector table, `compute_signature` job, dedup gate in deliver, Story Memory tab, "dup_of" reasons in Monitoring. Adds `corroboration` axis.
4. **PR4 — Impact Preview + Re-score/Backfill + per-axis Monitoring filters + Dashboard widget**.

Each PR is independently shippable; you'd already get value after PR1 (visibility), PR2 (daily dial), PR3 (no more double-publishing), and PR4 (confidence to tune fast).
