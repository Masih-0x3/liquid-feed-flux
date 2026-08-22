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

The older cleanup baseline recorded three moderate root production advisories
and a clean renderer audit. That observation is historical context only, not a
fresh scan receipt and not an implicit waiver.

## Deliberate non-claims and remaining SR-SUPPLY-01 work

This change does not provide any of the following:

- a fresh root or renderer audit result from CI;
- full dev/build advisory triage;
- an SBOM or license inventory;
- a Docker image or installed-APT vulnerability scan;
- an approved immutable image digest;
- CI action SHA-pin review; or
- a Deno/import image scan beyond static lock checksum coverage.

Do not mark AIR-052, AIR-053, AIR-075, or AIR-078 closed from this source-only
gate. The historical Supabase PAT secret-scanning alert remains a separate
release-security follow-up and must not be entered as a dependency waiver.

## Required next evidence after merge approval

Run the protected CI job on the reviewed SHA, retain the root and renderer audit
outputs, then record any findings in the exception ledger with owner and expiry.
Follow with a separately approved scanner/SBOM/license/image/remote-import run.
Only that combined evidence can satisfy the full `SR-SUPPLY-01` acceptance
criteria in the remediation plan.

GitHub branch protection must require the blocking `lint-build` check, and
review/CODEOWNERS policy must protect this workflow, its source checker, and the
runtime-contract digest. This source-only gate cannot prove those repository
settings or prevent an authorized workflow editor from changing all controls in
one review.
