
# Score-first, then Translate — with fully adjustable scoring model settings

## Goal
Refactor the `translate` job into two sequential GPT-5.4-mini calls:

1. **Score** — classify importance using the existing rubric/tool. Always runs.
2. **Translate** — run the editorial Persian prompt **only if the score passes the filter**.

Plus: make every GPT-5.4 parameter for the **scoring** call independently adjustable from the Settings UI (model, reasoning effort, verbosity, max tokens, temperature, top_p, seed, service tier, parallel tool calls) — exactly the same surface area we already expose for translation.

Everything downstream (hydration, deliver, X-poster, Telegram, media, X API gating) stays byte-for-byte identical.

---

## Target flow

```text
translate job claimed
        │
        ▼
  ┌──────────────────┐
  │ Call 1: SCORE    │  classifier tool only, uses scoring_*
  │ (always)         │  settings (model, reasoning_effort, verbosity,
  │                  │  max_tokens, etc. — all independent of translation)
  └────────┬─────────┘
           │ writes importance_score, importance_tags,
           │ importance_reasoning, delivery_decision
           ▼
  decision == 'deliver' ?
   │                  │
   │ no               │ yes
   ▼                  ▼
mark skipped     ┌──────────────────┐
(no translate)   │ Call 2: TRANSLATE│  editorial prompt, no tool,
                 │ (only on pass)   │  uses existing translation_* settings
                 └────────┬─────────┘
                          │ writes text_translated, translated_at, etc.
                          ▼
                  existing hydration / deliver
                  enqueue logic (UNCHANGED)
```

`score_only` mode preserved: still translates everything, just doesn't gate.

---

## Implementation plan

### 1. Settings shape — `translation_prompt` JSON in `settings`

Add a new `scoring` sub-object that mirrors the translation params, all optional with safe defaults:

```jsonc
{
  // existing translation fields (unchanged)
  "model": "gpt-5.4-mini",
  "system_prompt": "...",
  "user_prompt_template": "...",
  "temperature": 0.2,
  "reasoning_effort": "high",
  "verbosity": "high",
  "max_completion_tokens": 15000,
  "top_p": null, "seed": null, "service_tier": "auto", ...

  // NEW — independent scoring controls
  "scoring": {
    "model": "gpt-5.4-mini",          // default = same as translation model
    "reasoning_effort": "high",        // default "medium"
    "verbosity": "low",                // default "low" (scoring outputs are short)
    "max_completion_tokens": 4000,     // default 2000
    "temperature": null,
    "top_p": null,
    "seed": null,
    "service_tier": "auto",
    "parallel_tool_calls": null
  },

  // existing scoring prompt fields (unchanged)
  "scoring_system_prompt": "...",
  "classifier_tool_schema": "..."
}
```

Defaults baked into `useSettingsData.ts` so existing settings rows keep working with no migration.

### 2. UI — Settings → Translation tab

Add a new collapsible/separate card titled **"Scoring model settings"** under the existing translation card, mirroring the same controls (model dropdown, reasoning effort, verbosity, max tokens, temperature, top_p, seed, service tier, parallel tool calls). Reuses the existing form components — no new design tokens needed.

A "Reset to translation defaults" button copies translation values into the scoring block.

### 3. Backend validation — `supabase/functions/admin-actions/index.ts`

Extend the `translation_prompt` Zod validator: add an optional `scoring` object with the same per-field validation rules already used for translation params (string enums for reasoning_effort/verbosity/service_tier, numeric ranges for tokens/temperature/top_p/seed, boolean for parallel_tool_calls). Reject unknown keys.

### 4. Worker refactor — `supabase/functions/worker/index.ts`

`loadConfig` already builds a `defaults.openai*` object for translation. Add a parallel `defaults.scoring*` object populated from `settings.translation_prompt.scoring`, falling back to translation values when a scoring field is null/missing.

Refactor `handleTranslateJob` into two helpers:

