# Manual Tweet Video Intake Implementation Plan

## Planner Metadata

Date: 2026-06-29
Planner: Codex, using Planning Orchestrator plus research-plan loop
Repository: `/Users/stevmq/Finalized XOT`
Branch observed: `main`
Mode: plan only
Implementation authorization: not granted yet
Related research dossier: `docs/research/2026-06-29-manual-video-intake-research.md`

## Executive Goal

Add a manual-only admin panel workflow where an admin pastes an X/Twitter post URL, the system fetches the post text and video, runs the same translation/subtitle/video render logic used by the current pipeline, shows a preview with editable caption, and posts only after an explicit human button press.

The first release should be conservative:

- No automatic posting from pasted links.
- No automatic Telegram delivery from manual intakes.
- No change to RSS automation settings.
- No global setting mutation.
- No direct frontend service-role access.
- No post side effect unless the admin confirms the final post action.

## Source Of Truth Contract

Authoritative state should be:

- UI route: existing `/video-renders`, extended with a "Manual Intake" tab or section.
- Admin boundary: `supabase/functions/admin-actions/index.ts`.
- Canonical action names: `supabase/functions/_shared/adminActionNames.ts`.
- Manual workflow table: new `public.manual_video_intakes`.
- Processing primitives: existing `posts`, `media`, `jobs`, `video_renders`, `pipeline_events`.
- Preview URLs: signed URLs from `temp-media` via admin action response.
- Final X side effect: existing `x-poster` safety gates and `x_deliveries` claims.

The UI should treat `manual_video_intakes` as the workflow state, not infer state only from `posts`, `jobs`, or `video_renders`.

## Native Planning Superiority

This needs a plan before implementation because the existing pipeline has useful but dangerous automation:

- RSS ingest is not a pure fetcher. It queues downstream jobs.
- Worker translation can advance to delivery.
- Video render completion can queue delivery.
- X posting has strong but coupled safety gates.
- The existing UI preview is reusable, but it does not model manual approval.

The plan separates "reuse proven primitives" from "reuse automatic route", which is the central safety issue.

## Orchestration Decision

Parent-owned planning with explicit lanes:

- Repo lane: inspect current source, schema, worker, admin action, render UI, X poster.
- External-docs lane: verify X API, media upload, Supabase background/signed URL constraints.
- UX lane: apply `frontend-design` guidance for dense operational controls and reuse existing UI.
- Risk lane: identify delivery and duplicate side effects before design.

No implementation worker should start until this plan is approved.

## Background Browser Lane

Official docs checked:

- X Post lookup integration guide: `https://docs.x.com/x-api/posts/lookup/integrate`
- X chunked media upload guide: `https://docs.x.com/x-api/media/quickstart/media-upload-chunked`
- X media upload best practices: `https://docs.x.com/x-api/media/quickstart/best-practices`
- Supabase Edge Function background tasks: `https://supabase.com/docs/guides/functions/background-tasks`
- Supabase Storage signed URLs: `https://supabase.com/docs/reference/javascript/storage-from-createsignedurl`

Main implications:

- Fetching post text/media metadata requires explicit X fields and expansions.
- Video upload is multi-step and asynchronous.
- Signed preview URLs are time-limited.
- Long media/render work should stay queued and observable.

## Research Findings

1. The RSS webhook already contains much of the needed extraction logic, but calling it directly would be unsafe because it queues automatic pipeline work.
2. `translate_post` in `translation_only` mode is the safest existing translation primitive because it updates translated text without delivery.
3. `resolve_media` and `download_media` can be reused for native X video retrieval and storage, with manual source labels.
4. `VideoRenderDetailPanel` can be reused for preview because it already shows original video, processed video, subtitles, preflight, metrics, feedback, and retry.
5. `_video_render_queue_delivery` is the major database side-effect hazard. It queues delivery when a post appears deliverable after render completion.
6. `x-poster` is the right place for final posting safety because it already has duplicate assertion, quota checks, media upload, render readiness, and claim idempotency.
7. Existing `retry_x_post` does not meet the new requirement because it does not support a user-edited caption draft and is framed as force/retry for existing posts.

## Current State

Frontend:

