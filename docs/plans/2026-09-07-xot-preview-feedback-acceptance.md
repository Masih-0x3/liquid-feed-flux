# PR #77 Preview feedback repair and acceptance

Date: 2026-09-07 UTC. Frontend under test: `51ab283083d27099deff7f841b856fe22d2a6598`.
Preview project: `umicnrtkpuzjwivmgnei`.
Preview origin: `https://xot-git-codex-video-render-wor-9b1088-masihation-8914s-projects.vercel.app`.

## Authority and boundary

The owner explicitly authorized the targeted feedback-function repair and
continuing Preview work without further approval prompts. Production remains a
separate approval boundary. This record does not amend standing agent policies,
waive Production migration gates, or claim a Production-ready release.

## Repair

The admin feedback action returned HTTP 500 because PostgreSQL raised `42702`:
the output variable `id` conflicted with an unqualified table column. The same
ambiguity affected RETURNING columns. A real transactional SQL regression failed
before the repair and passed afterward; its test writes were rolled back.

Applied only Preview migration `20260907001640_video_render_feedback_qualified_columns`.
The forward-only source file leaves the earlier migration unchanged. It qualifies
SELECT/WHERE and INSERT RETURNING references, with no signature, owner, grant,
RLS, revision-guard, runtime-control, or Edge deployment changes.

- Local migration SHA-256: `6a8dcb81934646a23dc7cf0f0e0dc19347594d945f1649eb94b1ffa8158218c8`.
- Local and live function-body MD5 equality: `9ec3a7efcb9ef4a3d537f7791c7bc6bd`.
  This is a byte-equality check, not a security attestation.
- Live ACL before/after: `{postgres=X/postgres,service_role=X/postgres}`.
- `SECURITY DEFINER` and `search_path=public, pg_catalog` remain unchanged.
- Migration inventory includes the new append-only successor. The raw-video
  contract validates this exact replacement, signature and security settings,
  pins its bytes, and rejects grant/signature/revision-guard mutations. It is
  not classified as an unrelated migration or given a broad exemption.

## Completed requested checks

| Check | Evidence and result |
| --- | --- |
| Desktop resize | Tab from last queue row focuses the named splitter; Right changes 40 to 50, Left restores 40. Screenshot shows changed proportions and focus. Pointer drag was inconclusive; keyboard resizing is the accepted coverage. |
| Desktop read_only UI | Existing read_only account signed in; role banner visible. Retry, single/bulk review, Feedback, Note and Save disabled; Refresh and reading remain available. |
| Mobile read_only UI | At emulated 400 × 810, Back to queue and item selection work; detail mutation controls remain disabled and saved feedback is readable. |
| Admin feedback API | Save HTTP 200, `ok:true`; independently read back using the read_only account. |
| Admin feedback UI | Explicit Needs review label and synthetic note submitted. Save disabled during the request, then history displays the saved note. Independent database read confirms persistence. |
| Stale feedback | Wrong revision returns `ok:false`, instructing refresh; no stale probe is stored. |
| API role denial | read_only feedback, retry and reviewed-state mutations return HTTP 403 `admin_role_required`; same account reads detail successfully. |
| Review/restore API | Valid fixture 6 marked reviewed, read back under read_only, restored, and read back again. Final `reviewed_at=null`, status blocked, attempts 0. |
| SQL regression | `scripts/test-preview-video-render-feedback.sql` verifies stale guard, insert, returned fields, revision metadata, count and direct RPC permissions, then rolls back. |

Earlier bounded browser checks also passed selection, Down-arrow navigation,
refresh retaining selection, Queued empty state, returning to the issue list,
explicit-feedback Save gating, unsaved-choice reset, and admin mobile
queue/detail/back navigation. Screenshots and accessibility observations were
captured in the task session. Device emulation and DevTools were closed; the
existing task tab was left signed in as admin with the desktop layout restored.

### Live request evidence

- Initial failed admin save: `01a07932-b876-7f18-a57e-c7d91460d4e7`.
- Successful repaired save: `01a07939-af0c-71f7-af99-3eb04f8c41d5`.
- Independent read_only persistence read: `01a07939-b13c-799e-a027-372b26b9523d`.
- Stale revision rejected: `01a07939-b395-7c03-ac1a-ea2792abccfd`.
- read_only retry denial: `01a07942-ac97-7e7a-955d-671853947ade`.
- read_only reviewed-state denial: `01a07942-ae47-7fb5-8777-a2112ea1d501`.
- Mark reviewed: `01a07942-b00a-7c6d-918d-4fa682564b78`; readback
  `01a07942-b23e-7acb-a3f6-6f6d155f00aa`.
