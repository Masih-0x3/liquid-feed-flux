# XOT Observability Online Release Implementation Plan

## Planner Metadata

- Repository/path: `/Users/stevmq/Finalized XOT`
- Branch: `main`
- Date: 2026-07-03
- Planning mode: `planning-orchestrator`, goal-backed, parent-owned, read-only planning pass.
- Product surface: XOT admin dashboard, especially `/dashboard`, `/monitoring`, `/settings`, Supabase Edge Functions, Supabase Postgres migrations, Vercel frontend, optional hosted Foglamp export.
- Desired outcome: push the already implemented XOT native process observability work online safely, with the migration, functions, frontend, Foglamp cap controls, real-flow validation, release ledger, and rollback path handled in the right order.
- Worker scopes: none executed. The plan records worker lenses that a future implementation orchestrator may use, but this planning turn did not spawn subagents because the active multi-agent tool policy requires an explicit subagent/delegation request.
- References inspected:
  - `/Users/stevmq/Finalized XOT/README.md`
  - `/Users/stevmq/Finalized XOT/package.json`
  - `/Users/stevmq/Finalized XOT/.vercel/project.json`
  - `/Users/stevmq/Finalized XOT/scripts/deploy-functions.sh`
  - `/Users/stevmq/Finalized XOT/scripts/check-release-state.sh`
  - `/Users/stevmq/Finalized XOT/docs/operations/release-runbook.md`
  - `/Users/stevmq/Finalized XOT/docs/operations/runbooks.md`
  - `/Users/stevmq/Finalized XOT/docs/plans/2026-07-03-xot-native-process-observability-dashboard-implementation-plan.md`
  - `/Users/stevmq/Finalized XOT/docs/plans/2026-07-03-xot-native-process-observability-dashboard-implementation-ledger.jsonl`
  - `/Users/stevmq/Finalized XOT/supabase/migrations/20260703010000_xot_process_observability.sql`
- Research sources:
  - Foglamp introduction: `https://docs.foglamp.dev/introduction`
  - Foglamp AI agent instrumentation: `https://docs.foglamp.dev/ai-instrument.md`
  - Foglamp data model: `https://docs.foglamp.dev/concepts/data-model`
  - Foglamp SDK configuration: `https://docs.foglamp.dev/sdk/configuration`
  - Foglamp runtimes and flushing: `https://docs.foglamp.dev/sdk/runtimes`
  - Foglamp Live HUD: `https://docs.foglamp.dev/sdk/hud`
  - Foglamp ingest API reference: `https://docs.foglamp.dev/api-reference/introduction`
  - Foglamp OSS repository: `https://github.com/foglamp-labs/foglamp`
- Current live/source evidence:
  - `npm run check:release-state` previously completed successfully in the checkpoint pass.
  - `npx supabase migration list --linked` currently reports `20260703010000` as local-only.
  - `npx supabase secrets list --project-ref jzirqfzzvlbxwfzndaer` currently shows no `FOGLAMP_*` secret names.
  - `.vercel/project.json` identifies project `xot`, Vercel project id `prj_1qO6i3hZ2d9lqYFFWxuRTIhG8ep9`, team id `team_FZFzyiblNRBueeZRHhDlsnXJ`, build command `npm run build`, output `dist`, Node `24.x`.
  - Local browser validation from the checkpoint showed `/monitoring` opens row `Details`, displays `Process Observability`, and no longer has the Foglamp HUD overlay blocking the table.
- Assumptions:
  - The already dirty observability implementation worktree is intentional and should be committed or PR'd, not reverted.
  - The implementation orchestrator may run deployment actions in a later turn, but this planning turn must not apply migrations, set secrets, deploy functions, deploy Vercel, or trigger real AI flows.
  - Hosted Foglamp is optional. XOT native Supabase ledgers are the product source of truth whether or not hosted export is enabled.
  - Foglamp pricing and free-tier limits are drift-prone. The implementation must verify the current Foglamp account limit before enabling hosted export.

## Executive Goal

Move XOT native process observability from local-ready to online-ready without losing the release discipline already in the repo.

The work is not just "push the code." The safe release has five separate gates:

1. Commit and merge the implementation from a reviewed branch into clean `main`.
2. Apply only the reviewed observability migration despite historical migration drift.
3. Deploy the updated Edge Functions after the tables exist.
4. Deploy the Vercel frontend with real public Vite Supabase env.
5. Prove real XOT flows produce visible dashboard/monitoring evidence, while hosted Foglamp export stays within a locally enforced monthly cap or stays disabled.

## Source Of Truth Contract

- Intent: release XOT's native process observability dashboard and optional Foglamp hosted export safely to production.
- Current behavior: local implementation and checkpoint fixes are validated, but production does not yet have the new `workflow_runs`, `ai_call_ledger`, and `budget_ledger` tables; production Edge Function secrets do not contain `FOGLAMP_*`; production functions and frontend are still on prior deployed code.
- Expected outcome: production XOT dashboard and Monitoring can show process observability from real Supabase ledger rows, Edge Functions can write those rows, optional hosted Foglamp export is off or capped below the verified monthly free limit, and operators have rollback instructions.
- Truth owner: XOT-owned Supabase tables and admin action summaries are the product truth. Hosted Foglamp traces are optional external correlation, not the dashboard source of truth.
- Contract boundary: git branch/PR, Supabase migration application, Supabase migration history repair, Edge Function deploy, Supabase Edge secrets, Vercel frontend deployment, post-deploy SQL/browser checks, release ledger entry, rollback path.
- Displaced path: local-only validation state and the existing generic "Trace not captured" drawer state are displaced only after production has real ledger rows from real flows. Historical `jobs.result_meta` usage remains fallback, not release proof.
- Cutover:
  1. Land code on clean `main`.
  2. Apply and record the migration.
  3. Deploy functions that write/read ledgers.
  4. Deploy frontend.
  5. First validate local-only ledgers with hosted export disabled or missing key.
  6. Enable hosted Foglamp only after cap settings are confirmed.
  7. Trigger real flows and verify rows/UI/optional hosted traces.
