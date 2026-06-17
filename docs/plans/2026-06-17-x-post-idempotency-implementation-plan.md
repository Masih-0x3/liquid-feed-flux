# X Post Idempotency Implementation Plan

## Planner Metadata

- Repository/path: `/Users/stevmq/Finalized XOT`
- Branch: planned from `main`; implemented on `codex/x-post-idempotency-claim`
- Date: 2026-06-17
- Planning mode: lightweight planning-orchestrator, parent-only, goal-backed
- Worker scopes: 0 subagents. The scope is one subsystem, but spans database contracts, Edge Function behavior, worker/cron dispatch, tests, release, and monitoring. Parent-only planning avoids duplicate discovery.
- Product surface: X posting pipeline for the RSS-to-Telegram/X automation system.
- Stack: Supabase Postgres, Supabase Edge Functions on Deno, React/Vite admin dashboard, pg_cron, X API OAuth calls.
- Live project: Supabase project `jzirqfzzvlbxwfzndaer`, cron job `x-poster-tick`, Edge Function `x-poster`.
- References inspected:
  - `README.md`
  - `docs/operations/release-runbook.md`
  - `docs/operations/function-auth-matrix.md`
  - `supabase/functions/x-poster/index.ts`
  - `supabase/functions/worker/index.ts`
  - `supabase/functions/worker/videoRenderWorkflow.ts`
  - `supabase/functions/admin-actions/xPostingActions.ts`
  - `supabase/migrations/20260418133725_914c8ba5-305b-45b4-93a5-a5abac4c8a65.sql`
  - `supabase/migrations/20260514103000_x_poster_cron_respect_enabled.sql`
  - `supabase/migrations/20260602035014_pipeline_speed_monitoring.sql`
  - current production rows in `x_deliveries`, `pipeline_events`, `settings`, `cron.job`
- Research sources: local repo instructions/docs and live Supabase read-only queries. No external product research was relevant.
- Assumptions:
  - The desired product-grade outcome is no duplicate public X post for a single source `post_id`, across cron, worker target dispatch, admin retry, and retries.
  - A missed or deferred X post is preferable to publishing the same content twice.
  - Manual retry may retry prior failed/skipped X attempts, but must not duplicate an already posted `post_id`.
  - Historical duplicate public X posts should not be deleted or mutated without an explicit operator decision.

## Implementation Status

Implemented on 2026-06-17 in branch `codex/x-post-idempotency-claim`.

Completed Phase 1 scope:

- Added a Postgres claim contract for `x_deliveries`: `posting` claims, claim token/source/timestamps, partial uniqueness for active-or-posted rows, and token-checked claim/complete/fail RPCs.
- Refactored `x-poster` so media upload and `https://api.x.com/2/tweets` are downstream of `claim_x_post_delivery`.
- Removed the old post-after-side-effect update/upsert race; success now completes the claimed row by token.
- Preserved a safe failure mode: if X accepts the post but the DB completion fails, the `posting` claim remains in place and blocks future automatic duplicates.
- Updated admin retry, monitoring, and duplicate-coverage logic to treat `posting` as an active X state.

Validation completed:

- `npm run lint:functions`
- `npm run check:functions`
- `npm run test:functions` (`282` tests passed)
- `npm run lint` (passed with existing React fast-refresh warnings)
- `npm run build` with local-only Vite env values for compile validation

Not locally replayed:

- `supabase db lint --local` and local migration replay were blocked because Docker/Supabase local Postgres was not running in this environment.

## Executive Goal

Make X posting exactly-once at the product boundary: before `x-poster` sends a request to `https://api.x.com/2/tweets`, it must have a durable, single-owner claim for the source `post_id`. Overlapping invocations from cron, worker target dispatch, admin actions, or retries must converge on one of these outcomes:

- one invocation owns the claim and may call X;
- later invocations skip or defer with a machine-readable reason;
- success can only complete the row that owns the claim token;
- failure releases or records the claim in a way that enables safe retry without duplicate posting;
- monitoring makes claim contention, stale claims, and duplicate-risk events visible.

## Current State

### Live Evidence

Read-only production queries on 2026-06-17 found:

