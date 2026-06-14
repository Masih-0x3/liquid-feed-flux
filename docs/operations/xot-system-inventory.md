# XOT System Inventory

Checked at: 2026-06-14T08:29:26Z

This inventory is read-only. It records what is currently local, in GitHub, in Vercel, and in Supabase before the cleanup work begins.

## Local Git

- Cleanup worktree: `/Users/stevmq/.config/superpowers/worktrees/Finalized-XOT/xot-cleanup`
- Cleanup branch: `codex/xot-cleanup-01-inventory`
- Cleanup branch parent: `codex/xot-cleanup-00-baseline`
- Cleanup baseline commit: `af293379e23722aef8be1edbb0c19e6079ba2149`
- Production anchor: `origin/main@5d351a9db81809fac4e668c5d03f298f03647808`
- Main working checkout preserved: `/Users/stevmq/Finalized XOT`
- Main working checkout branch: `codex/fix-shadow-subtitle-quality`
- Main working checkout HEAD: `8af924bc897fec081ec323941b299d49817c9141`

Current worktrees:

| Path | Branch | HEAD | Note |
| --- | --- | --- | --- |
| `/Users/stevmq/Finalized XOT` | `codex/fix-shadow-subtitle-quality` | `8af924b` | Current feature branch; not used for cleanup edits. |
| `/Users/stevmq/.config/superpowers/worktrees/Finalized-XOT/xot-cleanup` | `codex/xot-cleanup-01-inventory` | `af29337` | Cleanup workspace. |
| `/Users/stevmq/.config/superpowers/worktrees/Finalized-XOT/layout-consolidation-topbar` | `codex/layout-consolidation-topbar` | `9116310` | Local worktree; remote branch is gone. |
| `/Users/stevmq/.config/superpowers/worktrees/Finalized-XOT/phase1-base-rollout` | `codex/phase1-base-rollout` | `ea5bc8a` | Local worktree; remote branch exists. |
| `/Users/stevmq/.config/superpowers/worktrees/Finalized-XOT/phase2-scoring-release` | `main` | `3fae212` | Stale local `main` worktree behind `origin/main`. |
| `/Users/stevmq/.config/superpowers/worktrees/Finalized-XOT/phase3-video-engine-release` | `codex/renderer-chant-subtitle-tightening` | `3e08f5d` | Local worktree; remote branch exists. |

Remote branches currently present:

- `origin/main`
- `origin/codex/duplicate-x-guard`
- `origin/codex/fix-shadow-subtitle-quality`
- `origin/codex/phase1-base-rollout`
- `origin/codex/renderer-chant-subtitle-tightening`
- `origin/codex/renderer-feedback-watermark-chant`

## GitHub

