# XOT E10 Preview parity implementation plan

**Date:** 2026-08-12
**Status:** E10 Phase 1 accepted locally; E10 Phase 2 accepted as `ACCEPTED_PREVIEW_PREPARATION_T1`; E10 Phase 3 requires explicit external provisioning authority; release `CLOSED`
**Route:** Planning by GPT-5.6 Sol, Max reasoning
**Target:** One stable, protected Preview environment with the same product capabilities and APIs as production, but with an isolated data and control plane

## 1. Outcome

Build one full XOT Preview environment that has:

- The Vite dashboard on Vercel Preview.
- A persistent, isolated Supabase staging project.
- The complete database schema, RLS, RPC, Auth, Storage, Realtime, cron, and all ten Edge Functions.
- A persistent staging video renderer.
- The same provider integration code as production.
- OpenAI dedupe and translation keys present, with both features paused by default and controlled from the dashboard.
- A hard Preview posting block that no dashboard, database, retry, force, or cron action can disable.
- Exactly two roles: `admin` and `read_only`. Each user has exactly one role.

Preview must never read from, write to, or control production. Capability parity does not mean shared data, shared queues, shared destinations, or shared mutable credentials.

## 2. Confirmed owner decisions

These decisions are binding for E10:

1. Ordered thread delivery remains disabled. Record this as the resolution of AIR-010.
2. AIR-050 remains deferred. The owner will decide after the full Preview is available for review.
3. Preview must include every production product capability and API.
4. Preview uses an isolated Supabase data and control plane and an isolated renderer.
5. External posting is blocked in Preview. It is not a dashboard toggle.
6. OpenAI dedupe is off by default. An `admin` can turn it on or off in the dashboard.
7. OpenAI translation is off by default. An `admin` can turn it on or off in the dashboard.
8. Required OpenAI keys are present in staging secret stores. They are never exposed to the browser.
9. The only roles are `admin` and `read_only`.
10. Each user has one role. The owner assigns roles. There is no self-registration, self-promotion, or multi-role user.
11. A `read_only` user can view all normal dashboard data and status surfaces. A `read_only` user cannot mutate data, settings, jobs, users, or provider state. Secret values remain hidden from all dashboard users.

Legacy references to `viewer`, `operator`, or other specialist roles are rejected. Replace them with `read_only` or remove them.

### 2.1 Operating model and current resume point

The owner has removed the requirement for a second complete, persistent local environment. This section is the current sequencing authority when older E9, E10, or E11 wording conflicts with it.

- **Local lane:** disposable code editing plus lint, type, test, build, and migration validation. Short-lived fixtures or processes may be used only for a bounded validation and must be torn down. Local does not need a persistent Supabase project, renderer, full-stack URL, data plane, or parity environment.
- **Preview lane:** one protected, persistent, full Preview plane made from Vercel Preview, isolated Supabase staging, and an isolated staging renderer. This is the only pre-production full-stack acceptance environment.
- **Production lane:** no production change until the protected Preview plane passes authenticated acceptance and the owner makes the deferred AIR-050 decision.
- **Preview controls:** external posting stays hard-disabled. Dedupe and translation start paused and are toggleable only by `admin`. The only roles are `admin` and `read_only`.

| Order | Phase | Current state | Authority and evidence boundary |
| --- | --- | --- | --- |
| 1 | Phase 1 — local control and role contracts | `ACCEPTED_LOCAL_PHASE1` | Receipt `docs/plans/2026-08-12-xot-e10-phase1-local-acceptance.json`; local evidence only, not hosted CI, staging, Preview, browser, deploy, live, or production proof. |
| 2 | Phase 2 — Preview safety preparation | `ACCEPTED_PREVIEW_PREPARATION_T1` | Repository/source/config/runbook preparation plus deterministic local checks and build only; no persistent local full stack, hosted, staging, browser, deploy, live, or production proof. Receipt `docs/plans/2026-08-13-xot-e10-phase2-preview-safety-acceptance.json`. |
| 3 | Phase 3 — isolated Supabase staging | Not started | Requires explicit Supabase provisioning and staging mutation authority. |
| 4 | Phase 4 — isolated staging renderer | Not started | Requires explicit renderer-host authority and accepted Phase 3 identity. |
| 5 | Phase 5 — protected Vercel Preview and hosted CI | Not started | Requires exact Git/push, hosted CI, and Vercel Preview authority. |
| 6 | Phase 6 — authenticated full-stack acceptance | Not started | Requires the protected full Preview plane, `admin` and `read_only` credentials, and the required Computer Use route. Ends with the owner AIR-050 decision. |
| 7 | Phase 7 — closeout and production handoff | Not started | Produces a production-change proposal only. Production remains separately gated and `CLOSED`. |