- `x-poster-tick` is active every minute in `cron.job`.
- `x_posting_config.enabled` is `true`.
- Existing unique index is present:
  - `uq_x_deliveries_post_posted ON public.x_deliveries(post_id) WHERE status = 'posted'`
- In the last 30 days:
  - `3981` posted `x_deliveries` rows.
  - `7` posted rows with `attempts > 1`.
  - `5` rows with two retained `pipeline_events.step = 'x_post' and status = 'completed'`.

Confirmed duplicate-completed X events:

| Source post | X IDs | Started UTC | Dispatch sources |
| --- | --- | --- | --- |
| `https://twitter.com/Osint613/status/2067334459247231150` | `2067335729194156302`, `2067335738375491694` | `2026-06-17 19:57:01.584`, `19:57:03.803` | `event`, `cron` |
| `https://twitter.com/sentdefender/status/2067329536237146585` | `2067330213285867652`, `2067330219841569235` | `2026-06-17 19:35:06.521`, `19:35:08.092` | `cron`, `event` |
| `https://twitter.com/sentdefender/status/2067284468163883136` | `2067288421823901904`, `2067288426655748129` | `2026-06-17 16:49:02.638`, `16:49:03.801` | `event`, `cron` |
| `https://twitter.com/FirstSquawk/status/2065278697343799422` | `2065278954957627800`, `2065284299192947095` | `2026-06-12 03:44:08.471`, `04:05:22.553` | `event`, `force` |
| `https://twitter.com/Osint613/status/2065106306751451328` | `2065107823185269090`, `2065107832404377912` | `2026-06-11 16:24:07.381`, `16:24:09.622` | `event`, `cron` |

Two older `x_deliveries.attempts = 2` rows had no retained `posts` row or completed `pipeline_events` detail. Treat them as weaker historical evidence, not confirmed duplicate public posts unless external X/account evidence is checked.

### Local Code Diagnosis

The pipeline has two legitimate posting dispatch paths:

- Cron calls `public.invoke_x_poster_if_enabled()` every minute, which posts to `/functions/v1/x-poster`.
- Worker/video-render completion can call `dispatchXPosterForTarget()`, which invokes `x-poster` with `target_tweet_id`.

The current `x-poster` flow:

1. Loads settings and rate-limit counters.
2. Gets candidates through `get_x_post_candidates` or fallback queries.
3. Filters only already-posted rows loaded before the loop.
4. Checks latest `x_deliveries` status, but only defers previous `failed` or `skipped` for non-force paths.
5. Runs duplicate/media/video/quota checks.
6. Calls the external X API through `postTweet(...)`.
7. After X succeeds, queries `x_deliveries` for an existing posted row:
   - if found, updates it and increments `attempts`;
   - otherwise inserts a posted row.

This means the database uniqueness guard runs after the irreversible external side effect. A second invocation can publish to X before discovering that the first invocation has already posted.

### Current Guard That Is Insufficient

The partial unique index on posted rows prevents two `posted` ledger rows for one `post_id`, but it does not prevent two X API calls. In the confirmed incidents, the second successful X API call updated the first ledger row instead of inserting a new row, leaving `attempts = 2`.

## Future State

X posting should behave like a durable claim-driven workflow:

- Candidate selection is advisory only. It can suggest eligible posts, but it is not the idempotency boundary.
- The idempotency boundary is a Postgres-backed claim immediately before any media upload or tweet creation side effect.
- Claim state is durable, inspectable, and expires safely if an Edge Function dies.
- Only the holder of the current claim token may complete or fail that claim.
- Manual retry is explicit and safe: it may retry failed/skipped states, but not already-posted states.
- Cron, worker target dispatch, and admin retry can remain enabled because the DB contract makes overlap harmless.
- Monitoring and dashboard summaries expose duplicate-risk signals so this class of issue is caught before screenshots from X.

## Non-Goals

- Do not delete historical duplicate X posts without a separate operator decision.
- Do not disable `x-poster-tick` as the primary fix. That reduces one trigger path but does not solve admin/worker/concurrent retries.
- Do not rely on `min_spacing_minutes` as the fix. It is a posting cadence policy, not an idempotency guarantee.
- Do not solve by only checking latest status in TypeScript. That narrows timing but still races under overlap.
- Do not refactor unrelated duplicate-gate/story-memory logic.
- Do not change RSS ingestion, Telegram delivery, or video renderer behavior except where they dispatch X posting.

