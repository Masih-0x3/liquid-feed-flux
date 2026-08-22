import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(repoRoot, "supabase/functions/digest-compiler/index.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true);

const sensitiveFields = new Set([
  "twitter_consumer_key",
  "twitter_consumer_secret",
  "twitter_access_token",
  "twitter_access_token_secret",
]);
const allowedDigestConfigFields = new Set([
  "frequency_minutes",
  "max_bullets",
  "min_posts",
  "header_format",
]);
const forbiddenCredentialEnvKeys = new Set([
  "TWITTER_CONSUMER_KEY",
  "TWITTER_CONSUMER_SECRET",
  "TWITTER_ACCESS_TOKEN",
  "TWITTER_ACCESS_TOKEN_SECRET",
]);

function fail(message) {
  throw new Error(`DIGEST_CONFIG_SECRET_BOUNDARY_SOURCE_CONTRACT_FAIL ${message}`);
}

function propertyName(node) {
  if (!node) return null;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  return null;
}

function visit(node, callback) {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}

function findNamedDeclaration(kind, name) {
  let found = null;
  visit(sourceFile, (node) => {
    if (found || !node.name || propertyName(node.name) !== name) return;
    if (kind(node)) found = node;
  });
  return found;
}

function objectPropertyNames(node) {
  if (!node || !ts.isObjectLiteralExpression(node)) return [];
  return node.properties
    .filter(ts.isPropertyAssignment)
    .map((property) => propertyName(property.name))
    .filter(Boolean);
}

function isDenoEnvGet(node) {
  return ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === "get"
    && ts.isPropertyAccessExpression(node.expression.expression)
    && node.expression.expression.name.text === "env"
    && ts.isIdentifier(node.expression.expression.expression)
    && node.expression.expression.expression.text === "Deno";
}

function denoEnvKey(node) {
  const argument = node.arguments[0];
  return ts.isStringLiteral(argument) ? argument.text : null;
}

function unwrapExpression(node) {
  while (
    node
    && (ts.isParenthesizedExpression(node)
      || ts.isAsExpression(node)
      || ts.isSatisfiesExpression(node)
      || ts.isNonNullExpression(node))
  ) {
    node = node.expression;
  }
  return node;
}

function propertyPath(node) {
  if (!ts.isPropertyAccessExpression(node) || !ts.isIdentifier(node.expression)) return null;
  return `${node.expression.text}.${node.name.text}`;
}

const diagnostics = sourceFile.parseDiagnostics;
if (diagnostics.length > 0) fail("digest compiler parse diagnostics");

const transpile = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
  reportDiagnostics: true,
  fileName: sourcePath,
});
if ((transpile.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
  fail("digest compiler transpilation diagnostics");
}

const digestConfig = findNamedDeclaration(ts.isInterfaceDeclaration, "DigestConfig");
if (!digestConfig) fail("DigestConfig interface missing");
const digestConfigFields = new Set(
  digestConfig.members.map((member) => propertyName(member.name)).filter(Boolean),
);
for (const field of sensitiveFields) {
  if (digestConfigFields.has(field)) fail(`DigestConfig still accepts ${field}`);
}
for (const field of allowedDigestConfigFields) {
  if (!digestConfigFields.has(field)) fail(`DigestConfig lost allowed field ${field}`);
}

const defaultDigestConfig = findNamedDeclaration(ts.isVariableDeclaration, "DEFAULT_DIGEST_CONFIG");
if (!defaultDigestConfig) fail("DEFAULT_DIGEST_CONFIG missing");
const defaultDigestConfigObject = unwrapExpression(defaultDigestConfig.initializer);
const defaultDigestConfigFields = new Set(objectPropertyNames(defaultDigestConfigObject));
for (const field of sensitiveFields) {
  if (defaultDigestConfigFields.has(field)) fail(`DEFAULT_DIGEST_CONFIG still includes ${field}`);
}
for (const field of allowedDigestConfigFields) {
  if (!defaultDigestConfigFields.has(field)) fail(`DEFAULT_DIGEST_CONFIG lost allowed field ${field}`);
}

const parser = findNamedDeclaration(ts.isFunctionDeclaration, "readDigestConfigOverride");
if (!parser || !parser.body) fail("readDigestConfigOverride missing");
let parserCallsShapeGuard = false;
let parserReadsSensitiveField = false;
visit(parser.body, (node) => {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "assertDigestConfigShape") {
    parserCallsShapeGuard = true;
  }
  if (ts.isPropertyAccessExpression(node) && sensitiveFields.has(node.name.text)) {
    parserReadsSensitiveField = true;
  }
});
if (!parserCallsShapeGuard) fail("digest config parser does not call assertDigestConfigShape");
if (parserReadsSensitiveField) fail("digest config parser still reads a credential field");

const shapeGuard = findNamedDeclaration(ts.isFunctionDeclaration, "assertDigestConfigShape");
if (!shapeGuard || !shapeGuard.body) fail("assertDigestConfigShape missing");
let guardUsesCredentialPattern = false;
let guardRejectsUnsupportedKeys = false;
let guardRecurses = false;
visit(shapeGuard.body, (node) => {
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)
    && node.expression.text === "CREDENTIAL_LIKE_CONFIG_KEY" && node.name.text === "test") {
    guardUsesCredentialPattern = true;
  }
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)
    && node.expression.text === "DIGEST_CONFIG_KEYS" && node.name.text === "has") {
    guardRejectsUnsupportedKeys = true;
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "visit") {
    guardRecurses = true;
  }
});
if (!guardUsesCredentialPattern) fail("shape guard does not test credential-like keys");
if (!guardRejectsUnsupportedKeys) fail("shape guard does not reject unsupported top-level keys");
if (!guardRecurses) fail("shape guard does not inspect nested values");

const forbiddenDigestCredentialPaths = new Set(
  [...sensitiveFields].map((field) => `digestConfig.${field}`),
);
const credentialEnvKeys = new Set();
let postTweetSinks = 0;
visit(sourceFile, (node) => {
  const path = propertyPath(node);
  if (path && forbiddenDigestCredentialPaths.has(path)) fail(`${path} remains reachable after env-only cutover`);
  if (ts.isCallExpression(node) && isDenoEnvGet(node)) {
    const key = denoEnvKey(node);
    if (key && forbiddenCredentialEnvKeys.has(key)) credentialEnvKeys.add(key);
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "postTweet") {
    postTweetSinks += 1;
  }
});
if (credentialEnvKeys.size !== 0) fail("digest compiler still reads TWITTER_* credentials");
if (postTweetSinks !== 0) fail(`digest compiler still has ${postTweetSinks} postTweet sinks`);
if (source.includes("https://api.x.com/2/tweets") || source.includes("twitterCredentials")) {
  fail("digest compiler still contains direct X delivery source");
}

console.log(
  `DIGEST_CONFIG_SECRET_BOUNDARY_SOURCE_CONTRACT_PASS digestFields=${digestConfigFields.size} envKeys=${credentialEnvKeys.size} postTweetSinks=${postTweetSinks}`,
);
