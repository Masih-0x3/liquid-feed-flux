# Dashboard UI audit remediation

Tracks Linear 0X3-396 through 0X3-418, following the September 2026 visual audit.

## Behavior

- The responsive shell keeps six distinct navigation destinations and a readable runtime posting state. Page loading retains the shell.
- Monitoring prioritizes four triage counts and the queue. Details put the selected content and outcome ahead of collapsed diagnostics.
- A completed internal job is not an external delivery receipt. Skipped work remains skipped; delivery timestamps and counts require outcome evidence. Explicit posted/delivered events can resolve a stale post snapshot.
- Video queue excerpts are bounded independently of the full inspector content. Mobile selection opens the inspector with a return-to-queue control and focus restoration.
- Settings expose per-group save scope, retained drafts, incoming-change conflicts and action consequences. Drafts remain in memory only and are cleared before authentication identity changes reach React state.
- Persian content has consistent language/direction/font handling. Formatted message previews are inert; video style previews are illustrative, local and require no render request.
- Shared actions use semantic contrast tokens. Reduced motion removes transitions and animation, while loading remains explicit text.

## Metric semantics

| Surface | Cohort and availability |
| --- | --- |
| Dashboard cockpit | Last 24 hours; post snapshot is bounded to 10,000. Queue state and delivery counts can have different row cohorts. These figures do not reconcile directly with all retained Monitoring rows. |
| Monitoring summary | Current state of the bounded operational snapshot. If the overview fails, the fallback is explicitly the currently loaded, filtered rows. Secondary metrics retain their own time labels. |
| X usage | Local X API ledger activity over 24 hours, with month-to-date posting budget shown separately. Dashboard reads do not synchronize official provider usage. |
| Video overview | Renders created within seven days, up to 5,000. Issue counts cover retained failed/blocked rows separately, up to 5,000. |
| Timing and resources | Percentiles retain their measured window; absent samples and failed diagnostics are unavailable rather than zero or healthy. |

Enhanced dashboard responses carry `data_quality.unavailable_sections` and `observed_at`. A failed refresh retains the last successful data with an explicit stale/error message. Initial loading does not render false zero-count or empty conclusions.

## Authorized media boundary

`get_media_catalog` accepts a tweet ID and returns bounded logical asset metadata. `get_media_access` accepts that tweet ID, exactly one media ID or render ID, and a preview/download purpose. Both require the existing administrator role.

The broker verifies the post/object relationship, archived source or completed render, private bucket, supported MIME, byte count and stored-object metadata. A grant lasts at most 120 seconds and cannot outlive render expiry. Only the centralized `AuthorizedMedia` component accepts a validated grant for playback or download. Ordinary list/detail responses do not sign media or return protected storage paths.

Unavailable, missing, expired and denied access have distinct recovery copy. Lookup does not fetch X or start processing; ordinary backend/storage billing can still apply. Processing and posting remain separate confirmed actions under the existing server gates.

## Validation and release boundary

Use Node 24 and the repository scripts for frontend tests, strict types, lint, build, Deno checks/tests and source contracts. The media and Settings tests cover authorization, stale responses, expiry, draft restoration, save races, identity changes and confirmation behavior.

Browser verification uses a local synthetic fixture adapter with external network access blocked. It exercises desktop/phone layouts, all eight Settings sections at 320/390/768px, keyboard access, reduced motion, loading, error and empty states. These fixtures are not production evidence.

The initial remediation and browser audit were local only. On September 12, 2026, the owner authorized production deployment of these reviewed changes. Release scope is the frontend and admin-actions function; no migration, renderer replacement, cleanup activation, provider test or live post is required. Authenticated storage playback/download must be verified after deployment. Required hosted CI and supply-owner checks remain in force; database recovery and migration holds remain separate and unchanged.
