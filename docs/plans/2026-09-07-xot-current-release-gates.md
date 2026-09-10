# Current release baseline: implemented locally; Production remains closed

## Authorized work completed

On September 7 the owner approved updating the release baseline/tooling and
downloading the exact pinned PostgreSQL test image. This was not authorization
to publish, merge, deploy, change Production, accept unreviewed source differences,
export application records, or run a provider restore.

The current baseline now binds **137 local migrations and 117 captured remote
records**, without rewriting historical E7/E10 manifests, receipts, runtimes or
source bodies. The existing migration check validates both the historical chain
and the new epoch. The release command selects the new epoch and retains every
required release gate, protected-input hash, freshness, review and commit-chain
requirement. No gate was relabeled passed to clear an error.

Artifacts:

- [Current baseline](2026-09-07-xot-current-release-baseline.json).
- [Pinned SQL/type replay receipt](2026-09-07-xot-current-release-sql-replay.json).
- [Redacted schema/privilege comparison](2026-09-07-xot-current-release-schema-privilege-diff.json).
- [Operator commands and isolation boundary](../operations/staging-replay-no-egress.md).

## Current local replay

The accepted run lasted **33.911 seconds**, from `10:35:48.385Z` to
`10:36:22.296Z`, using PostgreSQL image
`sha256:99b1729aeb0bac314445024fc149fbd39306170b61dd50800ccf180327ab3459`.
That exact image was downloaded after approval. The type generator image
`sha256:a84cc713585eea7b401e4a2561ec4a1e48c87083d1c7ecb4502f204bb4391300`
was already cached; no additional image was downloaded.

- All 137 migration bodies replayed under the exact inventory SHA-256
  `321c48bcc6258dabfae83c088a2d6286be0012de8f69cd275b0cf33f424aeeb5`.
- PostgreSQL: one CPU, 1 GiB, `network=none`, no mounts or published ports.
  The route table had zero non-loopback routes. A bounded connection to the
  reserved documentation address `192.0.2.1` failed with curl exit 7.
- The current bridge's one seeded control row was Preview/blocked with
  translation/dedupe disabled and no activation epoch. Existing RLS, grant,
  singleton, role-uniqueness and mutation-rejection assertions passed.
- The guarded Preview feedback SQL regression ran unchanged on synthetic local
  fixtures. Save/result/metadata/stale-revision/direct-RPC-denial checks passed;
  rollback left zero feedback rows. No real application records were imported.
- Direct, pinned postgres-meta generated public-schema TypeScript inside the
  same owned no-egress network namespace, with one CPU/512 MiB. The resulting
  file passed strict TypeScript compilation. This is accurately recorded as
  direct postgres-meta invocation, not a hosted/linked CLI capture.
- Source/harness hashes were checked before and after execution. Both exact
  task containers were removed, absence verified, and unrelated Skillmap/XOT
  resource inventories were unchanged.

Earlier attempts revealed two harness assumptions, not application defects:
the historical assertion expected zero controls before the August 25 seed, and
Docker returned unchanged mount records in different array orders. The current
runner explicitly verifies the safe seed and normalizes mount ordering only;
negative tests still reject changed/deleted/added mounts and unsafe controls.

Protected artifacts remain in
`supabase/.temp/current-release-replay-9ad2tq/` (0700 directory, 0600 files).
The public receipts contain hashes and redacted metadata, not SQL bodies, tokens,
passwords, application rows or raw resource snapshots.

## What the comparison actually says

There are 254 side-specific source records: 152 have deterministic raw-body
matches, allowing only an optional terminal LF; 102 remain in owner-review state.
**102 is not a count of defects or changes to deploy.** Historical ledger aliases,
bundled definitions, source-only forward migrations and missing bodies are
included. The missing historical body `20260516050042` remains unresolved.

The captured and replayed catalogs have the same 237 relation identities, 661
column identities, 210 function identities, 187 index identities, 44 policies,
23 triggers, four views, one sequence and two enum labels. These counts include
indexes and extension objects; they are not all application tables/functions.

Three function definitions differ textually:

- `save_video_render_feedback_if_current`: the intended qualified-column repair.
- `cleanup_old_data`: two ordinary SQL line comments/blank lines only.
- `find_similar_story_v2`: one ordinary SQL line comment only.

Both complete non-feedback definitions and their narrow line differences were
inspected; no executable SQL difference was found in those two functions.
Neither function was invoked or changed in Production. Cleanup holds remain
unchanged. The comparison tool does not broadly normalize quoted SQL or turn
comment-like data into equivalence evidence.

Other differences include runtime-control column ordering/constraint shape, a
column default, and ownership/ACL/policy representation. The report's **764
syntactic GRANT/REVOKE records are not 764 effective-permission defects**. Replay
and Production have different owner contexts; role-matrix/default-privilege
review is still required. No broad database convergence was attempted.

Replay types were generated successfully, but they do not have exact byte parity
with captured Production types. Previously demonstrated type assignability is
not substituted for the gate's exact evidence requirement.

## Remaining release gates

| Gate | Evidence now available | Still required |
| --- | --- | --- |
| Replay/egress | Current pinned 137-migration replay, direct denial probe, safe state and cleanup | Reviewed closure package including the required Production-log zero-traffic evidence |
| Recovery | Historical provider backup inventory; schema-only local replay | Owner-selected recovery point/target and a real isolated database plus Storage recovery drill |
| Source review | Exact hashes, all current records, targeted catalog comparison | Named owner review tied to the eventual source commit; general tooling approval is not source approval |
| Missing body | Missing version identified and carried forward | Approved source recovery or forward-fix/live-effect disposition |
| Privileges | Reproducible protected SQL facts and redacted catalog differences | Role matrix, default-privilege disposition and reviewed schema reconciliation |
| Types | Current local generated types and successful compile | Reviewed parity/disposition and fresh Production type evidence tied to the source SHA |
| Hosted CI | Local checks only | Publish the scoped source candidate, pass exact-commit CI, and record reviewed source/evidence commits |