- Routes are defined in `src/App.tsx`.
- Navigation is defined in `src/components/layout/navigation.ts`.
- `/video-renders` is already a wide operational route.
- `src/pages/VideoRenders.tsx` shows queue, renderer health, and render detail.
- `src/components/video/VideoRenderDetailPanel.tsx` provides reusable preview UI.

Backend:

- All privileged dashboard actions go through `admin-actions`.
- `admin-actions` requires an authenticated admin before service-role work.
- Action contract is tested by `src/test/admin-actions-contract.test.ts`.
- RSS ingest writes `posts` and `media`, then queues jobs.
- Worker translate can queue hydrate, enrich, or deliver.
- Video renderer completion can queue delivery through `_video_render_queue_delivery`.
- X poster contains safety gates and final external side effects.

Local validation note:

- `npm run build` is expected to require `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_SUPABASE_PROJECT_ID`.
- Use local-only Vite env values during implementation validation when real env is absent.

## Future State

The admin sees a manual intake surface:

1. Paste an X/Twitter post URL.
2. Click "Fetch".
3. The app validates the URL and starts a manual intake workflow.
4. The backend fetches or resolves post text/author/media, creates a manual intake row, and queues safe async steps.
5. The UI shows status: Fetch, Media, Translation, Render, Review, Post.
6. The preview shows source video, rendered/subtitled output, subtitles, preflight, and warnings.
7. The caption editor shows the generated caption and allows manual edits.
8. Duplicate/media/render/quota warnings are visible before posting.
9. The "Post to X" button is disabled until all required checks pass.
10. Pressing "Post to X" requires explicit confirmation and posts exactly the selected render with the current edited caption.
11. The workflow records X post result and cannot be posted twice accidentally.

## Non-Goals

- Do not add fully automatic posting from pasted links.
- Do not call RSS.app or mutate RSS feed state.
- Do not add automatic Telegram delivery for manual intakes in phase 1.
- Do not bypass duplicate detection.
- Do not bypass X posting enabled/credential/rate-limit safety settings.
- Do not redesign the whole dashboard.
- Do not change renderer subtitle style or watermark policy as part of this feature.
- Do not broaden service-role access to the frontend.

## Phase Plan

### Phase 0: Live Preflight And Safety Confirmation

Read-only checks before code:

- Query `settings.video_render_config`, `settings.x_posting_config`, and `settings.story_memory`.
- Check `video_renderer_heartbeats`.
- Check active `jobs`, `video_renders`, and `x_deliveries` for stuck rows.
- Confirm whether manual posts should respect `x_posting_config.enabled`.
- Confirm phase 1 posts only to X.

Stop condition:

- If render, X posting, or dedupe is unhealthy, fix or explicitly defer before implementing manual intake.

### Phase 1: Manual State Model And Delivery Guard

Add migration:

- Create `public.manual_video_intakes`.
- Service-role manage access only; frontend reads through `admin-actions`.
- Index by `tweet_id`, `status`, `created_at`, `created_by`.
- Add updated-at trigger.
- Add optional unique active intake guard for a `tweet_id`.

Fields:

- `id uuid primary key default gen_random_uuid()`
- `tweet_id text not null references public.posts(tweet_id)`
- `source_url text not null`
- `source_handle text`
- `created_by uuid`
- `status text not null`
- `caption_draft text`
- `caption_edited text`
- `selected_render_id uuid references public.video_renders(id)`
- `safety_flags jsonb not null default '{}'::jsonb`
- `duplicate_override boolean not null default false`
- `duplicate_override_reason text`
- `posted_x_tweet_id text`
- `posted_at timestamptz`
- `last_error text`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Add defensive database guard:

- Update `_video_render_should_release(p_tweet_id)` so posts linked to an active manual intake do not auto-release delivery.
- Active manual statuses should include every status except `posted` and `canceled`.
- This guard is defense in depth. Manual posts should also avoid setting `delivery_decision = 'deliver'` before explicit post.

Tests:

- Migration/RPC test or function-level test proving a manual intake row prevents `_video_render_queue_delivery`.
- Existing video render completion behavior remains unchanged for normal RSS posts.

### Phase 2: Backend Manual Intake Actions

Add `supabase/functions/admin-actions/manualVideoIntakeActions.ts`.

New admin actions:

- `manual_video_intake_create`
- `manual_video_intake_get`
- `manual_video_intake_list`
- `manual_video_intake_refresh`
- `manual_video_intake_save_caption`
- `manual_video_intake_set_duplicate_override`
- `manual_video_intake_cancel`
- `manual_video_intake_post`

Register each action in:

- `supabase/functions/_shared/adminActionNames.ts`
- `supabase/functions/admin-actions/index.ts`
- Frontend API hook/module
- Contract tests

Create action behavior:

1. Validate X/Twitter URL and extract numeric post id.
2. Reject non-X URLs and invalid ids.
3. If a manual intake already exists for the tweet, return it instead of creating duplicates.
4. Fetch text/author using the safest available path:
   - Prefer existing X hydration helpers when credentials permit.
   - Fall back to URL/handle and existing resolver behavior when X lookup is unavailable.
5. Upsert `posts` in a manual-safe state:
   - `tweet_id`
   - `url`
   - `author_handle`
   - `text_original`
   - `has_media = true` when video is detected or expected
   - `delivery_decision = 'manual_review'` or another non-deliver value
   - `decision_reason = 'manual_video_intake'`
6. Create or update `manual_video_intakes`.
7. Run duplicate dry-run and store result in `safety_flags`.
8. Queue `resolve_media` and `download_media` with manual source metadata.
9. Run `translate_post` in `translation_only` mode or an equivalent no-advance helper.
10. Queue video render when a downloaded source video is available.
11. Return a full intake snapshot.

Get/refresh action behavior:

- Return intake row, post, media rows, render detail, duplicate safety, signed URLs, and current blockers.
- Signed URLs should be refreshed on every detail request, not stored long-term.

Save caption behavior:

- Update only `manual_video_intakes.caption_edited`.
- Do not update `posts.text_translated` unless explicitly needed for preview.
- Return updated caption and validation warnings.

Cancel behavior:

- Mark intake `canceled`.
- Do not delete `posts`, `media`, or `video_renders` in phase 1.
- Do not cancel global jobs unless they are uniquely namespaced to this manual intake.

### Phase 3: Final Manual X Posting Path

Add an explicit manual branch to `x-poster` or a shared posting helper used by `x-poster`.

Recommended design:

- `admin-actions.manual_video_intake_post` validates UI confirmation, then invokes `x-poster` with:
  - `manual_intake_id`
  - `tweet_id`
  - `render_id`
  - `text_override`
  - `confirm_manual_post: true`
  - `dispatch_source: 'manual_video_intake'`

The manual branch must:

- Require `x_posting_config.enabled = true`.
- Require `confirm_manual_post === true`.
- Require a non-empty caption.
- Enforce configured max character count with preview-visible validation.
- Require selected render status `completed` with `output_storage_path`.
- Apply rendered video preference for the selected render.
- Reuse final duplicate assertion.
- Block duplicate status unless `duplicate_override` is true and reason is present.
- Reuse media tier selection and do not post text-only if media is expected.
- Reuse quota/rate-limit checks.
- Reuse `claim_x_post_delivery` and `complete_x_post_delivery`.
- Refuse if an `x_deliveries` posted/posting row already exists.
- Mark `manual_video_intakes.status = 'posted'` only after X accepted the post and delivery write completed.
- Record pipeline events with `source = manual_video_intake`.

Avoid:

- Do not use automatic candidate selection.
- Do not mutate RSS feed/account `last_seen_item_id`.
- Do not enqueue Telegram `deliver`.
- Do not set the post into normal auto-deliver state as a side effect.

### Phase 4: Frontend UI

Placement:

- Extend `/video-renders` with tabs: `Queue` and `Manual Intake`.
- Keep route wide and operational.
- Add navigation only if the section becomes too crowded; phase 1 can stay under Video.

UI components:

- `src/pages/VideoRenders.tsx`: tab shell and layout integration.
- `src/components/video/ManualVideoIntakePanel.tsx`: paste URL, create/refresh, status rail, blockers.
- `src/components/video/ManualVideoIntakeReview.tsx`: preview, caption editor, safety panel, final post.
- Reuse `VideoRenderDetailPanel` for video preview where possible.
- `src/hooks/useManualVideoIntakeData.ts`: query/mutations around new admin actions.
- `src/api/manualVideoIntake.ts` or add to existing monitoring/video API style.