## Product Principles

- External side effects require durable ownership first.
- Database constraints are the source of truth; TypeScript checks are defense in depth.
- Retry should be slower and more explicit than duplicate posting.
- Admin/manual controls must be powerful but must not bypass already-posted protection by accident.
- Incident monitoring should report user-visible duplicate risk, not only internal row shape.

## Phase Plan

### Phase 0: Immediate Safety Decision

Purpose: decide whether to temporarily reduce risk while the product-grade fix is implemented.

Tasks:

- If duplicate posting is still actively visible, temporarily pause one trigger path:
  - safest high-friction option: set `x_posting_config.enabled = false`;
  - narrower option: temporarily stop worker target dispatch or cron, but only after recording the operational tradeoff.
- Record any temporary setting change in the release/incident ledger.
- Do not treat this as the fix.

Acceptance criteria:

- Operator knows whether production is still exposed during implementation.
- Any mitigation is reversible and documented.

Validation:

- Query `settings` for `x_posting_config.enabled`.
- Query `cron.job` for `x-poster-tick`.
- Query recent `pipeline_events` for new duplicate `x_post completed` pairs.

### Phase 1: Database Claim Contract

Purpose: add an atomic, inspectable claim before any external X side effect.

Recommended design:

Add claim metadata to `public.x_deliveries` rather than creating a second claim table, so the delivery ledger stays the source of truth.

Proposed columns:

- `claim_token uuid`
- `claim_source text`
- `claim_started_at timestamptz`
- `claim_expires_at timestamptz`
- `claim_released_at timestamptz`
- `claim_release_reason text`
- `next_retry_at timestamptz`
- `last_claim_error text`

Proposed status semantics:

- `posting`: active in-flight claim that may call X.
- `posted`: completed successful X post.
- `failed`: terminal or manually retryable failure.
- `skipped`: terminal skip decision.
- `pending`: reserved for future queued retry if implemented; do not use as the in-flight lock without tightening all candidate queries.

Indexes and constraints:

- Keep `uq_x_deliveries_post_posted`.
- Add a partial unique index that prevents another active or successful claim:
  - `UNIQUE (post_id) WHERE status IN ('posting', 'posted')`
- Add an expiry index:
  - `(claim_expires_at) WHERE status = 'posting'`
- Add a status check constraint only after confirming all existing statuses are in the allowed set.

RPCs:

1. `public.claim_x_post_delivery(p_post_id text, p_source text, p_force_retry boolean default false, p_claim_ttl_seconds integer default 600)`
   - Returns: `claimed boolean`, `delivery_id uuid`, `claim_token uuid`, `reason text`, `existing_status text`, `existing_x_tweet_id text`.
   - Must be `SECURITY DEFINER`, `service_role` only.
   - Must normalize empty inputs and reject missing `post_id`.
   - Must release expired `posting` rows before attempting a new claim.
   - Must return `already_posted` if a posted row exists.
   - Must return `already_posting` if an unexpired posting claim exists.
   - Must not let normal cron/event paths retry `failed` or `skipped` rows.
   - Must allow admin/manual retry of `failed` or selected `skipped` rows only when `p_force_retry = true`.
   - Must insert or update exactly one `posting` row and return its token.
   - Must rely on the partial unique index to resolve concurrent inserts.

2. `public.complete_x_post_delivery(p_delivery_id uuid, p_claim_token uuid, p_x_tweet_id text, p_media_count int, p_media_bytes bigint, p_media_kind text, p_posted_at timestamptz, p_latency_ms int, p_api_response jsonb, p_last_error text)`
   - Updates only when `id`, `claim_token`, and `status = 'posting'` match.
   - Sets `status = 'posted'`, `x_tweet_id`, media fields, `posted_at`, `latency_ms`, response, clears active claim expiry, increments attempts once.
   - Returns `completed boolean`.
   - If `completed = false`, the caller must log `claim_lost_after_x_api` because the external post may already be public.

