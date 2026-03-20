
# Remaining Tasks — Final Rounds Plan

## Completed So Far
- Rounds 1, 2, 3, 5, 6, 7, A, B are done
- Issues marked done: 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 19, 20, 21, 22, 24, 25, 26, 27, 28, 29, 30, 31, 32, 35, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53

## Round A Status
- **Issue 14** ✅ — Migration created for telegram analytics tables, views, indexes, RLS. Views set to `security_invoker = on`.
- **Issue 15** ✅ — Types already reflect schema (types.ts is auto-generated from live DB).
- **Issue 24** ✅ — Fixed `let→const`, unused expressions, `as const` lint errors. Remaining warnings are in auto-generated shadcn UI components (not actionable).
- **Issue 42** ✅ — Confirmed no `select('*')` in codebase.
- **Issue 48** ✅ — `src_url_hash` now generated via SHA-256 in `webhooks-rssapp` and `worker` when inserting media rows. `media-processor` already uses it for dedup during download.

## Round B Status
- **Issue 49** ✅ — Added `"packageManager": "npm@10.8.2"` to `package.json`. `bun.lockb` already in `.gitignore`.
- **Issue 51** ✅ — Installed vitest, @testing-library/react, @testing-library/jest-dom, jsdom. Created `vitest.config.ts`, `src/test/setup.ts`. Wrote auth guard + settings validation tests (6 tests passing). Added `test` and `test:watch` scripts. Updated CI to run tests.
- **Issue 52** ✅ — `npm audit` clean: no high/critical vulnerabilities.
- **Issue 53** ✅ — Installed husky + lint-staged. Pre-commit hook runs `eslint --fix` and `tsc --noEmit` on staged `.ts/.tsx` files.

---

## Remaining Items (6 tasks, Round C)

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
