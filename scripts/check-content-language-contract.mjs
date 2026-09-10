import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const helperPath = join(repoRoot, "src/lib/contentLanguage.ts");
const monitoringPath = join(repoRoot, "src/components/monitoring/MonitoringDetailDrawer.tsx");
const translationPath = join(repoRoot, "src/components/settings/TranslationPlayground.tsx");
const enrichmentPath = join(repoRoot, "src/components/settings/EnrichmentSettings.tsx");
const videoPath = join(repoRoot, "src/components/video/VideoRenderDetailPanel.tsx");
const testPath = join(repoRoot, "src/test/content-language.test.ts");
const htmlPath = join(repoRoot, "index.html");
const require = createRequire(import.meta.url);
const typescript = require("typescript");
const helperSource = readFileSync(helperPath, "utf8");
const monitoringSource = readFileSync(monitoringPath, "utf8");
const translationSource = readFileSync(translationPath, "utf8");
const enrichmentSource = readFileSync(enrichmentPath, "utf8");
const videoSource = readFileSync(videoPath, "utf8");
const testSource = readFileSync(testPath, "utf8");
const htmlSource = readFileSync(htmlPath, "utf8");

function transpile(path, source) {
  const result = typescript.transpileModule(source, {
    compilerOptions: {
      jsx: typescript.JsxEmit.ReactJSX,
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
  assert.equal(diagnostics.length, 0, `${path} must transpile without TypeScript diagnostics`);
  return result.outputText;
}

const helperTranspile = transpile(helperPath, helperSource);
for (const [path, source] of [
  [monitoringPath, monitoringSource],
  [translationPath, translationSource],
  [enrichmentPath, enrichmentSource],
  [videoPath, videoSource],
  [testPath, testSource],
]) {
  transpile(path, source);
}

const contentLanguage = await import(
  `data:text/javascript;base64,${Buffer.from(helperTranspile).toString("base64")}`,
);
assert.deepEqual(contentLanguage.persianContentAttributes, { dir: "rtl", lang: "fa" });
for (const language of ["fa", "Persian", "fa-IR"]) {
  assert.deepEqual(contentLanguage.contentLanguageAttributes(language), { dir: "rtl", lang: "fa" });
}
for (const language of ["en", "English", "en-US"]) {
  assert.deepEqual(contentLanguage.contentLanguageAttributes(language), { dir: "ltr", lang: "en" });
}
for (const language of [undefined, null, "ar", "mixed", "unknown"]) {
  assert.deepEqual(contentLanguage.contentLanguageAttributes(language), { dir: "auto" });
}

assert.match(htmlSource, /<html\s+lang="en">/, "the English admin shell must retain lang=en");

function sourceFile(path, source) {
  return typescript.createSourceFile(
    path,
    source,
    typescript.ScriptTarget.ES2022,
    true,
    typescript.ScriptKind.TSX,
  );
}

function findNodes(root, predicate) {
  const found = [];
  const visit = (node) => {
    if (predicate(node)) found.push(node);
    typescript.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

function jsxAttribute(opening, name) {
  return opening.attributes.properties.find((property) =>
    typescript.isJsxAttribute(property) && property.name.text === name,
  );
}

function hasStringAttribute(opening, name, value) {
  const attribute = jsxAttribute(opening, name);
  return Boolean(
    attribute &&
    typescript.isJsxAttribute(attribute) &&
    attribute.initializer &&
    typescript.isStringLiteral(attribute.initializer) &&
    attribute.initializer.text === value,
  );
}

function hasSpreadIdentifier(opening, name) {
  return opening.attributes.properties.some((property) =>
    typescript.isJsxSpreadAttribute(property) &&
    typescript.isIdentifier(property.expression) &&
    property.expression.text === name,
  );
}

function hasSpreadCall(opening, name, argumentText, file) {
  return opening.attributes.properties.some((property) =>
    typescript.isJsxSpreadAttribute(property) &&
    typescript.isCallExpression(property.expression) &&
    typescript.isIdentifier(property.expression.expression) &&
    property.expression.expression.text === name &&
    property.expression.arguments.length === 1 &&
    property.expression.arguments[0].getText(file).trim() === argumentText,
  );
}

function jsxElementsWithDirectExpression(file, text, exact = false) {
  return findNodes(file, (node) =>
    typescript.isJsxElement(node) && node.children.some((child) =>
      typescript.isJsxExpression(child) &&
      child.expression &&
      (exact
        ? child.expression.getText(file).trim() === text
        : child.expression.getText(file).trim().startsWith(text)),
    ),
  );
}

function selfClosingWithExpressionAttribute(file, tag, attributeName, expressionText) {
  return findNodes(file, (node) =>
    typescript.isJsxSelfClosingElement(node) &&
    node.tagName.getText(file) === tag &&
    (() => {
      const attribute = jsxAttribute(node, attributeName);
      return Boolean(
        attribute &&
        typescript.isJsxAttribute(attribute) &&
        attribute.initializer &&
        typescript.isJsxExpression(attribute.initializer) &&
        attribute.initializer.expression?.getText(file).trim() === expressionText,
      );
    })(),
  );
}

function assertKnownPersian(elements, label) {
  assert.ok(elements.length > 0, `${label} must remain represented by a concrete JSX element`);
  for (const element of elements) {
    assert.ok(
      hasSpreadIdentifier(element.openingElement, "persianContentAttributes"),
      `${label} must receive lang=fa and dir=rtl together`,
    );
  }
}

function assertUntypedAuto(elements, label) {
  assert.ok(elements.length > 0, `${label} must remain represented by a concrete JSX element`);
  for (const element of elements) {
    assert.equal(hasStringAttribute(element.openingElement, "dir", "auto"), true, `${label} must retain dir=auto`);
    assert.equal(Boolean(jsxAttribute(element.openingElement, "lang")), false, `${label} must not guess a language`);
    assert.equal(element.openingElement.attributes.properties.some(typescript.isJsxSpreadAttribute), false, `${label} must not hide a guessed language in a spread`);
  }
}

const monitoringFile = sourceFile(monitoringPath, monitoringSource);
const translationFile = sourceFile(translationPath, translationSource);
const enrichmentFile = sourceFile(enrichmentPath, enrichmentSource);
const videoFile = sourceFile(videoPath, videoSource);

const translationOutputs = jsxElementsWithDirectExpression(translationFile, "res.translated_text");
assert.equal(translationOutputs.length, 1, "translation playground must retain one explicit translated-text output");
assertKnownPersian(translationOutputs, "translation playground output");
const monitoringTranslations = jsxElementsWithDirectExpression(monitoringFile, "entry.text_translated");
assert.equal(monitoringTranslations.length, 2, "monitoring must retain both explicit translated-text outputs");
assertKnownPersian(monitoringTranslations, "monitoring translation output");
const translationEditors = selfClosingWithExpressionAttribute(monitoringFile, "Textarea", "value", "editedContent");
assert.equal(translationEditors.length, 1, "monitoring translation editor must remain singular and explicit");
for (const element of translationEditors) {
  assert.ok(hasSpreadIdentifier(element, "persianContentAttributes"), "translation editor must receive lang=fa and dir=rtl together");
}
const voiceSampleDisplays = jsxElementsWithDirectExpression(enrichmentFile, "sample", true);
assert.equal(voiceSampleDisplays.length, 1, "voice sample display must remain singular and explicit");
assertUntypedAuto(voiceSampleDisplays, "voice sample display");
const voiceSampleInputs = selfClosingWithExpressionAttribute(enrichmentFile, "Textarea", "value", "newSample");
assert.equal(voiceSampleInputs.length, 1, "voice sample input must remain singular and explicit");
for (const element of voiceSampleInputs) {
  assert.equal(hasStringAttribute(element, "dir", "auto"), true, "voice sample input must retain dir=auto");
  assert.equal(Boolean(jsxAttribute(element, "lang")), false, "voice sample input must not guess a language");
}
for (const field of ["entry.creator_angle", "entry.why_it_matters", "entry.composed_post_text"]) {
  const elements = jsxElementsWithDirectExpression(monitoringFile, field, true);
  assert.equal(elements.length, 1, `${field} must remain singular and explicit`);
  assertUntypedAuto(elements, `${field} fallback`);
}
for (const [text, argument, label] of [
  ["variant.final_x_text", "variant.language_choice", "voice variant"],
  ["entry.final_x_text", "selectedVoice?.language_choice", "selected final post"],
]) {
  const elements = jsxElementsWithDirectExpression(monitoringFile, text, true);
  assert.equal(elements.length, 1, `${label} must remain singular and explicit`);
  for (const element of elements) {
    assert.ok(hasSpreadCall(element.openingElement, "contentLanguageAttributes", argument, monitoringFile), `${label} must use its explicit language metadata`);
  }
}
const videoSubtitles = jsxElementsWithDirectExpression(videoFile, "finalSubtitle", true);
assert.equal(videoSubtitles.length, 1, "video subtitle must retain one explicit finalSubtitle output");
assert.match(
  videoSource,
  /const finalSubtitle = \[render\?\.translated_srt,\s*render\?\.persian_srt\]/,
  "video subtitle must derive finalSubtitle from translated_srt and persian_srt",
);
for (const element of videoSubtitles) {
  assert.ok(hasSpreadCall(element.openingElement, "contentLanguageAttributes", "render.target_language", videoFile), "video subtitle must use its explicit target language");
}
assert.match(testSource, /contentLanguageAttributes/, "future test coverage must exercise the language helper");
assert.match(testSource, /persianContentAttributes/, "future test coverage must retain the known Persian contract");
assert.match(testSource, /\["ar", \{ dir: "auto" \}\]/, "future test coverage must retain the Arabic/unknown fallback");
assert.match(testSource, /\["mixed", \{ dir: "auto" \}\]/, "future test coverage must retain the mixed/unknown fallback");

console.log("CONTENT_LANGUAGE_SOURCE_CONTRACT_PASS cases=11 surfaces=4");