Phase 2 preparation is accepted at its local T1 boundary. The next phase is isolated Supabase staging and requires explicit external provisioning authority. This plan does not authorize commit, push, cloud provisioning, secret work, deployment, hosted CI, browser use, provider contact, or production action.

## 3. Current-state evidence and gaps

The evidence snapshot is for planning. Recheck all live identifiers before execution.

| Surface | Current evidence | Gap |
| --- | --- | --- |
| Local candidate | Branch `codex/xot-remediation-convergence`, local SHA `0bd578856016c06a10890339f93aa13b82ecae48` | Local tree is dirty and 51 commits ahead of the deployed Preview SHA. Re-anchor before any slice. |
| Vercel Preview | Deployment `dpl_5SgezDdEJAU4Gyi6kMK99Bcs2aS6`, SHA `7e4b004964167b6856ecf980337049f90e125205`, READY | It is not the local candidate. |
| Vercel Production | Deployment `dpl_CLrAaSCRhZKL7ENgCi91A1qD51K3`, SHA `53b35436dbb42697a004b6002312a86212a48abb` | Production is outside E10 execution scope. |
| Vercel build | `vercel.json` builds the Vite app and serves `dist` | It deploys no backend APIs. |
| Renderer | `.vercelignore` excludes renderer source; the renderer is a separate Node service | Preview has no renderer deployment. |
| Supabase | `supabase/config.toml` pins production ref `jzirqfzzvlbxwfzndaer` | There is no XOT staging project or Supabase branch. |
| Function deploy | `scripts/deploy-functions.sh` defaults to the production ref | A missing argument can target production. This must fail closed. |
| Vercel runbook | `docs/operations/vercel-cutover.md` directs Preview and Production to the production ref | Replace this unsafe topology before full Preview acceptance. |
| Functions | Production has ten active functions | Vercel Preview does not deploy candidate functions or prove exact-SHA alignment. |
| Migrations | Production reports 106 remote migrations; the checkout has 123 migration files | Staging schema equivalence does not exist yet. Resolve migration gates before provisioning. |
| CI | `.github/workflows/ci.yml` checks and builds the frontend | It does not deploy staging database, functions, renderer, or authenticated Preview acceptance. |
| Dedupe control | Phase 1 accepted the local server-authoritative pause contract | Hosted staging behavior and request counts remain unverified. |
| Translation control | Phase 1 accepted the local server-authoritative pause contract | Hosted staging behavior and request counts remain unverified. |
| Roles | Phase 1 accepted the local canonical `admin | read_only` contract | Staging Auth, RLS, API, and UI role-matrix evidence remains unverified. |

Primary evidence:

- `vercel.json`
- `.vercelignore`
- `.vercel/project.json`
- `.env.example`
- `src/integrations/supabase/client.ts`
- `scripts/check-vite-env.mjs`
- `scripts/deploy-functions.sh`
- `supabase/config.toml`
- `supabase/functions/**`
- `supabase/migrations/**`
- `services/video-renderer/**`
- `.github/workflows/ci.yml`
- `docs/operations/function-auth-matrix.md`
- `docs/operations/vercel-cutover.md`
- `docs/plans/2026-08-08-xot-post-b4-execution-sequence.md`
- `docs/plans/2026-08-12-xot-e9-owner-external-gate-packet.json`

## 4. Target topology

```text
Designated Preview branch and exact candidate SHA
                       |
                       v
                hosted staging CI
                       |
          +------------+-------------+
          |            |             |
          v            v             v
 Vercel Preview   Supabase staging   staging renderer
 dashboard        database/Auth      private service
 stable origin    Storage/Realtime   staging workdir
                  ten functions      staging token
                  staging cron       staging renderer_id
          |            |             |
          +------------+-------------+
                       |
              staging provider plane
      OpenAI/Deepgram keys with bounded budgets
     posting calls blocked before network access

Production Vercel, Supabase, renderer, queues, data,
destinations, cron, and secrets remain separate.
```

### 4.1 Environment identity

Use these environment identities:

| Item | Preview contract | Production guard |
| --- | --- | --- |
| Application environment | `XOT_ENVIRONMENT=preview` | Reject `production` during Preview deploy. |
| Supabase | New persistent project named `XOT Staging`; ref assigned during authorized provisioning | Reject ref `jzirqfzzvlbxwfzndaer`. |
| Vercel | Existing `xot` project, one designated full-preview branch, branch-specific Preview variables | Never use a Production deployment target. |
| Canonical origin | `https://preview.xot.iraneyes.com` after separate DNS authorization | Do not change `xot.iraneyes.com`. Use the protected branch alias until DNS is approved. |
| Renderer service | `xot-staging-renderer` | Reject production Supabase URL and production renderer token. |
| Renderer identity | `xot-staging-1` | Must not reuse a production renderer ID. |
| Observability | Environment tag `staging` or `preview` on every event | Never merge Preview alerts or release identity with production. |

