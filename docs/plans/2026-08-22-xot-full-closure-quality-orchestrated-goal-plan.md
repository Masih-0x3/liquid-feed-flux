# XOT full-closure quality-orchestrated goal plan

**Status:** planning complete; implementation not started

**Planning owner:** Planner, GPT-5.6 Sol, Max reasoning

**Execution owner:** GPT-5.6 Luna, High reasoning

**Repository:** `/Users/stevmq/Finalized XOT`

**Plan date:** 2026-08-22
**Quality target:** 5/5

## 1. Operator decision

XOT is back in a clean, known local state. It is not yet release-ready. The remaining work is mainly target evidence and controlled external execution, not a broad source rewrite.

One persistent goal can run the work end to end only if the one-time access and authorization packet in section 5 is complete before the goal starts. Without that packet, the goal can finish every safe independent task, but it must stop honestly at the missing authority, credential, owner decision, or observation window. It must not promise a deploy or production result that it cannot reach.

This plan keeps the work small and direct:

- Do not redesign working features.
- Do not add a new security program. Satisfy only the release gates already named in the repository.
- Do not add manual file-hash matching. Use the reviewed Git commit, provider deployment IDs, hosted run IDs, and existing automated checkers as provenance.
- Do not weaken an existing migration, RLS, supply-chain, or release checker to make a gate pass.
- Do not repeat work already accepted locally. Promote each AIR row only when its missing target evidence exists.
- Do not run more than two disjoint candidate writers, one reviewer, and one Luna integrator at once.

## 2. Source-of-truth anchor

The planning phase verified this state without fetching or contacting any external system:

| Item | Verified state |
| --- | --- |
| Branch | `codex/xot-remediation-convergence` |
| HEAD | `179ed27219660159086597f98298bb9b1c652777` |
| Tree | `bd170b760c4a60a87e3cff491291edcaf3de889c` |
| Worktree before this plan | Clean |
| Tracking ref | `origin/codex/xot-remediation-convergence` |
| Local-ref delta | 61 ahead, 0 behind; no fetch, so this is not current remote proof |
| Release gate | `CLOSED` |
| Current accepted evidence | R5 local candidate gate and clean reconstruction; R6 AIR state and estimate |
| Current external evidence | No current hosted CI, staging, protected Preview, authenticated browser, deploy, live, T3, or T4 proof |

This plan file is the only intended planning delta. Execution must first inspect the live status, commit the approved plan and any authorized pre-freeze corrections, and establish a new clean candidate SHA. `179ed272...` is the planning anchor, not a promise that it will be the pushed candidate.

Evidence precedence is:

1. Current target evidence from GitHub, Supabase, the renderer host, Vercel, the native browser, and production.
2. Current exact-SHA hosted evidence.
3. Current local checks on the exact candidate.
4. Existing receipts and the AIR JSON.
5. Worker reports and historical notes, which are routing context only.

The controlling local artifacts are:

- `docs/plans/2026-08-21-xot-r5-candidate-gate-manifest.json`
- `docs/plans/2026-08-21-xot-r5-check-classification.json`
- `docs/plans/2026-08-21-xot-r5-clean-reconstruction-parity-receipt.json`
- `docs/plans/2026-08-21-xot-air-latest-state-and-estimate.json`
- `docs/plans/2026-08-12-xot-e9-owner-external-gate-packet-v4.json`
- `docs/plans/2026-08-12-xot-e10-preview-parity-implementation-plan.md`
- `docs/plans/2026-08-21-xot-recovery-clean-worktree-and-resume-implementation-plan.md`
- `docs/plans/2026-07-14-xot-comprehensive-audit-remediation-implementation-ledger.jsonl`
- `.github/workflows/ci.yml`
- `docs/operations/release-runbook.md`
- `docs/operations/runtime-contract.json`
- `docs/operations/supply-chain-gate.md`

### Current AIR state

The accepted R6 JSON has exactly 80 rows:

| State | Count | Meaning now |
| --- | ---: | --- |
| `accepted_local` | 15 | Local proof exists. Higher-tier proof may still be required by the release lane. |
| `partial_local` | 58 | Source work is present, but the row still needs the exact evidence named in the JSON. |
| `owner_blocked` | 4 | AIR-017, AIR-050, AIR-055, AIR-065 |
| `external_blocked` | 2 | AIR-052, AIR-053 |
| `disproved` | 1 | AIR-051; retain its regression contract, do not implement the disproved premise. |

There are 22 T1 rows and 58 T0 rows. No T2, T3, or T4 closure exists.

## 3. Definition of done

The goal is complete only when all conditions below are true:

1. All 80 AIR rows have a current final disposition tied to their required closure evidence. No `partial_local`, `owner_blocked`, or `external_blocked` row remains.
2. AIR-051 remains closed as disproved and its regression check still passes.
3. The reviewed candidate is clean, normally pushed, and tested by all required hosted checks on the exact PR-head SHA.
4. The isolated Supabase staging plane, renderer, ten functions, and protected Vercel Preview have target receipts and one consistent source SHA.
5. Authenticated admin and `read_only` workflows pass in the native/PiP browser. Production access and Preview posting writes are zero.
6. AIR-050 has an explicit `ACCEPT` decision. Silence is not acceptance.
7. The production proposal is separately authorized. T3 is current and read-only. T4 is bounded, serial, observed, and accepted.
8. Cleanup has a dry run, one bounded canary, an observation result, and an AIR-065 decision. Exactly one approved canonical schedule is active; all other cleanup schedules remain inactive unless separately authorized.
9. Git, CI, staging, renderer, Vercel, browser, provider, production, and rollback evidence are attached to the accepted target state. A worker report is not evidence.
10. All Orca tasks, dispatches, task-owned terminals, workers, temporary resources, and canary directories are settled. User-owned terminals, apps, servers, and unrelated files are untouched.
11. The implementation worktree is clean, the final reviewed state is pushed, and merge/deploy/live states are reported separately and accurately.

## 4. Strict phase and model ownership

These are execution boundaries, not preferences.

| Work | Required owner | Delegate boundary |
| --- | --- | --- |
| Substantive planning or replan | Native GPT-5.6 Sol, Max | Must finish before Luna resumes. |
| Source, config, docs, tests, integration, validation, final acceptance | Native GPT-5.6 Luna, High | External S0-S2 output is candidate-only. |
| Native/PiP browser interaction | Computer Use, GPT-5.6 Sol, Low, Fast | Luna interprets receipts and accepts results. |
| Migrations, Auth, RLS, secrets, data, billing, CI/lockfile/shared contracts, ledgers, deploys, production, cleanup | Luna High, serial, with the named system owner | External agents may only give redacted read-only findings. |

