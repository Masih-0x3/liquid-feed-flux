

## Plan: Twitter Digest System with UI Configuration

### Summary
Build the complete Twitter Digest feature: database table, edge function, cron job, and a new "Digest" tab in Settings where Twitter API credentials and digest preferences are configured via the existing `settings` table pattern.

### What Changes

**1. Database Migration — `digests` table**

Create `public.digests` with columns: `id`, `period_start`, `period_end`, `post_ids` (text[]), `summary_text`, `twitter_tweet_ids` (text[]), `status` (pending/posted/failed/skipped), `error`, `created_at`. Simple RLS: authenticated users can read, admins can manage (same pattern as all other tables).

**2. Settings UI — New "Digest" tab in Settings page**

Add a 6th tab called "Digest" (icon: Newspaper) to `src/pages/Settings.tsx` with:

- **Twitter API Credentials** — 4 password-type inputs stored in `settings` table under key `digest_config`:
  - Consumer Key, Consumer Secret, Access Token, Access Token Secret
  - Note: These are stored in the `settings` table (admin-only access via RLS), not as Supabase secrets. The edge function will read them from the DB at runtime.

- **Digest Preferences**:
  - Frequency (select: 30min, 1hr, 2hr, 4hr)
  - Max bullet points (number input, default 10)
  - Min posts to trigger (number input, default 2)
  - Header format (text input, default "📰 News Digest — {time}")

- Save button using existing `useSaveSettings` mutation

**3. Update `useSettingsData.ts`**

Add `DigestSettings` interface and default values for `digest_config` key. The edge function reads these at runtime.

**4. Edge Function — `supabase/functions/digest-compiler/index.ts`**

Single file implementing:
1. Read `digest_config` from `settings` table (Twitter creds + preferences)
2. Query `posts` from last N minutes where `text_translated IS NOT NULL` and `delivery_decision = 'deliver'`
3. Skip if fewer than min_posts (insert `skipped` digest record)
4. Send to OpenAI for bullet-point summarization (reuses existing `OPENAI_API_KEY` secret)
5. Format into tweet-sized chunks (280 char limit, thread structure)
6. Upload images to Twitter media endpoint via OAuth 1.0a
7. Post thread to X via `POST https://api.x.com/2/tweets`
8. Record result in `digests` table

OAuth 1.0a signature generation implemented inline (HMAC-SHA1).

**5. Config — `supabase/config.toml`**

Add `[functions.digest-compiler]` with `verify_jwt = false`.

**6. Cron Job**

Insert via SQL (not migration): `cron.schedule` to call `digest-compiler` every 30 minutes using `net.http_post`.

### Files Changed/Created

| File | Action |
|------|--------|
| `supabase/migrations/XXXX_create_digests.sql` | Create — digests table + RLS |
| `supabase/functions/digest-compiler/index.ts` | Create — main edge function |
| `supabase/config.toml` | Edit — add digest-compiler entry |
| `src/pages/Settings.tsx` | Edit — add Digest tab with Twitter creds + preferences |
| `src/hooks/useSettingsData.ts` | Edit — add DigestSettings type + defaults |
| Cron SQL (via insert tool) | Insert — 30-min schedule |

### Implementation Order

1. Create `digests` table migration
2. Update `useSettingsData.ts` with digest config types
3. Add Digest tab to Settings page
4. Build `digest-compiler` edge function
5. Update `config.toml`
6. Deploy and set up cron job
7. Test end-to-end