- Acceptance evidence: real production route, SQL rows, function versions, Vercel deployment, live Dashboard/Monitoring UI, and release-state output. Tests and builds are required support evidence, but they are not enough by themselves.
- Evidence lane: `npm run check:release-state`, `npx supabase migration list --linked`, SQL reads against `workflow_runs`/`ai_call_ledger`/`budget_ledger`, Supabase function version list, Vercel deployment metadata, browser screenshots/DOM checks on `https://xot.iraneyes.com`, and optional Foglamp dashboard trace only after hosted export is intentionally enabled.
- Kill criteria:
  - Stop deploy if local validation regresses.
  - Stop migration if review finds policy/auth drift or unsupported dependency on historical local-only migrations.
  - Set `FOGLAMP_ENABLED=0` or omit `FOGLAMP_API_KEY` if the current free limit cannot be verified.
  - Disable hosted export if estimated spans approach cap, Foglamp returns quota `429`, or prompt/output text appears in hosted traces.
  - Roll back functions/frontend if `admin-actions`, worker cron, x-poster cron, dashboard auth, or Monitoring load breaks.
- Forbidden moves:
  - Do not run `supabase db push` blindly while migration history drift exists.
  - Do not commit `.env`, API keys, Supabase secret values, Foglamp keys, screenshots exposing secrets, or trace payload text.
  - Do not create fake smoke endpoints, synthetic trace jobs, demo rows, forced posts, or fake dashboard data.
  - Do not report "verified" from tests alone.
  - Do not turn on prompt/output capture in production. Keep `FOGLAMP_RECORD_INPUTS=false` and `FOGLAMP_RECORD_OUTPUTS=false`.
  - Do not label all processes with one dynamic name; keep static `workflowName`, `traceName`, and `agentName`.

## Native Planning Superiority

- Codex Native baseline: likely says "apply migration, deploy, set API key, test dashboard" without respecting XOT's release runbook, migration drift, local ledger source of truth, Foglamp quota behavior, or the user's "no fake trace" requirement.
- What this plan does better: it separates commit, migration, function, frontend, secret, real-flow, and rollback gates; it uses XOT's runbook commands; it defines free-tier protection; it gives exact SQL/browser evidence; and it keeps hosted Foglamp optional.
- User-specific context used: XOT release-state conventions, prior checkpoint findings, existing Monitoring route, Foglamp HUD blocking fix, admin-only RLS fix, and the user's desire to make observability useful inside XOT rather than depending on Foglamp's hosted dashboard.
- Superiority score target: 5
- Proof artifacts: this saved plan, the checkpoint ledger, current migration/secret/Vercel evidence, official Foglamp docs, and repo runbooks.

## Orchestration Decision

Orchestration decision:
- Mode: parent-only planning run.
- Worker count: 0.
- Decision reason: the plan spans several independent surfaces, but the session's multi-agent tool policy says not to spawn agents unless the user explicitly asks for subagents/delegation/parallel agent work. The parent had direct access to the required repo, runbook, live migration/secret evidence, browser continuity, and official docs.
- Independent surfaces:
  - Git/PR/CI/Vercel release path.
  - Supabase migration and RLS/data contract.
  - Supabase Edge Functions and secrets.
  - XOT Dashboard/Monitoring/Settings validation.
  - Foglamp hosted export and monthly cap control.
  - Rollback and release ledger.
- Workers used or skipped:
  - Skipped migration/release worker due active tool policy; parent inspected runbook, migration list, CLI help, and deploy script.
  - Skipped UI validation worker due active tool policy; parent used prior authenticated browser checkpoint evidence.
  - Skipped Foglamp docs worker due active tool policy; parent inspected official docs and source repository page.
- Thread decision: no visible thread. This is one implementation handoff plan for the same repo.
- Token/context rationale: current source truth and recent checkpoint evidence were enough for a high-confidence plan; duplicate workers would mostly re-read the same files.
- Reconsider trigger: if the user explicitly says "use subagents" or asks for parallel implementation lanes, split into migration/release, function deploy, UI validation, and budget/Foglamp workers.

## Background Browser Lane

- Needed: yes, during implementation only.
- Target/surface: `https://xot.iraneyes.com/dashboard`, `https://xot.iraneyes.com/monitoring`, `https://xot.iraneyes.com/settings`, plus current local route if validating before production.
- Safety boundary: read-only until the operator explicitly chooses a real AI/admin action. Do not generate fake traces or force posts. Do not submit settings changes unless the implementation goal explicitly includes them.
- Required receipt:
  - Current URL and auth state.
  - Dashboard process observability summary visible or degraded with reason.
  - Monitoring row `Details` opens.
  - `Process Observability` section shows real run/call data after a real flow.
  - No Foglamp HUD overlay blocks Monitoring.
  - Any real action triggered, with timestamp and reason.
