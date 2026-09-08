# PR #77 — focused release scope

Reassessment requested by the owner on 2026-09-06 after the broader execution
checkpoint conflated feature release with recovery and cleanup remediation.
This document narrows the work; it does not waive checks, change standing release
policies, approve spending, or claim the release is ready.

## Exact change

PR #77 remains open/draft at `51ab283083d27099deff7f841b856fe22d2a6598`, against
main `7797b11c11b9805f701c9f77b5a752c5eece71d9`. All 48 changed paths were
inventoried; relevant UI, runtime, deployment, type and test changes were traced.

- **Video Render screen:** compact selectable queue, keyboard navigation,
  resizable desktop queue/inspector, mobile detail/back navigation, condensed
  overview, and clearer diagnostics, subtitles and review feedback.
- **Review behavior:** existing retry and reviewed/restore actions move into the
  inspector; failed/blocked renders without feedback require an explicit feedback
  label before Save. Existing admin/read-only restrictions remain required.
- **Frontend build:** Node 24/npm 11 and updated browser-compatibility build data.
- **Renderer deployment support:** pinned Node 24 base image, isolated resource
  names/ports, and explicit persistence instructions. No renderer processing code
  changes. These files do not upgrade a running container merely by merging.
- **Assurance:** CI/supply-chain checks, tests, type declarations and evidence.

There are **zero changed files** under `supabase/functions`,
`supabase/migrations`, `services/video-renderer/src`, `src/api`, or `src/hooks`.
The UI uses the existing `get_video_render_overview`, `get_video_render_queue`,
`get_video_render_detail`, `retry_video_render`, `set_video_render_reviewed`, and
`save_video_render_feedback` actions. Added TypeScript declarations are not new
database functions or a schema migration.

## Release in separate stages

### A. Frontend release — current focus

Deploy the updated frontend against the existing backend and renderer. Do not
bundle database changes, Edge redeployment, or a renderer-host cutover into it.
No history rewrite or code removal is needed to separate deployment targets.

Required before release:

1. Retain all repository-required CI, supply, type, lint, test and build checks.
   Current exact-head GitHub lint-build, CodeRabbit and Vercel checks are green;
   run `33817672499` is evidence for the existing candidate, not a later commit.
2. Authenticated Preview validation with existing admin and read_only roles:
   desktop resizing/scrolling, mobile queue/detail/back, keyboard/focus, selection
   across filters/refresh, loading/empty/error states, output/subtitle display,
   explicit feedback selection, pending/error handling, and disabled role actions.
   Use synthetic isolated fixtures for mutation checks; no Production retry or
   external posting as a smoke test. Mocked component tests do not prove backend
   authorization or persistence.
3. Verify the exact Preview bundle's non-production identity and the specific
   video actions' compatibility and role behavior. Earlier broad Preview drift
   findings are not themselves proof these actions are incompatible. Fix any
   concrete affected-path defect if found; do not blanket-converge the database.
4. Follow `docs/operations/release-runbook.md`: required local gate before actual
   release, explicit pre/post target inventory, clean main release checkout,
   exact source/deployment/Node runtime identity, rollback target, live read-only
   smoke and release record. Record backend/renderer versions as unchanged.

Verdict: **not ready for deployment until authenticated UI/affected-path
acceptance and normal release checks are complete**. No new live browser test
was performed during this scope reassessment. Prior native-browser/SSO access
limitation remains unverified, not a code failure. External Chrome-tab permission
has not been inferred from the request to narrow scope.

### B. Renderer upgrade — separate operational stage

Before deploying the changed Node 24 image/bootstrap/Compose configuration:
existing-host compute approval, isolated no-provider render canary, exact image
identity, restart-persistence test, preserved rollback and unchanged posting
controls are required. Keep the current renderer running during stage A.
Its Node 24/persistence rollout is not complete merely because stage A ships.

### C. Separate maintenance backlog — not a prerequisite for stage A

- AIR-065 backup/Storage recovery drill and cleanup reactivation. Keep cleanup
  paused and all historical-delivery protections intact. No private export needed
  to test the frontend changes.
- Full migration replay/equivalence and broad Preview schema/grant convergence.
  The documented 42 extra grants and singleton primary-key difference remain open;
  no evidence is erased or marked accepted. They become relevant gates for a
  schema/permission change or a demonstrated affected-path safety failure.
- Full AIR-010 deployed-process equivalence: retain partial status. Verify actual
  frontend source and backend compatibility for A; verify renderer identity for B.
