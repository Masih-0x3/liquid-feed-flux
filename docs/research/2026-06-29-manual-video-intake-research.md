# Manual Tweet Video Intake Research Dossier

Date: 2026-06-29
Mode: research-plan
Repository: `/Users/stevmq/Finalized XOT`
Scope: planning only. No implementation has been started.

## Executive Finding

The feature is feasible, but it must not literally reuse the RSS webhook end to end. The RSS path is intentionally automatic after ingest: it can enqueue dedupe, translate, media download, render, and delivery work. The safe implementation should reuse individual proven components, especially media resolution, translation-only, video render preview, X text formatting, media upload, duplicate assertion, quota checks, and X delivery claims, while adding a manual-only control table and explicit post action.

Recommended architecture:

1. Add a `manual_video_intakes` state table.
2. Add admin-only manual intake actions behind the existing `admin-actions` boundary.
3. Insert or link a `posts` row in a manual review state that cannot release delivery.
4. Run media resolution, media download, translation-only, and video render as queued steps.
5. Show preview in `/video-renders` using the existing render detail panel.
6. Store an editable caption draft separately from automatic generated text.
7. Final posting goes through a new explicit manual X post path that reuses current X posting safety gates.

## Research Sources

### Local Source

- `README.md` identifies the product as an RSS-to-Telegram/X content pipeline with Supabase Edge Functions and a React admin dashboard.
- `supabase/functions/webhooks-rssapp/index.ts` shows RSS ingest creates/updates `posts`, inserts media, queues `dedupe` or `translate`, queues `download_media` or `resolve_media`, and dispatches `worker`.
- `supabase/functions/worker/translateWorkflow.ts` shows normal translation routing can enqueue hydrate, enrich, or deliver after a deliver decision.
- `supabase/functions/worker/videoRenderWorkflow.ts` and `supabase/migrations/20260609201533_video_render_pipeline.sql` show video render completion can call `_video_render_queue_delivery`.
- `supabase/functions/admin-actions/index.ts` is the existing authenticated admin boundary. It requires JWT and admin role, then uses service role for privileged work.
- `supabase/functions/_shared/adminActionNames.ts` is the canonical action-name contract used by frontend tests.
- `supabase/functions/admin-actions/translationRescoreActions.ts` exposes `translate_post` in `translation_only` mode, which updates translation without queuing delivery.
- `supabase/functions/admin-actions/dedupeActions.ts` exposes admin dedupe, including dry-run support.
- `supabase/functions/admin-actions/videoRenderActions.ts` exposes render overview, queue, detail, retry, feedback, and signed storage preview URLs.
- `src/pages/VideoRenders.tsx`, `src/hooks/useVideoRenderData.ts`, and `src/components/video/VideoRenderDetailPanel.tsx` already implement the operational video review UI surface.
- `supabase/functions/x-poster/index.ts` handles X posting with settings, quotas, duplicate assertions, media tiering, video render gate, media upload, claim idempotency, and posted status writes.
- `supabase/functions/_shared/xPostText.ts` centralizes generated X text formatting.
- `supabase/functions/worker/mediaWorkflow.ts` and `supabase/functions/worker/index.ts` implement `resolve_media` via fxtwitter/vxtwitter and then enqueue `download_media`.
- `supabase/functions/_shared/mediaSelection.ts` defines media validity, video intent, size caps, duration gate, and tier selection.
- `package.json` defines verification commands: `check:functions`, `test:functions`, `check:strict`, `test`, `lint`, and build scripts.

### External Official Docs

- X Post lookup integration guide: https://docs.x.com/x-api/posts/lookup/integrate
  - X Post lookup returns minimal data unless requested fields and expansions are provided.
  - Media fields require the `attachments.media_keys` expansion.
  - Public lookup can use app-only bearer auth; private metrics require user context.
  - Common errors include 401, 403, 404, and 429.
- X chunked media upload guide: https://docs.x.com/x-api/media/quickstart/media-upload-chunked
  - Video and large media upload uses INIT, APPEND, FINALIZE, then STATUS if processing is asynchronous.
  - A post with media is created by passing uploaded media ids to `POST /2/tweets`.
- X media upload best practices: https://docs.x.com/x-api/media/quickstart/best-practices
  - A post can attach up to four photos, one GIF, or one video.
  - Official video guidance includes codec, size, duration, aspect-ratio, and async processing constraints.
- Supabase Edge Function background tasks: https://supabase.com/docs/guides/functions/background-tasks
  - `EdgeRuntime.waitUntil` can run work after a fast response, but total duration is still limited by platform caps.
  - Long work should remain asynchronous and observable.
- Supabase Storage signed URLs: https://supabase.com/docs/reference/javascript/storage-from-createsignedurl
  - Signed URLs are explicitly time-bounded and require an expiry in seconds.

## Claim Ledger

