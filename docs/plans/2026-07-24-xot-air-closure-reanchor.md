# XOT AIR Closure Re-anchor

Status: program-control evidence, not release approval  
Recorded: 2026-07-24  
Scope: AIR rows not yet represented by an implementation-ledger acceptance,
disproof, preservation, or explicit deferral receipt as of this re-anchor.

The canonical issue definitions remain in
`2026-07-14-xot-comprehensive-audit-remediation-implementation-plan.md`.
This document prevents the remaining rows from being obscured by the many
source-only acceptances already recorded in the append-only ledger.

## Open and gated AIR rows

| AIR | Owning task(s) | Current disposition | Exact next proof or prerequisite |
| --- | --- | --- | --- |
| AIR-002 | BR-TG-01, BR-JOB-01 | Blocked by migration/job ownership foundation | Implement and prove token-fenced job ownership, then use provider-stub concurrency/crash fixtures before any Telegram canary. |
| AIR-012 | BR-X-02 | Blocked by BR-JOB-01 and SR-MIG-01 | Add fenced X claim/reclaim state only after the migration baseline is approved; prove pre/post-call ambiguity handling. |
| AIR-013 | BR-X-02 | Blocked by BR-JOB-01 and SR-MIG-01 | Same claim contract as AIR-012; prove concurrent preparation happens once. |
| AIR-017 | SR-DBPERF-01 | Blocked by database evidence | Capture live advisor output and role-specific plans/metrics before choosing indexes or RLS rewrites. |
| AIR-023 | FE-SCORE-01 | Blocked by scoring data/migration contract | Establish one versioned backend effective-threshold resolver and precedence evidence before changing controls. |
| AIR-024 | FE-SCORE-01 | Blocked by scoring data/migration contract | Same resolver/compatibility cutover as AIR-023; do not remove a control plane until legacy parity is proven. |
| AIR-030 | BR-DASH-01, FE-DASH-01 | Open, not dependency-ready | Define bounded dashboard query/envelope contract and baseline query/payload/paint evidence before component refactoring. |
| AIR-036 | BR-MOD-01, BR-MOD-02, FE-QUALITY-01 | Deferred until correctness stabilizes | Characterize owner hotspots and preserve behavior traces before narrow module extraction. |
| AIR-037 | FE-BUNDLE-01 | Deferred by build/visual proof boundary | Capture auth-route transfer baseline, replace the heavy logo asset, then verify visual parity and budget in a production-like build. |
| AIR-039 | FE-BUNDLE-01 | Deferred by build/route coverage boundary | Establish route chunk baseline and remove/defer only proven admin-only Radix imports; browser/build proof remains required. |
| AIR-048 | FE-VISUAL-01 | Deferred by visual/browser boundary | Change shared glass spacing only with 200% zoom and responsive screenshot proof; server/browser remain off. |
| AIR-052 | SR-SUPPLY-01 | Blocked by external scanner/audit coverage | Run root/renderer production and dev audits, Deno import/checksum review, image/SBOM/license scans, and action-pin review in an approved networked CI lane. |
| AIR-053 | QA-04 | Blocked by authenticated browser access | Run the role/state/route/viewport matrix against a SHA-tied preview after the server/browser boundary is lifted. |
| AIR-054 | BR-MEDIA-02, QA-02 | Deferred to an isolated safe corpus | Validate SSRF defenses only in a no-egress/controlled fixture environment; never target live/internal endpoints. |
| AIR-077 | FE-MEDIA-01, SR-REL-01, QA-05 | Blocked by deployed header evidence | Inspect post-deploy CSP/HSTS/frame/nosniff/referrer headers on the intended release SHA. |
| AIR-079 | BR-JOB-01, BR-TG-01, BR-X-02, BR-RENDER-01, QA-05 | Blocked by runtime/provider evidence | Compare queue/X/render/Telegram invariants before and after an approved canary. |
| AIR-080 | FE-MANUAL-01, FE-DASH-01, FE-DASH-02, FE-MON-01, FE-A11Y-01, FE-BUNDLE-01, QA-05 | Blocked by browser regression matrix | Verify routes, responsive layouts, reduced motion, noopener, confirmation, overflow, and degraded states in the browser. |

## Program order after gates lift

1. Resolve SR-MIG-01 through the protected evidence and no-egress replay
   workflow; preserve the new forward-candidate dossier until owners approve a
   replacement candidate.
2. Land BR-JOB-01 before any Telegram/X claim work.
3. Establish dashboard/scoring backend contracts before frontend performance or
   control-plane cleanup.
4. Run build/browser/supply-chain work in an approved, SHA-tied environment.
5. Perform provider and production receipts only behind explicit canary approval.

## Guardrails retained

- A source-only receipt does not close a database, browser, provider, CI, or
  live AIR row.
- The current server-off boundary prohibits local browser/Vite/Deno validation.
- The historical Supabase PAT alert remains an independent release-security
  follow-up; this re-anchor does not downgrade or close it.
- No migration baseline, historical source, alias, database, provider, or
  deployment state was changed while producing this document.