External routes may be used only after fresh discovery and exact canaries. The planning phase observed local CLI version drift from the stored adapter notes: AGY `1.1.18`, Devin `3000.5.20`, and Command Code `1.32.1`. No route is eligible from those version strings alone.

### Route codes and ordered chains

| Code | Exact route | Use |
| --- | --- | --- |
| `DS` | Devin CLI, `swe-1-7`, Max, `--permission-mode dangerous --respect-workspace-trust false` | Bounded S0-S2 code and tests while the exact route is still Free. |
| `DG` | Devin CLI, `glm-5-2`, High, `--permission-mode dangerous --respect-workspace-trust false` | Bounded tests, docs, repository reading, alternate patch, and review while Free. |
| `AGY` | Antigravity `agy`, `gemini-3.7-flash-high`, High, `--dangerously-skip-permissions` | Visual, frontend, multimodal, and task-compatible candidate or review work. Use `--mode plan` for review and `--mode accept-edits` only for an exact S0-S2 write set. |
| `CC-F` | Command Code, `deepseek/deepseek-v4-flash`, High, `--yolo` | Final routine external fallback after predecessor settlement. |
| `CC-P` | Command Code, `deepseek/deepseek-v4-pro`, Max, `--yolo` | Hard-debug or adversarial specialist only, after its own canary. |
| `LUNA` | Native `gpt-5.6-luna`, High | Implementation owner, integrator, validator, final acceptor, and protected work. |
| `CU` | Native Computer Use `gpt-5.6-sol`, Low, Fast | All browser clicks, typing, sign-in, viewport changes, screenshots, and browser DevTools actions. |
| `PLAN` | Native Planner `gpt-5.6-sol`, Max | Replanning on material scope, target, or authority drift. |

Ordered fallback chains:

- Bounded code/tests: `DS -> DG -> AGY -> CC-F -> LUNA`.
- Bounded docs/tests/read/review: `DG -> DS -> AGY -> CC-F -> LUNA`.
- Visual/frontend: `AGY -> task-compatible Free Devin -> compatible non-visual CC-F -> eligible Terra Ultra visual analysis`; Luna still integrates and accepts. If modality is lost, record `fallback_ineligible` and stop that stage.
- Hard specialist: `CC-P -> task-compatible AGY -> eligible Terra Ultra`; Luna owns any repair and acceptance.
- S3-S4 and protected files/systems: `LUNA` directly. Do not manufacture external work to increase provider usage.

Use both `DS` and `DG` concurrently when both exact models are still Free, both canaries pass, and two S0-S2 slices have disjoint write sets. With one write slice, use the second route only as a read-only challenger when that adds evidence. S2 and higher behavior needs an independent provider-family review, not two Devin models alone.

All Zro, Cline, Kimi, Anthropic, non-exact GLM, and disabled routes remain ineligible.

### Per-dispatch route gate

Before every external dispatch, Luna must record:

- live repo, branch, HEAD, tree, status, task authority, risk, modality, exact read/write/exclude sets;
- provider, harness, installed CLI version, requested/effective model and effort, identity, auth, quota, catalog time, exact Free/cost tier, privacy, and task fit;
- a fresh non-mutating canary for the exact model and effort;
- the current version-matched provider adapter;
- Orca Run ID, Task ID, task-owned terminal handle, Dispatch ID, prompt-submitted proof, and whether the provider executable started.

Provider names are not Orca agent IDs. Use the current adapter: create a task-owned terminal, wait for `tui-idle` when required, create and inspect a tracked Dispatch, then submit exactly once. AGY uses tracked injection and one submit check. Devin and Command Code use tracked non-injected dispatch plus one explicit terminal send unless a fresh transport canary proves a different supported path.

The high-autonomy flags remove prompts only. They do not expand files, scope, secret access, destructive authority, deploy authority, or acceptance authority.

Fallback starts only after the predecessor has a known, inspected, settled outcome. A launcher error before the provider executable starts is an adapter failure, not a provider failure. Timeout or silence is unknown, not failed. A returned `DONE` is not accepted until Luna inspects the actual diff and evidence and records `ACCEPTED`, `REWORK`, `REJECTED`, or `BLOCKED`.

No external delegate receives `.env*`, credentials, tokens, private keys, private URLs, production data, browser credentials, unredacted logs, or private provider identity data.

### Current adapter and canary shapes

Reload the current version-matched adapter before use. These commands show the required launch shape; replace only task IDs, terminal handles, titles, mode, and the exact task specification.

```bash
# Antigravity discovery and canary
agy models
agy --print 'Return exactly AGY_ROUTE_OK and nothing else.' \
  --model gemini-3.7-flash-high --effort high --mode plan \
  --dangerously-skip-permissions --output-format json --print-timeout 60s

# Antigravity supervised terminal: use accept-edits only for an exact S0-S2 write set
orca terminal create --worktree "path:<repo-root>" --title agy-worker \
  --command 'agy --model gemini-3.7-flash-high --effort high --mode plan --dangerously-skip-permissions' --json
orca terminal wait --terminal <handle> --for tui-idle --timeout-ms 60000 --json
orca orchestration dispatch --task <task-id> --to <handle> --inject --json
orca orchestration dispatch-show --task <task-id> --json
```

After AGY injection, inspect the terminal. If the exact task remains a draft and no provider work started, submit that existing draft once with `orca terminal send --terminal <handle> --text '' --enter --json`. Never send the task twice.

```bash
# Devin discovery and one exact-model canary per dispatch
devin --version
devin auth status
devin models list --format json
devin_canary_dir="$(mktemp -d /tmp/quality-devin-canary.XXXXXX)"
(
  cd "$devin_canary_dir" || exit 70
  devin --model <swe-1-7-or-glm-5-2> \
    --permission-mode dangerous --respect-workspace-trust false \
    -p 'Return exactly DEVIN_ROUTE_OK and nothing else.'
)
rmdir "$devin_canary_dir"

# Devin supervised terminal and tracked non-injected dispatch
orca terminal create --worktree "path:<repo-root>" --title devin-worker \
  --command 'devin --model <exact-model> --permission-mode dangerous --respect-workspace-trust false' --json
orca terminal wait --terminal <handle> --for tui-idle --timeout-ms 60000 --json
orca orchestration dispatch --task <task-id> --to <handle> --json
orca orchestration dispatch-show --task <task-id> --json
orca terminal send --terminal <handle> --text '<exact task specification>' --enter --json
```

The Devin receipt must attest the exact `model_input` and `resolved_model_uid`. `rmdir` failure means inspect the unexpected canary residue; do not delete it blindly.