- Restore: `01a07942-b462-76c5-9ae8-405cc227624a`; readback
  `01a07942-b6d9-7d69-b93d-877cbf0181e3`.

## Final test data and isolation

Two explicitly labeled acceptance notes remain on synthetic fixture 4
(`6a029974-123b-9f0c-0e72-2a2dbd382956`), feedback IDs
`fabc01ed-15f6-4929-b6c2-190aa1f50591` (API) and
`1de8465c-e108-4b5a-83fe-4b979c525cf8` (UI). It remains blocked, attempts 0,
revision 1 and unreviewed. These are intentional test evidence, not real content.

Fixture 6 (`fdf5c2d2-ceaa-5d09-8125-74efa7b47b6e`) remains blocked, attempts 0,
unreviewed, revision 3 after the reversible review roundtrip; audit events remain.
Some older sanitized fixture UUIDs are not RFC-valid under the app's existing
validator: fixture 4's review attempt was rejected before mutation. Review tests
used fixture 6 rather than weakening UUID validation or changing fixture IDs.

Final Preview controls: environment preview, posting blocked, translation false,
deduplication false, zero cron jobs. No admin render retry, renderer processing,
external posting, paid provider call, Production mutation or private export ran.
Passwords were consumed through existing 1Password access and never printed or
persisted by the test script. Copied passwords were replaced on the clipboard
with nonsensitive variable names.

## Regression results

- `npm test`: 41 files, 245 tests passed. Expected negative AuthProvider tests
  emit their intentional error messages; the suite exits 0.
- `node --test scripts/check-migration-baseline.test.mjs`: 83 passed.
- `node --test scripts/check-video-render-rls-contract.test.mjs`: 2 passed,
  including fail-closed mutation tests and the new repair mutations.
- `node --test scripts/check-runtime-contract.test.mjs`: 35 passed.
- `npm run lint`: 0 errors, 11 existing warnings in unchanged frontend files.
- `npm run check:strict`: passed.
- Runtime, feedback, review-persistence, admin-role and RLS source contracts: passed.
- Migration inventory integrity: passed, 129 frozen migrations plus 8 named
  append-only successors. Its Production release gate still reports existing
  owner/replay/restore/privilege/types/remote-evidence/hosted-CI blockers.
- Canonical `npm run build`, using explicit Preview identity and public key:
  passed; `BUILD_OUTPUT_IDENTITY_PASS`, 84 files, expected Preview project.
- `git diff --check`: passed.

## Limits and handoff

The requested resize, read_only-role and saved-feedback checks are complete with
the coverage above. This is not blanket stage-A or Production acceptance:
authorized output/media playback and populated subtitle display are not live
verified in this Preview, and pointer dragging remains inconclusive. No renderer
upgrade or new output generation was attempted. Error handling is proven by the
API stale-revision guard and existing component tests, not an induced browser
network outage. The local repair/contract/test files are uncommitted and unpushed;
fresh remote CI for these files and separate Production migration approval/gates
are still required before any release that includes the database repair.

No services or watchers were started. Credential-free temporary API runner and
local Preview build are retained at `/tmp/xot-pr77-acceptance.mLcMQ6/` for
reproducibility; that directory is not deployed or served. Existing credential
mounts and unrelated user browser tabs were not reconfigured or removed.

## Continued media and release-gate verification — 2026-09-07

This section supersedes the populated-subtitle coverage limit above. It does
not supersede the Production migration hold or claim playback support.

### Media contract and live subtitle coverage

Source inspection establishes that `VideoRenderDetailPanel.tsx` intentionally
has no media player or configuration-controlled playback branch. Its unavailable
message is unconditional. The client-media containment contract explicitly
rejects adding a video source or exposing raw media response fields. Therefore
enabling playback is not a missing Preview setting: it would be a separate
authorized-media implementation and security-boundary change. No such bypass
was introduced. Current supported media behavior is metadata/subtitle display
with media preview unavailable; actual output playback is unsupported, not passed.

Synthetic fixture 6 was guarded by exact ID, tweet ID, blocked status, zero
attempts, revision and expected original values. Preview isolation and the two
local-only revision/timestamp triggers were inspected before modification.
Temporary translated and legacy SRT text was added, then target language `fa`.

