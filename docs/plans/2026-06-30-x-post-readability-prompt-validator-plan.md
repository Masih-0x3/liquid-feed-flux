# X Post Readability, RTL, and Concision Plan

Date: 2026-06-30  
Status: Implemented locally; pending production deploy/config cutover  
Repo: `/Users/stevmq/Finalized XOT`  

## Goal

Make Persian X posts look native, concise, and clean on mobile feeds without losing important facts. Keep the existing ranking, dedupe, translation pipeline, manual intake flow, and X posting workflow intact.

## Current Evidence

- The RTL base-direction hotfix is already deployed through `xPostText`.
- Recent screenshots still show awkward feed presentation because posts contain:
  - long text that X collapses with `Show more`,
  - raw English spans such as `The Michael Knowles Show`, `NPT`, `SNN`, `(MOU)`,
  - a leading `📰` emoji that visually looks like a stray UI/icon marker on X Android.
- Production `x_posting_config` currently uses:
  - `post_template = "{leading_emoji} {translated_text}"`
  - `leading_emoji = "📰"`
  - `max_chars = 4000`

## Future-State Rules

1. The model writes as a Persian X editor, not a literal translator.
2. Long source posts are digested into short Persian news posts.
3. Normal output avoids X mobile feed collapse.
4. Every sentence is complete and punctuated.
5. English names/acronyms are handled with Persian context.
6. Code validates the output shape before posting.
7. Premium long-form capacity remains available only for exceptional cases.

## Phase 1 - Prompt Update

Update `settings.translation_prompt.system_prompt` / `user_prompt_template`.

Add rules:

```text
Write a concise Persian X post, not a sentence-by-sentence translation.
Target 280-450 Persian characters for normal posts.
Hard editorial maximum: 650 characters unless the story is exceptional.
If the source is long, digest it into the main fact, actor, claim, number, and consequence.
Use at most 1-2 short paragraphs.
Every sentence must be complete and end with Persian punctuation.
Do not leave standalone fragments, source names, titles, or clauses on their own line.
Do not start with Latin text.
Use Persian forms for common outlets, people, programs, and organizations when natural.
If an English title/acronym must remain, introduce it with Persian context.
Avoid raw English multiword spans inside Persian sentences.
Remove feed labels/source clutter unless attribution matters.
```

Examples to steer:

- Bad: `The Michael Knowles Show گفت...`
- Better: `ونس در برنامه «مایکل نولز شو» گفت...`
- Bad: `SNN، قالیباف گفت...`
- Better: `به گزارش اس‌ان‌ان، قالیباف گفت...`
- Bad: `شرایط تفاهم‌نامه (MOU)`
- Better: `شروط تفاهم‌نامه را محقق کند` unless the acronym is essential.

## Phase 2 - Output Validator

Add a validation helper near the translation result path, before delivery/X posting.

Reject or retry once when:

- output length exceeds the editorial maximum,
- output begins with Latin text,
- output has more than two blank-line-separated paragraphs,
- output contains obvious raw English multiword spans,
- output has incomplete sentence endings,
- output has excessive Latin token density,
- output likely causes X mobile collapse.

Retry behavior:

```text
This draft is too long or visually awkward for a Persian X feed.
Rewrite it as a concise Persian editorial post under 450 characters.
Preserve the key fact, actor, number, attribution, and consequence.
Use complete Persian sentences and natural punctuation.
```

If retry still fails:

- keep the best available output,
- mark metadata with a readability warning,
- do not block emergency/high-priority news solely for style.

## Phase 3 - X Posting Config Cleanup

Change only after Phase 1/2 is ready:

- remove the leading `📰` prefix from `x_posting_config`,
- keep a technical X cap for API safety,
- treat the 280-650 character range as the editorial feed target,
- preserve long-form support as an explicit exception rather than the default.

Recommended config direction:

```text
post_template = "{translated_text}"
leading_emoji = ""
technical max = X long-form safe cap
editorial target = prompt/validator controlled
```

## Acceptance Criteria

- Recent sample posts with `The Michael Knowles Show`, `SNN`, `NPT`, and `(MOU)` produce cleaner Persian-first text.
- Normal posts stay under the editorial feed budget unless explicitly exceptional.
- No post begins with raw Latin text.
- No post has orphaned fragments or punctuation-free ending.
- X preview/manual intake caption uses the same cleaned formatter path.
- Ranking, dedupe, media handling, video rendering, and posting idempotency are unchanged.

## Validation Plan

1. Run a dry sample over 100-200 recent `posts.text_original` rows.
2. Compare current `text_translated` vs new prompt output.
3. Record counts for:
   - over-budget outputs,
   - Latin-start outputs,
   - raw English multiword spans,
   - missing final punctuation,
   - paragraph count.
4. Run focused unit tests for the validator.
5. Run function gates:
   - `npm run lint:functions`
   - `npm run check:functions`
   - `npm run test:functions`
6. Deploy only after sample output review.

## Implementation Record

Implemented on 2026-07-01.

Code changes:

- Added shared readability analysis and retry-once repair helper:
  - `supabase/functions/_shared/translationReadability.ts`
  - `supabase/functions/_shared/translationReadability.test.ts`
- Wired the helper into:
  - `supabase/functions/worker/index.ts` for normal background translation jobs,
  - `supabase/functions/admin-actions/translationRescoreActions.ts` for preview, rescore, and translation-only admin/manual paths.
- Extended worker job metadata with `translation_readability` when available.
- Kept ranking, dedupe, media handling, video rendering, and posting idempotency untouched.

Live sample baseline before cutover:

```json
{
  "sample_size": 200,
  "flagged": 22,
  "over450": 14,
  "max_chars": 767,
  "issue_counts": {
    "too_long": 2,
    "raw_english_span": 7,
    "too_many_paragraphs": 5,
    "starts_latin": 8,
    "excessive_latin_density": 1,
    "missing_final_punctuation": 1
  }
}
```

Validation completed:

- `npx --yes deno test supabase/functions/_shared/translationReadability.test.ts supabase/functions/worker/translateWorkflow.test.ts supabase/functions/admin-actions/translationRescoreActions.test.ts` passed: 30 tests.
- `npm run lint:functions` passed.
- `npm run check:functions` passed.
- `npm run test:functions` passed: 311 tests.
- `npm run check:function-inventory` passed.
- `npm run check:strict` passed.
- `npm test` passed: 112 tests. Existing expected `useAuth` console error still prints from the auth test.
- `npm run lint` passed with the existing 8 fast-refresh warnings.
- `npm --prefix services/video-renderer test` passed: 164 tests.
- `VITE_SUPABASE_URL=https://jzirqfzzvlbxwfzndaer.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=local-build-validation-key VITE_SUPABASE_PROJECT_ID=jzirqfzzvlbxwfzndaer npm run build` passed.
- `npm run check:release-state` passed before deploy.

## Non-Goals

- Do not change ranking.
- Do not change dedupe.
- Do not change X posting idempotency.
- Do not remove Premium long-form capability.
- Do not force every proper noun into Persian when precision requires the original token.

## Implementation Order

1. Add prompt revision in a draft/settings-safe path.
2. Build the validator and retry path behind a narrow helper.
3. Run the 100-200 post sample comparison.
4. Review sample output before production deploy.
5. Remove the `📰` prefix and deploy config cleanup after the validator is ready.