```bash
# Command Code discovery and Flash canary
commandcode status
commandcode --list-models
commandcode --no-session --skip-onboarding --no-skills --yolo \
  --model deepseek/deepseek-v4-flash --effort high --max-turns 1 \
  --output-format json -p 'Return exactly COMMAND_CODE_ROUTE_OK and nothing else.'

# Command Code supervised terminal and tracked non-injected dispatch
orca terminal create --worktree "path:<repo-root>" --title command-code-worker \
  --command 'commandcode --skip-onboarding --yolo --model deepseek/deepseek-v4-flash --effort high' --json
orca terminal wait --terminal <handle> --for tui-idle --timeout-ms 60000 --json
orca orchestration dispatch --task <task-id> --to <handle> --json
orca orchestration dispatch-show --task <task-id> --json
orca terminal send --terminal <handle> --text '<exact task specification>' --enter --json
```

For the specialist canary and terminal, use exact `deepseek/deepseek-v4-pro` and `--effort max`. A standalone Codex CLI, if a future approved chain explicitly selects one, must use `--dangerously-bypass-approvals-and-sandbox`. Native agents have no separate YOLO flag and use the runtime's configured sandbox and approval policy.

Every settled dispatch and fallback record must include:

`primary_route`, `failure_class`, `failure_layer`, `provider_executable_invoked`, `launch_adapter`, `transport_mode`, `prompt_submitted`, `ordered_fallback_chain`, `fallback_route_index`, `predecessor_dispatch`, `predecessor_outcome`, `predecessor_settled_evidence`, requested/effective model and effort, catalog/cost/canary evidence, Run/Task/terminal/Dispatch IDs, Luna decision, residual resources, and cleanup evidence.

## 5. One-time authorization and access packet

Create and approve one redacted packet before starting the goal. Recommended path:

`docs/plans/2026-08-22-xot-full-closure-authorization-packet.json`

The packet must name the owner, approver, scope, target, expiry, spending cap, rollback authority, and evidence location for each row below. It must refer to secrets by secret-store name only.

| Area | Minimum grant needed for unattended execution | Required exclusion or decision |
| --- | --- | --- |
| GitHub repository | Confirm stable repository ID and canonical namespace; authorize remote reads, fetch, plan/E9/required repair commits, normal push to one named successor branch, creation/update of one draft successor PR, hosted checks, logs/artifacts, and one proven-infrastructure rerun. | No force push, direct `main` push, tag, branch deletion, auto-merge, PR #69 mutation, or merge before the release gate. Specify whether the executor may merge after all gates pass. |
| GitHub CI | Authorize the minimal workflow/checker/test changes needed to add `test:functions`, bind exact PR-head provenance, and satisfy the existing supply-chain gate. Provide required-check and branch-protection access. | No unrelated workflow redesign. No secret values in CI evidence. |
| Supabase staging | Organization, region, project name, cost cap, project creation/link, approved target-bound migration replay, Auth users, roles, Storage, Realtime, Vault/secret names, function deploy, disabled cron setup, sanitized fixtures, logs, and rollback. | No production data, users, objects, endpoints, or keys. Choose and approve the no-egress or sanitized-baseline method before replay. |
| Renderer staging | Host/account, cost cap, registry, deploy/start/stop/log/metric/rollback access, secret-store injection, staging ID `xot-staging-1`, and bounded provider fixtures. | No production endpoint or key. One replica and concurrency one until accepted. |
| Vercel Preview | `xot` project, named source branch, Preview variables, deployment protection, immutable URL, stable protected alias, deploy/rollback, and read access to build artifacts/provenance. | Production variables, aliases, and DNS remain unchanged. Prove automatic deploy is suppressed until the protected deploy wave. |
| Browser acceptance | Protected Preview URLs, owner-controlled `admin` and `read_only` sessions, and an MFA/bootstrap method usable inside native Computer Use. | Credentials stay in the native browser session. If AIR-050 judgment is not delegated, the goal must pause for the owner. |
| Preview providers | Staging-only OpenAI/Deepgram keys, named fixture IDs, maximum request counts, and budget. | X and Telegram posting credentials are absent. Preview posting write count must be zero. |
| Production T3 | Current production target IDs and read-only access for Vercel, Supabase, functions, renderer, logs, queues, provider ledgers, migration/RLS/grant state, backup/PITR, and PAT disposition. | No mutation under T3 authority. |
| Production T4 | Exact approved proposal, deploy order, fixture IDs, expected transitions, maximum queue claims, provider request/write envelope, time window, soak window, prior versions, rollback triggers, and named rollback operators. | Provider writes default to zero unless the packet names a non-zero canary. No action outside the manifest. |
| Cleanup | One dry run, one bounded claimed invocation, row/object/byte limits, observation window, and authority to enable exactly one canonical schedule after AIR-065 approval. | No broad SQL/object deletion, project reset, evidence deletion, or second schedule. Job 17 stays inactive unless separately authorized. |
| Owner decisions | Named decision owners or delegated measurable rules for AIR-017, AIR-050, AIR-052, AIR-053, AIR-055, AIR-065, SR-REL-00, SR-MIG-01, SR-RLS-01, and PAT-1. | An owner must either decide in advance from named pass/fail criteria or commit to the response window. Silence never passes. |
| Billing and retention | Maximum spend for Supabase, renderer, registry, Vercel, and provider fixtures; staging retention/teardown decision. | Teardown is destructive and is not implied by completion. |

Minimum practical owner rules:

- AIR-017: name the representative queries, workload window, plan/metric acceptance rule, and database performance owner.
- AIR-050: delegate `ACCEPT` when every named P6 route, role, viewport, hierarchy, accessibility, zero-write, and rollback criterion passes, or plan for the owner to return.
- AIR-052: fix-first rule for high/critical findings; any waiver needs a named owner and expiry. Do not expand the scan program beyond the existing gate.
- AIR-055: name the masked build inputs and provenance artifacts that the build/release owner will accept.
- AIR-065: approve one canary limit, one observation window, and the rule for selecting exactly one cleanup schedule.
- PAT-1: name the security owner and provide a current redacted disposition. Never put the token or PAT value in the packet.

If any required packet field is missing, mark the dependent task `BLOCKED_AUTHORITY`, `BLOCKED_ACCESS`, `BLOCKED_OWNER_DECISION`, or `BLOCKED_BILLING`. Continue independent safe work. Do not keep prompting in a loop.

## 6. Dependency DAG and concurrency waves