- Secondary PR merges/closure and redundant worktree removal.

The migration release gate remains blocked for migration operations. Its restore
requirements are explicitly under the runbook's **Supabase Migration Release**
section; this plan does not run or bypass that gate to deploy a database change.

## Evidence and handoff

Read-only commands: `gh pr view 77`, exact base/head Git diffs, changed-path
inventory, existing API hook tracing, CI workflow and release-runbook inspection.
Focused component/schema-type tests were rerun locally; see the appended ledger
receipt for the result. This is scope reassessment, not a full code audit or live
acceptance. No backend/renderer change, credential access, private export, new
service, merge, push or deployment was performed.

Next action: complete stage A's authenticated Preview acceptance. Only if that
identifies a real backend dependency should the frontend scope expand.

## Browser handoff — 2026-09-06

- Target: designated PR #77 Preview alias, `/auth`.
- Surface used: Comet profile via native Computer Use. Browser-extension tab
  creation timed out after creating one blank task tab; inventory confirmed it,
  and native UI reused that same tab without creating a duplicate.
- Mode: user-attention-required; task group `XOT Preview QA`, tab `618623997`.
- Actions completed: selected only the task-created tab, navigated to Preview.
- Evidence captured: accessibility tree shows XOT Panel, Email, Password and
  Sign In at the Preview alias. No Vercel sign-in prompt blocked this session.
- Auth/session state: existing browser can reach the app; XOT app is signed out.
- User focus interrupted: browser selection switched to the authorized task tab;
  OS foreground focus change was not separately measured. No typing into existing
  unrelated tabs.
- Durable state touched: task tab/navigation history only; no credentials entered
  and no XOT data/settings mutation.
- Blocked/not verified: authenticated admin/read_only desktop/mobile workflows.
- Next checkpoint: owner signs into the existing Preview admin account directly
  in the browser, then requests continuation. No password should be sent in chat.

## Authenticated check and concrete blocker — 2026-09-06 23:19 UTC

The existing Preview credentials were located in the XOT 1Password Environment;
no account creation or password reset was necessary. A signed-in session is now
confirmed on the designated Preview alias. The Video Render page displays source
version `51ab283` but reports `API offline`, unknown renderer and no queue data.
This is not a successful empty-queue or role-matrix acceptance result.

Read-only paired OPTIONS requests to Preview project
`umicnrtkpuzjwivmgnei`, `/functions/v1/admin-actions`, establish the CORS failure:

- Origin = the PR #77 Preview alias: HTTP 200 but no
  `Access-Control-Allow-Origin` header. Request ID
  `01a07905-acac-77f9-b107-a6e26cb0ae12`.
- Control origin = `https://xot.iraneyes.com`: same Preview endpoint returns HTTP
  200 and the matching `Access-Control-Allow-Origin` header. Request ID
  `01a07905-ae23-7e0d-94bc-b4760bb0fd37`. This was a preflight probe against Preview,
  not a Production call or authenticated action.
- The Preview `ALLOWED_CORS_ORIGIN` variable exists. Source
  `supabase/functions/admin-actions/index.ts:142` uses exact origin matching and
  omits permission headers for unmatched origins. The new Preview alias is not
  effectively allowed. The reachable endpoint rules out total backend outage;
  sign-in worked, but browser API access is blocked before affected-path testing.

Minimal proposed fix: preserve the existing Preview allowlist and add only the
exact PR #77 Preview origin. No wildcard, Production config, role, password,
schema or posting-control change. Request explicit permission for this
browser-origin access change before applying it. Then repeat both preflight and
authenticated page checks; additional errors may become visible after CORS is
resolved. No app or cloud setting was changed during diagnosis.

Background browser status: dedicated Comet task tab; active verification now
paused at the configuration approval boundary. Signed-in app session and desktop
failure screenshot/accessibility evidence observed; admin/read_only matrix and
mobile workflow not accepted. Browser tab selection changed with owner readiness;
no unrelated-tab typing, render retry, feedback save or posting occurred.

## Approved CORS addition — preservation prerequisite

The owner approved adding only the designated PR #77 Preview origin, while
preserving all existing entries. No remote write has been performed: the
targeted `supabase secrets list --project-ref umicnrtkpuzjwivmgnei --output json`
response exposes `ALLOWED_CORS_ORIGIN` as a 64-character hexadecimal digest,
not its readable value. The repository contains no saved value; checks against
11 documented origin candidates did not identify it. Do not overwrite this
digest or replace the unknown list with a guessed list.