- **`scorePost(post, config)`** → uses scoring params + `scoring_system_prompt` + a **score-only tool schema** (drops `translated_text` from the existing `classify_importance` schema; keeps `importance_score`, `tags`, `reasoning`). Returns `{ score, tags, reasoning, raw, usage }`.

- **`translatePost(post, config)`** → uses translation params + `system_prompt` + rendered `user_prompt_template` ({content}, {author}, {published_at}). No tool. Free-form output. Honors the user's saved `max_completion_tokens` (remove the current 8000 clamp on line 107).

Top-level flow inside `handleTranslateJob`:
1. Load post (unchanged query).
2. Compute `filterEnabled` / `scoreOnly` (unchanged).
3. **Backward-compat fast path**: if `importance_score IS NOT NULL` AND `delivery_decision = 'deliver'` AND `text_translated IS NULL`, skip scoring → go straight to translate.
4. If `filterEnabled`: call `scorePost`. Apply existing author-rule + threshold logic to compute `deliveryDecision`.
   - If `skip` AND `!scoreOnly`: persist score fields + `delivery_decision='skip'`, log `delivery_skipped`, insert pipeline event, **return** (no translate, no deliver).
   - Else fall through.
5. Call `translatePost`. Persist `text_translated`, `translated_at`, `translation_model`, `translation_tokens`, `translation_duration_ms`.
6. Run the existing post-translate block (hydration gate / deliver enqueue / pipeline events) **unchanged**.

`result_meta` on the job: `{ scoring: {...}, translation: {...} }`.

### 5. Logging
- `score_start` / `scored` (already exist, keep)
- `translate_skipped_by_filter` (NEW — when score gate stops translation)
- `translate_start` / `translate_complete`
- `filter_decision` (unchanged)
- Each log includes which model + endpoint was used, so you can verify scoring vs translation params took effect.

### 6. Rollout safety
- Feature flag `translation_prompt.split_calls` (default `true`). If `false`, fall back to the current combined-call code path verbatim. One-line revert if anything regresses.
- All new scoring fields are optional — if absent, scoring uses the same params as translation (today's behavior).

### 7. What is NOT touched
- ✅ Hydration system, `hydrate_tweet` job, post-translate hydration gate
- ✅ Deliver job, `deliveries` table, Telegram delivery
- ✅ X poster, `x_deliveries`, X API calls, media tiering, chunked video upload
- ✅ Media download / resolve_media / dedup
- ✅ Scoring rubric content, threshold logic, author rules, Iran-gate caps
- ✅ Reconcile, retry_step, claim_jobs, all RPCs
- ✅ Frontend monitoring / dashboard / X account pages
- ✅ `score_only` mode

### 8. Files touched
- `supabase/functions/worker/index.ts` — split `handleTranslateJob`; load scoring config; remove 8000 clamp.
- `supabase/functions/admin-actions/index.ts` — extend validator with optional `scoring` block.
- `src/hooks/useSettingsData.ts` — add `scoring` defaults to `TranslationSettings` interface.
- `src/components/settings/PromptEditor.tsx` (or sibling) — new "Scoring model settings" card mirroring translation controls.

No DB migrations. No new tables. No RLS, RPC, cron, or other edge-function changes.

---

## Expected impact

| Metric | Before | After |
|---|---|---|
| Translation quality | Flat literal | Editorial X-style |
| Scoring quality | Constrained by translation budget | Fully independent — can run high reasoning without inflating translation cost |
| OpenAI tokens / skipped tweet | ~5,000 | ~1,500–3,000 (scoring only) |
| OpenAI tokens / delivered tweet | ~5,000 | ~6,000–8,000 |
| Net OpenAI cost (≈65% skip rate) | 100% | ~55–70% |
| X API calls | unchanged | unchanged |
| Telegram calls | unchanged | unchanged |
| Latency / skipped tweet | ~5s | ~2–3s |
| Latency / delivered tweet | ~5s | ~7–10s (sequential) |