```text
G0 live anchor + packet + route gates
 |
 +--> C1 minimal pre-freeze contracts --------+
 +--> C2 AIR-036 bounded closure --------------+--> C3 final local gate/commit
 +--> C0 remote read-only identity ------------+             |
                                                              v
                                                    P2.5 push/PR/hosted CI
                                                              |
                                                              v
                            P3 Supabase staging (serial protected core)
                                      |
                                      +----> P4 renderer
                                      |          |
                                      +----------+--> P5 serial protected deploy
                                                           |
                                                           v
                                               P6 authenticated acceptance
                                                           |
                                                   AIR-050 decision
                                                           |
                                                           v
                                                P7 proposal/receipt closeout
                                                           |
                                               separate production authority
                                                           |
                           +-------------------------------+------------------+
                           v                               v                  v
                    T3 DB/runtime reads            T3 deploy/build reads   T3 browser smoke
                           +-------------------------------+------------------+
                                                           |
                                                           v
                                      merge + serial production release wave
                              migrations/config -> functions -> renderer -> frontend
                                                           |
                                                           v
                                              T4 serial canaries + soak
                                                           |
                                                           v
                                    cleanup dry run -> one canary -> observe
                                                           |
                                                   AIR-065 decision
                                                           |
                                               exactly one schedule / final audit
```

Safe overlaps:

- In G0, remote read-only identity, route discovery, cost/access checks, staging target design, renderer capacity inventory, browser fixture inventory, and Vercel read-only inventory may run together.
- In C1/C2, `DS` and `DG` may work on two disjoint S0-S2 modules. One independent read-only reviewer may run after candidates freeze. Luna integrates serially.
- After P3 migration acceptance, independent schema, type, RLS, grant, and catalog reads may run together.
- P4 image build/scan may overlap renderer-host capacity inventory. P4 deployment remains serial.
- In P6, Computer Use route tours may overlap Luna's read-only log, database, queue, and provider-count collection if sessions and fixtures are isolated. Shared toggles, posting probes, failure injection, and rollback remain serial.
- T3 read-only snapshots may fan out by system and then reconcile into one timestamped state.

Always serial:

- CI, package/lockfile, shared contracts, migration/generated types, ledger, and release-workflow writes.
- Project linking, migrations, Auth, RLS, grants, Vault, secrets, staging data, runtime controls, and cron.
- Function, renderer, Vercel, production, alias, and schedule mutations.
- Shared provider toggles, T4 canaries, rollback, cleanup, and AIR-065 schedule activation.

## 7. Goal task inventory

`Now` describes the state at this plan anchor. `Fallback` applies only to eligible candidate or review work. Protected Luna work has no external fallback.