The approved addition remains blocked on the original allowlist value from its
configuration owner/source. Once available, preserve it and append only the
approved origin; repeat preflight and authenticated checks. Supabase CLI docs
retrieved through Context7 corroborate that the list response contains digests;
the response shape was verified directly with installed CLI 2.111.0. The generic
shell entrypoint fails on a local shared-library dependency; the already-present
Node CLI entrypoint works, so no installation or machine configuration change
was needed. Preview remains unaccepted; Production is untouched.

## Preview-only CORS replacement applied — 2026-09-06 23:38 UTC

After the preservation prerequisite could not be met, the owner explicitly
approved replacing the unknown Preview list with the current Preview alias and
known app origins, accepting that older Preview links may lose access.

- Target: Preview project `umicnrtkpuzjwivmgnei` only.
- Updated only `ALLOWED_CORS_ORIGIN` to these comma-separated origins:
  `https://xot-git-codex-video-render-wor-9b1088-masihation-8914s-projects.vercel.app`,
  `https://xot.iraneyes.com`, `https://xot.vercel.app`,
  `https://liquid-feed-flux.lovable.app`.
- CLI returned success with the exact Preview project ref and `count: 1`.
- Live OPTIONS verification now returns the matching Preview
  `Access-Control-Allow-Origin` and requested authorization/content headers.
  Request ID: `01a07916-baa2-7509-a613-a0c3a0c549a5`.
- Negative control `https://unapproved.example.invalid` still receives no
  allow-origin header. Request ID: `01a07916-bcde-7b9b-9934-eed0b91fe8db`.
- No Production settings, application code, roles, passwords, schema, posting
  controls or deployments changed. The prior unknown list cannot be restored
  from its digest; older Preview origin access was not preserved or tested.
- Authenticated page recheck remains pending: dedicated Preview tab exists,
  but background browser attachment returns `Debugger unattached`; the user's
  active browser is on an unrelated tab, so no tab switching/input was done.
  The CORS failure is verified fixed; full Preview acceptance is not claimed.

## Authenticated page recovery confirmed — 2026-09-06 23:43 UTC

The dedicated Preview tab's signed-in accessibility tree now shows real API
results: 79 blocked sanitized staging fixture items, zero queued, mode disabled,
and `Posting locked in Preview`. Selected fixture detail loads with attempts,
stage diagnostics, feedback selection, and Save disabled without a selection.
No retry, reviewed/restore, feedback save or render action was executed.

The page reports renderer `Blocked` with a recent heartbeat and explicitly says
authorized media access is not configured; no remote media was loaded. These
restrictions are consistent with the isolated Preview setup and are not proof
that rendering/output acceptance passed. The frontend reports `51ab283`; the
backend badge reports `fbbd44aa699640991efba24b24bb92a54a4c2690`. Badge wording
about relative freshness is not a verified code/deployment comparison.

Visible console messages concerned extension scripts, blocked Vercel feedback,
blocked browser fonts, and frame-ancestors in a meta element. No CORS error was
visible in the inspected console snapshot; this is bounded observation, not an
exhaustive network audit or a proposal to loosen CSP.

An attempted DevTools-close interaction was rejected because the user changed
the browser. A fresh read confirmed an unrelated X tab was active. No further
input was sent. Remaining desktop/mobile/keyboard/role/mutation acceptance needs
an uninterrupted task-tab window or working background browser attachment.
The access defect is resolved; release remains gated on those remaining checks.

## Bounded authenticated interaction pass — 2026-09-06 23:46–23:53 UTC

Owner readiness authorized selecting the dedicated Preview tab. Completed in
the existing signed-in session, without remote data mutations:

- Mouse selection of fixture 3 loads its detail. Down-arrow moves focus and
  selection to fixture 4; its detail ID is
  `6a029974-123b-9f0c-0e72-2a2dbd382956`. Desktop screenshot shows the visible
  keyboard focus outline and queue/inspector layout.
- Refresh retains that selected detail. Queued filter shows both an explicit
  empty queue message and no-row inspector state. Returning to Active + issues
  restores the populated list (79 issues).
- Feedback begins unselected with Save disabled. Selecting Needs review enables
  Save; changing rows discards the unsaved choice and disables Save again.
  Nothing was saved, retried, marked reviewed, or restored.