- Stop condition: stop browser automation if sign-in is required, if a form would mutate Settings without explicit approval, if an external account page asks for payment/plan changes, or if trace payloads expose prompt/output text.

## Research And Inspiration Findings

### Foglamp Instrumentation And Data Model

Foglamp supports Vercel AI SDK v4-v7. The docs state v4-v6 use `foglamp/wrap`, while v7 uses native telemetry integrations. XOT currently has `ai@6.0.217`, so v4-v6 wrapping remains the correct SDK path for any AI SDK-based instrumentation.

Foglamp's data model says every trace must have `traceName` or `agentName`, and `workflowName` plus `workflowRunId` must be provided together. Sessions are for real user conversations, while workflows are repeatable processes. XOT's RSS, worker, renderer, dedupe, posting, and settings flows are workflows, not sessions.

Implementation takeaway:
- Keep the already implemented static names and workflow grouping.
- Keep high-cardinality tweet/job/run identifiers in `workflowRunId`, `subject_id`, `tweet_id`, or metadata, never in names.
- Do not add `customer` unless XOT becomes multi-tenant.

### Foglamp Privacy, Flush, And Error Behavior

Foglamp configuration defaults include prompt/input and output capture, but the docs show `recordInputs: false` and `recordOutputs: false` as the privacy path. The docs also say the collector never throws into the app path and routes transport errors to `onError` or swallows them. Runtime docs warn that in serverless contexts spans can be lost if not flushed, but XOT's native Supabase ledgers are independent of hosted Foglamp flush success.

Implementation takeaway:
- Production must set or preserve `FOGLAMP_RECORD_INPUTS=false` and `FOGLAMP_RECORD_OUTPUTS=false`.
- Hosted Foglamp errors must not block XOT pipeline actions.
- XOT local ledger writes remain the acceptance source, not Foglamp's hosted UI.

### Foglamp HUD

The Live HUD docs describe a dev-only React overlay that connects to a localhost Node SSE broker. The docs explicitly say the broker needs a long-lived Node process and is not for edge/serverless/prod. XOT's Monitoring page already had a local HUD overlap issue that was fixed by not mounting HUD on `/monitoring`.

Implementation takeaway:
- Do not try to prove production observability through the HUD.
- Keep HUD dev-only and never let it block XOT-native Monitoring.
- The useful production dashboard is XOT's own process observability, not the upstream floating overlay.

### Foglamp Ingest API And Quota

The ingest API is a write path. A `202` means accepted; `429` can mean rate limit or monthly plan quota. The docs say quota `429` is terminal until the plan upgrades or resets; retrying does not help.

Implementation takeaway:
- Locally count estimated spans before hosted export.
- Treat quota `429` as a kill condition for hosted export, not as a retryable transient.
- Dashboard should show estimated spans used, cap, warning threshold, skipped spans, and stopped state.

### Foglamp OSS License

The GitHub repository describes Foglamp as open source and self-hostable. The README page reports platform code as Apache 2.0 and the SDK as MIT, with package-specific license fields. If XOT vendors HUD model/reducer code later, preserve the relevant notices.

Implementation takeaway:
- Current release does not need vendoring.
- If a future "XOT-native live HUD" copies code from Foglamp, add explicit license attribution.

## Current State

### Local Code And Validation

The previous checkpoint loop completed these fixes:

- HUD no longer mounts on `/monitoring` and is collapsed elsewhere.
- Monitoring rows have explicit desktop `Details`.
- New observability ledger RLS is admin-only for authenticated reads and service-role for writes.

The previous checkpoint validated:

- `npx vitest run src/test/monitoring-components.test.tsx src/test/dashboard.test.tsx src/test/observability-settings.test.tsx`: passed.
- `npm test`: passed with 116 tests.
- `npm run check:strict`: passed.
- `npm run lint`: 0 errors, 8 existing Fast Refresh warnings.
- `npm run build:dev`: passed.
- `npm run build`: passed when supplied with real public Vite Supabase env.
- `npm --prefix services/video-renderer test`: 166 passed.
- `npm run test:functions`: 317 passed.
- `npm run check:functions`: passed.
- `npm run lint:functions`: passed.
- `git diff --check`: clean.
- Browser `/monitoring`: row `Details` opens drawer, `Process Observability` renders, no HUD overlay.

### Live Release State

- Production hosts respond from Vercel.
- GitHub CI on current `main` was green before the dirty observability work.
- Vercel project config exists locally for project `xot`.
- Supabase active cron and renderer heartbeat were healthy in release-state output.
- New migration `20260703010000_xot_process_observability` is local-only.
- No remote `FOGLAMP_*` secret names are present.
- Historical Supabase migration history has many local-only and remote-only entries. This means `supabase db push` is specifically unsafe under the existing release runbook.

## Future State

The online state should look like this:

- Production Supabase contains `workflow_runs`, `ai_call_ledger`, and `budget_ledger` with admin-only read policies.
- Production `admin-actions`, `worker`, `digest-compiler`, and `x-poster` run code that can write/read those tables.
- Vercel production frontend includes Dashboard/Monitoring/Settings observability UI.
- Dashboard shows native process observability status and Foglamp budget/cap state.
- Monitoring detail drawer shows real process observability rows for new real workflow runs.
- Hosted Foglamp export is either:
  - disabled/local-only, with `foglamp_skip_reason` showing why, or
  - enabled with `FOGLAMP_API_KEY`, text capture off, warning/cap secrets set, and hosted spans remaining below the verified monthly free allowance.
- Release ledger records SHA, CI, Vercel deployment, migration head, function versions, secrets status by name only, smoke checks, and rollback target.

## Non-Goals

- No fake endpoint, fake trace, demo job, synthetic ledger row, forced X post, or test-only production data.
- No full self-hosted Foglamp deployment in this release.
- No migration history cleanup beyond recording this reviewed migration safely.
- No broad UI redesign beyond release validation.
- No customer attribution unless XOT gets real customer/tenant boundaries.
- No prompt/output text capture in hosted Foglamp.

## Phase Plan

### Phase 0 - Freeze Release Scope And Branch

Goal: convert the dirty local implementation into a reviewable branch without changing behavior.

Tasks:

1. Create a branch:
   ```bash
   git checkout -b codex/xot-observability-online-release
   ```
2. Review changed files:
   ```bash
   git status --short
   git diff --stat
   git diff --check
   ```
3. Confirm no secrets:
   ```bash
   rg -n "fl_|sk-|SUPABASE_SERVICE_ROLE|FOGLAMP_API_KEY|OPENAI_API_KEY|TELEGRAM_BOT_TOKEN" . \
     -g '!node_modules' -g '!dist' -g '!*.lock'
   ```
   Investigate matches before staging. Expected docs/env placeholder matches are acceptable; real values are not.
4. Run focused validation again after any conflict resolution:
   ```bash
   npx vitest run src/test/monitoring-components.test.tsx src/test/dashboard.test.tsx src/test/observability-settings.test.tsx
   npm run check:strict
   git diff --check
   ```

Acceptance criteria:

- Branch exists.
- No unreviewed secret-like values are staged.
- The worktree diff is understood and scoped to observability/release docs.

### Phase 1 - Full Pre-PR Validation And PR

Goal: make GitHub CI the promotion gate before any production action.

Tasks:

1. Run the full local gate:
   ```bash
   npm run lint
   npm run check:function-inventory
   npm run lint:functions
   npm run check:functions
   npm run check:strict
   npm test
   VITE_SUPABASE_URL=https://jzirqfzzvlbxwfzndaer.supabase.co \
   VITE_SUPABASE_PUBLISHABLE_KEY=<public publishable key> \
   VITE_SUPABASE_PROJECT_ID=jzirqfzzvlbxwfzndaer \
   npm run build
   npm --prefix services/video-renderer test
   git diff --check
   ```
2. Dry-run deploy shape:
   ```bash
   DEPLOY_FUNCTIONS_DRY_RUN=1 ./scripts/deploy-functions.sh admin-actions worker digest-compiler x-poster
   ```
3. Commit, push, and open a PR.
4. Wait for GitHub CI to pass.
5. Merge to `main` only after local and CI evidence are recorded.

Acceptance criteria:

- Full validation passes.
- Deploy dry-run passes.
- PR merged or explicitly approved according to operator choice.
- `main` is clean and matches `origin/main` before production actions:
  ```bash
  git checkout main
  git pull --ff-only origin main
  test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
  git status --short --branch
  ```

### Phase 2 - Migration Apply With Drift Guard

Goal: apply only the reviewed observability migration while respecting existing migration drift.

Do not run:

```bash
npx supabase db push
```

Because the release runbook forbids blind `db push` while migration drift exists.

Tasks:

1. Capture pre-migration state:
   ```bash
   SUPABASE_TELEMETRY_DISABLED=1 npx supabase migration list --linked
   SUPABASE_TELEMETRY_DISABLED=1 npx supabase db query --linked \
     "select to_regclass('public.workflow_runs') as workflow_runs, to_regclass('public.ai_call_ledger') as ai_call_ledger, to_regclass('public.budget_ledger') as budget_ledger;"
   ```
2. Review the migration one last time:
   ```bash
   sed -n '1,240p' supabase/migrations/20260703010000_xot_process_observability.sql
   ```
3. Apply exactly that SQL file:
   ```bash
   SUPABASE_TELEMETRY_DISABLED=1 npx supabase db query --linked \
     --file supabase/migrations/20260703010000_xot_process_observability.sql
   ```
4. Record migration history as applied:
   ```bash
   SUPABASE_TELEMETRY_DISABLED=1 npx supabase migration repair --linked --status applied 20260703010000
   ```
5. Verify tables, policies, grants, and version:
   ```bash
   SUPABASE_TELEMETRY_DISABLED=1 npx supabase migration list --linked
   SUPABASE_TELEMETRY_DISABLED=1 npx supabase db query --linked \
     "select to_regclass('public.workflow_runs') as workflow_runs, to_regclass('public.ai_call_ledger') as ai_call_ledger, to_regclass('public.budget_ledger') as budget_ledger;"
   SUPABASE_TELEMETRY_DISABLED=1 npx supabase db query --linked \
     "select tablename, policyname, cmd, roles, qual from pg_policies where schemaname='public' and tablename in ('workflow_runs','ai_call_ledger','budget_ledger') order by tablename, policyname;"
   ```