Only the designated branch is the full Preview environment. Other automatic Vercel branch deployments are not full-parity environments and must not be described as such.

### 4.2 Secret placement

- Vercel Preview receives only public browser values: the staging Supabase URL, staging publishable or anon key, public app origin, and public observability values.
- Supabase staging Function Secrets hold OpenAI, provider, internal-token, webhook, and service credentials used by Edge Functions.
- The renderer secret store holds its staging Supabase service-role key, renderer token, OpenAI key, and Deepgram key.
- Prefer provider keys that belong to a staging project or account and have a separate budget.
- Do not copy production posting credentials. A dedicated non-production posting credential can be added later only with owner approval, but the Preview posting block still applies.
- Never place a service-role key, provider key, token, or webhook secret in a `VITE_` variable, repository file, CI log, build artifact, or browser response.

### 4.3 Origin and redirect separation

- Set Supabase Auth redirect URLs to the exact protected Preview origin and approved local development origins.
- Set Edge Function CORS to an exact allowlist. Do not use `*`.
- Do not add the production origin to the Preview write allowlist.
- Do not add the Preview origin to production Auth or CORS until a separate production change is approved.
- Prefer the stable Preview origin for Auth flows. Treat commit-specific Vercel URLs as diagnostic URLs unless their exact origin is allowlisted for a bounded test.

## 5. Server-authoritative control plane

Create one authoritative `runtime_controls` row in the staging database. The browser displays and requests changes; it does not decide whether work runs.

### 5.1 Data contract

Add a migration with these logical fields. Match repository naming and timestamp conventions during implementation.

```text
runtime_controls
  singleton_id           fixed singleton primary key
  environment            enum: preview | production
  dedupe_enabled         boolean, default false in Preview
  translation_enabled    boolean, default false in Preview
  posting_mode           enum: blocked | enabled, fixed blocked in Preview
  updated_at             timestamptz
  updated_by             auth user id, nullable for seed
```

Required invariants:

- Preview seed creates exactly one row with `environment='preview'`, both OpenAI controls false, and `posting_mode='blocked'`.
- The database rejects a Preview update that changes `posting_mode` from `blocked`.
- Client roles receive no direct update grant on this table.
- Provide a narrow RPC for an `admin` to update only `dedupe_enabled` and `translation_enabled`.
- A `read_only` call to the mutation RPC returns `403` or a database authorization error mapped to `403`.
- A missing, duplicated, malformed, or unreadable row causes workers and posting paths to fail closed.
- Record safe audit metadata for control changes. Never record keys, story text, prompts, or provider payloads.

### 5.2 Immutable posting breaker

Set `ALLOW_EXTERNAL_POSTING=false` in every staging Edge Function and worker environment. Do not expose it in the dashboard.

Add one shared server guard and call it immediately before every external write action, including:

- X post, reply, thread, retry, force-post, and scheduled post.
- Telegram send, retry, digest delivery, and force-send.
- Any current or future provider action that publishes, sends, or mutates an external account.

The guard requires both:

```text
ALLOW_EXTERNAL_POSTING == "true"
runtime_controls.posting_mode == "enabled"
```

Preview has neither condition. If either condition is absent, false, malformed, or unavailable, the guard blocks before the network call. A database edit cannot override the environment breaker. An environment edit cannot override the Preview database invariant.

Blocked scheduled calls return a stable no-op result so they do not create retry storms. Blocked manual and force calls return a clear locked response. The dashboard shows `Posting locked in Preview` and renders no posting enable control.

### 5.3 Dedupe and translation pause behavior

The worker loads `runtime_controls` before it claims jobs.

- If dedupe is disabled, exclude dedupe job types from the claim request.
- If translation is disabled, exclude translation job types from the claim request.
- Disabled work stays pending and visible. It is not marked complete, failed, cancelled, or dead-lettered.
- Disabling dedupe must not bypass dedupe and enqueue translation.
- Disabling translation must not enqueue delivery.
- Re-enabling a control lets the normal bounded worker batch process the backlog. It does not start an unbounded bulk run.
- Backfill, retry, and manual bulk paths obey the same controls.
- A deliberate one-item dashboard test can run only after an `admin` enables the relevant control.
- Turning a control off prevents new claims. An already claimed item finishes under the existing lease contract, and this behavior is stated in the UI.

