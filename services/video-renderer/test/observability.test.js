import assert from "node:assert/strict";
import test from "node:test";
import {
  createObservedOpenAIFetch,
  finishWorkflowRun,
  sanitizeObservabilityMetadata,
  startWorkflowRun,
} from "../src/observability.js";

function makeSupabase() {
  const state = {
    inserts: [],
    updates: [],
    upserts: [],
    from(table) {
      return new FakeBuilder(table, state);
    },
  };
  return state;
}

class FakeBuilder {
  constructor(table, state) {
    this.table = table;
    this.state = state;
    this.mode = "select";
    this.payload = null;
    this.options = null;
    this.filters = {};
  }

  insert(payload) {
    this.mode = "insert";
    this.payload = payload;
    return this;
  }

  upsert(payload, options) {
    this.mode = "upsert";
    this.payload = payload;
    this.options = options;
    return this;
  }

  update(payload) {
    this.mode = "update";
    this.payload = payload;
    return this;
  }

  eq(column, value) {
    this.filters[column] = value;
    return this;
  }

  then(resolve) {
    if (this.mode === "insert") {
      this.state.inserts.push({ table: this.table, row: this.payload });
    } else if (this.mode === "upsert") {
      this.state.upserts.push({
        table: this.table,
        row: this.payload,
        options: this.options,
      });
    } else if (this.mode === "update") {
      this.state.updates.push({
        table: this.table,
        row: this.payload,
        filters: this.filters,
      });
    }
    resolve({ data: null, error: null });
  }
}

test("renderer observability sanitizes prompt and text metadata", () => {
  const sanitized = sanitizeObservabilityMetadata({
    render_id: "render-1",
    prompt_text: "SECRET",
    output_text: "SECRET",
    source_media_id: "media-1",
  });

  assert.equal(sanitized.render_id, "render-1");
  assert.equal(sanitized.source_media_id, "media-1");
  assert.equal("prompt_text" in sanitized, false);
  assert.equal("output_text" in sanitized, false);
});

test("renderer observability records workflow and OpenAI provider usage", async () => {
  const supabase = makeSupabase();
  await startWorkflowRun(supabase, {
    runKey: "video-renderer:render:render-1",
    workflowName: "video-renderer-ai",
    workflowRunId: "render-1",
    source: "video-renderer",
    sourceFunction: "processRenderRow",
    subjectType: "video_render",
    subjectId: "render-1",
    tweetId: "tweet-1",
    metadata: { render_id: "render-1" },
  });

  const observedFetch = createObservedOpenAIFetch({
    supabase,
    workflowRunKey: "video-renderer:render:render-1",
    operationName: "translate_subtitles",
    agentName: "subtitle-translator",
    metadata: {
      render_id: "render-1",
      prompt_text: "SECRET",
      target_language: "fa",
    },
    fetchImpl: async () =>
      new Response(JSON.stringify({
        usage: {
          input_tokens: 9,
          output_tokens: 4,
          total_tokens: 13,
        },
        output_text: "{\"segments\":[]}",
      }), { status: 200 }),
  });

  const response = await observedFetch("https://api.openai.com/v1/responses", {
    method: "POST",
    body: JSON.stringify({
      model: "gpt-5.4-mini",
      input: [{ role: "user", content: [{ type: "input_text", text: "SECRET" }] }],
    }),
  });
  assert.equal(response.ok, true);

  await finishWorkflowRun(supabase, "video-renderer:render:render-1", "completed", {
    render_id: "render-1",
    output_text: "SECRET",
  });

  assert.equal(supabase.upserts.length, 1);
  assert.equal(supabase.upserts[0].table, "workflow_runs");
  assert.equal(supabase.upserts[0].row.workflow_name, "video-renderer-ai");
  assert.equal(supabase.updates.length, 1);
  assert.equal(supabase.updates[0].row.status, "completed");
  assert.equal("output_text" in supabase.updates[0].row.metadata, false);

  const aiRow = supabase.inserts.find((insert) => insert.table === "ai_call_ledger")?.row;
  assert.ok(aiRow);
  assert.equal(aiRow.workflow_run_key, "video-renderer:render:render-1");
  assert.equal(aiRow.trace_name, "video-renderer-ai");
  assert.equal(aiRow.operation_name, "translate_subtitles");
  assert.equal(aiRow.agent_name, "subtitle-translator");
  assert.equal(aiRow.endpoint, "responses");
  assert.equal(aiRow.model, "gpt-5.4-mini");
  assert.equal(aiRow.total_tokens, 13);
  assert.equal(aiRow.foglamp_span_estimate, 0);
  assert.equal(aiRow.foglamp_skip_reason, "non_chat_endpoint");
  assert.equal(aiRow.metadata.render_id, "render-1");
  assert.equal(aiRow.metadata.target_language, "fa");
  assert.equal("prompt_text" in aiRow.metadata, false);

  const budgetRows = supabase.inserts
    .filter((insert) => insert.table === "budget_ledger")
    .flatMap((insert) => Array.isArray(insert.row) ? insert.row : [insert.row]);
  assert.ok(budgetRows.some((row) =>
    row.provider === "openai" && row.unit === "token" && row.quantity === 13
  ));
  assert.equal(budgetRows.some((row) => row.provider === "foglamp"), false);
});
