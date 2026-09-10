# Detail PR integration review — 2026-09-08

## Candidate

Base: `7797b11c11b9805f701c9f77b5a752c5eece71d9`. Validated source candidate: `673582f272ad5842917a135ead490fe38dfe2209`.

28 existing Detail PRs are integrated locally: 18 bug fixes, eight cleanups, and two documentation changes. Original PR head ancestry is preserved. At initial local validation, no remote push, merge, or deployment had occurred. The aggregate must use a merge commit to preserve that ancestry.

## Accepted PRs

| PR | Change | Reviewed head |
| --- | --- | --- |
| [#111](https://github.com/Masih-0x3/liquid-feed-flux/pull/111) | fix(worker): preserve DeliveryCutoverBlockedNoWrite class through handleDeliverJob catch | `b4e6c60da7d92de02b41af7ee51d38c4c59b909c` |
| [#95](https://github.com/Masih-0x3/liquid-feed-flux/pull/95) | fix(worker): match production message for reconciliation_required flag | `94a46335e77d7d15f04c8ba0704d909358fe1eda` |
| [#87](https://github.com/Masih-0x3/liquid-feed-flux/pull/87) | fix(translation-readability): reject Latin-only repair that loses Persian | `28bb02b9b1199afb6957372375ad8914e3c2e135` |
| [#107](https://github.com/Masih-0x3/liquid-feed-flux/pull/107) | fix(media-processor): copy file_size and mime_type onto reused media rows | `b99fabd6e2e6a0875c223afcc405871ad20ea548` |
| [#108](https://github.com/Masih-0x3/liquid-feed-flux/pull/108) | fix(webhooks-rssapp): preserve bare twimg URL offsets when non-ASCII text precedes them | `e83ac0c3eb0ba2a1b2b91ebf345bd8a38a49f732` |
| [#100](https://github.com/Masih-0x3/liquid-feed-flux/pull/100) | fix(dedupe): clear stale delivery_decision on duplicate-gate un-block | `5aa3b7956386bed896e6e3a63dbe6d22f678b8e3` |
| [#94](https://github.com/Masih-0x3/liquid-feed-flux/pull/94) | fix(admin-actions): recognize completed enrichment under auto-approval in manual advance | `e69bf107427a73937188b182481cdf67bbff10d2` |
| [#91](https://github.com/Masih-0x3/liquid-feed-flux/pull/91) | fix(admin-actions): unblock run_dedupe when translation is disabled | `3c5de6d56aa4748768a81f6ded10f30c9e7937ef` |
| [#98](https://github.com/Masih-0x3/liquid-feed-flux/pull/98) | fix(admin-actions): report followers snapshot partial failures on the ok boolean | `18c96eb74a47e3dbbb86bbc87b6687e49c627fbd` |
| [#104](https://github.com/Masih-0x3/liquid-feed-flux/pull/104) | fix(media-processor): preserve media_object_* cleanup codes at the handler boundary | `5dbe3a71966fc0e0ce9783fbbf90ad6d55e89210` |
| [#90](https://github.com/Masih-0x3/liquid-feed-flux/pull/90) | fix(openai): capture url_citation annotations from Responses API messages | `4e58b722439557bd1c7cdda696340a0a5142a1e4` |
| [#97](https://github.com/Masih-0x3/liquid-feed-flux/pull/97) | fix(worker): capture vxtwitter media dimensions on fallback path | `851f7a8833cf2349ed1ad4616fc3f85382a1ee40` |
| [#101](https://github.com/Masih-0x3/liquid-feed-flux/pull/101) | fix(worker): fall back to conservative spacing on probe query errors | `e9010b7bf345a44415a3a7498c3429d594022572` |
| [#96](https://github.com/Masih-0x3/liquid-feed-flux/pull/96) | fix(renderer): preserve keep-overlay box so watermark badge avoids protected source logos | `376f6adcdbb60aa34acf8fd9ae1e353e278ff31e` |
| [#103](https://github.com/Masih-0x3/liquid-feed-flux/pull/103) | fix(admin-actions): validate story_memory.bypass_authors entries are string handles ≤15 chars | `e54ef9211ce7b2acc54d6e6256992ada9eca7127` |
| [#105](https://github.com/Masih-0x3/liquid-feed-flux/pull/105) | fix(video-renderer): run preview OCR outside vision gate for block parity | `c3eb1df94d6b15cdfe9f4f9c618c06143d116c00` |
| [#86](https://github.com/Masih-0x3/liquid-feed-flux/pull/86) | fix(monitoring): mirror duplicate-block gate in manual score preview | `5a868743e4daf3fc229482e60febb2210181fbf0` |
| [#109](https://github.com/Masih-0x3/liquid-feed-flux/pull/109) | fix(dashboard): label settings-bound cockpit CTA by destination | `73a772f0fe79720ce82b0411669256c084dab885` |
| [#78](https://github.com/Masih-0x3/liquid-feed-flux/pull/78) | docs: mark EditorialProfilesCard/ContentFilterSettings as read-only | `3908969323f402e4ba0e872a33922cc5c6573513` |
| [#79](https://github.com/Masih-0x3/liquid-feed-flux/pull/79) | docs: correct settle_delivery_cutover_blocked semantics in v1 cutover runbook | `14f0f8af865705c4ed52b2885a6e41d43b9f7b7c` |
| [#80](https://github.com/Masih-0x3/liquid-feed-flux/pull/80) | chore: remove makeDefaultProfile helper | `53bca0acb488e181945ef3d9480709c11270609d` |
| [#81](https://github.com/Masih-0x3/liquid-feed-flux/pull/81) | chore: remove unused DashboardMetrics component | `8f73e26897166399a634006f09d72fe7509ede8e` |
| [#83](https://github.com/Masih-0x3/liquid-feed-flux/pull/83) | chore: remove unused monitoring data hooks and type re-exports | `1484a512b72ffbe67f5c1380baa9f72106440086` |
| [#84](https://github.com/Masih-0x3/liquid-feed-flux/pull/84) | chore: remove unused useXDeliveries hook and XDeliveryRow type | `d1ff4002044cdea164c55633b745bf9e0e37c5e8` |
| [#85](https://github.com/Masih-0x3/liquid-feed-flux/pull/85) | chore: remove dead matchesScoringV2Filter helpers | `10755384fa805489b762ba7ffc0c9a12b905e6ba` |
| [#112](https://github.com/Masih-0x3/liquid-feed-flux/pull/112) | chore: remove dead halted.status/halted.error fields in x-followers-snapshot | `f3aca368b57ffa95d4eaf12b769788087467124c` |
| [#113](https://github.com/Masih-0x3/liquid-feed-flux/pull/113) | chore: remove dead AppSidebar and sidebar theme config | `d0bc9e38fd0c22e28bcec2c744871f23bdcf5491` |
| [#114](https://github.com/Masih-0x3/liquid-feed-flux/pull/114) | chore: remove unused mergePreflight helper | `0db06a094eedb41f0fafe43db40af8962f93a985` |

## Held PRs

| PR | Reason |
| --- | --- |
| [#88](https://github.com/Masih-0x3/liquid-feed-flux/pull/88) | Excluding active partial follower rows can trigger duplicate API work. |
| [#89](https://github.com/Masih-0x3/liquid-feed-flux/pull/89) | Transport failures remain in the denominator although the UI says they are excluded. |
| [#92](https://github.com/Masih-0x3/liquid-feed-flux/pull/92) | UTF-16 splitting can corrupt emoji and does not implement weighted X character counting. |
| [#93](https://github.com/Masih-0x3/liquid-feed-flux/pull/93) | Partial image uploads can become terminal skips; diagnostic and enforcement behavior disagree. |
| [#99](https://github.com/Masih-0x3/liquid-feed-flux/pull/99) | Prune/read/upsert remains nontransactional and new media positions can be scheduled incorrectly. |
| [#102](https://github.com/Masih-0x3/liquid-feed-flux/pull/102) | The missing-context guard covers acceptResult but not weakDeepgramReason, so valid subtitles can be removed. |
| [#106](https://github.com/Masih-0x3/liquid-feed-flux/pull/106) | Changes the legacy v1 scoring curve and defaults; defer this behavior change. |
| [#110](https://github.com/Masih-0x3/liquid-feed-flux/pull/110) | Ordinary pending rows enter the limited query and can starve released retries. |

PR #82 duplicates the deletion accepted in #113 and remains open. Older PRs #66, #67, #68, and #77 are outside this Detail integration. Held PRs have not been rewritten or closed.

## Integration and validation

The only merge conflicts involved the generated local supply/build inventory. They were resolved using the existing inventory generator; its conservative release gate remains closed. No dependency, lockfile, or migration changes are included.

- All 147 non-install CI commands executed locally returned exit code 0, including dependency audits, contract checks, lint, type checks, tests, and the production-mode build.
- Major suites: 221 renderer tests, 543 Edge tests, and 243 frontend tests across 40 files passed. Lint reported zero errors and ten existing warnings.
- Local runtime: Node 24.20.0, npm 10.8.2, Deno 2.9.5. Hosted CI uses Node 20; the combined candidate has not yet run there.
- Locked dependencies were installed locally. The Supabase CLI version probe was omitted; no migration execution was needed.
- Headless browser checks at 1440×1000 and 390×844 verified dashboard settings navigation via keyboard, manual-score duplicate skip prediction, override-to-pass prediction, and Escape dismissal. Screenshots were inspected. Both viewports had zero page errors.
- Browser authentication and API responses were synthetic and external HTTP/WebSocket traffic was intercepted. This is local interaction/visual evidence, not authenticated or live acceptance.
- Final source diff whitespace checks passed. The task-created browser server was stopped after validation.

## Remote and deployment boundary

Existing Detail PRs have failed Vercel statuses. The inspected #114 build failed the Preview identity guard because its configured Supabase identity identifies production. That guard must remain intact; local success does not resolve the hosted Preview configuration problem. Semaphore failures also remain separate remote evidence.

Read-only Vercel project inspection confirmed that `main` is the production branch with automatic domain assignment. Merging the candidate therefore triggers a production frontend deployment. Backend Edge Functions and migrations are not deployed by this merge workflow.

The user authorized merging suitable Detail fixes. On 2026-09-08, the user explicitly approved the accompanying production frontend deployment and any charges from existing hosted CI/review/Preview automation. Incremental hosted costs are not exposed by available evidence. No account configuration or safeguards were changed.

Under that approval, publish the candidate for exact-head hosted checks, investigate failures without weakening gates, and merge only when applicable checks permit it. Revalidate remote heads and base before publishing.

## Hosted integration outcome

PR #115 merged as `aaad5aac9cfca33cad9fcfb04f06ff6353c3809e` on 2026-09-08. GitHub marked all 28 accepted Detail PRs merged; their heads are ancestors of main. The final PR head passed required Node 20 CI (run 34213597854). Production frontend deployment `dpl_9EvQVtacp158bjEYzbYYRN6G5CLv` reached READY at that merge SHA; the homepage and entry asset returned HTTP 200. Backend functions and migrations were not deployed.

Late automated review identified overly broad runbook wording about the worker guard preceding all writes; the follow-up corrects that documentation. The manual-score fractional-input preview mismatch and permissive bypass-handle character validation also existed on the original base; those are separate follow-up issues, not regressions introduced by this integration. The bot ancestry concern was disproven by checking all 28 accepted heads against main.