- Existing admin browser displayed the translated Persian/English SRT on
  desktop and emulated 400 × 810 mobile, with wrapping inside the inspector.
  Desktop inspector scrolling left the queue in place. Screenshots were inspected.
- read_only API independently returned revision 5 and the same two subtitle
  fields with target language `fa`: HTTP 200, request
  `01a07976-1a63-7586-a2c3-84230fd2de72`.
- Setting translated text to whitespace exposed `PR77 legacy fallback fixture.`
  in the live accessibility result. This fallback has text observation, not a
  final screenshot: the user switched to another tab before capture.
- Two new component regressions cover populated translated precedence and
  whitespace-to-legacy fallback, `lang=fa`, `dir=rtl`, and absence of media sinks.
- All three temporary fields were restored to NULL with exact revision/value
  guards. Independent final SQL confirms revision 7, blocked, attempts 0,
  unreviewed, both subtitles and target language NULL. Revision/timestamp
  advancement is intentional; the original revision was not falsified.
- Final controls remain Preview, posting blocked, translation/deduplication
  false, cron count 0. No renderer, paid-provider call, output upload or posting
  was initiated. Existing two feedback notes on fixture 4 were preserved.

### Additional local and remote checks

- Function inventory: 10 functions; Edge lint: 163 files; Edge typecheck: passed.
- Full Edge suite: 496 passed, zero failed; runtime network permission restricted
  to the test listener at `0.0.0.0:8000`.
- Renderer suite: 214 tests passed, zero failures/skips; provider calls are
  mocked and server tests use temporary local listeners.
- Full frontend rerun: 41 files, 247 tests passed; strict TypeScript passed;
  lint passed with the same 11 existing warnings.
- Client-media containment and supply-chain source contracts passed. Supply
  reports `awaiting_fresh_scan_evidence`, not hosted scan acceptance.
- Expanded containment mutation testing first failed on a pre-existing stale
  fixture replacement for the removed `compact` prop: the old indentation no
  longer matched the redesigned page, so the mutation was a no-op. The test now
  inserts at the actual component opening and asserts every mutation changes
  its source. `MUTATION_TEST=1` then passes. No containment rule was weakened.
- Explicit Preview release-state `--mode render`: passed; this mode makes no
  remote calls and is not a live inventory receipt.
- Function deployment dry-run validated all ten function entries, then refused
  the dirty worktree. No dirty override, stash, deployment or unrelated commit
  was used. A clean finalized candidate is still required.
- `gh pr view 77`: still OPEN/DRAFT, head `51ab283083d27099deff7f841b856fe22d2a6598`;
  existing successful CI run `33817672499` does not cover these unpushed files.
- `npm run check:migration-release`: exit 1. Its actual failures include reviewed
  candidate inventory/body mismatch, immutable-source/type-hash mismatches,
  missing protected replay/Production schema evidence, missing fresh Production
  types and missing valid `reviewed_git_sha`. These were not rewritten to pass.

### Remaining release boundary

Verdict: not ready for Production. `docs/operations/release-runbook.md`, section
**Supabase Migration Release**, requires protected fresh remote/schema/type
inputs, no-egress replay, disposable restore evidence, full reviewed privilege
comparison, and database/security/release-owner approval before applying the
repair to Production. Preview-only authority does not authorize private
Production exports, recovery-target spending, owner impersonation or gate waiver.
The exact candidate also needs clean-source, hosted-CI and supply evidence before
promotion. Existing conditional rollout approval does not satisfy these gates.

Pointer dragging remains inconclusive (keyboard resize passed); an induced
browser network-error workflow is not covered. These are explicitly retained
coverage limits, not silently counted as passed. No Production rollout occurred.

Background browser status: designated PR #77 Preview task tab, native Comet;
existing admin session, active verification. No new browser instance or tab was
created by this pass. Mobile emulation was disabled and DevTools close was
issued before the user switched tabs. User focus interruption was not separately
measured. No input followed the observed tab switch; final background page
refresh after fixture restoration was not visually checked. Browser interactions
changed no account/settings or saved feedback. Temporary test data restoration
was independently verified through SQL. No task service or watcher remains.

## Subsequent approved Production evidence capture

The owner approved protected local schema/history/type capture. See
[Production evidence capture](2026-09-07-xot-production-evidence-capture.md)
for the captured hashes, 117-row history comparison, matching table/view type
inventories, remaining canonical-dump/provenance blockers, and the disclosed
unexpected CLI temporary-login initialization. This does not approve or record
a Production release, migration, replay or restore.
