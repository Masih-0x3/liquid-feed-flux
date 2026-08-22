import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerPath = path.join(repoRoot, "supabase/functions/worker/index.ts");
const source = fs.readFileSync(workerPath, "utf8");
const sourceFile = ts.createSourceFile(workerPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
let functionText = null;
function visit(node) {
  if (functionText || !ts.isFunctionDeclaration(node)) return ts.forEachChild(node, visit);
  if (node.name?.text === "classifyQueueInsertResult") functionText = node.getText(sourceFile);
  else ts.forEachChild(node, visit);
}
visit(sourceFile);
if (!functionText) throw new Error("QUEUE_INSERT_RESULT_CONTRACT_FAIL public classifier missing");
functionText = functionText.replace(/^export\s+/, "");
const js = ts.transpileModule(functionText, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const classify = new Function(`${js}; return classifyQueueInsertResult;`)();
const failure = "hydrate_dedupe_enqueue_failed";
const valid = { id: "job-1" };
const cases = [
  [null, "error"],
  [{ id: "job-1" }, "error"],
  [[valid, { id: "job-2" }], "error"],
  [[{}], "error"],
  [[{ id: "" }], "error"],
  [[], "duplicate"],
  [[valid], "inserted"],
];
for (const [input, expected] of cases) {
  let result = "error";
  try {
    result = classify(input, failure);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== failure) throw error;
  }
  if (result !== expected) throw new Error(`QUEUE_INSERT_RESULT_CONTRACT_FAIL expected=${expected} got=${result}`);
}
if (process.env.MUTATION_TEST === "1") {
  const mutated = functionText.replace('if (data.length === 0) return "duplicate";', 'if (data.length === 0) return "inserted";');
  const mutatedJs = ts.transpileModule(mutated, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const mutatedClassify = new Function(`${mutatedJs}; return classifyQueueInsertResult;`)();
  if (mutatedClassify([], failure) !== "duplicate") {
    // Expected mutation failure: the contract caught the incorrect duplicate classification.
  } else {
    throw new Error("QUEUE_INSERT_RESULT_CONTRACT_FAIL duplicate mutation survived");
  }
}
console.log(`QUEUE_INSERT_RESULT_CONTRACT_PASS malformed=bounded duplicate=empty inserted=one selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);