Acceptance criteria:

- `20260703010000` is present on both local and remote migration lists.
- All three tables exist.
- Policies show admin-only select for authenticated users and service-role management.
- No existing production tables or cron jobs are changed except the new observability tables.

Rollback:

- Prefer forward-fix. If functions have not been deployed yet, leaving new unused tables in place is safer than dropping them during an incident.
- If the migration itself caused an incident, stop before function deploy and write a reviewed forward-fix migration.

### Phase 3 - Edge Function Deploy

Goal: deploy code that reads/writes the new ledgers after the tables exist.

Functions to deploy:

- `admin-actions`
- `worker`
- `digest-compiler`
- `x-poster`

Tasks:

1. Capture function versions before:
   ```bash
   SUPABASE_TELEMETRY_DISABLED=1 npx supabase functions list --project-ref jzirqfzzvlbxwfzndaer
   ```
2. Dry-run from clean `main`:
   ```bash
   DEPLOY_FUNCTIONS_DRY_RUN=1 ./scripts/deploy-functions.sh admin-actions worker digest-compiler x-poster
   ```
3. Deploy:
   ```bash
   ./scripts/deploy-functions.sh admin-actions worker digest-compiler x-poster
   ```
4. Capture function versions after:
   ```bash
   SUPABASE_TELEMETRY_DISABLED=1 npx supabase functions list --project-ref jzirqfzzvlbxwfzndaer
   ```
5. Verify `DEPLOY_GIT_SHA` secret name timestamp updated by the deploy script. Do not print secret values.

Acceptance criteria:

- Deploy script completes.
- Selected function versions increment.
- `DEPLOY_GIT_SHA` is stamped after deploy success.
- Cron health remains normal:
  ```bash
  SUPABASE_TELEMETRY_DISABLED=1 npx supabase db query --linked \
    "select jobname, schedule, active from cron.job order by jobname;"
  ```

Rollback:

- Redeploy the previous release SHA with `DEPLOY_ALLOW_NON_MAIN=1` as described in `docs/operations/release-runbook.md`.
- Leave migration tables in place unless a reviewed forward-fix says otherwise.

### Phase 4 - Vercel Frontend Deploy

Goal: deploy the frontend that can render the new observability state.

Tasks:

1. Confirm Vercel project settings:
   - Project: `xot`
   - Framework: Vite
   - Install: `npm ci`
   - Build: `npm run build`
   - Output: `dist`
   - Node: `24.x`
2. Confirm Vercel env contains real values:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `VITE_SUPABASE_PROJECT_ID`
   - optional Sentry browser env
3. Let Vercel deploy from merged GitHub `main`.
4. Capture deployment id, commit SHA, and aliases.
5. Smoke both hosts:
   ```bash
   curl -sSI https://xot.iraneyes.com
   curl -sSI https://xot.vercel.app
   ```

Acceptance criteria:

- Vercel production deployment is ready.
- Both aliases return `HTTP/2 200`.
- ETags match between aliases.
- Security headers from `vercel.json` are present.

Rollback:

- Promote previous Vercel production deployment.
- Recheck both aliases.
- Record rollback deployment id.

### Phase 5 - Hosted Foglamp Budget Configuration

Goal: keep hosted export safely below the monthly free limit, or keep it local-only.

Decision gate:

- If the current Foglamp account limit is not verified from the Foglamp account/dashboard on release day, do not enable hosted export. Keep local ledgers only.
- If the free span limit is verified as `L`, set:
  - `FOGLAMP_MONTHLY_SPAN_LIMIT=L`
  - `FOGLAMP_MONTHLY_SPAN_CAP=min(floor(0.8 * L), operator-approved cap)`
  - `FOGLAMP_MONTHLY_SPAN_WARN=min(floor(0.6 * L), cap)`
- If the verified free limit is 10,000 spans/month, initial values are:
  - `FOGLAMP_MONTHLY_SPAN_LIMIT=10000`
  - `FOGLAMP_MONTHLY_SPAN_CAP=8000`
  - `FOGLAMP_MONTHLY_SPAN_WARN=6000`

Local-only first release option:

```bash
npx supabase secrets set --project-ref jzirqfzzvlbxwfzndaer \
  FOGLAMP_ENABLED=0 \
  FOGLAMP_RECORD_INPUTS=false \
  FOGLAMP_RECORD_OUTPUTS=false
```

Hosted export option, only after verifying plan limit and key:

```bash
export FOGLAMP_API_KEY=<paste from Foglamp account or local secure source>
npx supabase secrets set --project-ref jzirqfzzvlbxwfzndaer \
  FOGLAMP_API_KEY="$FOGLAMP_API_KEY" \
  FOGLAMP_ENABLED=1 \
  FOGLAMP_MONTHLY_SPAN_LIMIT=10000 \
  FOGLAMP_MONTHLY_SPAN_CAP=8000 \
  FOGLAMP_MONTHLY_SPAN_WARN=6000 \
  FOGLAMP_RECORD_INPUTS=false \
  FOGLAMP_RECORD_OUTPUTS=false
unset FOGLAMP_API_KEY
```

Do not print the key. Confirm by secret names only:

```bash
SUPABASE_TELEMETRY_DISABLED=1 npx supabase secrets list --project-ref jzirqfzzvlbxwfzndaer \
  | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);console.log(j.secrets.map(x=>x.name).filter(n=>n.startsWith('FOGLAMP')).sort().join('\\n'))})"
```

