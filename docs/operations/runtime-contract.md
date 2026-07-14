# XOT Runtime Contract

Status: current divergent matrix frozen; upgrade not approved.

This checkpoint implements the read-only/freeze portion of `SR-RUNTIME-01`. It
does not upgrade Node, Supabase clients, the Supabase CLI, the renderer image, or
any lockfile. The machine-readable source of truth is
`docs/operations/runtime-contract.json`; `npm run check:runtime-contract` rejects
unreviewed drift and prints the exact Node patch used by every CI/Vercel build.
The guard also freezes Vercel's install/build path through the checked prebuild
wrapper, exact run steps in the named blocking CI job, Vite
range/resolution/Node floor, the coherent root/CI/renderer Node major, standard
static/dynamic/CommonJS/TypeScript import-equals module loads across supported
JS/TS extensions, and the current npm and esm.sh lock integrity hashes. Edge
syntax errors and non-literal loads fail closed; `node:module`/`module` imports
are prohibited there so an aliased `createRequire` cannot bypass inventory, as
are CommonJS `module`/`exports` globals and aliased `require` calls. Workflow or
job defaults, environment overrides, conditions, custom shells, working
directories, quoted keys, YAML indirection, redirected checkout/setup actions,
and pre-gate steps are rejected for the named CI gate. The complete canonical
workflow is also SHA-256 frozen, so alternate valid YAML spellings cannot evade
the semantic parser; any intentional CI edit requires an explicit contract
hash review.

## Verified current state

- Vercel deployment `dpl_GkzZnfyUQGMtbdJ46mz68kPm4aWj` built commit
  `b554b2f8c494a120a4995b175544f71199d3de6e` successfully with Vite `8.0.16`
  and 2,492 transformed modules. Inspection used Vercel CLI `56.1.0`; the
  managed build used Vercel CLI `55.0.0`.
- Vercel project settings select Node `24.x`, but root `engines.node` overrides
  that setting with `20.x`. The build log says Node 20 deployments created on or
  after 2026-10-01 will fail.
- Vite 8 requires Node `20.19+` or `22.12+`. The prior Vercel log proved a
  successful supported build but did not emit the exact Node patch. The new
  prebuild guard prints exact Node and npm versions, rejects a Node 20 patch
  below 20.19, and requires npm major 10 during this freeze. The current local
  evidence surface is the Codex bundled workspace runtime on Node `22.23.1`
  with npm `10.9.8`; the `npm@10.8.2` package-manager declaration is not
  misrepresented as the effective binary or as proof of another shell.
- Root/browser Supabase resolves `2.57.0`; the renderer resolves `2.108.1`; the
  Deno lock resolves the npm specifier to `2.105.4`; ten Edge entrypoints still
  use pinned esm.sh `2.39.7` or `2.49.1` imports.
- The renderer Dockerfile floats on `node:20-bookworm-slim`; the live renderer
  exact Node/image digest was not checked because `xot-renderer-do` was not
  resolvable from this machine. Do not infer it from the Dockerfile.
- Supabase CLI `2.109.1` produced the migration evidence, but the repository has
  no authoritative CLI pin.

## Decision

Freeze the current matrix so it cannot drift accidentally. Do not normalize the
Supabase clients or move Vercel/CI/renderer to Node 24 in a correctness, schema,
RLS, or frontend slice. The actual cutover remains an isolated Phase 7 release
after `SR-MIG-01` and `SR-TYPE-01` are accepted and auth/query behavior fixtures
exist.

The Phase 7 candidate should align root/renderer engines, a local version file,
CI, Vercel, and a digest-pinned renderer image on Node 24; centralize Edge
Supabase imports on one exact npm/import-map version; pin the CLI; regenerate
locks once; and canary renderer, frontend, then Edge function families. Rollback
uses the prior reviewed locks/image/runtime and must occur before Vercel's Node
20 deadline.

## Evidence and commands

```bash
npm run check:runtime-contract
npm run test:runtime-contract
npx vercel inspect dpl_GkzZnfyUQGMtbdJ46mz68kPm4aWj --logs
```

Official constraints were rechecked on 2026-07-14 against the Vite 8 Node
requirement, Vercel Node runtime/version override documentation, and Supabase
Edge dependency guidance. Supabase recommends versioned npm/jsr imports and
discourages CDN imports such as esm.sh for new Edge dependency work.
