## Add "My X" tab — daily follower snapshots & unfollower detection (pay-as-you-go optimized)

### What you'll get

A new sidebar entry **"My X"** at `/x-account` with:
- Current follower count + 7/30-day delta
- **Unfollowers list** — handle, name, avatar, when they unfollowed, profile link
- **New followers list**
- Snapshot history table (date, total, +N / −N, API cost estimate)
- **"Run snapshot now"** button (manual, no daily-cap enforcement) with a confirm dialog showing estimated API cost

### Cost model & API budget

X pay-as-you-go: `GET /2/users/:id/followers` is billed per request, returning up to 1,000 users/page. So for F followers, one full snapshot = `ceil(F / 1000)` API calls.

To keep cost minimal:

1. **Hard cap: 1 automated snapshot per 24h.** Cron triggers at 03:00 UTC; the function checks for an existing snapshot in the last 23h and **exits early** if found. This prevents accidental double-runs (cron retries, redeploys).
2. **Manual runs bypass the cap** but require an explicit click + confirmation showing "this will cost ~N API calls (~F followers ÷ 1000)".
3. **Skip `/users/me` after first run** — cache your X user ID in `settings.x_self_id` permanently; saves 1 call per snapshot forever.
4. **Skip profile hydration unless changed** — only fetch `user.fields=username,name,profile_image_url` for IDs that aren't in `x_followers_cache` OR were last seen >30 days ago. The followers endpoint itself returns these fields inline, so this is effectively free — no extra calls needed.
5. **Snapshot only stores IDs + diffs** — profile metadata is cached separately and re-used across snapshots; we never re-fetch profiles for users we already know.

Net: with F followers, daily cost = exactly `ceil(F / 1000)` calls. No hidden multipliers.

### Architecture

**1. Tables** (migration)

```text
x_follower_snapshots
  id uuid pk
  taken_at timestamptz default now()
  trigger text                    -- 'cron' | 'manual'
  follower_count int
  follower_ids text[]             -- full ID list at snapshot time
  status text                     -- 'complete' | 'partial' | 'failed'
  pages_fetched int
  api_calls_used int
  error text
  created_at timestamptz

x_followers_cache
  user_id text pk
  username text
  name text
  profile_image_url text
  first_seen_at timestamptz
  last_seen_at timestamptz

x_follower_changes
  id uuid pk
  detected_at timestamptz
  user_id text
  username text                   -- snapshot of handle at change time
  name text
  profile_image_url text
  change_type text                -- 'unfollowed' | 'followed'
  prev_snapshot_id uuid
  curr_snapshot_id uuid
```

RLS: admin manage, authenticated read (matches existing tables).

**2. Edge function: `x-followers-snapshot`**

Body: `{ trigger: 'cron' | 'manual' }` (defaults to 'cron').

Logic:
1. If `trigger === 'cron'`: query latest snapshot; if `taken_at > now() - 23h`, return `{skipped: true, reason: 'daily_cap'}` with HTTP 200. **No API call made.**
2. Resolve self ID (cached in `settings.x_self_id`).
3. Insert snapshot row with `status='partial'`, `trigger`, `pages_fetched=0`.
4. Page through `GET /2/users/:id/followers?max_results=1000&user.fields=username,name,profile_image_url` until `next_token` is null.
5. On each page: accumulate IDs, upsert profiles into `x_followers_cache` (cheap DB op, no API).
6. Increment `api_calls_used`, call `recordXApiCall` for dashboard usage tracking.
7. On 429 (rate limit): persist progress in a `jobs` row of type `x_followers_page` with the cursor; worker resumes after the rate window. Snapshot stays `status='partial'`.
8. When complete: set `status='complete'`, then diff vs previous **complete** snapshot:
   - `prev - curr` → unfollowers
   - `curr - prev` → new followers
   - Insert into `x_follower_changes` with cached profile snapshot (so changes survive cache eviction).
9. Return `{snapshot_id, follower_count, api_calls_used, unfollowed: N, followed: M}`.

**3. Cron schedule** (daily, defensive)

```sql
select cron.schedule(
  'x-followers-snapshot-daily', '0 3 * * *',
  $$ select net.http_post(
    url:='https://jzirqfzzvlbxwfzndaer.supabase.co/functions/v1/x-followers-snapshot',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer <anon>"}'::jsonb,
    body:='{"trigger":"cron"}'::jsonb
  ); $$
);
```

The 23h check inside the function is the real guard — cron is just the trigger.

**4. Frontend**

- Add **My X** nav item in `AppSidebar.tsx` (icon: `Users`).
- New route `/x-account` in `App.tsx` → lazy-loaded `pages/XAccount.tsx`.
- Hook `useXAccountData.ts` querying latest snapshot, last 30 snapshots, recent changes (default filter: unfollowed, last 30d).
- Components:
  - `XAccountOverview.tsx` — KPIs: current count, 24h/7d/30d Δ, last snapshot time, **next automated run**, total API calls this month
  - `UnfollowersList.tsx` — avatar, @handle, name, unfollowed date, link to `https://x.com/<handle>`
  - `FollowersChart.tsx` — line chart over time
  - `SnapshotHistoryTable.tsx` — date, count, Δ, trigger (cron/manual), API calls used
  - **Manual run button**: opens confirm dialog "This will use ~N API calls. Continue?" → calls new `admin-actions` action `run_followers_snapshot` with `trigger:'manual'`.

**5. First-run UX**

Banner on first snapshot: "Baseline captured (F followers). Unfollowers will appear after the next snapshot."

### Files

**Create**:
- `supabase/functions/x-followers-snapshot/index.ts`
- `src/pages/XAccount.tsx`
- `src/components/x-account/{XAccountOverview,UnfollowersList,FollowersChart,SnapshotHistoryTable,ManualSnapshotButton}.tsx`
- `src/hooks/useXAccountData.ts`
- Migration: 3 tables + RLS + cron job

**Modify**:
- `src/App.tsx` — add route
- `src/components/layout/AppSidebar.tsx` — add nav item
- `supabase/functions/admin-actions/index.ts` — add `run_followers_snapshot` action (admin-only, calls the snapshot function with `trigger:'manual'`)

No new secrets — reuses existing `TWITTER_*` OAuth1 creds.

### Quick confirms before I build

1. **03:00 UTC** for the daily run, or different hour?
2. **Snapshot retention** — keep all snapshots forever, or prune `follower_ids` arrays older than 90 days (changes table preserved)? Keeping all forever is fine for a few thousand followers but the array column grows.
3. **Telegram alert** when someone unfollows? Or just in-app for now?