Acceptance criteria:

- `FOGLAMP_RECORD_INPUTS=false` and `FOGLAMP_RECORD_OUTPUTS=false` are set if any hosted export is enabled.
- Hosted export is off unless plan limit and cap are confirmed.
- Dashboard reports cap, warn, used, skipped, and stopped state.
- If cap is reached, XOT keeps local ledgers and skips hosted export.

Rollback:

```bash
npx supabase secrets set --project-ref jzirqfzzvlbxwfzndaer FOGLAMP_ENABLED=0
```

If necessary, revoke the Foglamp key in Foglamp dashboard and remove/rotate the Supabase secret in a separate secret-rotation step.

### Phase 6 - Real Flow Validation

Goal: prove production observability from real XOT flows, not fake traces.

Recommended validation order:

1. Open `https://xot.iraneyes.com/dashboard` and sign in.
2. Confirm Dashboard loads and admin-actions respond.
3. Open `https://xot.iraneyes.com/monitoring`.
4. Click a row `Details`.
5. Confirm `Process Observability` panel renders.
6. Before triggering any AI action, run a baseline SQL check:
   ```bash
   SUPABASE_TELEMETRY_DISABLED=1 npx supabase db query --linked \
     "select count(*)::int as workflow_runs from public.workflow_runs where started_at > now() - interval '1 hour';"
   ```
7. Trigger one real, low-risk AI flow. Preferred first proof:
   - Use an existing admin translation preview or normal Settings translation preview path if the operator accepts one OpenAI call and no posting side effect.
   - Alternative: wait for the normal worker cron to process a real incoming RSS item.
   - Avoid force-posting, fake data, or demo endpoints.
8. Verify rows:
   ```bash
   SUPABASE_TELEMETRY_DISABLED=1 npx supabase db query --linked \
     "select run_key, workflow_name, workflow_run_id, status, source_function, started_at, ended_at from public.workflow_runs order by started_at desc limit 10;"
   SUPABASE_TELEMETRY_DISABLED=1 npx supabase db query --linked \
     "select workflow_run_key, trace_name, operation_name, agent_name, model, endpoint, status, total_tokens, foglamp_exported, foglamp_span_estimate, foglamp_skip_reason, started_at from public.ai_call_ledger order by started_at desc limit 20;"
   SUPABASE_TELEMETRY_DISABLED=1 npx supabase db query --linked \
     "select provider, unit, period_key, sum(quantity)::numeric as quantity from public.budget_ledger where period_key=to_char(now(), 'YYYY-MM') group by provider, unit, period_key order by provider, unit;"
   ```
9. Refresh Dashboard and Monitoring.
10. Confirm new run/call appears in XOT UI.
11. If hosted export is enabled, check Foglamp dashboard for trace arrival without prompt/output text.

Acceptance criteria:

- Real workflow creates at least one `workflow_runs` row.
- AI/provider call creates at least one `ai_call_ledger` row.
- `budget_ledger` records OpenAI token usage and Foglamp estimated span or skipped span.
- XOT UI shows the corresponding state.
- If hosted export is off or capped, `foglamp_exported=false` with a clear skip reason is acceptable.
- If hosted export is on and under cap, `foglamp_exported=true` for supported AI SDK traces and Foglamp dashboard shows the trace.
- No prompt/output text or secrets appear in XOT metadata or hosted Foglamp trace.

### Phase 7 - Post-Release Health And Ledger

Goal: close the release with evidence and rollback target.

Tasks:

1. Run release-state after production changes:
   ```bash
   npm run check:release-state
   ```
2. Confirm queue health:
   ```bash
   SUPABASE_TELEMETRY_DISABLED=1 npx supabase db query --linked \
     "select type, status, count(*)::int as count from public.jobs group by type, status order by type, status;"
   SUPABASE_TELEMETRY_DISABLED=1 npx supabase db query --linked \
     "select id, type, status, started_at, locked_at, lease_expires_at from public.jobs where status='running' and coalesce(lease_expires_at, started_at) < now() - interval '15 minutes' order by started_at nulls last limit 20;"
   ```
3. Confirm renderer heartbeat:
   ```bash
   SUPABASE_TELEMETRY_DISABLED=1 npx supabase db query --linked \
     "select renderer_id, status, version, render_version, processed, failed, last_seen_at from public.video_renderer_heartbeats order by last_seen_at desc limit 5;"
   ```
4. Add a release ledger entry at the top of `docs/operations/release-runbook.md`.

Release ledger must include:

- Date and operator.
- Git SHA.
- GitHub PR URL.
- GitHub CI run URL.
- Vercel deployment id and aliases checked.
- Supabase project ref.
- Migration head before/after.
- Function versions before/after.
- `DEPLOY_GIT_SHA` stamped timestamp, name only.
- Foglamp secret names present, not values.
- Foglamp cap settings by intended numeric values.
- Browser smoke timestamp.
- SQL row proof summary.
- Rollback target.
- Explicit note that no fake traces or forced posts were used.

Acceptance criteria:

- Release runbook contains durable entry.
- Post-release `npm run check:release-state` passes.
- No stale running jobs.
- Renderer is online.
- Operator can explain how to disable hosted Foglamp immediately.

## Task Backlog

