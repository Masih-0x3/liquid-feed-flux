import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const paths = {
  settings: path.join(repoRoot, "src/pages/Settings.tsx"),
  enrichment: path.join(repoRoot, "src/components/settings/EnrichmentSettings.tsx"),
  video: path.join(repoRoot, "src/components/settings/VideoRenderingSettings.tsx"),
};

const source = Object.fromEntries(
  Object.entries(paths).map(([name, filePath]) => [name, fs.readFileSync(filePath, "utf8")]),
);

function fail(message) {
  throw new Error("SETTINGS_FAIL_CLOSED_SOURCE_CONTRACT_FAIL " + message);
}

function parseAndTranspile(filePath, input) {
  const sourceFile = ts.createSourceFile(
    filePath,
    input,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  if (sourceFile.parseDiagnostics.length > 0) {
    fail(path.basename(filePath) + " has TypeScript parse diagnostics");
  }
  const output = ts.transpileModule(input, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
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

function assertContract(sources, label) {
  parseAndTranspile(paths.settings, sources.settings);
  parseAndTranspile(paths.enrichment, sources.enrichment);
  parseAndTranspile(paths.video, sources.video);

  assertIncludes(
    sources.settings,
    "const hasAuthoritativeSettingsBaseline = hasSettingsBaseline(settings);",
    label + " root Settings baseline parser",
  );
  assertIncludes(
    sources.settings,
    "if (settingsQuery.isError || settingsQuery.error || !hasAuthoritativeSettingsBaseline)",
    label + " root Settings error gate",
  );
  assertIncludes(sources.settings, "Settings are unavailable", label + " root Settings error title");
  assertIncludes(sources.settings, "Nothing can be changed until the read succeeds.", label + " root Settings fail-closed copy");
  assertIncludes(sources.settings, "settingsQuery.refetch()", label + " root Settings retry");
  assertOrder(
    sources.settings,
    "if (settingsQuery.isError || settingsQuery.error || !hasAuthoritativeSettingsBaseline)",
    "if (!ts || !tgs || !mt) return null;",
    label + " root Settings error gate",
  );

  assertIncludes(
    sources.enrichment,
    "useState<EnrichmentConfig | null>(null)",
    label + " enrichment config baseline state",
  );
  assertNotIncludes(
    sources.enrichment,
    "useState<EnrichmentConfig>(DEFAULT_CONFIG)",
    label + " enrichment config baseline state",
  );
  assertIncludes(sources.enrichment, "const [loadError, setLoadError] = useState(false);", label + " enrichment error state");
  assertIncludes(sources.enrichment, "setConfig(null);", label + " enrichment fail-closed state reset");
  assertIncludes(sources.enrichment, "setLoadError(true);", label + " enrichment load failure");
  assertIncludes(sources.enrichment, "function parseEnrichmentConfig(value: unknown): EnrichmentConfig | null", label + " enrichment parser");
  assertIncludes(sources.enrichment, "parseEnrichmentConfig(enrichmentConfig)", label + " enrichment parsed baseline");
  assertIncludes(
    sources.enrichment,
    "function parsePersonalVoiceProfile(value: unknown): PersonalVoiceProfile | null",
    label + " enrichment personal voice profile parser",
  );
  assertIncludes(
    sources.enrichment,
    "const parsedProfile = parsePersonalVoiceProfile(profile);",
    label + " enrichment stored profile parser",
  );
  assertIncludes(
    sources.enrichment,
    "const profile = parsePersonalVoiceProfile(data?.profile);",
    label + " enrichment generated profile parser",
  );
  assertIncludes(
    sources.enrichment,
    "const rules = parseStringArray(field);",
    label + " enrichment profile nested array parser",
  );
  assertIncludes(
    sources.enrichment,
    "const intentRules = parseStringRecord(value.intent_rules);",
    label + " enrichment profile nested record parser",
  );
  assertNotIncludes(
    sources.enrichment,
    "setVoiceProfile(profile as PersonalVoiceProfile);",
    label + " enrichment stored profile cast",
  );
  assertNotIncludes(
    sources.enrichment,
    "setVoiceProfile(data.profile as PersonalVoiceProfile);",
    label + " enrichment generated profile cast",
  );
  assertIncludes(sources.enrichment, "if (loadError || !config)", label + " enrichment error gate");
  assertIncludes(sources.enrichment, "Retry loading settings", label + " enrichment retry");
  assertIncludes(sources.enrichment, "if (!config) return;", label + " enrichment save guard");
  assertIncludes(sources.enrichment, "authoritative default baseline", label + " enrichment empty baseline copy");
  assertNotIncludes(
    sources.enrichment,
    "console.error('Failed to load enrichment settings:'",
    label + " enrichment raw load logging",
  );
  assertOrder(
    sources.enrichment,
    "const data = await fetchSettingsRows",
    "setConfig(parsedConfig);",
    label + " enrichment default construction",
  );
  const enrichmentLoadStart = sources.enrichment.indexOf("async function loadSettings()");
  const enrichmentFetch = sources.enrichment.indexOf("const data = await fetchSettingsRows");
  const enrichmentLoadPrefix = sources.enrichment.slice(enrichmentLoadStart, enrichmentFetch);
  assertNotIncludes(enrichmentLoadPrefix, "setConfig({", label + " enrichment pre-read writable default");
  assertNotIncludes(enrichmentLoadPrefix, "setConfig(DEFAULT_CONFIG)", label + " enrichment pre-read writable default");
  assertOrder(
    sources.enrichment,
    "if (loadError || !config)",
    "{/* Master Toggle */}",
    label + " enrichment error render",
  );

  assertIncludes(sources.video, "if (configQuery.isLoading)", label + " video loading state");
  assertIncludes(sources.video, "function isVideoRenderConfig(value: unknown): value is VideoRenderConfigValue", label + " video config parser");
  assertIncludes(sources.video, "if (isVideoRenderConfig(config) && !draft)", label + " video parsed baseline");
  assertIncludes(sources.video, "useState<VideoRenderConfigValue | null>(null)", label + " video draft baseline");
  assertNotIncludes(sources.video, "useState<VideoRenderConfigValue>(DEFAULT_", label + " video draft baseline");
  assertIncludes(sources.video, "if (configQuery.isError || configQuery.error || !draft)", label + " video error gate");
  assertNotIncludes(sources.video, "if (configQuery.isLoading || !draft)", label + " video permanent spinner");
  assertIncludes(sources.video, "Video rendering settings are unavailable", label + " video error title");
  assertIncludes(sources.video, "configQuery.refetch()", label + " video retry");
  assertOrder(
    sources.video,
    "if (configQuery.isError || configQuery.error || !draft)",
    "const set = (patch: Partial<VideoRenderConfigValue>)",
    label + " video error gate",
  );

  return { rootGates: 1, cardGates: 2 };
}

function makeRootErrorGateMutant(input) {
  return input.replace(
    "if (settingsQuery.isError || settingsQuery.error || !hasAuthoritativeSettingsBaseline)",
    "if (false)",
  );
}

function makeRootBaselineMutant(input) {
  return input.replace(
    "const hasAuthoritativeSettingsBaseline = hasSettingsBaseline(settings);",
    "const hasAuthoritativeSettingsBaseline = true;",
  );
}

function makeEnrichmentWritableDefaultMutant(input) {
  return input.replace(
    "useState<EnrichmentConfig | null>(null)",
    "useState<EnrichmentConfig>(DEFAULT_CONFIG)",
  );
}

function makeVideoSpinnerMutant(input) {
  return input.replace(
    "if (configQuery.isError || configQuery.error || !draft)",
    "if (configQuery.isLoading || !draft)",
  );
}

function makeEnrichmentParserMutant(input) {
  return input.replace(
    ": parseEnrichmentConfig(enrichmentConfig);",
    ": { ...DEFAULT_CONFIG };",
  );
}

function makeEnrichmentPreloadDefaultMutant(input) {
  return input.replace(
    "async function loadSettings() {",
    "async function loadSettings() {" + String.fromCharCode(10) + "    setConfig({ ...DEFAULT_CONFIG });",
  );
}

function makeStoredProfileParserMutant(input) {
  return input.replace(
    "const parsedProfile = parsePersonalVoiceProfile(profile);",
    "const parsedProfile = profile as PersonalVoiceProfile;",
  );
}

function makeGeneratedProfileParserMutant(input) {
  return input.replace(
    "const profile = parsePersonalVoiceProfile(data?.profile);",
    "const profile = data?.profile as PersonalVoiceProfile;",
  );
}

function makeProfileNestedFieldMutant(input) {
  return input.replace(
    "const rules = parseStringArray(field);",
    "const rules = field as string[];",
  );
}

function makeVideoParserMutant(input) {
  return input.replace(
    "if (isVideoRenderConfig(config) && !draft)",
    "if (config && !draft)",
  );
}

const result = assertContract(source, "current source");
const selfTest = process.argv.includes("--self-test");

if (selfTest) {
  const mutants = [
    ["root-error-gate", { ...source, settings: makeRootErrorGateMutant(source.settings) }],
    ["root-baseline-parser", { ...source, settings: makeRootBaselineMutant(source.settings) }],
    ["enrichment-writable-default", { ...source, enrichment: makeEnrichmentWritableDefaultMutant(source.enrichment) }],
    ["enrichment-parser", { ...source, enrichment: makeEnrichmentParserMutant(source.enrichment) }],
    ["enrichment-preload-default", { ...source, enrichment: makeEnrichmentPreloadDefaultMutant(source.enrichment) }],
    ["enrichment-stored-profile-parser", { ...source, enrichment: makeStoredProfileParserMutant(source.enrichment) }],
    ["enrichment-generated-profile-parser", { ...source, enrichment: makeGeneratedProfileParserMutant(source.enrichment) }],
    ["enrichment-profile-nested-field-parser", { ...source, enrichment: makeProfileNestedFieldMutant(source.enrichment) }],
    ["video-permanent-spinner", { ...source, video: makeVideoSpinnerMutant(source.video) }],
    ["video-parser", { ...source, video: makeVideoParserMutant(source.video) }],
  ];
  for (const [name, mutant] of mutants) {
    let rejected = false;
    try {
      assertContract(mutant, name + " mutant");
    } catch (error) {
      rejected = String(error).includes("SETTINGS_FAIL_CLOSED_SOURCE_CONTRACT_FAIL");
    }
    if (!rejected) fail(name + " mutant was not rejected by the source contract");
  }
}

console.log(
  "SETTINGS_FAIL_CLOSED_SOURCE_CONTRACT_PASS rootGates=" + result.rootGates
    + " cardGates=" + result.cardGates
    + " selfTest=" + (selfTest ? "pass" : "skipped"),
);