- Responsive DevTools viewport at 400 px (displayed 400 × 810) exposes mobile
  Back to queue. Back reveals the queue; selecting fixture 4 returns to its
  matching detail. Mobile feedback options are visible and Escape dismisses
  the menu with focus returned to Feedback. Screenshots inspected; this is one
  emulated viewport, not physical-device or exhaustive breakpoint coverage.
- Device emulation was turned off and DevTools closed after testing.

Not accepted: splitter resizing. Clicking the splitter and pressing Right did
not establish a value change or splitter focus; a later set-value attempt was
rejected when the user changed the browser. Do not label this a proven app bug
or a passed resize check. No further input followed that ownership guard.

Remaining release checks include read_only-role behavior and backend denial,
isolated saved-feedback/review persistence and pending/error handling, complete
resize/scroll coverage, and configured output/subtitle display. This pass proves
the listed interactions only; it does not complete stage A or authorize release
despite its unresolved acceptance gates. `git diff --check` passed for this
documentation update; no application source changed during the pass.

## Acceptance failure isolated — 2026-09-07 approximately 00:08 UTC

The owner explicitly requested completing the remaining checks before merge or
deployment. Existing Preview admin/read_only credentials were consumed through
the already-registered 1Password local environment mount, without printing or
persisting credential values. A temporary credential-free test script is at
`/tmp/xot-pr77-acceptance.mLcMQ6/check.mjs`; no service or watcher was started.
All authenticated requests targeted `umicnrtkpuzjwivmgnei` only, using its public
anonymous API key plus each user's access token, not service-role authorization.

### Passed: API read_only boundary

- Admin detail read: HTTP 200, request
  `01a07931-fd3e-70f3-8d3b-6757f5aba418`.
- Read-only detail read: HTTP 200, request
  `01a07932-0176-7ab8-ab84-ef6ffd7270c1`.
- Read-only feedback write: HTTP 403, `admin_role_required`, request
  `01a07932-0430-7122-af34-189055b0f3f0`.

The target was verified as fixture 4, author `xot_staging_fixture`, delivery
decision `skip`, render ID `6a029974-123b-9f0c-0e72-2a2dbd382956`, revision 1,
status blocked, attempts 0, no existing feedback. This is API permission proof,
not yet read_only browser-control acceptance.

### Failed: admin feedback persistence

One admin save of a labeled synthetic acceptance note returned HTTP 500,
`Admin action failed`, request `01a07932-b876-7f18-a57e-c7d91460d4e7`.
The script stopped before retrying or testing stale revisions. A fresh admin
detail read (`01a07933-4e11-78ce-ace7-4c7b9df10bdb`) confirmed feedback remains
empty and render status/attempts unchanged. No acceptance note persisted.

Read-only inspection of the deployed function and a `BEGIN READ ONLY` call with
a nonexistent render UUID independently reproduced PostgreSQL error `42702`:
`column reference "id" is ambiguous`. The failing function is
`public.save_video_render_feedback_if_current(uuid,text,bigint,text,text,jsonb,uuid)`;
its `RETURNS TABLE` output variable `id` conflicts with unqualified `WHERE id`
in its initial SELECT. The body also has unqualified RETURNING columns requiring
review in the same bounded repair. Local migration
`supabase/migrations/20260722162000_video_render_feedback_revision.sql` contains
the same pattern; no new frontend change was required to reproduce the failure.

Minimal proposed repair: explicitly qualify table columns inside that function,
retain its signature, revision guard, grants and security settings, and validate
with regression tests plus the same Preview save/readback/denial checks. This is
a concrete affected-path backend dependency under stage A, not justification for
broad schema convergence. Implementation and Preview migration authorization are
required before changing it; no SQL definitions were changed during these checks.

Resize remains unaccepted: the native pointer attempt did not prove a changed
splitter value, and the browser subsequently switched to unrelated browsing.
No further input was sent. Background tab acquisition also timed out and reset
the control session. Read_only visual controls, resize, successful persistence,
and dependent error/pending/output coverage remain open. No merge, deployment,
Production mutation, render retry or posting occurred.

## Superseding repair/acceptance result — 2026-09-07

The owner subsequently approved the targeted repair and ongoing Preview work.
See [Preview feedback repair and acceptance](2026-09-07-xot-preview-feedback-acceptance.md)
for the applied migration, red/green SQL regression, successful API/UI feedback
persistence, desktop/mobile read_only controls, keyboard resize, review/restore,
unchanged isolation controls and exact remaining release limits. This supersedes
the feedback failure and pending three-check status above, without erasing them
or declaring broader Production release gates complete.
