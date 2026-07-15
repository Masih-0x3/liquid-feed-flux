# Vercel Cutover Runbook

This runbook moves XOT frontend hosting from Lovable to Vercel while keeping the
existing Supabase project `jzirqfzzvlbxwfzndaer` as the production backend.

## Vercel Project

1. Import `Masih-0x3/liquid-feed-flux` into Vercel.
2. Use the Vite framework preset.
3. Use `npm ci` as the install command.
4. Use `npm run build` as the build command.
5. Use `dist` as the output directory.
6. Keep the committed `vercel.json`; it rewrites SPA routes to `index.html`.
7. Set Node.js to 24.x. The app supports Vite 8's Node range (`^20.19.0 || >=22.12.0`), while CI and the current Vercel project use Node 24.

## Vercel Environment

Set these variables for Production and Preview:

| Variable | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://jzirqfzzvlbxwfzndaer.supabase.co` |
| `VITE_SUPABASE_PROJECT_ID` | `jzirqfzzvlbxwfzndaer` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Current Supabase anon/publishable key |

Do not commit `.env`. A production build fails when these values are missing or
left as placeholders.

## Supabase Updates

Current production frontend URL: `https://xot.vercel.app`.

1. Supabase Auth -> URL Configuration:
   - Set Site URL to `https://xot.vercel.app` or the final custom domain.
   - Add `https://xot.vercel.app/**` as an allowed redirect URL.
   - Add any preview URL pattern used for testing, for example `https://xot-*-masihation-8914s-projects.vercel.app/**`.
2. Supabase Edge Function Secrets:
   - Set `ALLOWED_CORS_ORIGIN` to `https://xot.vercel.app`.
   - If a custom domain replaces the Vercel URL, update this value again.
3. Keep existing Edge Function secrets, cron jobs, RSS.app webhook, Telegram, OpenAI, and X settings unchanged.

## Verification

Before closing Lovable:

1. Confirm Vercel loads `/`, `/auth`, `/monitoring`, `/settings`, `/x-account`, `/downloader`, `/threads`, and a not-found route.
2. Refresh directly on `/monitoring`; it must not 404.
3. Log in with the existing Supabase admin account.
4. Confirm Dashboard and Monitoring can invoke `admin-actions`.
5. Confirm the browser console has no startup config errors.
6. Confirm Dashboard and Monitoring page loads do not trigger X API calls.
7. Keep Lovable active until Vercel production passes these checks.

## Rollback

If Vercel fails after cutover, restore the previous frontend DNS or public URL
temporarily, then update Supabase Auth/CORS back to that origin while the Vercel
issue is corrected.