3. `public.fail_x_post_delivery(p_delivery_id uuid, p_claim_token uuid, p_status text, p_error text, p_api_response jsonb, p_next_retry_at timestamptz default null)`
   - Updates only matching active claim.
   - For non-retriable failures, set `failed`.
   - For quota/media/dedupe skips, set `skipped`.
   - For retriable X API failures, choose one product policy:
     - Phase 1 conservative: set `failed` with `skip_reason = 'x_api_retriable'` and require manual retry.
     - Phase 2 automatic retry: set `pending` with `next_retry_at`, and update `get_x_post_candidates`/claim RPC to safely re-claim due pending rows.

Migration acceptance criteria:

- Concurrent `claim_x_post_delivery` calls for the same `post_id` produce exactly one `claimed = true`.
- Already posted rows cannot be claimed, even by admin retry.
- Expired `posting` rows can be reclaimed after TTL.
- Failed/skipped rows can only be retried through explicit manual retry semantics.
- All grants are limited to `service_role`; browser/authenticated users do not get direct RPC access.

### Phase 2: Refactor `x-poster` Around Claim Ownership

Purpose: move the idempotency boundary before media upload and `postTweet(...)`.

Tasks:

- Add a small internal helper in `supabase/functions/x-poster/index.ts`:
  - `claimXPost(...)`
  - `completeXPostClaim(...)`
  - `failXPostClaim(...)`
- Call `claim_x_post_delivery` after cheap preconditions and before:
  - rendered video preference that can enqueue side effects;
  - media upload to X;
  - `postTweet(...)`.
- Skip with clear result when claim is not acquired:
  - `already_posted`
  - `already_posting`
  - `previous_x_failed`
  - `previous_x_skipped`
  - `claim_conflict`
- Keep dry-run non-mutating:
  - no claim row;
  - return a `claim_state` diagnostic if easy to fetch read-only.
- Replace the post-success "look up existing posted and update it" behavior with token-checked completion.
- On any path after claim acquisition that exits before X API call, release/fail/skip the claim explicitly.
- On X API success but claim completion failure, insert a high-severity `pipeline_events` row and capture to Sentry if configured.
- On X API failure, token-fail the claim. Avoid leaving unbounded `posting` rows.

Important sequencing:

- Keep duplicate gate, enrichment, hydration, and obvious media readiness checks before claim when they are cheap and side-effect-free.
- Acquire the claim before expensive/external side effects such as uploading media to X or posting the tweet.
- Re-check duplicate state after claim acquisition if the claim wait/retry path can be delayed.

Acceptance criteria:

- Overlapping cron and event invocations for one eligible `post_id` result in one `posted` row and one external X API call in tests.
- A second invocation returns `already_posting` or `already_posted`, not `posted`.
- Existing behavior for normal eligible posts remains unchanged from the user perspective.
- Manual retry cannot post when a `posted` row already exists.

### Phase 3: Candidate Query And Dispatch Policy Hardening

Purpose: make selection and dispatch consistent with the new claim contract.

Tasks:

- Update `get_x_post_candidates` to exclude active `posting` rows and posted rows.
- Decide how to handle `pending`:
  - if Phase 1 does not implement automatic retry, avoid generating `pending` rows from `x-poster`;
  - if automatic retry is implemented, include only due pending rows through an explicit retry path.
- Update the TypeScript fallback query in `x-poster` to mirror the RPC logic.
- Add a latest-status guard that skips `posted` for all paths, including forced/admin paths.
- Update `dispatchXPosterForTarget` only if needed:
  - keep target dispatch if product wants fast post-release posting;
  - remove or debounce it only if product chooses cron-only behavior for simplicity.
- Keep cron enabled after the claim fix because overlap should be safe.

Acceptance criteria:

- RPC and fallback queries agree on terminal and active X delivery states.
- Admin retry behavior is explicit and tested.
- Cron/event overlap is harmless without disabling either path.

### Phase 4: Tests

Purpose: prove the race is fixed before deployment.

Add or update tests:

1. `supabase/functions/x-poster/xPosterIdempotency.test.ts` or equivalent.
   - Mock Supabase calls, `postTweet`, and media upload boundaries.
   - Simulate two invocations on the same `post_id`:
     - cron wins, event skips;
     - event wins, cron skips;
     - admin retry cannot bypass posted.
   - Assert only one `postTweet` call happens.

