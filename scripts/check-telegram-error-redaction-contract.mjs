import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const helperPath = join(repoRoot, "supabase/functions/_shared/safeProviderTelemetry.ts");
const deliveryPath = join(repoRoot, "supabase/functions/worker/telegramDelivery.ts");
const testPath = join(repoRoot, "supabase/functions/worker/telegramDelivery.test.ts");
const packagePath = join(repoRoot, "package.json");
const workflowPath = join(repoRoot, ".github/workflows/ci.yml");
const helperSource = readFileSync(helperPath, "utf8");
const deliverySource = readFileSync(deliveryPath, "utf8");
const testSource = readFileSync(testPath, "utf8");
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
const workflowSource = readFileSync(workflowPath, "utf8");
const require = createRequire(import.meta.url);
const typescript = require("typescript");

function fail(message) {
  throw new Error(`TELEGRAM_ERROR_REDACTION_SOURCE_CONTRACT_FAIL ${message}`);
}

function assertTranspiles(path, source) {
  const result = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2022,
      strict: true,
    },
    fileName: path,
    reportDiagnostics: true,
  });
  const diagnostics = (result.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === typescript.DiagnosticCategory.Error,
  );
  if (diagnostics.length > 0) fail(`${path} has TypeScript diagnostics`);
  return result.outputText;
}

function assertSource(source, label) {
  if (!source.includes("safeTelegramErrorMessage")) fail(`${label} does not use the safe message helper`);
  if (source.includes("failed: ${description}") || source.includes("failed: ${String(result")) {
    fail(`${label} interpolates raw provider description`);
  }
  if (source.includes("telegram_video_download_failed:${storagePath}") ||
      source.includes("error?.message")) {
    fail(`${label} forwards raw storage path or download error text`);
  }
}

assertTranspiles(helperPath, helperSource);
assertTranspiles(deliveryPath, deliverySource);
assertTranspiles(testPath, testSource);
assertSource(deliverySource, "telegram delivery");

const helper = await import(
  `data:text/javascript;base64,${Buffer.from(assertTranspiles(helperPath, helperSource)).toString("base64")}`,
);
const generic = helper.safeTelegramErrorMessage(
  "sendPhoto",
  500,
  null,
);
assert.equal(generic, "Telegram sendPhoto failed with status 500");
assert.equal(generic.includes("final attempt failed"), false);

const rateLimited = helper.safeTelegramErrorMessage("sendMessage", 429, 7);
assert.equal(rateLimited, "Telegram sendMessage failed: Too Many Requests (retry after 7)");

const hostileMethod = helper.safeTelegramErrorMessage(
  "sendPhoto https://cdn.example.test/a?token=secret",
  500,
  null,
);
assert.equal(hostileMethod, "Telegram unknown failed with status 500");
assert.equal(hostileMethod.includes("token=secret"), false);

if (packageJson.scripts?.["check:telegram-error-redaction"] !==
    "node scripts/check-telegram-error-redaction-contract.mjs") {
  fail("package script is not registered");
}
if (!workflowSource.includes("npm run check:telegram-error-redaction")) {
  fail("hosted CI does not run the redaction contract");
}
if (!testSource.includes("status 500") || !testSource.includes("final attempt failed")) {
  fail("provider error test fixture is missing the safe-message regression assertion");
}

if (process.env.MUTATION_TEST === "1") {
  const rawDescriptionMutant = deliverySource.replace(
    "throw new Error(safeMessage);",
    "throw new Error(`Telegram ${method} failed: ${description}`);",
  );
  let rejected = false;
  try {
    assertSource(rawDescriptionMutant, "raw-description mutant");
  } catch (error) {
    rejected = String(error).includes("TELEGRAM_ERROR_REDACTION_SOURCE_CONTRACT_FAIL");
  }
  if (!rejected) fail("raw provider-description mutant was not rejected");

  const helperBypassMutant = deliverySource.replace(
    "const safeMessage = safeTelegramErrorMessage(\n    method,\n    statusCode,\n    retryAfter,\n  );",
    "const safeMessage = `Telegram ${method} failed: ${description}`;",
  );
  rejected = false;
  try {
    assertSource(helperBypassMutant, "helper-bypass mutant");
  } catch (error) {
    rejected = String(error).includes("TELEGRAM_ERROR_REDACTION_SOURCE_CONTRACT_FAIL");
  }
  if (!rejected) fail("helper-bypass mutant was not rejected");

  let videoDownloadMutant = false;
  try {
    assertSource(
      deliverySource.replace(
        'throw new Error("telegram_video_download_failed");',
        'throw new Error(`telegram_video_download_failed:${storagePath}:${error?.message ?? "no blob"}`);',
      ),
      "raw video-download mutant",
    );
  } catch (error) {
    videoDownloadMutant = String(error).includes("TELEGRAM_ERROR_REDACTION_SOURCE_CONTRACT_FAIL");
  }
  if (!videoDownloadMutant) fail("raw video-download mutant was not rejected");
}

console.log(
  `TELEGRAM_ERROR_REDACTION_SOURCE_CONTRACT_PASS raw_description=blocked status=bounded selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`,
);
