# Supply-chain CI gate

Status: initial source/CI gate for `SR-SUPPLY-01`; not a completed supply-chain
assessment or release-security closure.

## What this gate enforces

The blocking `lint-build` CI job begins with a direct-Node supply preflight,
before any npm install or registry access:

1. `node scripts/check-supply-chain-contract.mjs`

Only after that preflight passes, it runs the immutable runtime prefix
(`npm ci --ignore-scripts`), then reruns the direct preflight before the
renderer install and production audits:

1. `node scripts/check-supply-chain-contract.mjs`
2. `npm --prefix services/video-renderer ci --ignore-scripts`
3. `npm audit --omit=dev --audit-level=high`
4. `npm --prefix services/video-renderer audit --omit=dev --audit-level=high`

Only after those production audits complete does CI run the direct-Node runtime
contract/check suite and the supply-chain mutation suite. That ordering prevents
PR-controlled test code from changing `GITHUB_ENV`, `GITHUB_PATH`, lockfiles, or
repository npm configuration before an audit command is issued.

The source contract locks the workflow to its reviewed `name`, `on`, and `jobs`
grammar, including the PR/push-on-main event block; locks `lint-build` to its reviewed `runs-on` and `steps` grammar; and
locks the entire checkout → setup-node → runtime → supply-chain command prefix.
That prevents checkout/ref, registry, working-directory, conditional, or
non-blocking overrides from moving production audits away from the reviewed PR
source. It
also verifies both npm lockfiles, Deno remote/npm/JSR checksum metadata, the
renderer Dockerfile's reviewed base selector and lockfile install, and the
exception-ledger schema. Every npm lock entry must resolve through the reviewed
HTTPS npm registry with an integrity value; local linked entries are rejected so
they cannot bypass production-audit coverage. A future private or alternate
registry needs an explicit policy change rather than a silent bypass.
Repository `.npmrc` files are prohibited in both package roots so an audited PR
cannot redirect npm's registry or configuration path through source control.

`--audit-level=high` deliberately fails the production gate only for high or
critical findings. It is not a waiver for lower-severity findings.

## Evidence and exception policy

`docs/operations/supply-chain-exceptions.json` is the only exception ledger for
this gate. A waiver must state its ID, scope, advisory/license identifier,
severity, exploitability, impact, owner, evidence, and a future expiry. The
source checker rejects expired or incomplete waivers.

While the ledger is `awaiting_fresh_scan_evidence`, it must have no scan receipt
and no waivers. Once it changes to `current_scan_evidence_recorded`, it must
include a full lowercase 40-character reviewed Git SHA, CI/source location,
an ISO completion time that is not materially future-dated, and explicit root
and renderer production-audit outcomes. These shape checks still do not prove
that the receipt came from GitHub or an approved scanner; owner/provider review
of the referenced run remains required.

The current ledger status is `awaiting_fresh_scan_evidence`. Its empty waiver
arrays mean no current scan evidence was recorded in this source-only slice;
they do **not** prove that either dependency tree has zero advisories.

The final owner step accepts a reviewed zero-actionable scan through the
out-of-band GitHub Actions repository variable
`XOT_SUPPLY_OWNER_POLICY_B64`. The variable contains base64-encoded JSON with
schema `xot-hosted-supply-owner-policy-v1`, the exact reviewed and checked-out
SHA, named owner, dated signature, future expiry, observed/actionable/nonfixable
high-or-critical counts, all observed high-or-critical IDs, exact nonfixable
IDs, an allowed base-image classification, the decision
`accept_zero_actionable_no_waivers`, and an empty waiver list. The
workflow enables this path only with the fixed
`XOT_SUPPLY_OWNER_POLICY_MODE=exact-head` setting. The collector validates the
technical artifact manifest before reading the policy, constructs an accepted
owner disposition in the runner workspace, refreshes that manifest digest,
writes `validation.json` as `passed_owner_accepted`, and runs the independent
final validator. The accepted bundle records the renderer image ID produced by
that rerun and is uploaded only after the validator passes. Missing, malformed,
stale, mismatched, actionable, or waived policy data remains blocked. The
pinned base digest and complete observed-ID list are the owner-policy boundary;
the run-specific image ID remains evidence rather than a cross-run policy key
because equivalent Docker builds need not have identical image IDs. Debian
snapshot pinning is not part of this gate. This avoids
committing a receipt that changes the exact SHA it is meant to approve; the
repository variable must be refreshed for each exact-head scan.

The older cleanup baseline recorded three moderate root production advisories
and a clean renderer audit. That observation is historical context only, not a
fresh scan receipt and not an implicit waiver.

## Deliberate non-claims before a green exact-head run

The source change alone does not provide any of the following:

- a fresh root or renderer audit result from CI;
- full dev/build advisory triage;
- an SBOM or license inventory;
- a Docker image or installed-APT vulnerability scan;
- a hosted result for the reviewed immutable base-image digest;
- CI action SHA-pin review; or
- a Deno/import image scan beyond static lock checksum coverage.

Do not mark AIR-052, AIR-053, AIR-075, or AIR-078 closed from source changes
alone. The historical Supabase PAT secret-scanning alert remains a separate
release-security follow-up and must not be entered as a dependency waiver.

## Required next evidence before owner acceptance

Run the protected CI job on the exact reviewed SHA and retain the pending
bundle. Review its complete finding IDs and counts, then set the exact-head
repository variable and rerun the same SHA. Retain the accepted bundle from the
green rerun. Any changed finding set needs a new review. Only that combined
evidence can satisfy the full `SR-SUPPLY-01` acceptance criteria in the
remediation plan.

GitHub branch protection must require the blocking `lint-build` check, and
review/CODEOWNERS policy must protect this workflow, its source checker, and the
runtime-contract digest. This source-only gate cannot prove those repository
settings or prevent an authorized workflow editor from changing all controls in
one review.