2. Migration/RPC SQL tests where feasible.
   - Prefer Supabase local DB tests if the repo's Deno/Supabase test harness supports it.
   - At minimum, include SQL snippets in the migration PR description for:
     - two claim calls, one wins;
     - complete only with valid token;
     - expired claim reclaimed;
     - posted row blocks claim.

3. Existing adjacent tests to update:
   - `supabase/functions/admin-actions/xPostingActions.test.ts`
   - `supabase/functions/worker/videoRenderWorkflow.test.ts`
   - monitoring/dashboard tests if new statuses are surfaced.

4. Regression query tests in scripts/docs:
   - Add a read-only SQL check to the release-state or runbook:
     - count rows where `x_deliveries.attempts > 1`;
     - count subjects with more than one `x_post completed` in a selected window;
     - count stale `posting` claims.

Required validation commands:

```bash
npm run lint
npm run check:function-inventory
npm run lint:functions
npm run check:functions
npm run test:functions
npm run check:strict
npm test
DEPLOY_FUNCTIONS_DRY_RUN=1 ./scripts/deploy-functions.sh x-poster worker admin-actions
```

If migration tests require local Supabase:

```bash
npx supabase db reset
npx supabase test db
```

Use the local equivalent only if this repo already supports it. Do not invent a fragile migration test harness in the same fix unless necessary.

### Phase 5: Monitoring And Admin Visibility

Purpose: catch duplicate risk and stale claims before users see it on X.

Tasks:

- Add dashboard or admin summary fields:
  - `x_duplicate_completed_events_24h`
  - `x_double_attempt_rows_24h`
  - `x_active_claims`
  - `x_stale_claims`
  - `x_claim_conflicts_24h`
- Add a Monitoring detail timeline entry for:
  - claim acquired;
  - claim skipped because already posting;
  - claim skipped because already posted;
  - claim completion failed after X API success.
- Consider adding a small admin action to release a stale claim only if the claim is expired and no posted row exists.
- Update `docs/operations/runbooks.md` with a short "Duplicate X post risk" section:
  - evidence query;
  - mitigation;
  - how to distinguish active claim vs historical duplicate;
  - when to manually delete public duplicates from X.

Acceptance criteria:

- Operators can answer "are duplicates happening now?" from DB/dashboard evidence.
- Stale active claims are visible.
- Claim conflicts are treated as normal idempotency events, not hidden errors.

### Phase 6: Release And Deployment

Purpose: deploy without migration/function mismatch.

Release sequence:

1. Implement on a feature branch.
2. Run local validation.
3. Open PR and wait for CI.
4. Merge to `main`.
5. Pull clean `main`.
6. Run:
   ```bash
   npm run check:release-state
   ```
7. Apply the reviewed migration.
8. Deploy selected functions:
   ```bash
   ./scripts/deploy-functions.sh x-poster worker admin-actions
   ```
   Include `admin-actions` only if dashboard/admin diagnostics changed.
9. Re-run:
   ```bash
   npm run check:release-state
   ```
10. Run live smoke checks:
   - `x-poster-tick` still succeeds in `cron.job_run_details`.
   - one eligible post can claim and post once.
   - overlapping manual dry-run/cron cannot duplicate.
   - no stale `posting` claim remains after a normal post.
11. Record release ledger entry in `docs/operations/release-runbook.md`.

Rollback:

- Function rollback can use the prior Git SHA and `DEPLOY_ALLOW_NON_MAIN=1` per the runbook.
- Migration rollback should prefer a forward-fix migration.
- If a bad claim migration blocks posting, immediate mitigation is:
  - disable `x_posting_config.enabled`;
  - deploy a forward fix to claim RPC/function code;
  - do not manually drop constraints unless the SQL has been reviewed.

## Task Backlog

### Database

- Create a migration for claim columns, partial unique active/posted index, expiry index, grants, and RPCs.
- Add SQL comments explaining claim semantics.
- Backfill only metadata-safe defaults; do not alter historical posted rows except nullable claim fields.
- Decide whether to enforce a status check in the same migration or a follow-up migration after production status audit.

