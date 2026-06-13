import { assert, assertEquals } from "jsr:@std/assert";
import {
  type DuplicateGateResult,
  assertFinalDuplicateState,
  normalizeDuplicateGateConfig,
  normalizeStoryText,
  runDuplicateGate,
} from "./dedupe.ts";

Deno.test("normalizeDuplicateGateConfig keeps legacy settings and fills new gate defaults", () => {
  const cfg = normalizeDuplicateGateConfig({
    enabled: true,
    window_hours: 200,
    similarity_threshold: 0.86,
    action: "skip",
    bypass_authors: ["@Trusted", " "],
  });

  assertEquals(cfg.enabled, true);
  assertEquals(cfg.window_hours, 168);
  assertEquals(cfg.similarity_threshold, 0.86);
  assertEquals(cfg.candidate_min_similarity, 0.78);
  assertEquals(cfg.auto_duplicate_similarity, 0.94);
  assertEquals(cfg.mode, "hybrid_ai");
  assertEquals(cfg.adjudicator_model, "gpt-5.4-mini");
  assertEquals(cfg.bypass_authors, ["trusted"]);
});

Deno.test("normalizeDuplicateGateConfig enforces a 48 hour story memory floor", () => {
  const cfg = normalizeDuplicateGateConfig({
    enabled: true,
    window_hours: 12,
  });

  assertEquals(cfg.window_hours, 48);
});

Deno.test("normalizeStoryText strips urls, handles, hashtags, and punctuation", () => {
  assertEquals(
    normalizeStoryText("Breaking: @source says #Iran update https://x.com/i/status/123!"),
    "breaking says update",
  );
});

Deno.test("runDuplicateGate disabled does not mutate and advances translation", async () => {
  const supabase = makeFakeSupabase();
  const result = await runDuplicateGate(supabase, {
    tweet_id: "t1",
    text_original: "A long enough current story body for duplicate checks.",
  }, { enabled: false });

  assertEquals(result.status, "disabled");
  assertEquals(result.should_enqueue_translate, true);
  assertEquals(supabase.updates.length, 0);
});

Deno.test("runDuplicateGate blocks exact URL duplicates before model calls", async () => {
  const supabase = makeFakeSupabase({
    exactDuplicate: {
      tweet_id: "older",
      url: "https://example.com/story",
      story_cluster_id: "11111111-1111-1111-1111-111111111111",
    },
    canonicalPost: {
      tweet_id: "older",
      delivery_decision: "deliver",
      decision_reason: "score_pass:15>=14",
    },
  });

  const result = await runDuplicateGate(supabase, {
    tweet_id: "newer",
    text_original: "A long enough current story body for duplicate checks.",
    url: "https://example.com/story",
  }, { enabled: true, action: "skip", window_hours: 48 });

  assertEquals(result.ok, true);
  assertEquals(result.status, "duplicate");
  assertEquals(result.method, "exact_url");
  assertEquals(result.should_enqueue_translate, false);
  assertEquals(supabase.updates[0].update.dup_of_tweet_id, "older");
  assertEquals(supabase.updates[0].update.delivery_decision, "skip");
  assert(String(supabase.updates[0].update.decision_reason).startsWith("duplicate_gate:exact_url:"));
});

Deno.test("runDuplicateGate marks unique posts and upserts a story signature", async () => {
  const supabase = makeFakeSupabase({ candidates: [] });
  const result = await runDuplicateGate(supabase, basePost(), {
    enabled: true,
    action: "skip",
  }, { fetchEmbedding: async () => [0.1, 0.2, 0.3] });

  assertEquals(result.status, "unique");
  assertEquals(result.should_enqueue_translate, true);
  assertEquals(supabase.upserts[0].table, "story_signatures");
  assertEquals(supabase.upserts[0].payload.tweet_id, "newer");
  assertEquals(supabase.updates[0].update.dedupe_status, "unique");
});

Deno.test("runDuplicateGate auto-skips very high semantic matches before translation", async () => {
  const supabase = makeFakeSupabase({
    candidates: [candidate({ similarity: 0.97 })],
    canonicalPost: {
      tweet_id: "older",
      delivery_decision: "deliver",
      decision_reason: "score_pass:15>=14",
    },
  });
  const result = await runDuplicateGate(supabase, basePost(), {
    enabled: true,
    action: "skip",
    auto_duplicate_similarity: 0.94,
  }, { fetchEmbedding: async () => [0.1, 0.2, 0.3] });

  assertEquals(result.status, "duplicate");
  assertEquals(result.method, "semantic_auto");
  assertEquals(result.should_enqueue_translate, false);
  assertEquals(supabase.updates[0].update.dup_of_tweet_id, "older");
  assertEquals(supabase.updates[0].update.delivery_decision, "skip");
});