| ID / dependencies | One outcome | Owner and candidate route | Owned files or system | Risk | Target evidence and validation | Now / fallback |
| --- | --- | --- | --- | --- | --- | --- |
| `G0-01` / none | Re-anchor live repo, remote identity, authority packet, current plans, route ledger, and Orca state. | `LUNA`; `PLAN` only for material drift; `DG` may normalize public repo evidence after a fresh Free gate. | Read-only repo/Git/Orca/provider metadata | S0; authority contains S4 boundaries | Branch/HEAD/tree/status, stable repo ID, remote/base/source OIDs, PR/rules/check inventory, packet validation, route receipts. | Ready locally; external reads blocked until authorized. Docs/read chain. |
| `G0-02` / `G0-01` | Create a fresh Orca Run and the full dependency graph before dispatch. | `LUNA` | Orca Run/Tasks only | S0 | Run ID; every task has deps, read/write/exclude, risk, authority, evidence, stop, and cleanup fields. | Not started; `LUNA` direct. |
| `C0-01` / `G0-01` | Verify canonical GitHub namespace, PR #69, branch protection, secret-name presence, and Vercel auto-deploy suppression. | `LUNA`; `DG` read-only challenger if eligible. | GitHub/Vercel read-only | S0 | Stable repository ID, ref OIDs, PR state, required checks, masked names, and deploy-control receipt. | External blocked. Docs/read chain. |
| `C1-01` / `G0-01` | Create an append-only E9 successor with named owners, expiry, target, rollback, allowed actions, and derived-candidate rule. | `LUNA`; `DG` may review a redacted draft. | E9 successor doc only | S1, protected receipt | Valid packet; predecessor is named; no self-hash cycle; no secret values; release stays closed. | Not started; docs/review chain. |
| `C1-02` / `C1-01` | Make the smallest pre-freeze corrections: hosted `test:functions`, exact PR-head provenance, current supply-gate coverage, pinned Supabase CLI, and a reviewed target-bound no-egress or sanitized staging replay path. | `LUNA` sole writer; `DS`/`DG`/`AGY` read-only challenge only. | `.github/workflows/ci.yml`, package/lock if required, runtime/supply checkers/tests, staging/deploy wrapper and direct docs | S3-S4 shared/protected | Normal and mutation checks; CLI pin proof; migration replay cannot contact production; no broad `db push`; no unrelated dependency or workflow churn. | Not started; `LUNA` direct. |
| `C2-01` / `G0-01` | Close AIR-036 with the minimum characterized hotspot extraction or an explicit architecture-owner closure disposition. | `LUNA` integrator; `DS` code/tests and `DG` characterization/review concurrently on disjoint S0-S2 files; `AGY` only for a frontend hotspot. | Exact narrow modules/tests named at dispatch; exclude migrations, shared generated files, CI, package/lock, ledger | S2 | Characterization parity, narrow ownership, focused and full tests, owner decision. No broad refactor. | Partial local. Code/test chain. |
| `C3-01` / `C0-01,C1-02,C2-01` | Freeze one clean candidate and run the complete local R5 gate. No edit follows success. | `LUNA` | Whole repo validation, no writes except generated evidence already authorized | S2 | Clean SHA/tree, `git diff --check`, 129-check classification, strict/lint/tests/build/migrations/runtime/supply/AIR gates; masked build inventory. | Not started; `LUNA` accepts. |
| `P25-01` / `C3-01` | Commit the exact manifest-scoped candidate and create one normal successor branch/draft PR without changing #69. | `LUNA` | Git index, one authorized branch and draft PR | S2 | Staged-path manifest, commit/tree, clean status, remote ref, PR URL, head/base OIDs, draft/no-auto-merge. | Blocked on Git authority; no external fallback. |
| `P25-02` / `P25-01` | Pass all required non-deploy hosted CI and existing supply-chain checks on the exact PR-head SHA. | `LUNA`; `DG` may normalize redacted job artifacts; independent family review for disputed S2 findings. | GitHub Actions/checks/artifacts | S2 | Run IDs/URLs, checked-out SHA, all blocking job conclusions, root/renderer/Deno/function tests, build, SBOM/license/image/import/action evidence, AIR-052/AIR-055 inputs. | External blocked. Review chain. |
| `P25-03` / `P25-02` | Freeze the green branch without adding a post-CI evidence commit. | `LUNA` | Detached receipt/check artifact | S0 | Exact states: local validated, committed, pushed, hosted green; merged=false; deployed=false. | Not started; `LUNA` direct. |
| `P3-01` / `P25-03` | Provision and identify one isolated Supabase staging project. | `LUNA` + Supabase owner | Supabase project/billing/link | S3-S4 | Project/org/region/ref/URL/cost receipt; production denylist; empty target; rollback operator. | Blocked on staging authority. |
| `P3-02` / `P3-01` | Apply the approved exact candidate migration boundary with zero production exposure. | `LUNA` + database owner, serial | Staging database/migrations/generated-type comparison | S4 | Target-bound replay; zero production refs; schedules inactive; migration inventory; schema/RPC/policy/grant/type parity; SR-MIG-01 evidence. | Not started; protected direct. |
| `P3-03` / `P3-02` | Configure staging Auth roles/users, Storage, Realtime, Vault/secret names, RLS/grants, one runtime-control row, sanitized fixtures, and disabled cron. | `LUNA` + Supabase/Auth owners, serial | Staging Auth/RLS/secrets/data/config/cron | S4 | Admin/read_only role matrix; secret names only; staging identities; fail-closed controls; posting blocked; all cron inactive; no production data. | Not started; protected direct. |
| `P3-04` / `P3-03` | Accept the staging foundation and close its AIR/SR evidence, including AIR-017 performance evidence. | `LUNA`; redacted read-only `DG` review only if eligible | Staging catalog, plans, metrics, receipts; one Luna ledger write | S2-S3 | Representative plans/metrics, owner decision, backup/restore evidence required for staging, target queries, exact AIR JSON joins. Claim is foundation accepted, not functions deployed. | AIR-017 owner-blocked. Review chain. |
| `P4-01` / `P3-04` | Build and scan the exact-SHA renderer image and capture host capacity/prior-image state. | `LUNA`; `DS` tests and `DG` review may run concurrently if disjoint. | Renderer source/tests/image; registry read/build | S2-S3 | Exact SHA, immutable digest, current scan contract, host capacity, prior digest, rollback path. | Partial local; code/test chain for any repair. |
| `P4-02` / `P4-01` | Deploy `xot-staging-1` with staging-only config, one replica, concurrency one, polling disabled. | `LUNA` + renderer/secret owners, serial | Renderer host/registry/secret store | S3-S4 | Deployment metadata, staging endpoint/ref, dedicated workdir, observability tag, no production identity, polling off. | Blocked on host/access. |
| `P4-03` / `P4-02` | Pass one bounded render, resource/heartbeat checks, and graceful drain; return to polling disabled. | `LUNA`; `CU` only if UI is needed | Renderer, staging Storage, metrics/logs | S2-S3 | Request/render IDs, staging object, CPU/memory/PID/temp/p95, no extra claims, SIGTERM drain within grace, rollback proof. | Not started. `LUNA` direct. |
| `P5-01` / `P3-04,P4-03` | Recheck exact identity and start the protected staging deploy wave. | `LUNA`, single conductor | GitHub environment, Supabase, renderer, Vercel | S3-S4 | Approval, exact SHA, prior versions, rollback operators, staging-only secret-name inventory. | Blocked on deploy authority. |
| `P5-02` / `P5-01` | Deploy all ten functions serially, with schedules and posting off, then stamp the SHA. | `LUNA`, serial | Supabase functions/config | S3-S4 | Ten version IDs; all succeeded; `DEPLOY_GIT_SHA`; prior versions; no production target. | Not started; protected direct. |
| `P5-03` / `P5-02` | Confirm/start the accepted renderer digest with polling disabled. | `LUNA`, serial | Renderer host | S3 | Exact digest/SHA health, polling off, prior version retained. | Not started; protected direct. |
| `P5-04` / `P5-03` | Deploy protected Vercel Preview from the same SHA with branch-scoped staging values. | `LUNA`, serial | Vercel Preview/deployment protection/alias | S3-S4 | Deployment ID/SHA, immutable URL, protected URL, masked input names, no Production variable/alias change. | Not started; protected direct. |
| `P5-05` / `P5-04` | Prove one cross-plane SHA, staging-only network/config, current AIR-052 scans, AIR-055 provenance, and enable only an approved fixture-safe schedule allowlist. | `LUNA`; `DG` evidence review if redacted and eligible | CI/functions/renderer/Vercel/config; one ledger writer | S2-S4 | Same SHA everywhere; target inventory; owner decisions; zero production identities; posting/cleanup schedules off. Phase claim: deployed, not accepted. | AIR-052/055 blocked. Review chain. |
| `P6-01` / `P5-05` | Authenticate both roles and capture target identity, auth states, and all app routes at desktop and mobile. | `CU` actions; `LUNA` evidence owner; `AGY` may review redacted visual artifacts. | Native/PiP browser only; routes `/auth`, `/`, `/monitoring`, `/video-renders`, `/threads`, `/x-account`, `/downloader`, `/settings`, and not-found | S1 | Stable and immutable URL identity; admin/read_only; signed-out/degraded/denied states; 1440x900 and true 390x844; keyboard/focus/overflow/console/network evidence. | AIR-053 external-blocked. Visual chain. |
| `P6-02` / `P6-01` | Prove read parity, server-side mutation denial, bounded admin controls, zero posting writes, failure correlation, and queue preservation. | `LUNA`; `CU` browser actions, serial for shared toggles | Preview functions/database/renderer/provider ledgers/browser | S2-S4 | Full authoritative action inventory; read_only `403` plus before/after zero mutation; dedupe and translation off/on one fixture/off; exact request counts; posting paths stop before provider. | Partial/external blocked; protected direct plus CU. |
| `P6-03` / `P6-02` | Close AIR-037, AIR-049, and the dashboard hierarchy review; obtain AIR-050 `ACCEPT` or bounded rework list. | `CU` actions; `AGY` first visual reviewer; `LUNA` final acceptor; named UX owner | Browser and redacted captures; narrow frontend files only if rework is required | S1-S2 | Desktop/mobile first-viewport task script, diagnostics open/close, responsive/paint/keyboard/accessibility evidence, explicit owner decision. | AIR-050 owner-blocked. Visual chain. |
| `P6-04` / `P6-03` | Pass the Preview rollback drill and close AIR-053. | `LUNA`, serial; `CU` for visible browser steps | Preview alias, controls, cron, renderer, function/Vercel prior versions | S3 | Alias protected/removed, controls/schedules off, renderer drained, prior versions restored, forward-only DB recovery, post-rollback smoke. | Not started; protected direct. |
| `P7-01` / `P6-04` | Reconcile all Preview receipts to the 80-row AIR JSON and prepare the exact production proposal. | `LUNA` sole official writer; `DG` may draft a redacted evidence index. | AIR/receipt docs and append-only ledger | S3 shared ledger | Every row joined by `airId`, `latestLedgerRow`, `remainingAcceptanceEvidence`, owner, dependency, and target receipt; limitations explicit; release still closed. | Not started; docs/review chain, Luna writes. |
| `T3-01` / `P7-01` plus separate production authority | Capture one timestamped read-only production snapshot across frontend, functions, renderer, DB, cron, queue, providers, backup/PITR, and PAT state. | `LUNA`; `CU` for production browser smoke | Production read-only surfaces | S2-S3 | Current target IDs/versions, schema/migrations/types/RLS/grants/roles, jobs 17/19 inactive, queues, provider ledgers, restore evidence, PAT disposition. | Blocked on production authority; protected direct. |
| `T3-02` / `T3-01` | Close SR-REL-00, SR-MIG-01, SR-RLS-01, PAT-1, AIR-010 production equivalence, AIR-017/052/055, and approve or reject the exact release proposal. | `LUNA` + named DB/security/release owners; `PLAN` if proposal scope changes materially | Owner decisions and production proposal | S3-S4 | Signed current dispositions, backup/restore proof, forward-only migration set, role/grant matrix, exactly-once/order evidence, scans/provenance, rollback readiness. | Owner/external blocked; no external writer. |
| `PROD-01` / `T3-02` | Merge the reviewed exact commit to clean `main` only if every gate passes. | `LUNA` + release owner | GitHub PR/main | S3 | Required approvals/checks, exact merge result, clean main, release decision. No force push. | Not authorized yet. |
| `PROD-02` / `PROD-01` | Apply only approved forward migrations and production data/RLS/Auth/secret/config changes. | `LUNA` + DB/Auth owners, serial | Production Supabase | S4 | Approved set only, backup/rollback ready, target receipts, no broad `db push`, no unlisted data mutation. | Not authorized. |
| `PROD-03` / `PROD-02` | Deploy the approved function set. | `LUNA`, serial | Production functions | S4 | Version IDs, SHA stamp, config checks, prior versions. | Not authorized. |
| `PROD-04` / `PROD-03` | Deploy the approved renderer image/config. | `LUNA`, serial | Production renderer | S4 | Digest/SHA, health, capacity, prior digest, rollback. | Not authorized. |
| `PROD-05` / `PROD-04` | Deploy the approved frontend. | `LUNA`, serial | Production Vercel | S4 | Deployment ID/SHA, environment/alias, target identity, rollback. | Not authorized. |
| `T4-01` / `PROD-05` | Run each exact production canary serially within the approved fixture/request envelope. | `LUNA`; `CU` for browser actions | Production app/functions/renderer/providers | S3-S4 | Named fixtures, expected row transitions, max claims, exact provider counts, no out-of-manifest action, abort/rollback results. | Not authorized. |
| `T4-02` / `T4-01` | Run authenticated production smoke and the declared observation window; accept or rollback. | `LUNA`; `CU` actions | Production browser, metrics, logs, queues | S2-S4 | Admin/read_only smoke, metrics, errors, queues, provider counts, observation end, explicit release decision. | Not started. |
| `CLN-01` / `T4-02` | Run reference-aware cleanup dry run and shadow comparison with all mutations/schedules off. | `LUNA` + DB operations owner, serial | Production DB/Storage cleanup reads | S3 | Exact candidate object set, duplicates, age/reference exclusions, active-work protection, row/storage agreement. | AIR-065 owner-blocked. |
| `CLN-02` / `CLN-01` | Run one authorized bounded claimed cleanup invocation, then turn mutation off. | `LUNA`, serial | Production DB/Storage cleanup | S4 destructive | Approved set only; runtime bounds; `failedCount=0`; counts agree; fresh/active objects intact; lease and abort evidence. | Not authorized. |
| `CLN-03` / `CLN-02` | Observe, obtain AIR-065 decision, and enable exactly one canonical schedule. | `LUNA` + DB operations owner, serial | Production cron/runtime controls | S4 | Observation passed; owner decision; one schedule active; job 17 and all alternatives inactive unless separately approved. | Owner-blocked. |
| `FINAL-01` / `CLN-03` | Perform full closure audit, settle workers/resources, update exact states, and leave a clean worktree. | `LUNA`; independent read-only review may use `DG`/`AGY` if redacted | Repo, AIR/ledger, Orca/resources, external target inventory | S3 | 80 final AIR dispositions; no unresolved task; clean Git; remote/PR/main/deploy/live receipts; zero unintended residue; user resources preserved. | Not started; docs/review chain, Luna accepts. |

