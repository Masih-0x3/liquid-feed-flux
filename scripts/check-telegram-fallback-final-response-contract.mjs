import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const paths = {
  delivery: path.join(repoRoot, "supabase/functions/worker/telegramDelivery.ts"),
  worker: path.join(repoRoot, "supabase/functions/worker/index.ts"),
  tests: path.join(repoRoot, "supabase/functions/worker/telegramDelivery.test.ts"),
};

const source = Object.fromEntries(
  Object.entries(paths).map(([name, filePath]) => [name, fs.readFileSync(filePath, "utf8")]),
);

function fail(message) {
  throw new Error("TELEGRAM_FALLBACK_FINAL_RESPONSE_SOURCE_CONTRACT_FAIL " + message);
}

function parseAndTranspile(filePath, input) {
  const sourceFile = ts.createSourceFile(
    filePath,
    input,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if (sourceFile.parseDiagnostics.length > 0) {
    fail(path.basename(filePath) + " has TypeScript parse diagnostics");
  }
  const output = ts.transpileModule(input, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
    reportDiagnostics: true,
    fileName: filePath,
  });
  if ((output.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail(path.basename(filePath) + " has TypeScript transpilation diagnostics");
  }
}

function assertIncludes(input, expected, label) {
  if (!input.includes(expected)) fail(label + " is missing: " + expected);
}

function assertNotIncludes(input, unexpected, label) {
  if (input.includes(unexpected)) fail(label + " must not contain: " + unexpected);
}

function assertOrder(input, first, second, label) {
  const firstIndex = input.indexOf(first);
  const secondIndex = input.indexOf(second);
  if (firstIndex === -1 || secondIndex === -1 || firstIndex >= secondIndex) {
    fail(label + " has invalid order");
  }
}

function exportedFunctionRange(filePath, input, name) {
  const sourceFile = ts.createSourceFile(
    filePath,
    input,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let range = null;
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      range = { start: node.getStart(sourceFile), end: node.end };
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  if (!range) fail(name + " function declaration is missing");
  return range;
}

function exportedFunctionText(filePath, input, name) {
  const range = exportedFunctionRange(filePath, input, name);
  return input.slice(range.start, range.end);
}

function replaceInExportedFunction(input, name, expected, replacement) {
  const range = exportedFunctionRange(paths.delivery, input, name);
  const block = input.slice(range.start, range.end);
  const mutatedBlock = block.replace(expected, replacement);
  if (mutatedBlock === block) fail(name + " mutant target is missing");
  return input.slice(0, range.start) + mutatedBlock + input.slice(range.end);
}

function textBetween(input, startMarker, endMarker, label) {
  const start = input.indexOf(startMarker);
  const end = input.indexOf(endMarker, start);
  if (start === -1 || end === -1 || start >= end) fail(label + " range is missing");
  return input.slice(start, end);
}

function assertFallbackFunction(input, spec, label) {
  const block = exportedFunctionText(paths.delivery, input, spec.name);
  assertIncludes(block, "if (isTelegramParseError(result?.description ?? \"\"))", label + " parse fallback");
  assertIncludes(block, "let finalResult = result;", label + " final result initialization");
  assertIncludes(block, "let finalStatus = " + spec.initialStatus + ";", label + " final status initialization");
  assertIncludes(block, "const retryResult = await " + spec.retryResponse + ".json();", label + " retry response parsing");
  assertIncludes(block, "if (retryResult?.ok)", label + " retry success guard");
  assertIncludes(block, spec.retrySuccess, label + " retry success behavior");
  assertIncludes(block, "finalResult = retryResult;", label + " final result propagation");
  assertIncludes(block, "finalStatus = " + spec.retryStatus + ";", label + " final status propagation");
  assertIncludes(block, "throwTelegramError(" + spec.method + ", finalResult, finalStatus);", label + " final error classification");
  assertNotIncludes(block, "throwTelegramError(" + spec.method + ", result, " + spec.initialStatus + ");", label + " first-response classification");
  assertOrder(block, "const retryResult = await " + spec.retryResponse + ".json();", "if (retryResult?.ok)", label + " retry success guard");
  assertOrder(block, "const retryResult = await " + spec.retryResponse + ".json();", spec.retrySuccess, label + " retry success behavior");
  assertOrder(block, spec.retrySuccess, "finalResult = retryResult;", label + " retry success before final failure propagation");
  assertOrder(block, "const retryResult = await " + spec.retryResponse + ".json();", "finalResult = retryResult;", label + " result propagation");
  assertOrder(block, "finalResult = retryResult;", "throwTelegramError(" + spec.method + ", finalResult, finalStatus);", label + " final error classification");
}

function assertContract(sources, label) {
  parseAndTranspile(paths.delivery, sources.delivery);
  parseAndTranspile(paths.worker, sources.worker);
  parseAndTranspile(paths.tests, sources.tests);

  const deliverySpecs = [
    {
      name: "sendTelegramPhotoFromStorage",
      method: "\"sendPhoto\"",
      initialStatus: "resp.status",
      retryResponse: "retry",
      retryStatus: "retry.status",
      retrySuccess: "if (retryResult?.ok) return [String(retryResult.result.message_id)];",
    },
    {
      name: "sendTelegramPhotoGroupFromStorage",
      method: "\"sendMediaGroup\"",
      initialStatus: "resp.status",
      retryResponse: "retryResp",
      retryStatus: "retryResp.status",
      retrySuccess: "return retryResult.result.map((m: Record<string, unknown>) => String(m.message_id));",
    },
    {
      name: "sendTelegramVideoFromStorage",
      method: "\"sendVideo\"",
      initialStatus: "resp.status",
      retryResponse: "retry",
      retryStatus: "retry.status",
      retrySuccess: "if (retryResult?.ok) return [String(retryResult.result.message_id)];",
    },
    {
      name: "sendTelegramMedia",
      method: "method",
      initialStatus: "response.status",
      retryResponse: "retryResp",
      retryStatus: "retryResp.status",
      retrySuccess: "if (retryResult?.ok) return [String(retryResult.result.message_id)];",
    },
  ];
  for (const spec of deliverySpecs) {
    assertFallbackFunction(sources.delivery, spec, label + " " + spec.name);
  }

  const sendMessage = textBetween(
    sources.worker,
    "addTelegramMethod(\"sendMessage\");",
    "let completed = false;",
    label + " worker main-text fallback",
  );
  assertIncludes(sendMessage, "if (isTelegramParseError(result?.description ?? \"\"))", label + " worker parse fallback");
  assertIncludes(sendMessage, "let finalResult = result;", label + " worker final result initialization");
  assertIncludes(sendMessage, "let finalStatus = response.status;", label + " worker final status initialization");
  assertIncludes(sendMessage, "const retryResult = await retryResp.json();", label + " worker retry response parsing");
  assertIncludes(sendMessage, "if (retryResult?.ok) {", label + " worker retry success guard");
  assertIncludes(sendMessage, "telegramMessageIds.push(String(retryResult.result.message_id));", label + " worker retry success behavior");
  assertIncludes(sendMessage, "finalResult = retryResult;", label + " worker final result propagation");
  assertIncludes(sendMessage, "finalStatus = retryResp.status;", label + " worker final status propagation");
  assertIncludes(sendMessage, "if (!finalResult?.ok)", label + " worker final error gate");
  assertIncludes(sendMessage, "throwTelegramError(\"sendMessage\", finalResult, finalStatus);", label + " worker final error classification");
  assertNotIncludes(sendMessage, "throwTelegramError(\"sendMessage\", result, response.status);", label + " worker first-response classification");
  assertOrder(sendMessage, "const retryResult = await retryResp.json();", "if (retryResult?.ok) {", label + " worker retry success guard");
  assertOrder(sendMessage, "if (retryResult?.ok) {", "telegramMessageIds.push(String(retryResult.result.message_id));", label + " worker retry success behavior");
  assertOrder(sendMessage, "finalResult = retryResult;", "if (!finalResult?.ok)", label + " worker final error gate");
  assertOrder(sendMessage, "if (!finalResult?.ok)", "throwTelegramError(\"sendMessage\", finalResult, finalStatus);", label + " worker final error classification");

  assertIncludes(
    sources.tests,
    "sendTelegramMedia classifies a fallback rate limit from the final response",
    label + " fallback 429 fixture",
  );
  assertIncludes(
    sources.tests,
    "sendTelegramMedia reports a fallback server error from the final response",
    label + " fallback 500 fixture",
  );
  assertIncludes(sources.tests, "retry_after: 7", label + " fallback retry-after fixture");
  assertIncludes(sources.tests, "final attempt failed", label + " fallback final-description fixture");
  for (const successFixture of [
    "sendTelegramMedia retries Markdown parse failures as plain text",
    "sendTelegramPhotoFromStorage returns the fallback success id",
    "sendTelegramPhotoGroupFromStorage returns fallback success ids",
    "sendTelegramVideoFromStorage returns the fallback success id",
  ]) {
    assertIncludes(sources.tests, successFixture, label + " fallback success fixture");
  }

  return { fallbackPaths: deliverySpecs.length + 1 };
}

function makeDeliveryResultMutant(input) {
  return input.replace("finalResult = retryResult;", "finalResult = result;");
}

function makeDeliveryStatusMutant(input) {
  return input.replace("finalStatus = retry.status;", "finalStatus = resp.status;");
}

function makeDeliveryThrowMutant(input) {
  return input.replace(
    "throwTelegramError(\"sendPhoto\", finalResult, finalStatus);",
    "throwTelegramError(\"sendPhoto\", result, resp.status);",
  );
}

function makeDeliverySuccessMutant(input, name) {
  return replaceInExportedFunction(input, name, "if (retryResult?.ok)", "if (false)");
}

function makeWorkerResultMutant(input) {
  return input.replace("finalResult = retryResult;", "finalResult = result;");
}

function makeWorkerThrowMutant(input) {
  return input.replace(
    "throwTelegramError(\"sendMessage\", finalResult, finalStatus);",
    "throwTelegramError(\"sendMessage\", result, response.status);",
  );
}

function makeWorkerSuccessMutant(input) {
  return input.replace("if (retryResult?.ok) {", "if (false) {");
}

function makeFixtureMutant(input) {
  return input.replace(
    "sendTelegramMedia reports a fallback server error from the final response",
    "fallback server error fixture removed",
  );
}

function makeSuccessFixtureMutant(input) {
  return input.replace(
    "sendTelegramVideoFromStorage returns the fallback success id",
    "fallback video success fixture removed",
  );
}

const result = assertContract(source, "current source");
const selfTest = process.argv.includes("--self-test");

if (selfTest) {
  const mutants = [
    ["delivery-final-result", { ...source, delivery: makeDeliveryResultMutant(source.delivery) }],
    ["delivery-final-status", { ...source, delivery: makeDeliveryStatusMutant(source.delivery) }],
    ["delivery-final-throw", { ...source, delivery: makeDeliveryThrowMutant(source.delivery) }],
    ["photo-retry-success", { ...source, delivery: makeDeliverySuccessMutant(source.delivery, "sendTelegramPhotoFromStorage") }],
    ["media-group-retry-success", { ...source, delivery: makeDeliverySuccessMutant(source.delivery, "sendTelegramPhotoGroupFromStorage") }],
    ["video-retry-success", { ...source, delivery: makeDeliverySuccessMutant(source.delivery, "sendTelegramVideoFromStorage") }],
    ["generic-media-retry-success", { ...source, delivery: makeDeliverySuccessMutant(source.delivery, "sendTelegramMedia") }],
    ["worker-final-result", { ...source, worker: makeWorkerResultMutant(source.worker) }],
    ["worker-final-throw", { ...source, worker: makeWorkerThrowMutant(source.worker) }],
    ["worker-retry-success", { ...source, worker: makeWorkerSuccessMutant(source.worker) }],
    ["final-response-fixture", { ...source, tests: makeFixtureMutant(source.tests) }],
    ["fallback-success-fixture", { ...source, tests: makeSuccessFixtureMutant(source.tests) }],
  ];
  for (const [name, mutant] of mutants) {
    let rejected = false;
    try {
      assertContract(mutant, name + " mutant");
    } catch (error) {
      rejected = String(error).includes("TELEGRAM_FALLBACK_FINAL_RESPONSE_SOURCE_CONTRACT_FAIL");
    }
    if (!rejected) fail(name + " mutant was not rejected by the source contract");
  }
}

console.log(
  "TELEGRAM_FALLBACK_FINAL_RESPONSE_SOURCE_CONTRACT_PASS fallbackPaths=" + result.fallbackPaths
    + " selfTest=" + (selfTest ? "pass" : "skipped"),
);
