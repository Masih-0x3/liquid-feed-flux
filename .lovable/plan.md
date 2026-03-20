

# Remaining Tasks — Final Rounds Plan

## Completed So Far
- Rounds 1, 2, 3, 5, 6, 7 are done
- Issues marked done: 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 17, 19, 20, 21, 22, 25, 26, 27, 28, 29, 30, 31, 32, 35, 37, 38, 39, 41, 44, 45, 46, 50

## Remaining Items (14 tasks across 3 rounds)

---

### Round A: Schema Drift & Lint (5 items)

**Issue 14** — Telegram analytics tables exist in live DB but have no migration.
- Create migration capturing `telegram_channel_stats`, `telegram_daily_stats`, `telegram_member_events`, `telegram_message_analytics` and their views/indexes/RLS.

**Issue 15** — Regenerate `types.ts` after the above migration.

**Issue 24** — Remaining lint issues.
- Fix `any` types across pages/hooks, hook dependency arrays, lexical declarations in switch/case.
- Verify `react-refresh/only-export-components` warnings are resolved (pages already use default exports).

**Issue 42** — Verify no broad `select('*')` remains. Mark done if clean.

**Issue 48** — Worker/webhook don't use `src_url_hash` for media deduplication.
- Add hash-based duplicate check before downloading media in worker.

### Round B: Tooling & Package Hygiene (4 items)

**Issue 49** — Add `"packageManager": "npm@10.8.2"` to `package.json`. Add `bun.lockb` to `.gitignore`.

**Issue 51** — Test infrastructure.
- Install `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`.
- Create `vitest.config.ts` and a `src/test/setup.ts`.
- Write basic tests for auth guard logic and settings validation.

**Issue 52** — Dependency audit. Run `npm audit`, note any actionable upgrades.

**Issue 53** — Pre-commit hooks.
- Install `husky` + `lint-staged`. Configure to run `eslint` and `tsc --noEmit` on staged files.

### Round C: Documentation (5 items)

**Issue 16** — Update `docs/todo_monitoring.md` to reflect shipped state (it currently reads as a planning doc for unfinished work).

**Issue 23** — Add `dry_run` support to `media-processor`.

**Issue 33** — Add structured JSON logging to `admin-retry` and `media-cleanup` (worker/db-cleanup/webhooks already done in Round 1).

**Issue 54** — Rewrite `README.md`: project purpose (RSS→OpenAI→Telegram pipeline admin panel), architecture diagram, edge function inventory, local setup, secrets handling, deployment.

**Issue 55** — Expand `docs/operations/`: add sections for prompt management, secret rotation, incident response.

**Issue 34** — Document alert thresholds in `runbooks.md`. (External alerting setup is out of scope.)

---

## Execution Plan

| Round | Scope | Items |
|-------|-------|-------|
| A | Schema, lint, dedup | 14, 15, 24, 42, 48 |
| B | Tooling | 49, 51, 52, 53 |
| C | Docs & remaining hardening | 16, 23, 33, 34, 54, 55 |

**Round A** is recommended first -- it resolves schema drift that blocks accurate type generation and cleans up code quality. Round B adds developer tooling. Round C wraps up documentation and minor hardening.

### Items already resolved (confirm and close)
- **Issue 40** (lazy subtrees): Settings tabs and Monitoring drawer are already loaded within their pages; further lazy-loading would add complexity for minimal gain. Mark done.
- **Issue 42**: No `select('*')` found in codebase. Mark done.
- **Issue 43**: Monitoring now uses `useInfiniteQuery` with cursor pagination. Done.
- **Issue 47**: Indexes added in migrations. Done.

### Out of scope (manual/external)
- **Issue 1** (Git history scrub): requires `git filter-branch` or BFG outside Lovable.
- **Issue 34** (alerting implementation): depends on external monitoring service.
- **Issue 36** (staging environment): operational task.