### Retry and rework rules

- A deterministic test, lint, build, audit, or scan failure gets no blind retry. Diagnose, make a bounded repair, rerun the focused checks and full affected gate, create a new SHA, and rerun hosted evidence.
- A proven runner, registry, network 5xx, or cancellation may get one same-SHA infrastructure retry.
- A flaky test gets one diagnostic rerun. A lone later green is not enough: fix the cause or require two consecutive complete green runs on the same SHA.
- A new commit makes all earlier exact-SHA hosted, deploy, browser, and live evidence stale downstream of that commit.
- A Preview defect creates a narrow repair task. It returns only the affected nodes to local validation, exact-SHA hosted CI, deploy, and acceptance. Do not rerun unrelated accepted evidence unless its dependency changed.
- Unknown provider or production outcome triggers containment and inspection. Never retry a possibly completed mutation.

## 8. AIR execution map

Do not turn the 58 partial rows into 58 guessed implementation tickets. For every row, the executor must load the existing object from `docs/plans/2026-08-21-xot-air-latest-state-and-estimate.json` and use its exact:

`airId`, `currentImplementationState`, `currentSourceAndReceiptPaths`, `latestLedgerRow`, `remainingAcceptanceEvidence`, `owner`, `authorization`, `externalDependency`, `estimateUnits`, `criticalPath`, and `parallelLane`.

The existing JSON is the row-level task specification. The wave below is the execution grouping:

| Group | Exact AIR IDs | Execution nodes |
| --- | --- | --- |
| Accepted local | AIR-001, 003, 005, 007, 008, 009, 010, 018, 019, 020, 032, 054, 064, 066, 067 | Preserve local proof; promote only through the higher-tier nodes named in each row. AIR-010 stays disabled. |
| Browser/operator partial | AIR-037, 049 | `P6-01` through `P6-03` |
| Database/runtime partial | AIR-002, 063, 070, 072, 074 | `P3-02` through `P3-04`, then `T3`, `T4`, and cleanup as named by each row |
| Product/refactor partial | AIR-036 | `C2-01`, then hosted/staging/browser evidence only where its JSON requires it |
| Source/release-evidence partial | AIR-004, 006, 011-016, 021-031, 033-035, 038-048, 056-062, 068-069, 071, 073, 075-080 | `P25`, `P3`, `P4`, `P5`, `P6`, `T3`, and `T4` according to each row's exact remaining evidence; do not re-implement accepted source without a reproduced defect |
| Owner blockers | AIR-017, 050, 055, 065 | `P3-04`, `P6-03`, `P5-05/T3-02`, and `CLN-03` respectively |
| External blockers | AIR-052, 053 | `P25-02/P5-05` and `P6-01` through `P6-04` respectively |
| Disproved | AIR-051 | Keep its regression contract green; no feature work |

