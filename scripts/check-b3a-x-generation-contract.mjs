import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const claimPath = path.join(repoRoot, "supabase/functions/_shared/xPostDeliveryClaim.ts");
const xposterPath = path.join(repoRoot, "supabase/functions/x-poster/index.ts");
const migrationPath = path.join(repoRoot, "supabase/migrations/20260806143000_b3_job_x_claim_fencing.sql");
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function fail(message) {
  throw new Error(`B3A_X_GENERATION_SOURCE_CONTRACT_FAIL ${message}`);
}

function parseTS(source, fileName) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (sf.parseDiagnostics.length > 0) fail(`${fileName}: TypeScript parse diagnostics`);
  const out = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName,
  });
  if ((out.diagnostics ?? []).some((d) => d.category === ts.DiagnosticCategory.Error)) {
    fail(`${fileName}: TypeScript transpilation diagnostics`);
  }
}

function assertContract({ claim, xposter, migration, packageJson, ci }, label = "current source") {
  parseTS(claim, claimPath);
  parseTS(xposter, xposterPath);

  // 1. RPC layer carries the generation fence.
  if (!claim.includes("p_claim_generation: params.claimGeneration")) {
    fail(`${label}: all X RPC calls must forward the claim generation`);
  }
  if (!claim.includes(`"mark_x_delivery_provider_started"`)) {
    fail(`${label}: provider-start boundary RPC is missing`);
  }
  if (!claim.includes("return data === true;")) {
    fail(`${label}: provider-start boundary must return true/false, never throw as success`);
  }
  if (!migration.includes("RETURN v_updated = 1;")) {
    fail(`${label}: X completion/boundary must fail closed (zero-row => false)`);
  }

  // 2. Migration fences X generation: stale token OR generation cannot complete/fail/mark.
  const stales = (migration.match(/AND claim_generation = p_claim_generation/g) ?? []).length;
  if (stales < 4) {
    fail(`${label}: mark/complete/fail/claim X RPCs must each gate on the generation (found ${stales})`);
  }
  if (!migration.includes("AND status = 'posting'")) {
    fail(`${label}: X completes must only act on in-flight postings`);
  }
  if (!migration.includes("claim_state = 'preparing'")) {
    fail(`${label}: X provider boundary must require a preparing claim_state`);
  }
  if (!migration.includes("AND (claim_expires_at IS NULL OR claim_expires_at > now())")) {
    fail(`${label}: X claim must be time-window fenced`);
  }

  // 3. x-poster records the provider_started boundary before the first irreversible call.
  if (xposter.includes("provider_start_marker_failed")) {
    // provider boundary is present in manual path
  } else {
    fail(`${label}: x-poster manual provider boundary is missing`);
  }
  if (!xposter.includes("markXPostDeliveryProviderStarted")) {
    fail(`${label}: x-poster never calls markXPostDeliveryProviderStarted`);
  }
  // SF2: the batch provider-start marker must be reached from outside the
  // `sel.tier !== 'text'` media-only branch so the TEXT tier also records the
  // durable boundary before postTweet. A `if (!dryRun && deliveryClaim)` guard
  // that invokes markXPostDeliveryProviderStarted for every tier is required.
  if (!xposter.includes("if (!dryRun && deliveryClaim) {") &&
      !xposter.includes("if (!dryRun && deliveryClaim !== null) {")) {
    fail(`${label}: batch provider marker must run for ALL tiers incl. text (SF2)`);
  }
  const batchMarkerAnchor = "// Durable provider-start boundary (batch, ALL tiers incl. text — SF2):";
  if (!xposter.includes(batchMarkerAnchor)) {
    fail(`${label}: batch text-tier provider boundary is not documented (SF2)`);
  }
  // The text tier must not be able to reach postTweet without the marker: guard
  // must NOT be nested under a media-only (sel.tier !== 'text') condition.
  if (xposter.includes("if (sel.tier !== 'text' && !dryRun) {\n        let providerOk") ||
      /if \(sel\.tier !== 'text' && !dryRun\) \{[\s\S]{0,120}markXPostDeliveryProviderStarted/.test(xposter)) {
    fail(`${label}: batch provider marker must not be gated behind the media-only branch (SF2)`);
  }

  // 4. Ambiguity discipline: provider-started failure must never map to success.
  if (!xposter.includes("provider_start_marker_failed")) {
    fail(`${label}: marker failure must map to a distinct non-success outcome`);
  }
  if (!xposter.includes("provider_start_marker_rejected")) {
    fail(`${label}: a rejected marker must not proceed to the provider`);
  }

  // 5. package + CI wiring.
  const pkg = JSON.parse(packageJson);
  if (pkg.scripts?.["check:b3a-x-generation"] !== "node scripts/check-b3a-x-generation-contract.mjs") {
    fail(`${label}: package script is missing`);
  }
  if (!ci.includes("- run: npm run check:b3a-x-generation")) {
    fail(`${label}: CI bent wire is missing`);
  }
}

function sources() {
  return {
    claim: fs.readFileSync(claimPath, "utf8"),
    xposter: fs.readFileSync(xposterPath, "utf8"),
    migration: fs.readFileSync(migrationPath, "utf8"),
    packageJson: fs.readFileSync(packagePath, "utf8"),
    ci: fs.readFileSync(ciPath, "utf8"),
  };
}

function assertRejects(mutator, label) {
  try {
    assertContract(mutator(sources()), label);
  } catch (error) {
    if (String(error).includes("B3A_X_GENERATION_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());

if (process.env.MUTATION_TEST === "1") {
  assertRejects((s) => ({
    ...s,
    claim: s.claim.replace(/p_claim_generation: params\.claimGeneration/g, "p_no_generation: 0"),
  }), "removed generation forwarding");
  assertRejects((s) => ({
    ...s,
    migration: s.migration.replace(/AND claim_generation = p_claim_generation/g, "AND locked_by IS NOT NULL"),
  }), "removed X generation fence");
  assertRejects((s) => ({
    ...s,
    xposter: s.xposter.replace(/provider_start_marker_failed/g, "generic_provider_error"),
  }), "provider marker failure not ambiguous");
  assertRejects((s) => ({
    ...s,
    xposter: s.xposter.replace(/markXPostDeliveryProviderStarted/g, "completeXPostDelivery"),
  }), "provider boundary skipped");
  assertRejects((s) => ({
    ...s,
    xposter: s.xposter.replace("if (!dryRun && deliveryClaim) {", "if (false && deliveryClaim) {"),
  }), "batch provider marker skipped for all tiers (SF2)");
  assertRejects((s) => ({
    ...s,
    xposter: s.xposter.replace("// Durable provider-start boundary (batch, ALL tiers incl. text — SF2):", "// media only marker"),
  }), "batch text-tier boundary documentation removed (SF2)");
}

console.log(`B3A_X_GENERATION_SOURCE_CONTRACT_PASS generationFence=fenced providerBoundary=true ambiguousAsNonSuccess=true selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);