OpenAI keys stay present while controls are off. Missing keys are errors, not the pause mechanism.

## 6. Canonical role contract

Use exactly this application role type:

```text
app_role = admin | read_only
```

Use one row per user:

```text
user_roles
  user_id   primary key references auth.users
  role      app_role not null
```

Rules:

- The primary key enforces one role per user.
- A user without a role row is denied.
- Only an owner-run service operation can create or change a role assignment.
- There is no role-management dashboard in E10.
- Keep `current_user_is_admin()` if existing callers use it, but make it derive from the canonical role row.
- Add or use a stable `current_user_role()` helper for API and RLS policy checks.
- `admin` can use existing dashboard mutations subject to runtime controls.
- `read_only` can select the same normal operational data that `admin` can view.
- `read_only` cannot insert, update, delete, invoke mutating RPCs, retry jobs, run backfills, change settings, change roles, or call mutating function actions.
- Edge Functions enforce the role on the server. Hiding buttons is not authorization.
- Unknown role strings and all legacy `viewer` or specialist roles fail closed.

Run a complete mutation inventory. Each dashboard mutation must have an explicit server-side `admin` gate and a `read_only` rejection test.

## 7. Capability matrix

No row can be `missing` when E10 closes. `Paused`, `blocked`, and `fixture-only` are valid only where this plan defines them.

| Capability | Preview state at first acceptance | Required proof |
| --- | --- | --- |
| Vite dashboard and routes | Live | Protected stable origin and immutable commit URL load the exact SHA. |
| Supabase database, extensions, schema, RPC, triggers | Live, isolated | Migration list and schema receipt match the candidate. Production ref is absent. |
| Auth | Live, isolated | Staging users can authenticate only against staging redirects. |
| Roles and RLS | Live | One `admin` and one `read_only` fixture pass the read/mutation matrix. |
| Storage | Live, isolated | Staging buckets and fixture objects work; no production URL appears. |
| Realtime | Live, isolated | A staging-only fixture update is observed by the Preview client. |
| `webhooks-rssapp` | API live; signed fixture traffic | Fixture succeeds with staging secret. Production RSS.app webhook is unchanged. |
| `worker` | Live with runtime filters | Safe jobs process; paused types remain pending. |
| `admin-retry` | Live | Admin safe retry works; posting retry is locked; `read_only` gets `403`. |
| `db-cleanup` | Function live; schedule initially disabled | Bounded dry run against staging only. |
| `media-processor` | Live | Staging fixture produces staging-only media state. |
| `media-cleanup` | Function live; schedule initially disabled | Bounded dry run against staging only. |
| `admin-actions` | Live | Read actions work for both roles; mutations require `admin`; provider writes remain locked. |
| `x-poster` | API live; external writes blocked | All scheduled and manual paths stop before provider network access. |
| `x-followers-snapshot` | Live with test or read-only staging credentials | A bounded read fixture succeeds without external mutation. |
| `digest-compiler` | Compile path live; external delivery blocked | Digest fixture compiles; send path is locked. |
| Dedupe | Paused by default; admin-toggleable | Zero OpenAI calls while off; one bounded fixture works while on. |
| Translation | Paused by default; admin-toggleable | Zero OpenAI calls while off; one bounded fixture works while on. |
| Telegram and X delivery | Hard blocked | No dashboard toggle; zero provider writes even after direct setting, retry, force, and cron attempts. |
| Cron and queue reconciliation | Defined; activated in stages | Schedule list, safe no-op receipts, and bounded queue behavior. |
| Video renderer | Live, isolated | Staging heartbeat and one bounded staging render use the exact SHA. |
| Renderer OpenAI and Deepgram paths | Live for bounded staging fixtures | Keys are present in renderer secret store; artifacts stay in staging. |
| Observability | Live and tagged Preview | Logs and errors show environment, deployment SHA, function version, and renderer ID without secrets. |
| Rollback controls | Ready | Cron-off, renderer-stop, control-off, and prior-SHA receipts exist before acceptance. |

## 8. Implementation phases

Each implementation owner must use GPT-5.6 Luna with high reasoning. One owner controls a file set at a time. Preserve the dirty tree and unrelated user work.

### Phase 0 — Re-anchor and amend E9

**Dependencies:** None.
**State changes:** Planning and gate artifacts only. No push, deploy, cloud change, or production mutation.
**Status:** Owner decisions are recorded in E9 v4 and this successor plan/ledger re-sequencing. External E9 gates remain open and release remains `CLOSED`.

Tasks:

1. Record the owner decisions from Section 2 in a successor E9 gate packet.
2. Mark AIR-010 resolved as keep disabled.
3. Keep AIR-050 open and state `decide after full Preview review`.
4. Add the canonical role decision: `admin | read_only`, one role per user.
5. Add the Preview control decision: dedupe false, translation false, posting hard-blocked.
6. Keep E10 authorization closed until the owner gives exact Git/push/deploy authority and all E9 external gates pass.
7. Recheck the current branch, HEAD, dirty tree, migration inventory, and generated types. Do not reuse the SHA values in this plan without a current receipt.

Exit criteria:

- Successor packet is schema-valid and binds the exact candidate SHA.
- The packet distinguishes owner design decisions from execution authorization.
- No unresolved gate is represented as passed.

### Phase 1 — Local control and role contracts

**Dependencies:** Phase 0 gate receipt and implementation authorization.
**State changes:** Local repository files only.
**Status:** `ACCEPTED_LOCAL_PHASE1` at HEAD `0bd578856016c06a10890339f93aa13b82ecae48` under the Phase 1 receipt. This is local-only acceptance and does not establish hosted CI, staging, Preview, browser, deploy, live, provider, or production evidence.

Tasks:

1. Add migrations for `runtime_controls`, its audit path, canonical `app_role`, and one-role-per-user storage.
2. Add safe Preview seed values. Do not copy production settings or data.
3. Add shared server helpers for runtime controls, canonical roles, and the external posting guard.
4. Change worker claim logic so disabled dedupe and translation jobs remain pending.
5. Gate all posting, delivery, retry, force, and scheduled paths before network access.
6. Add dashboard read/update APIs for only the two OpenAI toggles.
7. Show the posting lock as read-only status.
8. Replace legacy role names in active source, tests, schemas, and current plans that govern E10. Do not rewrite historical receipts.
9. Add unit, function, SQL, and UI tests for fail-closed behavior.

Exit criteria:

- Local tests prove both OpenAI controls and the double posting breaker.
- Every mutation endpoint has an explicit role test.
- No active source accepts `viewer` or a specialist role.
- No cloud, provider, or production state changed.

### Phase 2 — Environment and deployment guards

**Dependencies:** Phase 1 locally green.
**Status:** `ACCEPTED_PREVIEW_PREPARATION_T1`. Repository/source/config/runbook preparation and deterministic local checks/build are accepted; this is not a persistent local implementation or full local environment.

**Acceptance record:** Receipt `docs/plans/2026-08-13-xot-e10-phase2-preview-safety-acceptance.json` (SHA-256 `d73f57e217ed5d935e65169c488af8c09977e5cb60a3a95fbe1456e934c8405b`, 9,776 bytes) records the four Phase 2 task groups, the 25-file evidence inventory, focused guard tests, Deno `2.9.5` with `444 passed / 0 failed`, frontend and renderer `202`-test scopes, lint, strict typecheck, isolated build, and final adversarial `ACCEPT` with `P0=0`, `P1=0`, `P2=0`. Independent review accepted the receipt: all 25 files matched and 38/38 additional invalid mutations were rejected.

The review also discloses one rejected read-only external-command incident (`scripts/check-release-state.sh --target preview --mode execute`, with attempted `gh`, `curl`, and `npx supabase functions list` probes). No mutation occurred; it was resolved with no mutation, and later clean validation used no external commands. Therefore this receipt does not claim a phase-wide zero-contact boundary.

**Deployment boundary:** committed `false`; pushed `false`; deployed `false`; staging `false`; browser acceptance `false`; live `false`; production `false`; release `CLOSED`. Phase 3 isolated Supabase staging is `NOT_STARTED` and requires explicit external provisioning authority.

Tasks:

1. Replace the production-default behavior in deployment scripts with an explicit required target.
2. Add a Preview identity guard that checks the intended project ref, URL host, environment, branch, and deployment target.
3. Make the guard reject production ref `jzirqfzzvlbxwfzndaer`, a Production Vercel target, missing Preview identity, and mixed staging/production values.
4. Extend the Vite environment check from format-only validation to target-pair validation.
5. Update the Vercel cutover runbook so full Preview never uses the production Supabase project.
6. Add masked receipts. Never print key values.

Exit criteria:

- A staging command without an explicit project ref fails.
- A staging command with the production ref fails before any CLI deploy command runs.
- Built assets contain the staging ref and do not contain the production ref.

### Phase 3 — Persistent Supabase staging

**Dependencies:** Phases 1 and 2 accepted; migration and RLS gates green; explicit external provisioning authority.

Tasks:

1. Obtain a cost receipt and owner approval for one persistent `XOT Staging` Supabase project.
2. Provision the project in the approved organization and region.
3. Record the new project ref in masked form and add it to the production denylist checks as the only Preview target.
4. Apply the complete candidate migration sequence to an empty staging database.
5. Generate and compare types.
6. Configure Auth redirects and create owner-controlled `admin` and `read_only` staging users.
7. Create staging Storage buckets, Realtime configuration, Vault items, and internal tokens.
8. Set function secrets, including OpenAI keys, through the staging secret store.
9. Deploy all ten Edge Functions from the same candidate SHA and stamp `DEPLOY_GIT_SHA`.
10. Create cron definitions disabled. Enable only safe schedules after function acceptance.
11. Load sanitized deterministic fixtures. Do not import production rows, users, files, queues, or destinations.

Exit criteria:

- Project identity receipt proves it is not production.
- Migration list, functions, config, Auth, Storage, Realtime, secrets-present checks, and safe seed all pass.
- Runtime controls have the required Preview defaults.
- Production has no configuration, migration, secret, cron, or data change.

### Phase 4 — Persistent staging renderer

**Dependencies:** Phase 3 backend accepted; explicit renderer-host authority.

Tasks:

1. Provision one persistent service named `xot-staging-renderer` on the approved host.
2. Deploy the same candidate SHA as the functions and frontend.
3. Set only staging Supabase URL, service role, renderer token, OpenAI key, and Deepgram key.
4. Set renderer ID `xot-staging-1`, a staging-only work directory, and staging observability tags.
5. Add a startup guard that exits if the Supabase URL or project ref equals production.
6. Start with polling disabled. Run health and one bounded render fixture.
7. Enable staging polling only after artifact and storage isolation pass.

Exit criteria:

- Heartbeat is current and identifies the staging renderer and exact SHA.
- One bounded render completes against staging data and staging Storage.
- Process, workdir, tokens, and logs contain no production endpoint or secret.
- Stop and previous-image rollback commands are recorded and tested.

### Phase 5 — Vercel full Preview and CI

**Dependencies:** Phases 3 and 4 accepted; exact Git/push and Vercel authority.

Tasks:

1. Select one designated full-preview branch in the E9 successor packet.
2. Set branch-specific Preview variables to the staging Supabase project and Preview origin.
3. Keep Vercel Production variables unchanged.
4. Enable Vercel Authentication for the full Preview URL.
5. Add the stable protected alias. Add `preview.xot.iraneyes.com` only after separate DNS authorization.
6. Use a GitHub `staging` environment with approval rules and staging-only secrets.
7. Add an approved staging workflow in this order:
   1. Candidate checks and environment identity guard.
   2. Database migration and type/RLS verification.
   3. Ten Edge Function deployments.
   4. Renderer deployment and health.
   5. Vercel Preview deployment.
   6. Safe cron activation.
   7. Authenticated browser acceptance.
8. Stamp and compare one exact SHA across CI, functions, renderer, and frontend.
9. Do not label arbitrary Vercel PR previews as full parity.

Exit criteria:

- Protected stable URL and immutable deployment URL serve the same exact candidate.
- Network inspection shows only staging Supabase, Storage, function, renderer, and observability endpoints.
- A backend or renderer failure prevents the full Preview promotion step.

### Phase 6 — Authenticated acceptance

**Dependencies:** Full stack deployed and protected.

Run acceptance in the Codex native browser through the required Computer Use route.

Tasks:

1. Run the capability matrix in Section 7.
2. Test `admin` and `read_only` on desktop and mobile.
3. Test every dashboard mutation as `read_only`; each must fail server-side.
4. Test dedupe off, one bounded on fixture, and off again.
5. Test translation off, one bounded on fixture, and off again.
6. Attempt posting through settings, direct API, retry, force, cron, and malformed-control paths.
7. Verify that each attempt stops before provider network access.
8. Test function and renderer failure modes, queue leases, paused backlog, CORS, Auth redirects, console errors, and observability tags.
9. Run the rollback drill before acceptance closes.

Exit criteria:

- Every capability row has a receipt and no row is missing.
- Posting provider write count is zero.
- Production access count from Preview is zero.
- Both role matrices pass.
- The owner can now review Preview and decide AIR-050.

### Phase 7 — E10 closeout and production handoff

**Dependencies:** Phase 6 accepted.

Tasks:

1. Attach exact-SHA, deployment, function, migration, renderer, browser, role, provider-zero, and rollback receipts.
2. Record all remaining limitations. Do not call paused or blocked capabilities missing.
3. Keep production cutover closed.
4. Prepare the exact-SHA production-change proposal after the owner AIR-050 decision. Do not start production work.

## 9. Phase 2 handoff and exact next phase