UX requirements:

- Dense, calm, scannable operational layout.
- No marketing copy.
- URL input with clear validation.
- Step/status rail: Fetch, Media, Translate, Render, Review, Post.
- Caption editor with character counter and RTL support.
- "Reset to generated caption" button.
- Duplicate warnings with linked original tweet/post ids where available.
- Render warnings: blocked, failed, no source video, missing media, expired signed URL.
- Quota/settings warnings: X posting disabled, video disabled, daily budget, rate limit, existing posted row.
- Final post button disabled until ready.
- Confirmation dialog must show:
  - final caption
  - selected render id
  - tweet id
  - duplicate override state
  - "This will post to X now"

### Phase 5: Observability And Audit Trail

Add pipeline events:

- `manual_intake` `created`
- `manual_intake` `fetching`
- `manual_intake` `ready`
- `manual_intake` `caption_saved`
- `manual_intake` `post_requested`
- `manual_intake` `posted`
- `manual_intake` `failed`
- `manual_intake` `canceled`

Add dashboard/read visibility:

- Manual intake list with newest first.
- Status and last error.
- Posted X id and link.
- Created by admin id.
- Existing post/render links.

### Phase 6: Rollout

Recommended rollout order:

1. Ship backend table and read-only/list/get actions behind no UI entry point.
2. Add create/refresh actions and UI with post button disabled.
3. Validate paste-to-render with a non-production or low-risk tweet.
4. Add final post action but keep it behind a feature flag setting.
5. Enable feature flag only after local and live dry-run checks.
6. Perform first live post manually with operator approval.
7. Monitor `x_deliveries`, `pipeline_events`, `manual_video_intakes`, `video_renders`, and X account surface.

## Task Backlog

Backend tasks:

- [ ] Add `manual_video_intakes` migration.
- [ ] Add `_video_render_should_release` manual-intake guard.
- [ ] Add manual-intake admin action module.
- [ ] Add URL parsing helper and tests.
- [ ] Add intake snapshot assembler.
- [ ] Add safe post upsert behavior.
- [ ] Add duplicate dry-run integration.
- [ ] Add media resolve/download queue integration.
- [ ] Add translation-only integration.
- [ ] Add render queue integration.
- [ ] Add caption save action.
- [ ] Add final manual X post action.
- [ ] Refactor or extend `x-poster` to accept `manual_intake_id` plus `text_override`.
- [ ] Add event logging.
- [ ] Add contract action-name tests.

Frontend tasks:

- [ ] Add manual intake hooks.
- [ ] Add manual intake tab/section under `/video-renders`.
- [ ] Add URL input and create flow.
- [ ] Add status rail and blockers.
- [ ] Reuse/adapt render detail panel.
- [ ] Add caption editor with validation.
- [ ] Add duplicate warning/override UI.
- [ ] Add final post confirmation dialog.
- [ ] Add success/error state and posted result link.
- [ ] Add responsive checks for desktop and mobile.

Testing tasks:

- [ ] Deno unit tests for URL parsing and action validation.
- [ ] Deno tests for create action idempotency.
- [ ] Deno tests proving no `deliver` job is created for manual intake create/refresh/render completion.
- [ ] Deno tests for duplicate block and explicit override.
- [ ] Deno tests for final post requiring confirmation.
- [ ] Deno tests for final post refusing missing render/output/caption.
- [ ] Deno tests for already-posted and active-claim refusal.
- [ ] Vitest tests for action contract alignment.
- [ ] Vitest tests for UI disabled/enabled states.
- [ ] Browser smoke test for paste URL to preview, caption edit, and disabled post blockers.

## Acceptance Criteria

Functional:

- Pasting a valid X URL creates or returns one manual intake.
- Invalid URLs are rejected before side effects.
- The workflow fetches or resolves post text and video through existing backend-safe helpers.
- Translation uses current translation settings but does not enqueue delivery.
- Video rendering uses existing renderer configuration.
- Preview shows original and processed video when available.
- Caption starts from generated text and can be edited manually.
- Caption edits persist across refresh.
- Duplicate warnings are visible before posting.
- Final post requires explicit confirmation.
- Final post uses the exact edited caption and selected rendered video.
- Final post records `x_deliveries` and `manual_video_intakes.posted_x_tweet_id`.
- A second post attempt is refused or shown as already posted.

