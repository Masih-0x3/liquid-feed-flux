# Backup & Restore

## Database Backups
Supabase provides daily automatic backups on paid plans. For free tier:
- Use `pg_dump` via the connection string for manual backups
- Schedule via cron on an external server

## Storage Backups
The `temp-media` bucket stores downloaded media temporarily (7-day retention).
Media is intentionally ephemeral — originals are on Twitter/source platforms.

## Restore Process
1. Restore database from Supabase dashboard backup or `pg_restore`
2. Re-deploy edge functions: `supabase functions deploy`
3. Verify cron jobs are active in Supabase Dashboard
4. Test pipeline end-to-end: Dashboard → Test Pipeline

## Recovery Time Objectives
- Database: ~15 minutes (from Supabase backup)
- Edge Functions: Instant (auto-deployed from repo)
- Media: Non-critical (re-downloaded on demand)