Deno.test("runDuplicateGate canonicalizes semantic candidates that are themselves duplicates", async () => {
  const supabase = makeFakeSupabase({
    candidates: [candidate({
      tweet_id: "middle",
      similarity: 0.97,
      candidate_dedupe_status: "duplicate",
      candidate_dup_of_tweet_id: "older",
    })],
    canonicalPost: {
      tweet_id: "older",
      delivery_decision: "deliver",
      decision_reason: "score_pass:15>=14",
    },
  });
  const result = await runDuplicateGate(supabase, basePost(), {
    enabled: true,
    action: "skip",
    auto_duplicate_similarity: 0.94,
  }, { fetchEmbedding: async () => [0.1, 0.2, 0.3] });

  assertEquals(result.status, "duplicate");
  assertEquals(result.dup_of_tweet_id, "older");
  assertEquals(supabase.updates[0].update.dup_of_tweet_id, "older");
});

Deno.test("runDuplicateGate canonicalizes AI duplicate decisions from duplicate candidates", async () => {
  const supabase = makeFakeSupabase({
    candidates: [candidate({
      tweet_id: "middle",
      similarity: 0.86,
      candidate_dedupe_status: "duplicate",
      candidate_dup_of_tweet_id: "older",
    })],
    canonicalPost: {
      tweet_id: "older",
      delivery_decision: "deliver",
      decision_reason: "score_pass:15>=14",
    },
  });
  const result = await runDuplicateGate(supabase, basePost(), {
    enabled: true,
    action: "skip",
    auto_duplicate_similarity: 0.94,
  }, {
    fetchEmbedding: async () => [0.1, 0.2, 0.3],
    adjudicate: async (_post, candidates) => makeAiResult("duplicate", candidates),
  });

  assertEquals(result.status, "duplicate");
  assertEquals(result.dup_of_tweet_id, "older");
  assertEquals(result.reason.includes("canonicalized_from:middle"), true);
  assertEquals(supabase.updates[0].update.dup_of_tweet_id, "older");
});

Deno.test("runDuplicateGate resolves duplicate-of-duplicate chains to the original canonical post", async () => {
  const supabase = makeFakeSupabase({
    candidates: [candidate({
      tweet_id: "newer-duplicate",
      similarity: 0.97,
      candidate_dedupe_status: "duplicate",
      candidate_dup_of_tweet_id: "middle",
    })],
    postsById: {
      middle: {
        tweet_id: "middle",
        dedupe_status: "duplicate",
        dup_of_tweet_id: "older",
      },
    },
    canonicalPost: {
      tweet_id: "older",
      delivery_decision: "deliver",
      decision_reason: "score_pass:15>=14",
    },
  });
  const result = await runDuplicateGate(supabase, basePost(), {
    enabled: true,
    action: "skip",
    auto_duplicate_similarity: 0.94,
  }, { fetchEmbedding: async () => [0.1, 0.2, 0.3] });

  assertEquals(result.status, "duplicate");
  assertEquals(result.dup_of_tweet_id, "older");
  assertEquals(result.reason.includes("canonical_chain:older"), true);
  assertEquals(supabase.updates[0].update.dup_of_tweet_id, "older");
});

Deno.test("runDuplicateGate does not hard-skip when the matched duplicate has no delivery coverage", async () => {
  const supabase = makeFakeSupabase({
    candidates: [candidate({ similarity: 0.97 })],
    canonicalPost: {
      tweet_id: "older",
      delivery_decision: "skip",
      decision_reason: "below_threshold:4<14",
      final_score: 4,
    },
  });
  const result = await runDuplicateGate(supabase, basePost(), {
    enabled: true,
    action: "skip",
    auto_duplicate_similarity: 0.94,
  }, { fetchEmbedding: async () => [0.1, 0.2, 0.3] });

  assertEquals(result.status, "coverage_gap");
  assertEquals(result.dup_of_tweet_id, "older");
  assertEquals(result.should_enqueue_translate, true);
  assert(result.reason.includes("coverage_gap:"));
  assertEquals(supabase.updates[0].update.dedupe_status, "coverage_gap");
  assertEquals(supabase.updates[0].update.dup_of_tweet_id, "older");
  assertEquals(supabase.updates[0].update.delivery_decision, undefined);
  const eventMeta = supabase.inserts.find((insert) => insert.table === "pipeline_events")?.row.meta as Record<string, unknown>;
  assertEquals((eventMeta.coverage as Record<string, unknown>).state, "coverage_gap");
  assertEquals(eventMeta.candidate_count, 1);
});