Safety:

- Manual intake create/refresh never creates Telegram delivery rows.
- Manual intake create/refresh never dispatches X posting.
- Video render completion for a manual intake never queues delivery.
- Automatic RSS behavior remains unchanged.
- Existing `/monitoring`, `/settings`, and `/video-renders` queue views still work.
- No service-role key or sensitive token is exposed to frontend.

UX:

- The manual surface is usable at desktop and mobile widths.
- Long tweet URLs and captions do not overflow controls.
- The final post button is not available while render/media/duplicate/config blockers exist.
- The UI shows exact blocker reasons, not generic failure.

## Validation Plan

Pre-implementation:

```bash
git status --short
npm run check:functions
npm run test:functions
npm run check:strict
npm test -- src/test/admin-actions-contract.test.ts
```

Post-implementation local checks:

```bash
npm run check:functions
npm run test:functions
npm run check:strict
npm test
npm run lint
VITE_SUPABASE_URL=https://jzirqfzzvlbxwfzndaer.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=local-build-validation-key VITE_SUPABASE_PROJECT_ID=jzirqfzzvlbxwfzndaer npm run build
```

Focused tests to add/run:

```bash
npm test -- src/test/admin-actions-contract.test.ts
npx deno test supabase/functions/admin-actions/manualVideoIntakeActions.test.ts
npx deno test supabase/functions/x-poster/manualIntakePosting.test.ts
npx deno test supabase/functions/worker/videoRenderWorkflow.test.ts
```

Browser validation:

- Start Vite with local-only Vite env values.
- Open `/video-renders`.
- Verify queue tab still works.
- Open manual intake tab.
- Paste invalid URL and confirm no backend mutation.
- Paste valid test URL and confirm status progression.
- Verify preview videos render.
- Edit caption and refresh.
- Confirm post button stays disabled until render complete.
- Confirm final post dialog text and blockers.

Live validation after deployment:

- Read-only check settings and queues.
- Create one manual intake for a safe test post.
- Confirm no `deliver` job and no `x_deliveries` row until final confirmation.
- Confirm render output preview.
- Confirm final manual post only after user approval.
- Watch `pipeline_events`, `x_deliveries`, `manual_video_intakes`, and X account.

## Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Manual render completion queues automatic delivery. | P0 | Keep manual posts non-deliver and add `_video_render_should_release` guard. |
| Final post accidentally uses generated caption instead of edited caption. | P0 | Pass explicit `text_override`; log final caption hash/length; test. |
| Duplicate content gets posted manually. | P1 | Run duplicate dry-run and final duplicate assertion; require override and reason. |
| Existing post already in automatic pipeline gets hijacked by manual intake. | P1 | If existing post is active/posted, show warning and avoid mutating automatic state. |
| X API media lookup cannot retrieve MP4. | P1 | Reuse existing `resolve_media` proxy fallback and media download pipeline. |
| Long/invalid video fails at X upload. | P1 | Preflight duration/size, reuse media tier checks, surface blocker before posting. |
| Rate limit or daily budget surprises. | P1 | Show settings/quota blockers and reuse `x-poster` budget checks. |
| Signed preview URLs expire. | P2 | Refresh snapshot/detail before preview and before final post. |
| Caption length/RTL issues. | P2 | Add character counter, truncation warning, and responsive UI tests. |
| Migration drift. | P2 | Follow release runbook; do not run `supabase db push` until migration trust is checked. |

## Implementation Orchestrator Handoff

Implementation should proceed only after user approval.

Recommended first implementation slice:

1. Add table migration and `_video_render_should_release` guard.
2. Add minimal `manual_video_intake_create`, `get`, `list`, and `save_caption`.
3. Add contract tests and no-auto-delivery tests.
4. Add UI tab with create/list/detail and caption edit, but keep final post disabled.

Recommended second slice:

1. Add render orchestration and refresh/status polling.
2. Reuse `VideoRenderDetailPanel`.
3. Add duplicate warning and override UI.

Recommended third slice:

1. Add explicit final manual X posting path.
2. Run full local validation.
3. Deploy behind feature flag.
4. Perform one operator-approved live smoke.

Approval checkpoint:

- Stop here until the user approves implementation.