The exact partial grouping accounts for all 58 rows: 2 browser/operator, 5 database/runtime, 1 product/refactor, and 50 source/release-evidence.

Critical-path rows from R6 remain:

`AIR-001, AIR-003, AIR-005, AIR-007, AIR-009, AIR-010, AIR-017, AIR-050, AIR-052, AIR-053, AIR-055, AIR-065`.

## 9. Phase gates, stop conditions, and rollback

### Phase entry and exit gates

| Phase | Entry | Exit claim |
| --- | --- | --- |
| G0/Candidate | Clean planning anchor and packet available | New exact clean candidate; minimal corrections only; local gate green |
| P2.5 | Git authority, remote state known, Vercel auto-deploy suppressed | Committed, normally pushed, draft successor PR, exact-SHA hosted CI green; not merged or deployed |
| P3 | P2.5 green and staging authority | Isolated Supabase foundation accepted; functions not yet deployed |
| P4 | P3 accepted and renderer authority | Exact renderer digest accepted; bounded render/drain pass; polling disabled |
| P5 | P3/P4 accepted and protected deploy authority | Functions, renderer, and protected Preview deployed on one SHA; not browser accepted |
| P6 | P5 target identity and rollback ready | Authenticated role/capability/visual/rollback evidence accepted; AIR-050 accepted |
| P7 | P6 accepted | AIR/evidence closeout and exact production proposal; production still closed |
| T3 | Separate production read authority | One current read-only production snapshot and all owner gates decided |
| Production/T4 | Exact proposal and mutation/canary authority | Approved deploy order complete; bounded canaries and soak accepted or rollback complete |
| Cleanup | T4 and observation accepted | One canary accepted; AIR-065 accepted; exactly one schedule active |
| Final | All prior exits accepted | Section 3 done definition passes |

### Global stop conditions

Stop the affected mutation immediately on:

- repo, branch, target, authority, exact SHA, receipt, or provider identity drift;
- an unexpected dirty path or overlapping worker write;
- production identity, data, endpoint, or key in staging/Preview;
- migration, generated type, RLS, role, Auth, or grant mismatch;
- an active unapproved schedule, read_only mutation, secret disclosure, provider request outside the envelope, unbounded queue drain, or out-of-manifest ID;
- a partial deploy with unknown current versions;
- missing prior version, unavailable rollback operator, failed rollback, or unknown provider result;
- cleanup set/count mismatch, deletion outside the approved set, or active/fresh reference loss.

No force push. No direct `main` push. No production before all named gates. No broad `supabase db push`. No historical migration rewrite. No project reset or staging deletion as normal rollback. No destructive cleanup before dry run, explicit canary authority, and target agreement.

### Rollback order

1. Protect or remove the Preview/production alias affected by the failed wave.
2. Set runtime controls off and disable schedules.
3. Stop the renderer with graceful drain and preserve workdir/logs.
4. Restore the recorded prior function, renderer, and frontend versions.
5. Repair database state forward with the reviewed target-bound command.
6. Rotate only affected staging credentials if exposure is possible.
7. Keep cleanup mutation and schedules off after any mismatch; preserve lease/evidence and wait for safe expiry before a separately approved retry.

## 10. Estimate and critical path

Use the committed R6 estimate. Do not replace it with a worker guess.

| Horizon | Optimistic | Likely | Conservative |
| --- | ---: | ---: | ---: |
| Through P7 production proposal | 75.75 h | 136.8 h | 270 h |
| Later T3, T4, and cleanup | 39.5 h | 79 h | 158 h |
| Full closure | **115.25 h** | **215.8 h** | **428 h** |

Planning allocation, preserving the exact totals:

| Wave | Optimistic | Likely | Conservative |
| --- | ---: | ---: | ---: |
| E9, pre-freeze work, P2.5 | 6 h | 10 h | 20 h |
| P3 Supabase staging | 16 h | 30 h | 60 h |
| P4 renderer | 8 h | 14 h | 30 h |
| P5 protected deploy | 10 h | 18 h | 42 h |
| P6 authenticated acceptance | 27 h | 50 h | 90 h |
| P7 closeout/proposal | 8.75 h | 14.8 h | 28 h |
| T3 read-only production | 15 h | 30 h | 60 h |
| T4 production release/canary | 15 h | 30 h | 60 h |
| Cleanup-last | 9.5 h | 19 h | 38 h |

The realistic likely elapsed range remains **30-50 business days**. Access, owner response, hosted queues, rollout observation, and cleanup soak dominate calendar time. Concurrency reduces active elapsed time; it does not reduce the evidence matrix or required observation windows.

Critical path:

`packet/E9 -> minimal pre-freeze corrections -> exact candidate -> P2.5 -> P3 -> P4 -> P5 -> P6 -> AIR-050 -> P7 -> production authorization -> T3 -> merge/deploy -> T4 -> observation -> cleanup canary -> AIR-065 -> one schedule -> final audit`

## 11. Persistent goal loop and resumability

Use `implementation-orchestrator` as the execution framework and `quality-orchestration` for every non-trivial eligible S0-S2 slice. Luna is the sole implementation phase owner.

At goal start:

1. Load this plan, the authorization packet, current `AGENTS.md` instructions, the implementation-orchestrator skill, the current quality-orchestration skill and adapters, and the version-matched Orca orchestration guide.
2. Re-anchor the repo and external targets. If the branch, target, authority, or source of truth changed materially, run a bounded Sol Max replan before implementation.
3. Create one Orca Run. Create all DAG Tasks and dependency gates before dispatch. Start all ready independent tasks before waiting.
4. Apply fresh route discovery and canaries. Freeze exact file/system ownership and exclusions in each prompt.

Loop algorithm:

1. Read the latest checkpoint and reconcile Git, Orca Tasks/Dispatches, provider processes, and external target state.
2. Compute dependency-ready tasks.
3. Dispatch at most two disjoint external candidate writers and one reviewer. Keep Luna as the only integrator.
4. Collect actual diffs and target evidence. Mark worker output `ACCEPTED`, `REWORK`, `REJECTED`, or `BLOCKED`.
5. Luna integrates one accepted slice at a time, runs focused validation, then runs the phase gate.
6. Settle the predecessor before any fallback. Release or retain the exact task-owned worker through the current Orca lifecycle. Do not touch user-owned resources.
7. Append a compact checkpoint. Update AIR state only from accepted target evidence.
8. Continue the next ready task without waiting for the user unless authority, MFA, billing, owner judgment, or destructive scope is missing.

