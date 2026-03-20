
# Remaining Tasks — Final Rounds Plan

## Completed So Far
- Rounds 1, 2, 3, 5, 6, 7, A, B, C are done
- Issues marked done: 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55

## Round A Status
- **Issue 14** ✅ — Migration created for telegram analytics tables, views, indexes, RLS. Views set to `security_invoker = on`.
- **Issue 15** ✅ — Types already reflect schema (types.ts is auto-generated from live DB).
- **Issue 24** ✅ — Fixed `let→const`, unused expressions, `as const` lint errors.
- **Issue 42** ✅ — Confirmed no `select('*')` in codebase.
- **Issue 48** ✅ — `src_url_hash` generated via SHA-256 in `webhooks-rssapp` and `worker`.

## Round B Status
- **Issue 49** ✅ — Added `"packageManager": "npm@10.8.2"` to `package.json`.
- **Issue 51** ✅ — Vitest + React Testing Library installed. 6 tests passing. CI updated.
- **Issue 52** ✅ — `npm audit` clean: no high/critical vulnerabilities.
- **Issue 53** ✅ — Husky + lint-staged configured for pre-commit hooks.

## Round C Status
- **Issue 16** ✅ — Rewrote `docs/todo_monitoring.md` from planning doc to shipped architecture reference.
- **Issue 23** ✅ — Added `dry_run` support to `media-processor` `download_media` action. Returns `would_download` count and media IDs without downloading.
- **Issue 33** ✅ — Structured JSON logging added to `admin-retry` (action entry + error) and `media-cleanup` (invoke error detail + result counts).
- **Issue 34** ✅ — Alert thresholds documented in `runbooks.md` with warning/critical levels for queue depth, failure rate, latency, DLQ, and storage.
- **Issue 54** ✅ — Rewrote `README.md` with project purpose, architecture diagram, edge function inventory, local setup, secrets, scripts, CI/CD.
- **Issue 55** ✅ — Expanded `docs/operations/runbooks.md` with alert thresholds table, DLQ incident response, and `reconcile_stuck_jobs` guidance. Prompt/secret rotation/cleanup docs were already present.

---

## Execution Plan

| Round | Scope | Items | Status |
|-------|-------|-------|--------|
| A | Schema, lint, dedup | 14, 15, 24, 42, 48 | ✅ Done |
| B | Tooling | 49, 51, 52, 53 | ✅ Done |
| C | Docs & hardening | 16, 23, 33, 34, 54, 55 | ✅ Done |

**All planned issues are resolved.** 🎉

### Out of scope (manual/external)
- **Issue 1** (Git history scrub): requires `git filter-branch` or BFG outside Lovable.
- **Issue 36** (staging environment): operational task.

### Infrastructure warnings (user action)
- Leaked password protection: enable in Supabase Auth settings.
- Postgres version: upgrade via Supabase dashboard.