Deno.test("runDuplicateGate asks the RPC for 10 semantic candidates", async () => {
  const supabase = makeFakeSupabase({ candidates: [] });
  await runDuplicateGate(supabase, basePost(), {
    enabled: true,
    action: "skip",
  }, { fetchEmbedding: async () => [0.1, 0.2, 0.3] });

  assertEquals(supabase.rpcs[0].name, "find_story_candidates_v3");
  assertEquals(supabase.rpcs[0].args.match_limit, 10);
});

Deno.test("assertFinalDuplicateState blocks a late high-confidence duplicate before delivery", async () => {
  const supabase = makeFakeSupabase({
    currentPost: {
      tweet_id: "newer",
      text_original: "A long enough current story body for semantic duplicate checks.",
      text_translated: null,
      dedupe_status: "unique",
      dup_of_tweet_id: null,
    },
    signatureEmbedding: "[0.1,0.2,0.3]",
    candidates: [candidate({ similarity: 0.97 })],
    canonicalPost: {
      tweet_id: "older",
      delivery_decision: "deliver",
      decision_reason: "score_pass:15>=14",
    },
  });

  const result = await assertFinalDuplicateState(supabase, "newer", {
    enabled: true,
    action: "skip",
    auto_duplicate_similarity: 0.94,
  });

  assertEquals(result.checked, true);
  assertEquals(result.blocked, true);
  assertEquals(result.result?.status, "duplicate");
  assertEquals(supabase.updates.at(-1)?.update.dedupe_status, "duplicate");
  assertEquals(supabase.updates.at(-1)?.update.delivery_decision, "skip");
});

Deno.test("runDuplicateGate preserves related-new-info items for translation", async () => {
  const supabase = makeFakeSupabase({ candidates: [candidate({ similarity: 0.86 })] });
  const result = await runDuplicateGate(supabase, basePost(), {
    enabled: true,
    action: "skip",
    auto_duplicate_similarity: 0.94,
  }, {
    fetchEmbedding: async () => [0.1, 0.2, 0.3],
    adjudicate: async (_post, candidates) => makeAiResult("related_new_info", candidates),
  });

  assertEquals(result.status, "related_new_info");
  assertEquals(result.should_enqueue_translate, true);
  assertEquals(supabase.updates[0].update.dedupe_status, "related_new_info");
  assertEquals(supabase.updates[0].update.delivery_decision, undefined);
  assertEquals(supabase.updates[0].update.story_cluster_id, "11111111-1111-1111-1111-111111111111");
  const eventMeta = supabase.inserts.find((insert) => insert.table === "pipeline_events")?.row.meta as Record<string, unknown>;
  assertEquals(eventMeta.window_hours, 48);
  assertEquals((eventMeta.thresholds as Record<string, unknown>).similarity_threshold, 0.86);
  assertEquals(eventMeta.candidate_count, 1);
  assertEquals((eventMeta.top_candidates as Array<Record<string, unknown>>)[0].tweet_id, "older");
});

Deno.test("runDuplicateGate marks low-confidence AI outcomes uncertain without blocking", async () => {
  const supabase = makeFakeSupabase({ candidates: [candidate({ similarity: 0.86 })] });
  const result = await runDuplicateGate(supabase, basePost(), {
    enabled: true,
    action: "skip",
  }, {
    fetchEmbedding: async () => [0.1, 0.2, 0.3],
    adjudicate: async (_post, candidates) => ({
      ...makeAiResult("uncertain", candidates),
      confidence: 0.4,
      reason: "low_confidence:test",
    }),
  });

  assertEquals(result.status, "uncertain");
  assertEquals(result.should_enqueue_translate, true);
  assertEquals(supabase.updates[0].update.dedupe_status, "uncertain");
  assertEquals(supabase.updates[0].update.delivery_decision, undefined);
});

Deno.test("runDuplicateGate fails closed when the dedupe post update fails", async () => {
  const supabase = makeFakeSupabase({
    candidates: [candidate({ similarity: 0.97 })],
    canonicalPost: {
      tweet_id: "older",
      delivery_decision: "deliver",
      decision_reason: "score_pass:15>=14",
    },
    updateErrorsByDedupeStatus: {
      duplicate: "new row for relation \"posts\" violates check constraint \"posts_dedupe_status_check\"",
    },
  });

  const result = await runDuplicateGate(supabase, basePost(), {
    enabled: true,
    action: "skip",
    auto_duplicate_similarity: 0.94,
  }, { fetchEmbedding: async () => [0.1, 0.2, 0.3] });

  assertEquals(result.ok, false);
  assertEquals(result.status, "failed");
  assertEquals(result.should_enqueue_translate, false);
  assertEquals(result.failure_phase, "post_update");
  assertEquals(result.retryable, false);
  const failedEvent = supabase.inserts.find((insert) =>
    insert.table === "pipeline_events" && insert.row.status === "failed"
  );
  const meta = failedEvent?.row.meta as Record<string, unknown>;
  assertEquals(meta.failure_phase, "post_update");
  assertEquals(meta.action, "skip");
});