The release command consumed all actual protected inputs and remained blocked,
as expected. It no longer rejects them for the obsolete 105/107 inventory or
mislabels their CLI provenance. It still rejects expired Production capture
evidence, unresolved schema/type differences, absent owner review and absent
reviewed Git SHA. The captured Production history/types are outside the six-hour
window; no timestamp was renewed or fabricated.

No new Production credential initialization, Production application write,
migration, restore, private upload, push, merge or deployment occurred during
this approved tooling pass. A read-only Preview public-key lookup was used only
for a local Preview build; Sentry upload credentials were excluded from its
environment. No new live browser acceptance is claimed.

## Handoff boundary

### Verification actually run

- `node --test scripts/check-migration-baseline.test.mjs scripts/e10SqlBoundary.test.mjs`:
  **123 passed**, including current-baseline, capture/privacy, age, tampering,
  schema-comparison, type-helper and historical-gate negative tests.
- `npm run check:runtime-contract` and `npm run test:runtime-contract`:
  **PASS / 35 tests**, Node `24.20.0`, npm `11.19.0`.
- `npm run check:supply-chain-contract` and `npm run test:supply-chain-contract`:
  **source contract PASS / 62 tests**. Fresh hosted vulnerability/advisory scan
  evidence remains outstanding; a source-contract pass is not an external scan.
- `npm run lint`: **exit 0**, 11 existing warnings, no errors.
- `npm run check:function-inventory`: **10 functions**; `npm run lint:functions`:
  **163 files checked**.
- `deno check --frozen --node-modules-dir=manual --deny-import supabase/functions/*/index.ts`:
  **PASS** on Deno `2.9.5`. An initial unsupported `--cached-only` invocation
  exited before checking; the installed CLI help was consulted and the rerun
  denied remote imports and used the existing dependency tree.
- `deno test --frozen --node-modules-dir=manual --deny-import --allow-read --allow-env --allow-net=0.0.0.0:8000 supabase/functions`:
  **496 passed**. The only permitted test networking was the configured local
  test endpoint; this is not an authenticated/live Production test.
- `npm run check:strict`: **PASS**; `npm test -- --maxWorkers=2`:
  **247 passed in 41 files**.
- `npm --prefix services/video-renderer test`: **214 passed**.
- `npm run build` through a task-local minimal-environment wrapper:
  **exit 0**, 84 output files passed Preview identity validation. The wrapper
  disabled Sentry upload by excluding its credential. Output/logs are under
  `/private/tmp/xot-current-baseline-build.88GLK4/`; no preview server was started.
- Strict compile of `supabase/.temp/current-release-replay-9ad2tq/replay-types.ts`:
  **PASS**. Exact replay/Production type-byte parity remains **not passed**.
- Full current migration release gate with all six protected input flags:
  **exit 1, blocked** on the explicit remaining gates above, not accepted.
- `git diff --check`: **PASS**. No commit or push was made; validation covered
  the current local working tree, not a newly published source SHA.

Implementation and local verification are separate from release acceptance.
### Publication authorization follow-up

The owner subsequently approved publishing the scoped candidate to PR #77 for
exact-commit CI, without merging or deploying, and explicitly approved disabling
automatic Vercel deployment for `codex/video-render-workspace-redesign` before
that push. `vercel.json` now sets only that additional branch to `false`, retaining
the existing exclusion and leaving other branches unchanged. Context7's Vercel
source documentation confirmed this per-branch setting disables automatic Git
deployments. This is configuration evidence, not a claim that a push or CI has
already completed. Production and manual deployment remain outside this approval.

Before that follow-up approval, the next independently useful external step was publishing the scoped candidate
to PR #77 for exact-commit CI. That requires explicit publishing approval and
does not authorize merging or deploying. A real recovery drill separately needs
an approved source/target and an established pre-start no-egress boundary; this
schema-only replay cannot be presented as that drill.

### September 8 publication and CI follow-up

Published `47af33d1726fe4692ef14553e4f75a424f8a398b` to draft PR #77 with the
branch-specific Vercel exclusion. Two subsequent Vercel deployment-list reads
returned zero deployments since the push. GitHub CI run `34179154611` passed
the hosted supply-chain technical stage but failed `check:v1-delivery-cutover`:
its three-file migration-tail assumption rejected the new feedback successor.

The follow-up checker retains the ordered delivery successors, requires the
exact feedback successor and its reviewed SHA-256, and preserves every existing
cutover assertion. Six subprocess fixture regressions cover the valid candidate,
missing repair, unexpected later migration, missing historical fence, changed
repair bytes and a trigger-drop addition. Red-first reproduction demonstrated
the old checker rejected the valid candidate and accepted a missing repair.
After the fix, all six pass, the real cutover check passes, and the combined
migration/E10 suite passes 129 tests. Hosted acceptance of the follow-up commit
still requires a new run.

Semaphore reported a generic pipeline failure; its cause was not available from
GitHub and the background browser was unavailable. CodeRabbit skipped the draft
review. Macroscope skipped because its estimated review exceeded the existing
per-review cost limit; no override, paid review, account setting change, merge,
or deployment was requested.
