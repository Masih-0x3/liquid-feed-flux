import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const paths = {
  hook: path.join(repoRoot, "src/hooks/useIncomingSettingsDraft.ts"),
  contentFilter: path.join(repoRoot, "src/components/settings/ContentFilterSettings.tsx"),
  storyMemory: path.join(repoRoot, "src/components/settings/StoryMemoryCard.tsx"),
};

const source = Object.fromEntries(
  Object.entries(paths).map(([name, filePath]) => [name, fs.readFileSync(filePath, "utf8")]),
);

function fail(message) {
  throw new Error("SETTINGS_DRAFT_PROTECTION_SOURCE_CONTRACT_FAIL " + message);
}

function parseAndTranspile(filePath, input) {
  const scriptKind = filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(filePath, input, ts.ScriptTarget.Latest, true, scriptKind);
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
  if (!input.includes(expected)) {
    fail(label + " is missing: " + expected);
  }
}

function assertNotIncludes(input, unexpected, label) {
  if (input.includes(unexpected)) {
    fail(label + " must not include: " + unexpected);
  }
}

function assertOrder(input, first, second, label) {
  const firstIndex = input.indexOf(first);
  const secondIndex = input.indexOf(second);
  if (firstIndex === -1 || secondIndex === -1 || firstIndex >= secondIndex) {
    fail(label + " has invalid order");
  }
}

function countOccurrences(input, expected) {
  return input.split(expected).length - 1;
}

function assertOccurrenceCount(input, expected, count, label) {
  if (countOccurrences(input, expected) !== count) {
    fail(label + " must occur " + count + " time(s): " + expected);
  }
}

function sliceBetween(input, start, end, label) {
  const startIndex = input.indexOf(start);
  const endIndex = input.indexOf(end, startIndex + start.length);
  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    fail(label + " could not be scoped");
  }
  return input.slice(startIndex, endIndex);
}

function assertDraftHook(hook, label) {
  assertIncludes(hook, "export function useIncomingSettingsDraft<T>(incoming: T)", label + " exported hook");
  assertIncludes(hook, "const [draft, setDraft] = useState<T>(() => incoming);", label + " local draft state");
  assertIncludes(hook, "const [baseline, setBaseline] = useState<T>(() => incoming);", label + " baseline state");
  assertIncludes(hook, "const [pendingIncoming, setPendingIncoming] = useState<PendingIncoming<T> | null>(null);", label + " pending incoming state");
  assertIncludes(hook, "const dirtyFields = useMemo(", label + " dirty field derivation");
  assertIncludes(hook, "const pendingFields = useMemo(", label + " pending comparison derivation");
  assertIncludes(hook, "const seenIncomingFingerprintsRef = useRef(new Set<string>([incomingFingerprint]));", label + " replay protection state");
  assertIncludes(hook, "const pendingIncomingRef = useRef(pendingIncoming);", label + " pending snapshot ref");
  assertIncludes(hook, "pendingIncomingRef.current = pendingIncoming;", label + " pending snapshot ref update");

  const incomingEffect = sliceBetween(
    hook,
    "  useEffect(() => {",
    "  const updateDraft = useCallback",
    label + " incoming snapshot effect",
  );
  assertIncludes(incomingEffect, "if (seenIncomingFingerprintsRef.current.has(incomingFingerprint)) {", label + " repeated snapshot guard");
  assertIncludes(incomingEffect, "seenIncomingFingerprintsRef.current.add(incomingFingerprint);", label + " snapshot recording");
  assertIncludes(
    incomingEffect,
    "if (isDirtyRef.current || pendingIncomingRef.current !== null) {",
    label + " dirty or unresolved snapshot guard",
  );
  assertIncludes(incomingEffect, "setPendingIncoming({ snapshot: incoming, fingerprint: incomingFingerprint });", label + " pending snapshot record");
  assertOrder(
    incomingEffect,
    "if (isDirtyRef.current || pendingIncomingRef.current !== null) {",
    "setBaseline(incoming);",
    label + " dirty guard before baseline replacement",
  );
  assertOrder(
    incomingEffect,
    "if (isDirtyRef.current || pendingIncomingRef.current !== null) {",
    "setDraft(incoming);",
    label + " dirty guard before draft replacement",
  );
  assertIncludes(incomingEffect, "}, [incoming, incomingFingerprint]);", label + " snapshot-only effect dependencies");

  const reloadHandler = sliceBetween(
    hook,
    "  const reloadIncoming = useCallback(() => {",
    "  const keepEditing = useCallback",
    label + " reload handler",
  );
  assertIncludes(reloadHandler, "setBaseline(pendingIncoming.snapshot);", label + " reload baseline");
  assertIncludes(reloadHandler, "setDraft(pendingIncoming.snapshot);", label + " reload draft");
  assertIncludes(reloadHandler, "setPendingIncoming(null);", label + " reload clears notice");

  const keepHandler = sliceBetween(
    hook,
    "  const keepEditing = useCallback(() => {",
    "  const markSaved = useCallback",
    label + " keep editing handler",
  );
  assertIncludes(keepHandler, "setPendingIncoming(null);", label + " keep editing clears notice");
  assertIncludes(keepHandler, "already recorded as seen", label + " keep editing replay explanation");

  const savedHandler = sliceBetween(
    hook,
    "  const markSaved = useCallback((saved: T) => {",
    "  return {",
    label + " save acknowledgement handler",
  );
  assertIncludes(savedHandler, "seenIncomingFingerprintsRef.current.add(savedFingerprint);", label + " saved snapshot replay protection");
  assertIncludes(savedHandler, "setBaseline(saved);", label + " save baseline acknowledgement");
  assertIncludes(
    savedHandler,
    "settingsSnapshotFingerprint(current) === savedFingerprint ? saved : current",
    label + " save acknowledgement must not overwrite edits made while saving",
  );
  assertIncludes(
    savedHandler,
    "setPendingIncoming((currentPending) => (",
    label + " pending snapshot acknowledgement",
  );
  assertIncludes(
    savedHandler,
    "currentPending?.fingerprint === savedFingerprint ? null : currentPending",
    label + " distinct pending snapshot must survive save acknowledgement",
  );
  assertOrder(
    savedHandler,
    "seenIncomingFingerprintsRef.current.add(savedFingerprint);",
    "setBaseline(saved);",
    label + " saved snapshot recorded before baseline acknowledgement",
  );
}