Deno.test("runDuplicateGate marks embedding provider failures retryable but does not advance translation", async () => {
  const supabase = makeFakeSupabase();

  const result = await runDuplicateGate(supabase, basePost(), {
    enabled: true,
    action: "skip",
  }, { fetchEmbedding: async () => {
    throw new Error("embedding_error:503:upstream unavailable");
  } });

  assertEquals(result.ok, false);
  assertEquals(result.status, "failed");
  assertEquals(result.should_enqueue_translate, false);
  assertEquals(result.failure_phase, "embedding");
  assertEquals(result.retryable, true);
  const failedEvent = supabase.inserts.find((insert) =>
    insert.table === "pipeline_events" && insert.row.status === "failed"
  );
  const meta = failedEvent?.row.meta as Record<string, unknown>;
  assertEquals(meta.failure_phase, "embedding");
  assertEquals(meta.retryable, true);
});

function makeFakeSupabase(options: {
  exactDuplicate?: Record<string, unknown>;
  currentPost?: Record<string, unknown>;
  canonicalPost?: Record<string, unknown>;
  postsById?: Record<string, Record<string, unknown>>;
  candidates?: Record<string, unknown>[];
  signatureEmbedding?: string | number[] | null;
  telegramStatuses?: string[];
  xStatuses?: string[];
  jobStatuses?: string[];
  updateErrorsByDedupeStatus?: Record<string, string>;
  insertErrors?: Record<string, string>;
  upsertErrors?: Record<string, string>;
  rpcErrors?: Record<string, string>;
} = {}) {
  const state = {
    updates: [] as Array<{ table: string; update: Record<string, unknown>; filters: Record<string, unknown> }>,
    inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
    upserts: [] as Array<{ table: string; payload: Record<string, unknown>; options?: Record<string, unknown> }>,
    rpcs: [] as Array<{ name: string; args: Record<string, unknown> }>,
    from(table: string) {
      return new FakeBuilder(table, state, options);
    },
    rpc(name: string, args: Record<string, unknown>) {
      state.rpcs.push({ name, args });
      if (options.rpcErrors?.[name]) {
        return Promise.resolve({ data: null, error: { message: options.rpcErrors[name] } });
      }
      if (name === "find_story_candidates_v3") {
        return Promise.resolve({ data: options.candidates ?? [], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  return state;
}

class FakeBuilder {
  private mode: "select" | "update" | "insert" | "upsert" = "select";
  private filters: Record<string, unknown> = {};
  private updatePayload: Record<string, unknown> = {};
  private insertPayload: Record<string, unknown> | null = null;
  private upsertPayload: Record<string, unknown> | null = null;
  private upsertOptions: Record<string, unknown> | undefined;

  constructor(
    private table: string,
    private state: ReturnType<typeof makeFakeSupabase>,
    private options: {
      exactDuplicate?: Record<string, unknown>;
      currentPost?: Record<string, unknown>;
      canonicalPost?: Record<string, unknown>;
      postsById?: Record<string, Record<string, unknown>>;
      signatureEmbedding?: string | number[] | null;
      telegramStatuses?: string[];
      xStatuses?: string[];
      jobStatuses?: string[];
      updateErrorsByDedupeStatus?: Record<string, string>;
      insertErrors?: Record<string, string>;
      upsertErrors?: Record<string, string>;
    },
  ) {}

  select() { return this; }
  neq(column: string, value: unknown) { this.filters[`neq:${column}`] = value; return this; }
  gte(column: string, value: unknown) { this.filters[`gte:${column}`] = value; return this; }
  order() { return this; }
  limit() { return this; }
  eq(column: string, value: unknown) { this.filters[column] = value; return this; }
  filter(column: string, operator: string, value: unknown) { this.filters[`${operator}:${column}`] = value; return this; }
  in(column: string, value: unknown[]) { this.filters[`in:${column}`] = value; return this; }

  update(payload: Record<string, unknown>) {
    this.mode = "update";
    this.updatePayload = payload;
    return this;
  }

  insert(payload: Record<string, unknown>) {
    this.mode = "insert";
    this.insertPayload = payload;
    return this;
  }

  upsert(payload: Record<string, unknown>, options?: Record<string, unknown>) {
    this.mode = "upsert";
    this.upsertPayload = payload;
    this.upsertOptions = options;
    return this;
  }

  maybeSingle() {
    if (this.mode !== "select") return Promise.resolve({ data: null, error: null });
    const data = this.resolveSelectData();
    const row = Array.isArray(data) ? data[0] ?? null : data ?? null;
    return Promise.resolve({ data: row, error: null });
  }

  single() {
    return this.maybeSingle();
  }

  then(resolve: (value: { data: unknown; error: { message: string } | null }) => void) {
    if (this.mode === "update") {
      this.state.updates.push({ table: this.table, update: this.updatePayload, filters: this.filters });
      const status = typeof this.updatePayload.dedupe_status === "string" ? this.updatePayload.dedupe_status : "";
      if (status && this.options.updateErrorsByDedupeStatus?.[status]) {
        resolve({ data: null, error: { message: this.options.updateErrorsByDedupeStatus[status] } });
        return;
      }
      resolve({ data: null, error: null });
      return;
    }
    if (this.mode === "insert") {
      this.state.inserts.push({ table: this.table, row: this.insertPayload ?? {} });
      if (this.options.insertErrors?.[this.table]) {
        resolve({ data: null, error: { message: this.options.insertErrors[this.table] } });
        return;
      }
      resolve({ data: null, error: null });
      return;
    }
    if (this.mode === "upsert") {
      this.state.upserts.push({
        table: this.table,
        payload: this.upsertPayload ?? {},
        options: this.upsertOptions,
      });
      if (this.options.upsertErrors?.[this.table]) {
        resolve({ data: null, error: { message: this.options.upsertErrors[this.table] } });
        return;
      }
      resolve({ data: null, error: null });
      return;
    }
    resolve({ data: this.resolveSelectData(), error: null });
  }

  private resolveSelectData(): unknown {
    if (this.table === "posts" && this.filters.tweet_id) {
      const id = String(this.filters.tweet_id);
      if (this.options.currentPost && id === this.options.currentPost.tweet_id) return [this.options.currentPost];
      if (this.options.postsById?.[id]) return [this.options.postsById[id]];
      if (this.options.canonicalPost && id === this.options.canonicalPost.tweet_id) return [this.options.canonicalPost];
    }
    if (this.table === "posts" && this.options.exactDuplicate && this.filters["neq:tweet_id"]) {
      return [this.options.exactDuplicate];
    }
    if (this.table === "story_signatures" && this.filters.tweet_id) {
      return this.options.signatureEmbedding === undefined
        ? []
        : [{ embedding: this.options.signatureEmbedding }];
    }
    if (this.table === "deliveries") {
      return (this.options.telegramStatuses ?? []).map((status) => ({ status }));
    }
    if (this.table === "x_deliveries") {
      return (this.options.xStatuses ?? []).map((status) => ({ status }));
    }
    if (this.table === "jobs") {
      return (this.options.jobStatuses ?? []).map((status) => ({ status, type: "deliver" }));
    }
    return [];
  }
}

function basePost() {
  return {
    tweet_id: "newer",
    text_original: "A long enough current story body for semantic duplicate checks.",
    url: "https://example.com/new",
    created_at: "2026-05-15T00:00:00.000Z",
  };
}

function candidate(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    tweet_id: "older",
    story_cluster_id: "11111111-1111-1111-1111-111111111111",
    similarity: 0.86,
    normalized_text: "older related story",
    text_original: "Older related story body.",
    text_translated: null,
    author_handle: "source",
    url: "https://example.com/older",
    created_at: "2026-05-14T23:00:00.000Z",
    ...overrides,
  };
}

function makeAiResult(status: "duplicate" | "related_new_info" | "uncertain", candidates: DuplicateGateResult["candidates"]): DuplicateGateResult {
  const top = candidates[0];
  return {
    ok: true,
    status,
    method: "semantic_ai",
    confidence: status === "uncertain" ? 0.4 : 0.8,
    dup_of_tweet_id: status === "duplicate" ? top.tweet_id : null,
    story_cluster_id: top.story_cluster_id,
    similarity: top.similarity,
    reason: status === "related_new_info" ? "adds material new facts" : "ai decision",
    new_facts: status === "related_new_info" ? ["new casualty count"] : [],
    should_enqueue_translate: status !== "duplicate",
    candidates,
  };
}
