import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helperPath = path.join(repoRoot, "supabase/functions/_shared/xPostDeliveryClaim.ts");
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function fail(message) {
  throw new Error(`X_POST_DELIVERY_CLAIM_SOURCE_CONTRACT_FAIL ${message}`);
}

function parse(source) {
  const file = ts.createSourceFile(helperPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (file.parseDiagnostics.length > 0) fail("helper parse diagnostics");
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName: helperPath,
  });
  if ((output.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail("helper transpilation diagnostics");
  }
}

function assertContract({ helper, packageJson, ci }, label = "current source") {
  parse(helper);
  for (const code of [
    "claim_x_post_delivery_failed",
    "complete_x_post_delivery_failed",
    "fail_x_post_delivery_failed",
  ]) {
    if (!helper.includes(`xPostDeliveryRpcErrorCode(\"${code.replace("_failed", "")}\")`)) {
      fail(`${label}: missing stable ${code}`);
    }
  }
  if (!helper.includes("function xPostDeliveryRpcErrorCode(name: string): string")) {
    fail(`${label}: shared RPC error normalizer is missing`);
  }
  if (/error\.message|rpcError\.message|String\(error\)/.test(helper)) {
    fail(`${label}: RPC exception text must not cross the claim boundary`);
  }
  for (const [name, rpcName, code] of [
    ["claimXPostDelivery", "claim_x_post_delivery", "claim_x_post_delivery_failed"],
    ["completeXPostDelivery", "complete_x_post_delivery", "complete_x_post_delivery_failed"],
    ["failXPostDelivery", "fail_x_post_delivery", "fail_x_post_delivery_failed"],
  ]) {
    const start = helper.indexOf(`export async function ${name}`);
    const end = helper.indexOf("\n}\n", start);
    if (start < 0 || end < 0) fail(`${label}: ${name} section is missing`);
    const section = helper.slice(start, end);
    if (!section.includes("if (")) fail(`${label}: ${name} must check RPC errors`);
    if (!section.includes(`xPostDeliveryRpcErrorCode(\"${rpcName}\")`)) fail(`${label}: ${name} must throw ${code}`);
    const errorName = name === "failXPostDelivery" ? "rpcError" : "error";
    if (!section.includes(`if (${errorName}) throw new Error(xPostDeliveryRpcErrorCode(`)) {
      fail(`${label}: ${name} must fail closed on its RPC result`);
    }
  }
  // Generation fence: complete/fail must forward p_claim_generation so a stale
  // token OR stale generation cannot settle the delivery.
  if (!helper.includes("p_claim_generation: params.claimGeneration")) {
    fail(`${label}: complete/fail must forward the claim generation`);
  }
  // Provider boundary: a durable marker must exist and return a boolean to the caller.
  if (!helper.includes("export async function markXPostDeliveryProviderStarted(")) {
    fail(`${label}: markXPostDeliveryProviderStarted boundary is missing`);
  }
  if (!helper.includes('"mark_x_delivery_provider_started"')) {
    fail(`${label}: provider boundary RPC is missing`);
  }
  const markStart = helper.indexOf("export async function markXPostDeliveryProviderStarted(");
  if (markStart >= 0) {
    const markSection = helper.slice(markStart, helper.indexOf("\n}\n", markStart));
    if (!markSection.includes("params.claimGeneration <= 0")) {
      fail(`${label}: provider boundary must reject a non-positive generation`);
    }
    if (!markSection.includes("return data === true;")) {
      fail(`${label}: provider boundary must map RPC true/false, never throw as success`);
    }
  }
  const packageData = JSON.parse(packageJson);
  if (packageData.scripts?.["check:x-post-delivery-claim"] !==
      "node scripts/check-x-post-delivery-claim-contract.mjs") {
    fail(`${label}: package script is missing`);
  }
  if (!ci.includes("- run: npm run check:x-post-delivery-claim")) {
    fail(`${label}: CI contract is missing`);
  }
}

function sources() {
  return {
    helper: fs.readFileSync(helperPath, "utf8"),
    packageJson: fs.readFileSync(packagePath, "utf8"),
    ci: fs.readFileSync(ciPath, "utf8"),
  };
}

function assertRejects(mutator, label) {
  try {
    assertContract(mutator(sources()), label);
  } catch (error) {
    if (String(error).includes("X_POST_DELIVERY_CLAIM_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());

if (process.env.MUTATION_TEST === "1") {
  for (const [stable, raw] of [
    ["claim_x_post_delivery_failed", "claim_x_post_delivery: permission denied"],
    ["complete_x_post_delivery_failed", "complete_x_post_delivery: constraint violation"],
    ["fail_x_post_delivery_failed", "fail_x_post_delivery: timeout"],
  ]) {
    assertRejects((source) => ({
      ...source,
      helper: source.helper.replace(
        `xPostDeliveryRpcErrorCode(\"${stable.replace("_failed", "")}\")`,
        `\"${raw}\"`,
      ),
    }), `${stable} raw error mutant`);
  }
  assertRejects((source) => ({
    ...source,
    helper: source.helper.replace(
      "if (error) throw new Error(xPostDeliveryRpcErrorCode(\"claim_x_post_delivery\"));",
      "if (false) throw new Error(\"claim_x_post_delivery_failed\");",
    ),
  }), "claim RPC error guard removal mutant");
  assertRejects((source) => ({
    ...source,
    helper: source.helper.replace(/p_claim_generation: params\.claimGeneration/g, "p_no_generation: 0"),
  }), "generation forwarding removal mutant");
  assertRejects((source) => ({
    ...source,
    helper: source.helper.replace("return data === true;", "return true;"),
  }), "provider boundary non-success mapping mutant");
}

console.log(
  `X_POST_DELIVERY_CLAIM_SOURCE_CONTRACT_PASS rpcErrors=3 selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`,
);