- Repository: `Masihhedayati/liquid-feed-flux`
- Visibility: private
- Default branch: `main`
- Open pull requests: none
- Open issues: none
- Latest merged PR: [#12](https://github.com/Masihhedayati/liquid-feed-flux/pull/12), `[codex] XOT production rollout`
- PR #12 merged at: `2026-06-14T07:39:49Z`
- PR #12 merge commit: `5d351a9db81809fac4e668c5d03f298f03647808`
- Latest `main` CI run: `27492167983`
- Latest `main` CI status: success
- Latest `main` CI URL: `https://github.com/Masihhedayati/liquid-feed-flux/actions/runs/27492167983`

## Vercel

- Project name: `xot`
- Project ID: `prj_1qO6i3hZ2d9lqYFFWxuRTIhG8ep9`
- Team ID: `team_FZFzyiblNRBueeZRHhDlsnXJ`
- Framework: Vite
- Build command: `npm run build`
- Install command: `npm ci`
- Output directory: `dist`
- Vercel project runtime: Node `24.x`
- Repo package runtime: Node `20.x`
- Local `vercel` CLI in cleanup worktree: not installed
- Vercel state source for this inventory: Vercel connector plus gitignored project metadata in `/Users/stevmq/Finalized XOT/.vercel/project.json`

Latest deployments observed through the Vercel connector:

| Deployment | Target | State | Commit | Branch | Note |
| --- | --- | --- | --- | --- | --- |
| `dpl_FPtcpbtFCic1vuj4cskdTkyRqnHK` | preview / no production target | READY | `8af924bc897fec081ec323941b299d49817c9141` | `codex/fix-shadow-subtitle-quality` | Newer ready deployment, not production. |
| `dpl_JEAKMGeLPRzpe3ZMTeNEAMGysHf9` | production | READY | `5d351a9db81809fac4e668c5d03f298f03647808` | `main` | Current production deployment and rollback candidate. |

Live host checks:

| URL | Status | Server | Last-Modified | Notes |
| --- | --- | --- | --- | --- |
| `https://xot.iraneyes.com` | `HTTP/2 200` | Vercel | `Sun, 14 Jun 2026 07:42:27 GMT` | CSP, frame, content-type, and referrer headers present. |
| `https://xot.vercel.app` | `HTTP/2 200` | Vercel | `Sun, 14 Jun 2026 07:42:27 GMT` | Same ETag as primary host: `085e7196b05f71bee6bec5f77fc6c184`. |

## Supabase

- Project ref: `jzirqfzzvlbxwfzndaer`
- Local cleanup worktree linked with `npx supabase link --project-ref jzirqfzzvlbxwfzndaer`
- Configured functions in `supabase/config.toml`: 10
- Remote active functions: 10

Remote functions:

| Function | Version | Verify JWT | Status |
| --- | ---: | --- | --- |
| `webhooks-rssapp` | 199 | false | ACTIVE |
| `worker` | 227 | false | ACTIVE |
| `admin-retry` | 155 | true | ACTIVE |
| `db-cleanup` | 126 | false | ACTIVE |
| `media-processor` | 165 | false | ACTIVE |
| `media-cleanup` | 162 | false | ACTIVE |
| `admin-actions` | 150 | true | ACTIVE |
| `x-poster` | 102 | false | ACTIVE |
| `x-followers-snapshot` | 76 | false | ACTIVE |
| `digest-compiler` | 82 | false | ACTIVE |

Migration state:

- Latest shared local/remote migration: `20260614064657`
- Local-only migrations requiring review: `20260609201533`, `20260609213357`
- Historical migration drift exists before `20260515075613`, with many local and remote timestamps offset from each other.
- Do not run `supabase db push` until Phase 3 migration trust repair is reviewed.

Cron jobs:

| Job | Schedule | Active |
| --- | --- | --- |
| `invoke-db-cleanup-daily` | `0 3 * * *` | true |
| `invoke-media-cleanup-6h` | `0 */6 * * *` | true |
| `invoke-worker-every-1m` | `* * * * *` | true |
| `rebuild-learned-biases-6h` | `0 */6 * * *` | true |
| `reconcile-stuck-jobs-every-10m` | `*/10 * * * *` | true |
| `x-poster-tick` | `* * * * *` | true |

Queue health:

- Current job statuses by type are all `completed`.
- Counts observed:
  - `dedupe`: 4220
  - `deliver`: 1480
  - `download_media`: 783
  - `hydrate_tweet`: 59
  - `resolve_media`: 298
  - `translate`: 3791
- Stale running jobs older than 15 minutes: none.

Renderer health:

- Renderer: `hermes-masih-1`
- Status: `online`
- Version: `0.1.0`
- Render version: `persian-subtitles-masihh-v1`
- Processed: 2
- Failed: 0
- Last seen: `2026-06-14 08:31:15.578+00`

Settings keys observed:

| Key | Type | Mode |
| --- | --- | --- |
| `content_filter` | object | none |
| `scoring_policy` | object | `active` |
| `video_render_config` | object | `shadow` |
| `x_posting_config` | object | none |

Secret names observed:

- `ALLOWED_CORS_ORIGIN`
- `DEPLOY_GIT_SHA`
- `LOVABLE_API_KEY`
- `OPENAI_API_KEY`
- Supabase-managed keys
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TWITTER_ACCESS_TOKEN`
- `TWITTER_ACCESS_TOKEN_SECRET`
- `TWITTER_CONSUMER_KEY`
- `TWITTER_CONSUMER_SECRET`
- `WEBHOOK_SHARED_SECRET`

Secrets not observed in Supabase Edge secret names:

- `RSSAPP_ALLOW_QUERY_TOKEN`
- `RSSAPP_WEBHOOK_TOKEN`
- `VIDEO_RENDERER_URL`
- `VIDEO_RENDERER_TOKEN`
- `DEEPGRAM_API_KEY`

Advisor highlights:

- `vector` extension is installed in `public`.
- Anon GraphQL exposure exists for `public.video_render_feedback`, `public.video_renderer_heartbeats`, `public.video_renders`, and `public.x_non_followback_reviews`.
- Authenticated GraphQL exposure exists for multiple admin/internal tables such as `accounts`, `jobs`, `posts`, `pipeline_events`, `settings`, and related analytics tables.
- Multiple permissive policies exist on video render tables.
- Duplicate indexes exist on:
  - `public.jobs`: `idx_jobs_type_status`, `jobs_type_status_idx`
  - `public.telegram_daily_stats`: `idx_daily_stats_chat_date`, `idx_tds_chat_date`
  - `public.telegram_message_analytics`: `idx_message_analytics_post_id`, `idx_tma_post_id`

## Baseline Risks To Carry Forward

- Production is currently aligned on `origin/main@5d351a9`, but a newer non-production Vercel preview exists from `codex/fix-shadow-subtitle-quality`.
- Supabase `DEPLOY_GIT_SHA` was observed as updated before the latest production function updates; Phase 2 should enforce stamping in the deploy path.
- Supabase migration history drift is real and must be repaired deliberately, not by blind `db push`.
- Vercel runtime is Node `24.x`; repo/CI currently declare Node `20.x`.
- Root dependency audit fails before cleanup work; video-renderer audit is clean.
- Supabase CLI live DB reads should be sequential. A parallel read during this inventory reproduced the known temp-role auth retry failure.

## Read-Only Refresh Command

Run:

```bash
npm run check:release-state
```

This command refreshes local Git, GitHub, live host headers, Supabase functions, migrations, secret names, cron, queue health, renderer health, and settings. It exits non-zero when a required check fails. If the local `vercel` CLI is unavailable, it reports that limitation and skips Vercel deployment listing; use the Vercel connector with project `prj_1qO6i3hZ2d9lqYFFWxuRTIhG8ep9` and team `team_FZFzyiblNRBueeZRHhDlsnXJ` to refresh the deployment table above.

Include advisors only when needed:

```bash
CHECK_RELEASE_ADVISORS=1 npm run check:release-state
```