E10 Phase 2 is accepted as `ACCEPTED_PREVIEW_PREPARATION_T1`. Its scope is repository/source/config/runbook preparation plus deterministic local checks and build. Local remains a disposable editing and validation lane; no persistent local Supabase, renderer, full-stack URL, or parity environment is required.

The accepted receipt is `docs/plans/2026-08-13-xot-e10-phase2-preview-safety-acceptance.json`, SHA-256 `d73f57e217ed5d935e65169c488af8c09977e5cb60a3a95fbe1456e934c8405b`, 9,776 bytes. The independent review accepted all 25 evidence files and rejected 38/38 additional invalid mutations. The disclosed rejected read-only external-command incident caused no mutation and was resolved; no external command was used in later clean validation.

The exact next phase is **E10-P3 — isolated Supabase staging**, `NOT_STARTED`. It requires explicit external provisioning authority. No commit, push, staging mutation, hosted CI, Vercel/renderer deployment, browser acceptance, live acceptance, provider contact, or production action is authorized by this handoff. Release remains `CLOSED`.

## 10. Novita minimal allowlist expansion task

Novita is not part of the first edit. The current repository policy allows only two fixed test commands and does not include the new E10 files.

After the first Luna High slice is locally green:

1. Prepare a separate owner-reviewed change to `.novita-offload.json`.
2. Add only the exact E10 test inputs needed for a Linux-compatible repeat:
   - `package.json` and `package-lock.json`.
   - The exact test runner configuration files already used by the repository.
   - The one new runtime-controls/roles migration.
   - The exact shared guard modules.
   - The exact changed function entrypoints.
   - The exact E10 unit and contract test files.
   - The exact environment-pairing guard and its test.
3. Do not allow `supabase/**`, `src/**`, or the repository root as broad globs.
4. Do not upload `.env*`, Vercel metadata, credentials, keys, private logs, production exports, user data, or unrelated dirty files.
5. Add exact non-network test commands. Do not permit deploy, link, login, provider, or database commands.
6. Keep network disabled, lifetime at or below one hour, use the smallest sufficient template, retrieve only test receipts, and use `kill` cleanup.
7. Report sandbox ID, file manifest, duration, resource use, remote exit status, artifact list, billing availability, and cleanup evidence.

Novita acceptance is a remote validation receipt only. It does not replace local tests, browser acceptance, staging deployment evidence, or production readiness.

## 11. Validation and evidence package

### 11.1 Local validation

- Focused SQL, function, API, role, settings, queue, and UI tests.
- `npm run lint:functions`
- `npm run check:functions`
- `npm test`
- `npm run check:strict`
- `npm --prefix services/video-renderer test`
- `git diff --check` on owned files

Use current package scripts as the source of truth. If a listed command is not present at execution time, record the drift and use the repository's current equivalent. Do not invent a passing receipt.

### 11.2 Staging identity validation

- Masked Supabase project ref and URL host.
- Explicit proof that the production ref is absent from source output, built assets, deployment variables, function config, renderer config, logs, and browser traffic.
- Migration version and hash inventory.
- Ten-function list, auth configuration, deployed version, and `DEPLOY_GIT_SHA`.
- Auth redirects, exact CORS origins, role rows, RLS policy matrix, Storage bucket list, Realtime check, and cron list.
- Renderer service, image or release ID, SHA, heartbeat time, and renderer ID.

### 11.3 Side-effect validation

- Mocked local tests prove guards run before HTTP clients.
- Staging structured logs show blocked actions without payloads or secrets.
- Provider dashboards or bounded request ledgers show zero X and Telegram write calls during acceptance.
- OpenAI request count is zero while both controls are off.
- One bounded request is attributable to each enabled fixture test.
- Turning controls off stops new claims and preserves remaining work.

### 11.4 Browser validation

- Use the protected stable origin and immutable commit URL.
- Test desktop and mobile.
- Capture role, toggle, locked posting, queue, renderer, error, console, network, CORS, and Auth receipts.
- Do not claim authenticated acceptance from an unauthenticated page load.

## 12. Kill conditions

Stop the Preview rollout immediately if any condition occurs:

- A Preview asset, variable, request, function, renderer, or log references production Supabase ref `jzirqfzzvlbxwfzndaer`.
- A Preview request reads or writes production database, Auth, Storage, Realtime, queue, renderer, or destination state.
- Any X, Telegram, or other external posting request reaches the provider network.
- A `read_only` mutation succeeds.
- A missing or malformed control row permits work.
- A component reports a different candidate SHA.
- Migrations, generated types, RLS, or function auth differ from the accepted candidate.
- Re-enabling an OpenAI control starts an unbounded backlog drain.
- Secrets appear in logs, build artifacts, browser data, or receipts.
- An external provider returns an unknown write outcome.

