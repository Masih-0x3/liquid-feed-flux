# XOT Runtime Contract

Status: Node 24 candidate aligned locally; hosted and live canaries pending.

This checkpoint implements the Node 24 source-alignment portion of
`SR-RUNTIME-01`. It updates the root, local version file, CI, Vercel override,
renderer engine, lock metadata, and digest-pinned renderer base. It does not
deploy the frontend or renderer, change a Supabase client, or mutate a database.
The machine-readable source of truth is
`docs/operations/runtime-contract.json`; `npm run check:runtime-contract` rejects
unreviewed drift and prints the exact Node patch used by every CI/Vercel build.
The guard also freezes Vercel's install/build path through the checked prebuild
wrapper, exact direct-Node run steps in the named blocking CI job, Vite
range/resolution/Node floor, the coherent root/CI/renderer Node major, standard
static/dynamic/CommonJS/TypeScript import-equals module loads across supported
JS/TS extensions, and the current npm and esm.sh lock integrity hashes. Edge
syntax errors and non-literal loads fail closed; `node:module`/`module` imports
are prohibited there so an aliased `createRequire` cannot bypass inventory, as
are CommonJS `module`/`exports` globals and aliased `require` calls. Workflow or
job defaults, environment overrides, conditions, custom shells, working
directories, quoted keys, YAML indirection, redirected checkout/setup actions,
and pre-gate steps are rejected for the named CI gate. A direct Node supply-chain
preflight verifies the reviewed lock and npm configuration before any npm network
access; the CI completes both lifecycle-suppressed installs and production audits
before it executes mutable Node contract/test code. The complete canonical
workflow is also SHA-256 frozen, so alternate valid YAML spellings cannot evade
the semantic parser; any intentional CI edit requires an explicit contract
hash review.

## Verified current state

- Vercel deployment `dpl_GkzZnfyUQGMtbdJ46mz68kPm4aWj` built commit
  `b554b2f8c494a120a4995b175544f71199d3de6e` successfully with Vite `8.0.16`
  and 2,492 transformed modules. Inspection used Vercel CLI `56.1.0`; the
  managed build used Vercel CLI `55.0.0`.
- Vercel project settings select Node `24.x`, but the earlier root
  `engines.node` override selected `20.x`. Guarded preview probe
  `dpl_3TXochCtQkx8dRFKhbVcrdcLCCJo` reported exact Node `20.20.2`; it then
  failed because `.vercelignore` had removed renderer contract metadata. The
  build log also says Node 20 deployments created on or after 2026-10-01 will
  fail. Follow-up deployment `dpl_5z2ntVZ9dHxxPcrUKhtW3fW6FSUV` included only
  the renderer package, lock, and Dockerfile metadata needed by the guard,
  reported Node `20.20.2` and npm `10.8.2`, passed the earlier Node 20 contract,
  built all 2,492 Vite modules, and reached READY at commit
  `082fd241e87b54b686191952a729b9584a797b4d`.
- The current candidate declares Node `24.x`, pins `.nvmrc` to `24.20.0`,
  declares npm `11.19.0`, selects Node `24` in CI, and pins the renderer base to
  `node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e`.
  Local contract tests pass on Node `24.20.0` and npm `11.19.0`. A hosted CI run,
  a Vercel Preview build, and a Lightning renderer canary on this exact candidate
  are still required.
- Vite 8 requires Node `20.19+` or `22.12+`. The earlier guarded Vercel probe
  proved a supported Node 20 build but is historical evidence only. The
  candidate prebuild guard prints exact Node and npm versions, requires Node
  major 24, and requires npm major 11. The current local evidence surface is
  Node `24.20.0` with npm `11.19.0` selected from the candidate `.nvmrc` and
  package contract.
- Root/browser Supabase resolves `2.57.0`; the renderer resolves `2.108.1`; the
  Deno lock resolves the npm specifier to `2.105.4`; ten Edge entrypoints still
  use pinned esm.sh `2.39.7` or `2.49.1` imports.
- The live renderer was observed on Node `20.20.2` with restart policy `no`.
  This is current production evidence, not proof of the Node 24 candidate. The
  candidate renderer must pass an exact-image canary and persistence drill
  before it replaces the live image.
- Supabase CLI `2.111.0` produced the current production type comparison and is
  the repository CI/release pin.

## Decision

Keep the Node 24 alignment as one isolated candidate. Do not treat local tests
as deployment proof. Hosted CI must run on the exact commit, then Vercel Preview
and the Lightning renderer must report their effective Node versions and pass
their existing acceptance checks. Production stays on the observed runtime
until those gates pass and the owner authorizes cutover. Supabase client
normalization remains separate because it affects all Edge functions.

## Evidence and commands

```bash
npm run check:runtime-contract
npm run test:runtime-contract
npx vercel inspect dpl_GkzZnfyUQGMtbdJ46mz68kPm4aWj --logs
```

Official constraints were rechecked on 2026-09-03 against the Vite 8 Node
requirement, Vercel Node runtime/version override documentation, and Supabase
Edge dependency guidance. Supabase recommends versioned npm/jsr imports and
discourages CDN imports such as esm.sh for new Edge dependency work.