function assertCard({
  input,
  label,
  stateSetter,
  updateDraft,
  configName,
  saveFunction,
  saveHandlerEnd,
  saveMutation,
  savedConfig,
  pendingDisabled,
  pendingDisabledCount,
  recommendedSavedConfig,
  readOnly,
}) {
  assertIncludes(input, "import { useIncomingSettingsDraft } from '@/hooks/useIncomingSettingsDraft';", label + " shared draft hook import");
  assertIncludes(input, "useIncomingSettingsDraft(incomingConfig)", label + " hook use");
  assertNotIncludes(input, "useEffect(", label + " unconditional prop reset");
  assertNotIncludes(input, stateSetter + "(", label + " direct local state reset");
  assertIncludes(input, "dirtyFields,", label + " dirty field UI state");
  assertIncludes(input, "pendingFields,", label + " pending comparison UI state");
  assertIncludes(input, "hasPendingIncoming,", label + " pending snapshot UI state");
  assertIncludes(input, "New saved settings available", label + " conflict notice");
  assertIncludes(input, "Compare changed fields:", label + " compare summary");
  assertIncludes(input, "Reload saved values", label + " reload choice");
  assertIncludes(input, "Keep editing", label + " keep choice");
  assertIncludes(input, "onClick={reloadIncoming}", label + " reload action");
  assertIncludes(input, "onClick={keepEditing}", label + " keep action");

  const updateCount = input.split(updateDraft + "(").length - 1;
  if (updateCount < 2) {
    fail(label + " must route more than one draft interaction through " + updateDraft);
  }

  if (readOnly) {
    assertIncludes(input, "const legacyReadOnly = true;", label + " legacy read-only guard");
    assertIncludes(input, "Scoring Studio is the only writable scoring policy", label + " read-only notice");
    assertIncludes(input, "Legacy content-filter settings are read-only", label + " read-only footer");
    assertOccurrenceCount(input, "disabled={legacyReadOnly}", 9, label + " disabled controls bound to legacy guard");
    assertOccurrenceCount(input, "readOnly={legacyReadOnly}", 3, label + " readOnly controls bound to legacy guard");
    assertNotIncludes(input, "useSaveSettings", label + " must not import save settings hook");
    assertNotIncludes(input, "saveMutation", label + " must not keep save mutation state");
    assertNotIncludes(input, saveFunction + " = async () => {", label + " must not define a save handler");
    assertNotIncludes(input, "mutateAsync({ key: 'content_filter'", label + " must not call content filter save mutation");
    assertNotIncludes(input, "Save Content Filter Settings", label + " must not render a content filter save control");
    return;
  }

  assertOccurrenceCount(input, pendingDisabled, pendingDisabledCount, label + " save disabled until decision");

  const saveHandler = sliceBetween(
    input,
    "  const " + saveFunction + " = async () => {",
    saveHandlerEnd,
    label + " save handler",
  );
  assertIncludes(saveHandler, "const " + savedConfig + " = " + configName + ";", label + " frozen save snapshot");
  assertIncludes(saveHandler, saveMutation, label + " save mutation");
  assertIncludes(saveHandler, "markSaved(" + savedConfig + ");", label + " save acknowledgement");
  assertOrder(saveHandler, saveMutation, "markSaved(" + savedConfig + ");", label + " save acknowledgement after mutation success");

  if (recommendedSavedConfig) {
    assertIncludes(input, "markSaved(" + recommendedSavedConfig + ");", label + " recommended defaults acknowledgement");
  }
}