### Edge Function

- Refactor `x-poster` into claim-acquire, side-effect, claim-complete/fail phases.
- Remove post-success update of an existing posted row as the normal duplicate path.
- Ensure every exit after claim acquisition resolves the claim.
- Keep dry-run read-only.
- Add Sentry/pipeline event for claim completion failure after X success.

### Worker And Admin Actions

- Preserve worker target dispatch but let DB claim handle overlap.
- Ensure admin `retry_x_post` sends an explicit retry flag and cannot bypass posted.
- Update diagnostics to show claim state and already-posted protection.

### Monitoring And Docs

- Add duplicate-risk and stale-claim queries to dashboard/admin summaries or release-state tooling.
- Update runbooks and release checklist.
- Add incident SQL snippets for duplicate X post RCA.

### Tests

- Add dedicated x-poster idempotency tests.
- Update admin retry tests.
- Update dashboard/monitoring tests if UI/API payload changes.
- Add SQL/RPC concurrency coverage where practical.

## Acceptance Criteria

### Functional

- Same `post_id` cannot produce two X API tweet-create calls during overlapping cron/event/admin invocations.
- Manual retry never posts an already-posted `post_id`.
- Normal cron and target event dispatch continue to work.
- Failed/skipped retry semantics are explicit and documented.
- Dry-run remains non-mutating.

### Data

- `x_deliveries` contains durable claim state before X API side effects.
- No more `attempts = 2` caused by duplicate successful X posts.
- Claim completion is token-checked.
- Stale claim recovery is bounded by TTL and visible in monitoring.

### Operations

- Operators can query:
  - duplicate completed X events;
  - active/stale claims;
  - claim conflicts;
  - double-attempt rows.
- Release runbook covers migration plus function deploy ordering.
- Rollback path is documented.

### Product Quality

- The fix prevents embarrassing duplicate public posts rather than merely hiding duplicate DB rows.
- Fast posting after video render remains possible.
- The admin dashboard can explain why an item did not post: already posted, already posting, skipped, failed, retry blocked, or claim conflict.

## Validation Plan

### Local Code Validation

Run:

```bash
npm run lint
npm run check:function-inventory
npm run lint:functions
npm run check:functions
npm run test:functions
npm run check:strict
npm test
```

### Function Deploy Preflight

Run from clean `main` after merge:

```bash
DEPLOY_FUNCTIONS_DRY_RUN=1 ./scripts/deploy-functions.sh x-poster worker admin-actions
```

### Live Read-Only Pre/Post Queries

Baseline before deploy:

```sql
WITH pe AS (
  SELECT subject_id, count(*) FILTER (WHERE status = 'completed') AS completed_events
  FROM public.pipeline_events
  WHERE step = 'x_post'
    AND created_at >= now() - interval '24 hours'
  GROUP BY subject_id
)
SELECT
  count(*) FILTER (WHERE xd.attempts > 1) AS rows_attempts_gt_1_24h,
  count(*) FILTER (WHERE coalesce(pe.completed_events, 0) > 1) AS rows_completed_events_gt_1_24h,
  count(*) AS posted_rows_24h
FROM public.x_deliveries xd
LEFT JOIN pe ON pe.subject_id = xd.post_id
WHERE xd.status = 'posted'
  AND xd.created_at >= now() - interval '24 hours';
```

After deploy:

```sql
SELECT count(*) AS active_claims
FROM public.x_deliveries
WHERE status = 'posting';

SELECT count(*) AS stale_claims
FROM public.x_deliveries
WHERE status = 'posting'
  AND claim_expires_at < now();

SELECT subject_id, count(*) AS completed_x_posts
FROM public.pipeline_events
WHERE step = 'x_post'
  AND status = 'completed'
  AND created_at >= now() - interval '24 hours'
GROUP BY subject_id
HAVING count(*) > 1;
```

### Live Behavioral Smoke

- Let one eligible post flow through normally.
- Confirm exactly one `x_deliveries` row reaches `posted`.
- Confirm exactly one `x_post completed` event for that `post_id`.
- Confirm duplicate claim attempts, if any, are `already_posting` or `already_posted`.
- Confirm `x-poster-tick` continues succeeding in `cron.job_run_details`.

