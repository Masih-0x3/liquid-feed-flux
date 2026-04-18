

## Plan: "X Automation" Settings Tab

### Goal
Add a new **X Automation** tab in `/settings` that consolidates everything related to the Twitter/X integration in one place: credential status, API usage, hydration toggle, and a test-tweet console for verifying the pipeline works end-to-end.

Currently this is scattered across the **Digest** tab (credential note, hydration toggle, usage cards) and missing key pieces (no way to send a test tweet, no way to verify creds without running a digest dry-run).

---

### What the new tab will contain

The tab will have 4 cards, top to bottom:

**1. Credentials & Connection Status**
- Visual status badges for the four required Supabase secrets: `TWITTER_CONSUMER_KEY`, `TWITTER_CONSUMER_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_TOKEN_SECRET`
- "Configured ✓" / "Missing ✗" badge per secret (we cannot read the values, only check existence — done via a new lightweight admin-action `get_x_status` that returns booleans)
- "Verify connection" button → calls X API v2 `GET /2/users/me` via a new admin-action `x_verify_credentials` and shows the authenticated handle + permission level (read vs read+write)
- Help text explaining secrets are managed in Supabase Edge Function settings (link out)

**2. Tweet Hydration**
- Move the existing "Hydrate truncated tweets" toggle here from the Digest tab
- Move the X API usage stats cards (24h calls, total, last call, last error) here
- Add a **monthly projection card**: estimated calls/month based on last 24h × 30, with a colored warning when projected > 15K (Basic tier limit)

**3. Test Tweet Console**
- A textarea (max 280 chars, with live counter) prefilled with a default test message
- Optional "Reply to tweet ID" input (so test stays out of public timeline if desired)
- Two buttons:
  - **"Send test tweet"** → posts via X API using the same OAuth 1.0a signing the worker/digest uses
  - **"Dry run (don't post)"** → just validates credentials and shows the signed request preview
- Result panel showing: success/failure, posted tweet ID + link, response body, error details
- Backend: new admin-action `send_test_tweet` in `admin-actions/index.ts` that reuses the OAuth signing helper
- Safeguard: rate-limited to 1 test tweet per minute per admin (in-memory), and validation rejects empty / >280 char text

**4. Hydration Test**
- Input for a tweet ID + button **"Test hydrate"** that calls the X API `GET /2/tweets/:id?tweet.fields=note_tweet` and shows the full text returned, without writing to DB
- Lets you verify the hydration pipeline can actually reach long tweets before relying on it for live posts
- Backend: another admin-action `test_hydrate_tweet`

---

### Files to change

**Frontend**
- `src/pages/Settings.tsx`
  - Add 7th `TabsTrigger` "X Automation" with a `Twitter`/`AtSign` icon
  - Change `grid-cols-6` → `grid-cols-7`
  - Add new `<TabsContent value="x-automation">` with the 4 cards above
  - Remove the hydration card and credential note from the Digest tab (they move here)
- `src/components/settings/XAutomationSettings.tsx` *(new)* — extract the tab body into its own component to keep `Settings.tsx` from growing further. Owns local state for test-tweet text, results, loading flags.
- `src/hooks/useSettingsData.ts` — add a small `useXAutomation()` hook exporting mutations: `verifyCredentials`, `sendTestTweet`, `testHydrate`, `getCredentialStatus`. All go through `supabase.functions.invoke('admin-actions', ...)`.

**Backend**
- `supabase/functions/admin-actions/index.ts` — add 4 new actions inside the existing switch:
  - `get_x_status` → returns `{ has_consumer_key: boolean, has_consumer_secret: boolean, has_access_token: boolean, has_access_token_secret: boolean }` based on `Deno.env.get(...)` checks (no values returned)
  - `x_verify_credentials` → calls `GET https://api.x.com/2/users/me` with OAuth 1.0a, returns `{ ok, handle, id, scopes_hint }` or error
  - `send_test_tweet` → Zod-validates `{ text: string(1..280), in_reply_to_tweet_id?: string }`, posts to `POST https://api.x.com/2/tweets`, returns the created tweet payload
  - `test_hydrate_tweet` → Zod-validates `{ tweet_id: string }`, calls `GET /2/tweets/:id?tweet.fields=note_tweet,text,lang`, returns the response without DB writes
  - All four reuse a small OAuth 1.0a helper extracted from the existing pattern in `worker/index.ts` (we'll inline it inside `admin-actions/index.ts` — no shared file, same approach the codebase already uses)

**No DB changes.** No new migrations. No new secrets (we use the four already-required `TWITTER_*` Supabase secrets).

---

### Anti-breakage guarantees
- Digest tab keeps working — only the hydration & credential cards move; the digest preferences card and dry-run console stay
- All new backend actions are admin-gated through the existing `requireAdmin` helper in `admin-actions`
- Test-tweet uses the same OAuth helper signature as the digest poster, so if digests work, test tweets work
- No changes to the worker, the hydration pipeline, or any RPC

### Risks / notes
- **A real test tweet posts to your live X account.** The button will have a confirmation dialog with the exact text being sent before posting.
- Verify-credentials and test-hydrate both consume 1 X API call each — counted toward your monthly Basic-tier quota and recorded in `x_api_usage`.
- If `TWITTER_*` secrets aren't set, the Credentials card surfaces this clearly instead of failing silently.