function assertContract(sources, label) {
  for (const [name, filePath] of Object.entries(paths)) {
    parseAndTranspile(filePath, sources[name]);
  }

  assertDraftHook(sources.hook, label + " hook");
  assertCard({
    input: sources.contentFilter,
    label: label + " Content Filter",
    stateSetter: "setConfig",
    updateDraft: "updateConfig",
    configName: "config",
    saveFunction: "saveContentFilter",
    readOnly: true,
  });
  assertCard({
    input: sources.storyMemory,
    label: label + " Story Memory",
    stateSetter: "setCfg",
    updateDraft: "updateCfg",
    configName: "cfg",
    saveFunction: "saveStoryMemory",
    saveHandlerEnd: "  const handleBackfill =",
    saveMutation: "await save.mutateAsync({ key: 'story_memory', value: savedConfig });",
    savedConfig: "savedConfig",
    pendingDisabled: "disabled={save.isPending || hasPendingIncoming}",
    pendingDisabledCount: 1,
  });

  return { cards: 2, protectedFields: 2 };
}

function makeDirtyGuardMutant(input) {
  return input.replace(
    "if (isDirtyRef.current || pendingIncomingRef.current !== null) {",
    "if (false) {",
  );
}

function makePendingGuardMutant(input) {
  return input.replace(
    "if (isDirtyRef.current || pendingIncomingRef.current !== null) {",
    "if (isDirtyRef.current) {",
  );
}

function makeReplayGuardMutant(input) {
  return input.replace(
    "if (seenIncomingFingerprintsRef.current.has(incomingFingerprint)) {",
    "if (false) {",
  );
}

function makeDistinctPendingClearMutant(input) {
  return input.replace(
    "currentPending?.fingerprint === savedFingerprint ? null : currentPending",
    "null",
  );
}

function makeContentReadOnlyGuardMutant(input) {
  return input.replace("const legacyReadOnly = true;", "const legacyReadOnly = false;");
}

function makeContentRestoreSaveMutant(input) {
  return input.replace(
    "const legacyReadOnly = true;",
    "const legacyReadOnly = true;\n  const saveMutation = useSaveSettings();",
  );
}

function makeContentRemoveDisabledGuardMutant(input) {
  return input.replace(
    "onClick={() => updateConfig(applyFilterStatus(config, opt.value))}\n                disabled={legacyReadOnly}",
    "onClick={() => updateConfig(applyFilterStatus(config, opt.value))}\n                disabled={false}",
  );
}

function makeContentDirectResetMutant(input) {
  return input.replace("updateConfig({ ...config,", "setConfig({ ...config,");
}

function makeStoryDirectResetMutant(input) {
  return input.replace("updateCfg({ ...cfg,", "setCfg({ ...cfg,");
}

function makeNoticeMutant(input) {
  return input.replace("New saved settings available", "Settings changed");
}

function makeCompareMutant(input) {
  return input.replace("Compare changed fields:", "Changed fields:");
}

const result = assertContract(source, "current source");
const selfTest = process.argv.includes("--self-test");

if (selfTest) {
  const mutants = [
    ["dirty-guard", { ...source, hook: makeDirtyGuardMutant(source.hook) }],
    ["pending-guard", { ...source, hook: makePendingGuardMutant(source.hook) }],
    ["replay-guard", { ...source, hook: makeReplayGuardMutant(source.hook) }],
    ["distinct-pending-save", { ...source, hook: makeDistinctPendingClearMutant(source.hook) }],
    ["content-readonly-guard", { ...source, contentFilter: makeContentReadOnlyGuardMutant(source.contentFilter) }],
    ["content-restore-save", { ...source, contentFilter: makeContentRestoreSaveMutant(source.contentFilter) }],
    ["content-remove-disabled-guard", { ...source, contentFilter: makeContentRemoveDisabledGuardMutant(source.contentFilter) }],
    ["content-direct-reset", { ...source, contentFilter: makeContentDirectResetMutant(source.contentFilter) }],
    ["story-direct-reset", { ...source, storyMemory: makeStoryDirectResetMutant(source.storyMemory) }],
    ["content-notice", { ...source, contentFilter: makeNoticeMutant(source.contentFilter) }],
    ["story-compare", { ...source, storyMemory: makeCompareMutant(source.storyMemory) }],
  ];

  for (const [name, mutant] of mutants) {
    let rejected = false;
    try {
      assertContract(mutant, name + " mutant");
    } catch (error) {
      rejected = String(error).includes("SETTINGS_DRAFT_PROTECTION_SOURCE_CONTRACT_FAIL");
    }
    if (!rejected) {
      fail(name + " mutant was not rejected by the source contract");
    }
  }
}

console.log(
  "SETTINGS_DRAFT_PROTECTION_SOURCE_CONTRACT_PASS cards=" + result.cards
    + " protectedFields=" + result.protectedFields
    + " selfTest=" + (selfTest ? "pass" : "skipped"),
);
