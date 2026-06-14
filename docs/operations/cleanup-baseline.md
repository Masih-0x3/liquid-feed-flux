# XOT Cleanup Baseline

Checked at: 2026-06-14

Workspace:

- Path: `/Users/stevmq/.config/superpowers/worktrees/Finalized-XOT/xot-cleanup`
- Branch: `codex/xot-cleanup-00-baseline`
- Base: `origin/main`
- HEAD: `5d351a9db81809fac4e668c5d03f298f03647808`
- Main working checkout preserved at `/Users/stevmq/Finalized XOT`

Runtime used for this baseline:

- Node: `v22.22.3`
- npm: `10.9.8`
- Root package declares Node `20.x`; this mismatch is a pre-existing runtime hygiene finding for the later dependency/runtime phase.

Install baseline:

- `npm ci`: passed.
- `npm --prefix services/video-renderer ci`: passed.
- Root install reported 8 audit findings.
- Video renderer install reported 0 audit findings.

Validation baseline:

| Command | Result | Notes |
| --- | --- | --- |
| `npm run lint` | Passed | 8 existing Fast Refresh warnings in UI/Auth files. |
| `npm run check:function-inventory` | Passed | `Supabase function inventory OK: 10 functions`. |
| `npm run lint:functions` | Passed | Deno lint checked 42 files. |
| `npm run check:functions` | Passed | Deno checked all configured function entrypoints. |
| `npm run check:strict` | Passed | Strict TypeScript config passed. |
| `npm test` | Passed | 11 files, 46 tests. Existing React Router future-flag warnings. |
| `VITE_SUPABASE_URL=https://jzirqfzzvlbxwfzndaer.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=local-build-validation-key VITE_SUPABASE_PROJECT_ID=jzirqfzzvlbxwfzndaer npm run build` | Passed | Frontend env contract and Vite production build passed. |
| `npm --prefix services/video-renderer test` | Passed | 133 tests. |
| `npm --prefix services/video-renderer audit --audit-level=low` | Passed | 0 vulnerabilities. |
| `npm audit --omit=dev --audit-level=low` | Failed | 3 moderate production dependency findings: `react-router`, `react-router-dom`, `ws`. |
| `npm audit --audit-level=low` | Failed | 8 total findings including Vite/esbuild dev-chain advisories. |

Pre-existing cleanup targets confirmed by baseline:

- Root dependency audit is failing before cleanup work begins.
- Declared Node runtime does not match the active local runtime and previously observed Vercel runtime.
- Monitoring bundle is large: build output reports `Monitoring-CO1ZhL7d.js` at 140.09 kB raw.
- Lint warnings are non-failing Fast Refresh warnings and should not block Phase 1.

Baseline rule:

- Later cleanup branches should not claim responsibility for these pre-existing findings unless they intentionally modify the related dependency, runtime, or UI module.