### Must Do Before Online Push

- Create branch, run validations, commit, PR, merge to clean `main`.
- Apply `20260703010000_xot_process_observability.sql` with `db query --file`.
- Repair migration history with `migration repair --status applied 20260703010000`.
- Deploy `admin-actions`, `worker`, `digest-compiler`, `x-poster`.
- Deploy Vercel frontend from GitHub `main`.
- Configure Foglamp secrets as local-only or hosted-with-cap.
- Run real-flow validation and SQL/UI proof.
- Record release ledger.

### Should Do In Same Release If Time Permits

- Add a short docs note under operations explaining how to interpret `foglamp_exported`, `foglamp_skip_reason`, and `estimated_spans_skipped`.
- Add a release checklist item for checking `FOGLAMP_*` secret names before future observability deploys.
- Confirm the Settings observability panel clearly communicates local-only vs hosted export.

### Defer

- Full Foglamp self-hosting.
- Vendoring Foglamp HUD reducer or replacing the floating HUD with a custom live embedded panel.
- Historical backfill of workflow rows.
- Broad migration history cleanup.
- Multi-tenant `customer` attribution.

## Acceptance Criteria

### Release Readiness

- Clean `main` matches `origin/main`.
- CI passed on the merged commit.
- Full local validation passed from clean checkout.
- Deploy dry-run passed.

### Database

- `workflow_runs`, `ai_call_ledger`, and `budget_ledger` exist in production.
- `20260703010000` appears as remote applied.
- Policies are admin-only for authenticated reads.
- Service-role writes work from Edge Functions.

### Functions

- `admin-actions`, `worker`, `digest-compiler`, and `x-poster` deployed successfully.
- Function versions changed as expected.
- `DEPLOY_GIT_SHA` stamped the released SHA.
- Cron jobs remain active.

### Frontend

- Vercel production deploy ready.
- `xot.iraneyes.com` and `xot.vercel.app` return 200.
- Authenticated Dashboard, Monitoring, and Settings load.
- Monitoring details drawer opens.
- `Process Observability` does not falsely claim trace data for historical rows.

### Foglamp Budget

- Hosted export disabled if plan limit is unverified.
- If hosted export enabled, cap is less than verified monthly free limit.
- Text capture disabled.
- Dashboard shows cap and usage.
- Quota `429` or cap reached stops hosted export, not XOT local ledgers.

### Real-Flow Proof

- A real workflow creates Supabase ledger rows.
- UI reflects the rows.
- No prompt/output/secrets are stored.
- No fake data was used.

## Validation Plan

### Local Commands

```bash
npm run lint
npm run check:function-inventory
npm run lint:functions
npm run check:functions
npm run check:strict
npm test
VITE_SUPABASE_URL=https://jzirqfzzvlbxwfzndaer.supabase.co \
VITE_SUPABASE_PUBLISHABLE_KEY=<public publishable key> \
VITE_SUPABASE_PROJECT_ID=jzirqfzzvlbxwfzndaer \
npm run build
npm --prefix services/video-renderer test
git diff --check
```

### Release Commands

```bash
npm run check:release-state
SUPABASE_TELEMETRY_DISABLED=1 npx supabase migration list --linked
DEPLOY_FUNCTIONS_DRY_RUN=1 ./scripts/deploy-functions.sh admin-actions worker digest-compiler x-poster
```

### Browser Checks

- Desktop `https://xot.iraneyes.com/dashboard`
- Desktop `https://xot.iraneyes.com/monitoring`
- Desktop `https://xot.iraneyes.com/settings`
- Mobile-ish viewport for `/monitoring`, focused on row card actions and drawer open.

Do not claim UI verified until the real production route has been observed after deployment.

### SQL Checks

Use the queries in Phases 2, 6, and 7. Keep query output bounded. Do not dump prompt/output metadata.

### Foglamp Checks

- If local-only: confirm XOT rows show `foglamp_exported=false` and reasonable skip reason.
- If hosted enabled: confirm one trace arrives in Foglamp, text is redacted/absent, and XOT span usage remains below cap.

## Risks And Dependencies

- Migration drift: many historical migration entries differ between local and remote. This plan avoids blind `db push` and applies only the reviewed migration.
- Secret handling: Supabase secrets list exposes hashed values in JSON. The implementation must only report names and timestamps, never values/hashes.
- Free-tier drift: Foglamp free span limits may change. Verify in account/dashboard before enabling hosted export.
- Serverless/Edge behavior: Foglamp HUD is not production proof and does not run on Edge/serverless. XOT ledgers are the proof.
- Hosted export coverage: direct OpenAI endpoint calls and renderer flows may be local-ledger-only. Do not overstate hosted Foglamp coverage.
- Production side effects: real validation actions can call OpenAI or mutate Settings. Choose lowest-risk flows and state the side effect before running.
- Rollback complexity: tables can remain if functions/frontend roll back. Prefer forward-fix migrations over destructive rollback.

## Implementation Orchestrator Handoff

### Source-Of-Truth Contract For First Slice