## 13. Rollback and recovery

Use this order:

1. Remove or protect the full-preview alias so users cannot continue acceptance.
2. Set both OpenAI controls false through the narrow admin RPC.
3. Disable staging worker, posting, reconciliation, and cleanup schedules.
4. Stop the staging renderer poller while preserving its workdir and logs.
5. Roll Vercel, functions, and renderer back to their recorded prior exact SHA.
6. Use a forward database repair migration. Do not reset or delete the database as a normal rollback.
7. Rotate staging-only credentials if exposure is possible.
8. Keep production credentials and state unchanged unless direct evidence proves production exposure.
9. Delete or reset the staging project only with separate destructive authorization and a retained evidence package.

The rollback drill must prove alias disablement, cron disablement, renderer stop, controls off, and prior-SHA restoration before E10 acceptance.

## 14. E9 sequence amendment

Do not collapse E9, E10 implementation, authenticated acceptance, and production into one gate.

Amend the sequence as follows:

1. **E9 — Owner decisions and external gates:** Keep AIR-010 disabled, keep AIR-050 deferred to full Preview review, retain every unresolved external gate, and capture exact authority for each later action.
2. **E10 Phase 1 — Local controls and roles:** Preserve `ACCEPTED_LOCAL_PHASE1`. Do not promote it to hosted, staging, Preview, browser, deploy, live, or production evidence.
3. **E10 Phase 2 — Local guards, config, and runbooks:** Accepted as `ACCEPTED_PREVIEW_PREPARATION_T1` for repository/source/config/runbook preparation plus deterministic local checks and build only. This does not establish a persistent local environment or hosted/staging/live evidence.
4. **E10 Phase 3 — Isolated Supabase staging:** Provision and validate the staging database, Auth, Storage, Realtime, functions, secrets-present checks, disabled cron, safe fixtures, runtime controls, and role rows.
5. **E10 Phase 4 — Isolated staging renderer:** Deploy and validate the staging-only renderer against the accepted staging backend and exact candidate.
6. **E10 Phase 5 — Protected Vercel Preview and hosted CI:** Bind the frontend, staging backend, functions, and renderer to one exact SHA behind deployment protection.
7. **E10 Phase 6 — Authenticated acceptance and AIR-050:** Run the full `admin` and `read_only` capability, side-effect, failure, responsive browser, and rollback matrix. The owner then decides AIR-050.
8. **E10 Phase 7 — Closeout and production handoff:** Package exact receipts and a production-change proposal. Production stays closed until a separate production gate authorizes it.

The current owner message resolves design choices. It does not by itself authorize a commit, push, cloud provisioning, deployment, DNS change, provider call, or production action.

## 15. No-production limits

These limits apply to all E10 implementation and validation:

- No production Vercel deploy, alias, domain, environment variable, or project setting change.
- No command that targets Supabase ref `jzirqfzzvlbxwfzndaer`.
- No production database migration, SQL write, function deployment, secret change, Auth change, Storage change, Realtime change, or cron change.
- No production renderer process, token, workdir, queue, or configuration change.
- No production data copy into staging. Use sanitized deterministic fixtures.
- No production service-role key or posting credential in Preview.
- No change to the production RSS.app webhook.
- No X, Telegram, digest, or other external posting from Preview.
- No destructive reset, project deletion, broad secret rotation, or data deletion without separate authorization.
- No Git push, commit, or deployment until the E9 successor packet records the exact authority and candidate SHA.
- Stop before execution if the target identity is missing, ambiguous, masked beyond verification, or equal to production.

## 16. Completion definition

E10-P is complete only when:

- One exact SHA is proven across hosted CI, Vercel, all ten functions, and the renderer.
- The full capability matrix passes with no missing row.
- Preview uses only isolated staging data, Auth, Storage, queues, cron, functions, renderer, and secrets.
- `admin | read_only` is the only active role contract, with one role per user.
- Dedupe and translation are off by default and safely toggleable by `admin`.
- Posting is hard-blocked and cannot be enabled in Preview.
- Production access and provider posting write counts are both zero.
- The rollback drill passes.
- The owner can review the protected full Preview and make the deferred AIR-050 decision.

## 17. Source basis

Current platform behavior must be rechecked at execution time against official documentation:

- Vercel environment variables: <https://vercel.com/docs/environment-variables>
- Vercel deployment environments: <https://vercel.com/docs/deployments/environments>
- Vercel deployment protection: <https://vercel.com/docs/deployment-protection>
- Supabase environment management: <https://supabase.com/docs/guides/deployment/managing-environments>
- Supabase branching: <https://supabase.com/docs/guides/deployment/branching>

This plan authorizes no implementation or external state change.
