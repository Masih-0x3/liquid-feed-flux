# XOT Audit Remediation Status

Date: 2026-05-15

This document maps the comprehensive audit findings to the local remediation work. Production still needs the new migrations and Edge Functions deployed, plus live secret rotation where noted.

| ID | Status | Local remediation |
| --- | --- | --- |
| F-01 | Fixed locally | Added `20260515075613_harden_admin_surface.sql` to revoke broad privileged RPC execution, move role checks to `private.has_role`, and route dashboard/status RPC reads through `admin-actions`. |
| F-02 | Fixed locally | Added local `digest-compiler` source and hardened it to require internal auth instead of anon-key or missing-secret bypasses. |
| F-03 | Fixed locally, rotate live secret | `requireRssWebhookAuth` now rejects query-string tokens and only accepts header tokens. Rotate the live RSS webhook token during deployment. |
| F-04 | Fixed locally | Auth loading now waits for role resolution, protected layout blocks unresolved roles, and admin-only RLS policies replace broad authenticated table reads. |
| F-05 | Fixed locally | Migration revokes anon table/view access, sets exposed views to `security_invoker`, and recreates admin-only policies. |
| F-06 | Fixed locally | Added scheduled stale-job reconciliation, stale running job detection without lease markers, reconcile run history, and dashboard health visibility. |
| F-07 | Fixed locally | Added `digest-compiler` source and CI inventory check for local function/config drift. |
| F-08 | Fixed | Supabase client storage is environment-safe and auth tests mock the client; `npm test` exits 0. |
| F-09 | Fixed | Upgraded vulnerable dependencies; `npm audit --audit-level=low` reports 0 vulnerabilities. |
| F-10 | Fixed locally | Admin functions now have JWT verification enabled in config; Edge Function CORS defaults are no longer wildcard. |
| F-11 | Fixed locally | RSS webhook logs now emit structured counts/flags instead of raw payload items, URLs, or content snippets. |
| F-12 | Fixed locally | Header, Settings tabs, Monitoring actions, and My X layout now wrap/scroll on narrow screens. |
| F-13 | Fixed locally | Live pipeline, Telegram test, retry, and X test-post actions now require confirmation with destination/context. |
| F-14 | Fixed locally | Added missing follower snapshot FK indexes, rewrote new/admin policies with `(SELECT auth.uid())`, and dropped the duplicate jobs idempotency index. |
| F-15 | Fixed locally | Recharts is lazy-loaded behind `FollowerGrowthChart`, Settings tab panels are split into lazy chunks, and Downloader proxy resolution moved server-side. The Settings route chunk dropped from ~149 kB raw to ~50 kB raw in the production build. |
| F-16 | Fixed | Supabase runtime URL/key now come from `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. |
| F-17 | Fixed locally | Downloader now resolves fxtwitter/vxtwitter data through authenticated `admin-actions` instead of direct browser proxy calls. |
| F-18 | Fixed | Added Deno lint/type checks for Edge Functions and CI wiring. |
| F-19 | Fixed incrementally | Added strict TypeScript checks for hooks, Supabase integration code, auth contexts, layout components, and the lazy chart component. |
| F-20 | Fixed locally, verify host support | Added CSP enforcement via `index.html` meta policy and a static `public/_headers` policy for hosts that honor header files. Confirm Lovable applies the HTTP header after deployment; the meta tag remains the fallback. |
| F-21 | Fixed locally | Backend version action now requires admin auth and returns only version fields used by the UI. |

## Verification

- `npm run lint` exits 0 with existing Fast Refresh warnings in shared UI exports.
- `npm run check:function-inventory` exits 0.
- `npm run lint:functions` exits 0.
- `npm run check:functions` exits 0.
- `npm run check:strict` exits 0.
- `npm test` exits 0.
- `npm run build` exits 0.
- `npm audit --audit-level=low` exits 0.

## Deployment Notes

1. Apply the new Supabase migrations before deploying the updated frontend that depends on admin-only RPC routing.
2. Deploy all Supabase functions, including the newly added `digest-compiler`.
3. Rotate the RSS webhook secret and update RSS.app to send `x-webhook-token` or `x-rssapp-token`.
4. Set `ALLOWED_CORS_ORIGIN` for Edge Functions if the production app origin differs from `https://liquid-feed-flux.lovable.app`.