- Intent: land and release the already implemented XOT native observability work without creating new feature scope.
- Current behavior: local-ready, not live-ready; migration local-only; no remote `FOGLAMP_*` secrets.
- Expected outcome: clean merged `main`, applied migration, deployed functions/frontend, real production ledger rows, optional capped hosted export.
- Truth owner: production Supabase ledgers plus release runbook.
- Contract boundary: branch/PR, migration, secrets, functions, Vercel, validation, release ledger.
- Displaced path: local-only proof and historical `Trace not captured` state.
- Cutover: commit -> CI -> migration -> functions -> frontend -> real-flow proof -> ledger.
- Acceptance evidence: production route, SQL rows, function versions, Vercel deployment, release-state output.
- Evidence lane: commands and browser checks in this plan.
- Kill criteria: any auth/dashboard/cron/posting break, quota cap breach, prompt/output leakage, or migration uncertainty.
- Forbidden moves: no fake traces, no blind `db push`, no secret printing, no forced posts.

### Recommended First Implementation Slice

Start with **Phase 0 and Phase 1 only**:

1. Create branch.
2. Run validation.
3. Commit and open PR.
4. Let CI pass.
5. Merge to `main`.

Do not apply the production migration until the code is merged and clean `main` is checked out.

### Phase Order And Dependency Constraints

1. Branch/PR/CI must precede production actions.
2. Migration must precede function deploy.
3. Function deploy must precede real-flow validation.
4. Frontend deploy can happen after migration/function deploy, or after functions if Vercel auto-deploys on merge, but production UI proof is only meaningful after functions and migration are live.
5. Hosted Foglamp enablement should come after local ledger proof unless the operator explicitly accepts hosted export during first proof.
6. Release ledger closes the release, not the implementation diff.

### Files And Surfaces Likely To Change

- `docs/operations/release-runbook.md` for the release ledger.
- Possibly a small operations docs note if gaps are found.
- No product code should change unless validation finds a bug.

### Allowed Changes

- Release ledger entry.
- Small documentation clarifications.
- Forward-fix migration only if production apply reveals an issue.
- Small bug fixes discovered during validation, with full revalidation.

### Disallowed Changes

- New fake trace/smoke endpoint.
- Synthetic production rows.
- Unreviewed schema cleanup.
- Prompt/output capture enablement.
- Broad dashboard redesign.
- Secret commits.

### Required Skills And Tools For Implementation

- `implementation-orchestrator` for the execution loop.
- `checkpoint-quality-loop` after each major gate.
- `engineering-acceptance-review` before claiming release complete.
- `audit-orchestrator` only if a gate fails and root-cause analysis is needed.
- Browser control for authenticated UI proof.
- Supabase CLI for migration/function/secrets checks.
- Vercel connector or GitHub/Vercel UI for deployment evidence when available.
- Cognee memory sidecar for bounded recall, but verify all live facts.

### Required Validation Before Claiming Completion

- All local validation commands pass after any change.
- `npm run check:release-state` passes after deploy.
- Migration appears applied remotely.
- Function versions and `DEPLOY_GIT_SHA` are recorded.
- Vercel production deployment and aliases verified.
- SQL rows from a real flow exist.
- Browser UI shows the real rows.
- Foglamp cap state is visible and under limit or hosted export is disabled.
- Release ledger entry exists.

### Blocking Questions Versus Runtime Decisions

Block implementation if:

- The operator cannot verify or choose hosted Foglamp mode.
- The migration apply path is not approved given historical drift.
- Vercel/Supabase auth blocks required deploy evidence.
- The implementation orchestrator cannot safely access clean `main`.

Resolve during execution:

- Whether first real-flow proof uses translation preview or waits for worker cron.
- Whether hosted Foglamp is enabled in the first release or kept local-only.
- Whether Vercel auto-deploy or manual promotion supplies deployment evidence.

### Stop Conditions

- Stop if secret values would be printed or committed.
- Stop if migration does not apply cleanly.
- Stop if admin dashboard cannot load after deploy.
- Stop if worker/x-poster cron fails after deploy.
- Stop if hosted Foglamp returns quota `429`; set `FOGLAMP_ENABLED=0`.
- Stop if prompt/output text appears in metadata or hosted traces.

### Do Not Claim Complete Until

- Production migration, functions, frontend, and real-flow evidence are all captured.
- Release ledger is updated.
- Rollback target is recorded.
- The operator-visible XOT dashboard/monitoring surface, not only tests, proves the outcome.

The future implementation orchestrator should turn this release into its own `/goal`, run implementation/validation cycles through each phase, and continue until the phase acceptance criteria are satisfied or a blocker is explicitly documented. It should not report `verified` unless target-perspective acceptance evidence is captured from the real route, payload, record, deployment, trace, rendered UI, or operator-visible output.

## Orchestration Closeout

- Workers actually used: 0.
- Worker scopes: planned but skipped due active multi-agent tool policy; parent covered release, migration, Foglamp docs, Vercel, and browser evidence directly.
- Worker results accepted/rejected/unverified: not applicable.
- Parent verification:
  - Repo branch/status read.
  - README, package scripts, release runbook, operations runbook, deploy script, prior plan, and ledger inspected.
  - Vercel project config inspected.
  - Supabase migration list confirmed new migration local-only.
  - Supabase secret names confirmed no `FOGLAMP_*`.
  - Supabase CLI migration repair/query help inspected.
  - Official Foglamp docs and GitHub source page inspected.
- Gaps that would benefit from more workers: if the user explicitly authorizes subagents, use separate workers for migration/release execution, Foglamp quota/account verification, and browser QA.
- Visible thread considered: no. This is a single repo-local release plan.
