import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const statePath = join(repoRoot, "src/lib/videoRenderFeedbackState.ts");
const hookPath = join(repoRoot, "src/hooks/useVideoRenderData.ts");
const panelPath = join(repoRoot, "src/components/video/VideoRenderDetailPanel.tsx");
const pageTestPath = join(repoRoot, "src/test/video-renders-page.test.tsx");
const actionsPath = join(repoRoot, "supabase/functions/admin-actions/videoRenderActions.ts");
const feedbackActionPath = join(repoRoot, "supabase/functions/admin-actions/videoRenderFeedback.ts");
const migrationPath = join(repoRoot, "supabase/migrations/20260722162000_video_render_feedback_revision.sql");
const require = createRequire(import.meta.url);
const typescript = require("typescript");
const stateSource = readFileSync(statePath, "utf8");
const hookSource = readFileSync(hookPath, "utf8");
const panelSource = readFileSync(panelPath, "utf8");
const pageTestSource = readFileSync(pageTestPath, "utf8");
const actionsSource = readFileSync(actionsPath, "utf8");
const feedbackActionSource = readFileSync(feedbackActionPath, "utf8");
const migrationSource = readFileSync(migrationPath, "utf8");

function sourceFile(path, source) {
  return typescript.createSourceFile(
    path,
    source,
    typescript.ScriptTarget.ES2022,
    true,
    path.endsWith(".tsx") ? typescript.ScriptKind.TSX : typescript.ScriptKind.TS,
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

function isIdentifier(node, name) {
  return typescript.isIdentifier(node) && node.text === name;
}

function propertyName(node) {
  return typescript.isIdentifier(node) || typescript.isStringLiteral(node) ? node.text : null;
}

function propertyAccess(node, objectName, property) {
  return typescript.isPropertyAccessExpression(node) &&
    isIdentifier(node.expression, objectName) &&
    node.name.text === property;
}

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

const stateOutput = transpile(statePath, stateSource);
transpile(hookPath, hookSource);
transpile(panelPath, panelSource);
transpile(pageTestPath, pageTestSource);
transpile(actionsPath, actionsSource);
const feedbackActionOutput = transpile(feedbackActionPath, feedbackActionSource);

const state = await import(
  `data:text/javascript;base64,${Buffer.from(stateOutput).toString("base64")}`,
);
const feedbackAction = await import(
  `data:text/javascript;base64,${Buffer.from(feedbackActionOutput).toString("base64")}`,
);

const renderA = { render_id: "render-a", render_version: "v1", render_revision: 1 };
const renderB = { render_id: "render-b", render_version: "v1", render_revision: 1 };
const renderANextVersion = { render_id: "render-a", render_version: "v2", render_revision: 2 };
const renderANextRevision = { render_id: "render-a", render_version: "v1", render_revision: 2 };
assert.equal(
  state.videoRenderFeedbackKey(renderA),
  "feedback:render:render-a:version:v1:revision:1",
);
assert.equal(
  state.videoRenderFeedbackKey(renderB),
  "feedback:render:render-b:version:v1:revision:1",
);
assert.equal(
  state.videoRenderFeedbackKey(renderANextVersion),
  "feedback:render:render-a:version:v2:revision:2",
);
assert.equal(
  state.videoRenderFeedbackKey(renderANextRevision),
  "feedback:render:render-a:version:v1:revision:2",
);
assert.equal(state.videoRenderFeedbackKey({ render_id: "render-a", render_version: "v1" }), null);
assert.equal(state.videoRenderFeedbackKey({ render_revision: 1 }), null);

let draft = state.createVideoRenderFeedbackDraft(state.videoRenderFeedbackKey(renderA));
draft = state.updateVideoRenderFeedbackDraft(
  draft,
  state.videoRenderFeedbackKey(renderA),
  { label: "subtitle_timing", note: "Feedback for A only" },
);
assert.equal(state.isVideoRenderFeedbackDraftCurrent(draft, state.videoRenderFeedbackKey(renderA)), true);
assert.equal(draft.note, "Feedback for A only");
const draftForB = state.rebaseVideoRenderFeedbackDraft(
  draft,
  state.videoRenderFeedbackKey(renderB),
);
assert.equal(state.isVideoRenderFeedbackDraftCurrent(draftForB, state.videoRenderFeedbackKey(renderA)), false);
assert.equal(state.isVideoRenderFeedbackDraftCurrent(draftForB, state.videoRenderFeedbackKey(renderB)), true);
assert.equal(draftForB.label, "pass");
assert.equal(draftForB.note, "");
const draftForNewVersion = state.rebaseVideoRenderFeedbackDraft(
  draft,
  state.videoRenderFeedbackKey(renderANextVersion),
);
assert.equal(draftForNewVersion.label, "pass");
assert.equal(draftForNewVersion.note, "");
const draftForNewRevision = state.rebaseVideoRenderFeedbackDraft(
  draft,
  state.videoRenderFeedbackKey(renderANextRevision),
);
assert.equal(draftForNewRevision.label, "pass");
assert.equal(draftForNewRevision.note, "");

let pending = state.beginVideoRenderFeedbackSave(new Map(), renderA);
assert.equal(state.isVideoRenderFeedbackSavePending(pending, renderA), true);
assert.equal(state.isVideoRenderFeedbackSavePending(pending, renderB), false);
assert.equal(state.isVideoRenderFeedbackSavePending(pending, renderANextRevision), false);
pending = state.beginVideoRenderFeedbackSave(pending, renderB);
assert.equal(state.isVideoRenderFeedbackSavePending(pending, renderA), true);
assert.equal(state.isVideoRenderFeedbackSavePending(pending, renderB), true);
pending = state.beginVideoRenderFeedbackSave(pending, renderB);
assert.equal(pending.get("feedback:render:render-b:version:v1:revision:1"), 2);
pending = state.settleVideoRenderFeedbackSave(pending, renderB);
assert.equal(state.isVideoRenderFeedbackSavePending(pending, renderB), true);
pending = state.settleVideoRenderFeedbackSave(pending, renderB);
assert.equal(state.isVideoRenderFeedbackSavePending(pending, renderB), false);
assert.equal(state.isVideoRenderFeedbackSavePending(pending, renderA), true);
pending = state.settleVideoRenderFeedbackSave(pending, renderA);
assert.equal(state.isVideoRenderFeedbackSavePending(pending, renderA), false);

const panelFile = sourceFile(panelPath, panelSource);
assert.equal(
  findNodes(panelFile, (node) =>
    typescript.isCallExpression(node) && isIdentifier(node.expression, "useEffect"),
  ).length,
  1,
  "detail panel must reset the feedback draft when its target key changes",
);
assert.equal(
  findNodes(panelFile, (node) =>
    typescript.isCallExpression(node) && isIdentifier(node.expression, "rebaseVideoRenderFeedbackDraft"),
  ).length,
  1,
  "detail panel must rebase the draft to its selected render/version/revision key",
);
assert.equal(
  findNodes(panelFile, (node) =>
    typescript.isCallExpression(node) && isIdentifier(node.expression, "updateVideoRenderFeedbackDraft"),
  ).length,
  2,
  "detail panel must key both label and note edits to the selected render",
);
assert.equal(
  findNodes(panelFile, (node) => propertyAccess(node, "saveFeedback", "isPending")).length,
  0,
  "detail panel must not drive feedback status from global saveFeedback.isPending",
);
const feedbackPendingCalls = findNodes(panelFile, (node) =>
  typescript.isCallExpression(node) && propertyAccess(node.expression, "saveFeedback", "isPendingFor"),
);
assert.equal(feedbackPendingCalls.length, 1, "detail panel must use one target-specific feedback pending check");
assert.equal(
  typescript.isObjectLiteralExpression(feedbackPendingCalls[0].arguments[0]),
  true,
  "feedback pending check must name its render/version/revision target",
);
const feedbackSaveCalls = findNodes(panelFile, (node) =>
  typescript.isCallExpression(node) && propertyAccess(node.expression, "saveFeedback", "mutate"),
);
assert.equal(feedbackSaveCalls.length, 1, "detail panel must preserve one feedback save action");
const feedbackSaveInput = feedbackSaveCalls[0].arguments[0];
assert.ok(typescript.isObjectLiteralExpression(feedbackSaveInput), "feedback save must use an explicit payload");
const saveProperties = new Map(
  feedbackSaveInput.properties
    .filter(typescript.isPropertyAssignment)
    .map((property) => [propertyName(property.name), property.initializer]),
);
assert.ok(propertyAccess(saveProperties.get("render_id"), "render", "id"), "feedback save must use the displayed render ID");
assert.ok(
  propertyAccess(saveProperties.get("render_version"), "render", "render_version"),
  "feedback save must bind the displayed render version",
);
assert.ok(
  propertyAccess(saveProperties.get("render_revision"), "render", "render_revision"),
  "feedback save must bind the displayed render revision",
);
assert.ok(isIdentifier(saveProperties.get("label"), "feedbackLabel"), "feedback save must use the current keyed label");
assert.ok(isIdentifier(saveProperties.get("note"), "feedbackNote"), "feedback save must use the current keyed note");
assert.match(
  panelSource,
  /disabled=\{(?:readOnly \|\| )?!feedbackDraftCurrent \|\| feedbackPending\}/,
  "feedback save must remain unavailable until its current selection-keyed draft is ready",
);

const hookFile = sourceFile(hookPath, hookSource);
const feedbackHook = findNodes(hookFile, (node) =>
  typescript.isFunctionDeclaration(node) && node.name?.text === "useSaveVideoRenderFeedback",
)[0];
assert.ok(feedbackHook, "feedback hook must retain useSaveVideoRenderFeedback");
for (const name of [
  "beginVideoRenderFeedbackSave",
  "settleVideoRenderFeedbackSave",
  "isVideoRenderFeedbackSavePending",
]) {
  assert.ok(
    findNodes(feedbackHook, (node) =>
      typescript.isCallExpression(node) && isIdentifier(node.expression, name),
    ).length > 0,
    `feedback hook must use ${name}`,
  );
}
assert.equal(
  findNodes(feedbackHook, (node) => propertyAccess(node, "feedback", "mutateAsync")).length,
  1,
  "feedback hook must use one per-call mutateAsync promise",
);
assert.equal(
  findNodes(feedbackHook, (node) => propertyAccess(node, "feedback", "mutate")).length,
  0,
  "feedback hook must not rely on mutation-level callbacks for keyed cleanup",
);
const feedbackFinallyCalls = findNodes(feedbackHook, (node) =>
  typescript.isCallExpression(node) &&
  typescript.isPropertyAccessExpression(node.expression) &&
  node.expression.name.text === "finally",
);
assert.equal(feedbackFinallyCalls.length, 1, "feedback save promise must settle exactly once in finally");
assert.equal(
  findNodes(feedbackFinallyCalls[0], (node) =>
    typescript.isCallExpression(node) && isIdentifier(node.expression, "settleVideoRenderFeedbackSave"),
  ).length,
  1,
  "feedback save promise must settle the target-specific pending count in finally",
);
assert.match(
  hookSource,
  /render_version:\s*string[\s\S]*render_revision:\s*number/,
  "feedback mutation input must require render_version and render_revision",
);
assert.equal(
  findNodes(feedbackHook, (node) =>
    typescript.isCallExpression(node) &&
    propertyAccess(node.expression, "queryClient", "invalidateQueries"),
  ).length,
  4,
  "feedback hook must refresh queue/detail after success and conflict/error",
);

const actionFile = sourceFile(feedbackActionPath, feedbackActionSource);
const saveAction = findNodes(actionFile, (node) =>
  typescript.isFunctionDeclaration(node) && node.name?.text === "saveVideoRenderFeedbackAdmin",
)[0];
assert.ok(saveAction, "admin action must retain saveVideoRenderFeedbackAdmin");
const saveActionText = saveAction.getText(actionFile);
assert.match(
  saveActionText,
  /save_video_render_feedback_if_current/,
  "admin action must call the atomic feedback RPC",
);
assert.match(
  saveActionText,
  /p_expected_render_version: expectedRenderVersion[\s\S]*p_expected_render_revision: expectedRenderRevision/,
  "admin action must pass the selection's expected version and revision to the RPC",
);
assert.equal(
  saveActionText.includes("video_render_feedback').insert"),
  false,
  "admin action must not reintroduce a direct feedback-table insert outside the atomic RPC",
);
const conflictIndex = saveActionText.indexOf("video render changed; refresh before saving feedback");
const eventIndex = saveActionText.lastIndexOf("insertAdminPipelineEvent");
assert.ok(conflictIndex >= 0 && eventIndex > conflictIndex, "empty RPC result must return a conflict before any event");

const matchingRpcCalls = [];
const matchingEvents = [];
const matchingResult = await feedbackAction.saveVideoRenderFeedbackAdmin(
  {
    from: () => {
      throw new Error("feedback handler must use the RPC, not direct table writes");
    },
    rpc: async (name, args) => {
      matchingRpcCalls.push({ name, args });
      return {
        data: [{
          id: "feedback-a",
          tweet_id: "tweet-a",
          label: "subtitle_timing",
          note: "Feedback for A only",
          created_at: "2026-07-22T16:00:00.000Z",
          render_version: "v1",
          render_revision: 1,
        }],
      };
    },
  },
  {
    ...renderA,
    label: "subtitle_timing",
    note: "Feedback for A only",
  },
  async (_supabase, tweetId, step, status, meta) => {
    matchingEvents.push({ tweetId, step, status, meta });
  },
  "operator-a",
);
assert.equal(matchingResult.ok, true);
assert.equal(matchingRpcCalls.length, 1);
assert.deepEqual(matchingRpcCalls[0], {
  name: "save_video_render_feedback_if_current",
  args: {
    p_render_id: "render-a",
    p_expected_render_version: "v1",
    p_expected_render_revision: 1,
    p_label: "subtitle_timing",
    p_note: "Feedback for A only",
    p_metadata: {},
    p_created_by: "operator-a",
  },
});
assert.deepEqual(matchingEvents, [{
  tweetId: "tweet-a",
  step: "video_render_feedback",
  status: "completed",
  meta: {
    render_id: "render-a",
    render_version: "v1",
    render_revision: 1,
    label: "subtitle_timing",
  },
}]);

const staleRpcCalls = [];
const staleEvents = [];
const staleResult = await feedbackAction.saveVideoRenderFeedbackAdmin(
  {
    from: () => {
      throw new Error("feedback handler must use the RPC, not direct table writes");
    },
    rpc: async (name, args) => {
      staleRpcCalls.push({ name, args });
      return { data: [] };
    },
  },
  { ...renderANextRevision, label: "fail", note: "stale" },
  async (...args) => {
    staleEvents.push(args);
  },
);
assert.deepEqual(staleResult, {
  ok: false,
  error: "video render changed; refresh before saving feedback",
});
assert.equal(staleRpcCalls.length, 1);
assert.equal(staleEvents.length, 0);

let missingRevisionRpcCalls = 0;
const missingRevisionEvents = [];
const missingRevisionResult = await feedbackAction.saveVideoRenderFeedbackAdmin(
  {
    from: () => {
      throw new Error("feedback handler must use the RPC, not direct table writes");
    },
    rpc: async () => {
      missingRevisionRpcCalls += 1;
      return { data: [] };
    },
  },
  { render_id: "render-a", render_version: "v1", label: "pass" },
  async (...args) => {
    missingRevisionEvents.push(args);
  },
);
assert.deepEqual(missingRevisionResult, {
  ok: false,
  error: "render_revision is required",
});
assert.equal(missingRevisionRpcCalls, 0);
assert.equal(missingRevisionEvents.length, 0);

assert.match(
  actionsSource,
  /saveVideoRenderFeedbackAdmin[\s\S]*from "\.\/videoRenderFeedback\.ts"/,
  "video render action module must re-export the dedicated feedback action",
);
assert.match(
  actionsSource,
  /render_version, render_revision, output_storage_path/,
  "queue/detail reads must include render_revision before the frontend cutover",
);
assert.match(
  pageTestSource,
  /render_version: 'v1',[\s\S]*render_revision: 1,/,
  "typed video-render page fixtures must include the revision required by the feedback contract",
);
assert.match(
  migrationSource,
  /ADD COLUMN IF NOT EXISTS render_revision bigint NOT NULL DEFAULT 1/,
  "migration must add a non-null render revision",
);
assert.match(
  migrationSource,
  /CREATE TRIGGER trg_video_renders_render_revision[\s\S]*BEFORE UPDATE ON public\.video_renders[\s\S]*bump_video_render_revision/,
  "migration must advance the revision on every video-render update",
);
const rpcStart = migrationSource.indexOf("CREATE OR REPLACE FUNCTION public.save_video_render_feedback_if_current");
const lockIndex = migrationSource.indexOf("FOR UPDATE", rpcStart);
const expectedVersionIndex = migrationSource.indexOf("render_version = btrim(p_expected_render_version)", rpcStart);
const expectedRevisionIndex = migrationSource.indexOf("render_revision = p_expected_render_revision", rpcStart);
const noMatchReturnIndex = migrationSource.indexOf("IF NOT FOUND THEN", rpcStart);
const insertIndex = migrationSource.indexOf("INSERT INTO public.video_render_feedback", rpcStart);
assert.ok(rpcStart >= 0, "migration must define the atomic save RPC");
assert.ok(
  expectedVersionIndex > rpcStart && expectedRevisionIndex > expectedVersionIndex && lockIndex > expectedRevisionIndex,
  "atomic RPC must compare version/revision and lock the matching row",
);
assert.ok(
  noMatchReturnIndex > lockIndex && insertIndex > noMatchReturnIndex,
  "atomic RPC must return no row before feedback insert when the target changed",
);
assert.match(
  migrationSource,
  /GRANT EXECUTE ON FUNCTION public\.save_video_render_feedback_if_current[\s\S]*TO service_role;/,
  "atomic feedback RPC must remain service-role-only",
);

console.log("VIDEO_RENDER_FEEDBACK_SOURCE_CONTRACT_PASS keys=7 transitions=22 handler=3");