## Risks And Dependencies

- Migration/function ordering risk: if function code expects claim RPC before migration is applied, posting can fail. Deploy migration before function code.
- Stale claim risk: Edge Function crash after claim but before completion can block posting until TTL. Mitigate with clear TTL and stale-claim monitoring.
- Retry behavior risk: changing retriable X API failure behavior can reduce automatic retry. Decide Phase 1 conservative vs Phase 2 automatic retry explicitly.
- UI compatibility risk: new `posting` status may require dashboard normalization.
- Historical duplicate cleanup risk: public duplicate X tweets are external state. Do not delete automatically.
- Supabase CLI transient auth: earlier parallel CLI reads hit temporary-role auth retries. Use sequential DB queries for release checks.

## Implementation Orchestrator Handoff

Recommended first implementation slice:

1. Create the migration for claim columns, partial active/posted unique index, and claim/complete/fail RPCs.
2. Add focused database/RPC tests or reviewed SQL verification snippets.
3. Refactor `x-poster` to acquire claim before X media upload/posting and complete/fail by token.
4. Add x-poster idempotency unit tests that simulate overlapping cron/event calls.

Phase order and dependency constraints:

- Database claim contract comes before `x-poster` refactor.
- `x-poster` refactor comes before admin/dashboard polish.
- Monitoring can land with or after the core fix, but live release should include at least read-only duplicate/stale-claim queries.
- Do not deploy new `x-poster` code before production has the claim RPC.

Likely files to change:

- `supabase/migrations/<timestamp>_x_post_claim_idempotency.sql`
- `supabase/functions/x-poster/index.ts`
- `supabase/functions/admin-actions/xPostingActions.ts`
- `supabase/functions/admin-actions/monitoringReads.ts`
- `supabase/functions/admin-actions/dashboardSummaries.ts`
- `supabase/functions/admin-actions/xApiSummary.ts`
- `supabase/functions/worker/videoRenderWorkflow.test.ts`
- new or existing `supabase/functions/x-poster/*.test.ts`
- `docs/operations/runbooks.md`
- `docs/operations/release-runbook.md`
- maybe `scripts/check-release-state.sh`

Allowed changes:

- Add a database-backed X post claim contract.
- Refactor `x-poster` around claim ownership.
- Tighten admin retry semantics for already-posted rows.
- Add operational metrics and docs.

Disallowed changes:

- Do not delete or mutate historical public duplicate posts.
- Do not refactor unrelated duplicate-gate/story-memory scoring.
- Do not disable cron as the permanent fix.
- Do not weaken internal auth or expose claim RPCs to browser users.
- Do not patch `dist/`.

Required skills/tools for implementation:

- Use local repo instructions and release runbook.
- Use Codegraph for targeted impact checks before editing.
- Use Supabase CLI for read-only live checks and migration history checks.
- Use Deno/Vitest validation commands listed above.

Open questions that block implementation:

- Should Phase 1 preserve automatic retries for retriable X API failures, or should retriable X failures become manual retry until Phase 2?
- Should `posting` status be surfaced in the dashboard immediately, or normalized as pending/in progress for the first release?

Open questions that can be resolved during execution:

- Exact claim TTL, recommended starting value `600` seconds.
- Exact dashboard metric naming.
- Whether to add status check constraint in the first migration or after one production status audit.

Stop conditions:

- Stop if migration history drift appears in `supabase migration list --linked`.
- Stop if current live schema differs from local assumptions about `x_deliveries`.
- Stop if tests show any path can call `postTweet` without an owned claim.
- Stop if admin retry can still post an already-posted `post_id`.

Do not claim complete until:

- Local validation passes.
- Migration and selected functions are deployed from clean `main`.
- Live post-release queries show no new duplicate completed X events.
- At least one eligible post or controlled dry-run/claim scenario proves claim behavior in production.
- Release ledger records migration/function versions, checks, rollback target, and smoke timestamp.

The implementation orchestrator should turn the chosen first slice into its own goal, run implementation and validation cycles, and continue until the slice acceptance criteria are satisfied or explicitly blocked.
