
# Remaining Tasks — Final Rounds Plan

## Completed So Far
- Rounds 1, 2, 3, 5, 6, 7, A (partial) are done
- Issues marked done: 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 19, 20, 21, 22, 24, 25, 26, 27, 28, 29, 30, 31, 32, 35, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 50

## Round A Status
- **Issue 14** ✅ — Migration created for telegram analytics tables, views, indexes, RLS. Views set to `security_invoker = on`.
- **Issue 15** ✅ — Types already reflect schema (types.ts is auto-generated from live DB).
- **Issue 24** ✅ — Fixed `let→const`, unused expressions, `as const` lint errors. Remaining warnings are in auto-generated shadcn UI components (not actionable).
- **Issue 42** ✅ — Confirmed no `select('*')` in codebase.
- **Issue 48** ✅ — `src_url_hash` now generated via SHA-256 in `webhooks-rssapp` and `worker` when inserting media rows. `media-processor` already uses it for dedup during download.

---

## Remaining Items (10 tasks across 2 rounds)

### Round B: Tooling & Package Hygiene (4 items)

**Issue 49** — Add `"packageManager": "npm@10.8.2"` to `package.json`. Add `bun.lockb` to `.gitignore`.

**Issue 51** — Test infrastructure.
- Install `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`.
- Create `vitest.config.ts` and a `src/test/setup.ts`.
- Write basic tests for auth guard logic and settings validation.

**Issue 52** — Dependency audit. Run `npm audit`, note any actionable upgrades.

**Issue 53** — Pre-commit hooks.
- Install `husky` + `lint-staged`. Configure to run `eslint` and `tsc --noEmit` on staged files.

### Round C: Documentation & Remaining Hardening (6 items)

**Issue 16** — Update `docs/todo_monitoring.md` to reflect shipped state.

**Issue 23** — Add `dry_run` support to `media-processor`.

**Issue 33** — Add structured JSON logging to `admin-retry` and `media-cleanup`.

**Issue 34** — Document alert thresholds in `runbooks.md`.

**Issue 54** — Rewrite `README.md` with project architecture.

**Issue 55** — Expand `docs/operations/` with prompt management, secret rotation, incident response.

---

## Execution Plan

| Round | Scope | Items |
|-------|-------|-------|
| B | Tooling | 49, 51, 52, 53 |
| C | Docs & hardening | 16, 23, 33, 34, 54, 55 |

### Out of scope (manual/external)
- **Issue 1** (Git history scrub): requires `git filter-branch` or BFG outside Lovable.
- **Issue 34** (alerting implementation): depends on external monitoring service. Doc thresholds only.
- **Issue 36** (staging environment): operational task.

### Infrastructure warnings (user action)
- Leaked password protection: enable in Supabase Auth settings.
- Postgres version: upgrade via Supabase dashboard.