| Claim | Evidence | Confidence | Planning impact |
| --- | --- | --- | --- |
| Directly calling the RSS webhook is unsafe for this feature. | Webhook queues pipeline jobs and dispatches worker. Worker translation can enqueue delivery. | High | Build manual actions that reuse pieces, not the whole webhook. |
| Manual rows need a hard no-auto-delivery control. | `_video_render_queue_delivery` queues delivery when `delivery_decision = 'deliver'` and translation exists. `complete_video_render` calls it. | High | Keep manual posts out of `deliver` state until explicit post, and add a manual-intake guard. |
| Existing video preview UI can be reused. | `VideoRenderDetailPanel` already shows original video, processed output, subtitles, preflight, metrics, feedback, and retry. | High | Add intake/review controls around the existing panel instead of rebuilding video review. |
| Existing X posting code contains important safety gates. | `x-poster` checks config, budgets, freshness, duplicate assertion, active claims, media requirements, render readiness, upload, and completion. | High | Final manual post should reuse or share these gates, not duplicate them in the frontend. |
| Translation-only is a safer caption-generation primitive than worker translate. | `translate_post` only supports `translation_only` and `runTranslationOnly` does not enqueue delivery. | High | Use translation-only or a new no-advance helper for caption draft generation. |
| Media work should be queued. | Current repo queues `resolve_media`, `download_media`, and video rendering. Supabase docs support background tasks but warn duration is capped. | High | Do not render synchronously from the paste URL request. |
| X API lookup can fetch text and media metadata, but not all practical MP4 needs. | X docs require fields/expansions for media metadata. Current repo uses fxtwitter/vxtwitter for actual video URLs. | Medium | Prefer existing resolver; optionally add X API lookup for text/author/hydration if available. |
| Official X video limits may be stricter than current code. | X docs list video constraints; repo has a current attempted duration cap in `mediaSelection.ts`. | Medium | Do not loosen limits; show duration warnings and use existing production gates until a separate policy decision. |

## Current Pipeline Map

1. RSS webhook receives payload.
2. It parses text, URL, author, media, and video signals.
3. It upserts `posts` and `media`.
4. It queues `dedupe` when story memory is enabled, otherwise `translate`.
5. It queues `download_media` for direct media and `resolve_media` for video signals.
6. It dispatches `worker`.
7. Worker dedupe can enqueue translation.
8. Worker translation can update score/decision and enqueue hydrate, enrich, or deliver.
9. Delivery runs Telegram delivery and dispatches X poster through render gates.
10. X poster selects candidates or forced target, checks final duplicate state, waits for media/render, claims X delivery, uploads media, posts, and records status.

## Contradictions And Hazards

1. User intent says "as if fetched by RSS", but the literal RSS route is not manual-safe. It should be treated as "reuse equivalent extraction and processing logic", not "call `webhooks-rssapp`".
2. Video render completion can enqueue delivery as a database side effect. Manual rows must never meet `_video_render_should_release` before final approval.
3. Worker translate is not safe for manual drafts because a deliver decision can route forward. Use translation-only or add a manual-mode no-advance route.
4. Existing `retry_x_post` force-posts a post id through `x-poster` and still uses generated text. It does not satisfy "editable caption before post".
5. Existing UI can preview render rows but has no concept of a manual intake draft, caption edit, duplicate warning, or final post confirmation.
6. X API docs describe media metadata lookup, but the current production resolver already handles native X video discovery via public proxy fallbacks. Replacing that path would be riskier than reusing it.
7. Build is currently env-gated by Vite variables in this local repo. Implementation validation must use local-only values or real configured env; do not infer production behavior from a missing-env build.

## Recommended Source Of Truth Contract

Manual video intake state should be controlled by a new table. `posts` and `media` remain reusable processing primitives, but `manual_video_intakes` becomes the review/post source of truth.

Draft control fields:

- `manual_video_intakes.id`: stable workflow id.
- `tweet_id`: numeric X post id, linked to `posts.tweet_id`.
- `source_url`: original pasted URL.
- `created_by`: admin user id.
- `status`: `draft`, `fetching`, `media_resolving`, `media_downloading`, `render_queued`, `rendering`, `ready`, `blocked`, `post_requested`, `posted`, `failed`, `canceled`.
- `caption_draft`: generated caption preview.
- `caption_edited`: user-edited caption.
- `selected_render_id`: exact render to post.
- `safety_flags`: duplicate, duration, media, render, quota, and X config warnings.
- `duplicate_override`: explicit human override.
- `posted_x_tweet_id`, `posted_at`, `last_error`, `updated_at`.

Processing truth:

- `posts` stores fetched/hydrated text and translation outputs.
- `media` stores resolved source media and downloaded storage path.
- `video_renders` stores renderer queue/output.
- `x_deliveries` stores final X claim/post status only after explicit user post.

## Planning Handoff

Implementation should start with a read-only live preflight before code:

1. Check current production `video_render_config`, renderer heartbeat, X posting settings, and story memory settings.
2. Confirm no current stuck delivery or render side effects that would confuse manual-intake testing.
3. Confirm whether X posting should be allowed only when `x_posting_config.enabled = true`.
4. Confirm manual phase 1 posts only to X, not Telegram.

The plan artifact expands this into phases, tasks, acceptance criteria, validation, and rollback.