Checkpoint after every accepted task and phase:

- goal/plan version; repo/branch/HEAD/tree/status;
- authority packet version and expiry;
- Orca Run/Task/Dispatch/terminal IDs and dependency states;
- exact route gate, requested/effective model and effort, Free/cost tier, fallback settlement, and Luna decision;
- accepted/rejected candidate paths and validation output;
- external target IDs and current state, redacted;
- rollback state and active resources;
- AIR rows changed, evidence tier, and target receipt;
- blocker signature/count and the exact next ready task.

On resume:

- Do not replay a successful mutation blindly.
- Reconcile the last checkpoint with live target and Orca state.
- Continue waiting for a known active task. If a predecessor is unknown, fence or explicitly abandon it before replacement.
- A changed candidate invalidates only downstream exact-SHA evidence. Preserve unrelated accepted work.
- A changed authorization or target that alters scope requires Sol Max replan. A simple credential refresh does not.

Task blocking may be immediate. Goal blocking is stricter: mark the persistent goal `blocked` only when the same blocker signature occurs for three consecutive goal turns, no meaningful independent safe work remains, and the exact required user or external state change is known. Progress or a different blocker resets the count. A resumed blocked goal starts a fresh three-turn audit.

The goal is never complete because budget is low, a worker said `DONE`, P7 produced a proposal, a deploy returned `READY`, or one URL returned `200`.

## 12. Goal text ready to create

Use this objective only after the authorization packet in section 5 is complete:

> Execute `/Users/stevmq/Finalized XOT/docs/plans/2026-08-22-xot-full-closure-quality-orchestrated-goal-plan.md` end to end in `/Users/stevmq/Finalized XOT`. Use `implementation-orchestrator` with GPT-5.6 Luna High as implementation, integration, validation, and final-acceptance owner. Use `quality-orchestration` for every eligible non-trivial S0-S2 slice: fresh-check exact Free Devin `swe-1-7` Max and `glm-5-2` High independently, use both concurrently on disjoint work, use Antigravity `gemini-3.7-flash-high` High first for visual/frontend/multimodal work, and use the declared Command Code route only after predecessor settlement. Use Sol Low Fast Computer Use for all native/PiP browser actions and Sol Max for any substantive replan. Validate the one-time authorization packet before mutation. Create a durable Orca Run and the full dependency DAG, checkpoint after every accepted task and phase, resume from live state, and continue all ready authorized work without waiting. Keep migrations, Auth, RLS, secrets, data, billing, CI/lockfile/shared contracts, ledgers, deploy sequencing, production canaries, and destructive cleanup serial under Luna. Never send secrets or production data to external delegates. Never force push, touch PR #69, deploy production before every gate, run a broad database push, or run cleanup before its dry run, canary authority, and observation gate. Treat worker output as a candidate until Luna inspects and validates it. Claim completion only when all 80 AIR rows have current final target evidence, hosted/staging/browser/deploy/live/production/cleanup states are proved separately, all resources are settled, and the worktree is clean. If access or authority is missing, finish all independent safe work, record the exact blocker, and use the three-consecutive-turn blocked rule from the plan.

Do not set a token budget unless the user explicitly requests one.

## 13. Exact implementation handoff

The first execution slice is:

1. Luna High rechecks the live branch, HEAD, tree, status, remote identity, PR state, current CI, staging replay risk, and authorization packet.
2. Luna loads current quality routes and adapters, runs fresh non-mutating canaries, and creates the Orca Run/DAG.
3. Luna creates the lightweight E9 successor. It names authority and targets without adding a self-referential or manual hash chain.
4. Luna makes only the protected pre-freeze corrections in `C1-02` and the bounded AIR-036 closure in `C2-01`. Eligible disjoint S0-S2 candidate work goes first to `DS` and `DG`; protected shared files stay Luna-only.
5. Luna runs `C3-01`, freezes the new candidate, and proceeds to P2.5 only if the full local gate is green and Vercel auto-deploy is suppressed.

The implementation owner must report these states separately at every handoff:

`validated locally -> committed -> pushed -> hosted CI green -> staging accepted -> deployed Preview -> authenticated Preview accepted -> production proposal approved -> production deployed -> production verified live -> cleanup accepted -> fully closed`.

No later label may be inferred from an earlier one.

## 14. Planning quality receipt

Planning Effort Gate result: **Max**.

Max triggers:

- production release plus Auth/RLS/data/deploy/cleanup S4 risk;
- more than three dependent product and infrastructure surfaces;
- a handoff that must remain reliable across a long unattended goal.

Rejected as Max triggers: task length and worker count by themselves.

Full planning orchestration used four distinct, read-only lanes. The planning owner inspected and reconciled their evidence; workers did not author this plan file.

| Planning agent | Model / effort | Scope | Decision |
| --- | --- | --- | --- |
| Main planning owner | GPT-5.6 Sol / Max | Anchor, tradeoffs, synthesis, acceptance criteria, final plan artifact | Accepted |
| `e9_p25_git_ci` | GPT-5.6 Sol / Max | E9 authority, Git/PR, P2.5, hosted CI | Accepted and narrowed to existing gates |
| `staging_renderer_preview` | GPT-5.6 Sol / Max | Supabase staging, renderer, protected Preview | Accepted; staging replay and CLI pin added as real pre-entry blockers |
| `browser_prod_cleanup` | GPT-5.6 Sol / Max | Authenticated acceptance, AIR-050, T3/T4, cleanup-last | Accepted; route corrected to `/x-account` from current source |
| `routing_goal_dag` | GPT-5.6 Sol / Max | Provider routing, concurrency, fallback receipts, goal loop | Accepted and aligned to current quality contract |

Fast status was not applicable to planning. No implementation agent, external provider, Computer Use action, hosted service, browser, cloud target, push, deploy, or production system was used in this planning phase. Strict planning route passed.

Plan quality rubric:

| Point | Result |
| --- | --- |
| Current source-of-truth anchor and honest unknowns | Pass |
| Complete dependency/task/AIR inventory through cleanup-last | Pass |
| Exact owner, model, route, risk, ownership, fallback, and evidence mapping | Pass |
| Unattended authority, stop, rollback, blocked, and resumability semantics | Pass |
| Goal-ready handoff with committed R6 estimate and target-based done definition | Pass |

**Plan quality: 5/5.**
