import { describe, expect, it } from "vitest";

import { buildProcessTraceMap, type ProcessTraceNodeId } from "@/lib/processTraceMap";
import type { MonitoringEntry, PipelineEvent } from "@/hooks/useMonitoringData";

function entry(overrides: Partial<MonitoringEntry> = {}): MonitoringEntry {
  return {
    tweet_id: "tweet-1",
    text_original: "original text",
    text_translated: "",
    url: "https://example.com/source",
    created_at: "2026-05-23T14:00:00.000Z",
    has_media: false,
    account_handle: "rss-feed",
    author_handle: "source",
    delivery_status: "",
    telegram_message_ids: [],
    is_translated: false,
    is_delivered: false,
    translation_job_status: "",
    delivery_job_status: "",
    translation_error: "",
    delivery_error: "",
    importance_score: null,
    importance_tags: null,
    importance_reasoning: null,
    delivery_decision: null,
    score_axes: null,
    final_score: null,
    base_score: null,
    learned_score: null,
    learned_delta: null,
    x_gate_score: null,
    learning_confidence: null,
    decision_reason: null,
    scoring_version: null,
    scoring_profile_id: null,
    audience_class: null,
    audience_confidence: null,
    audience_reason: null,
    global_exception_class: null,
    score_review_status: null,
    is_truncated: false,
    hydrated_at: null,
    hydration_source: null,
    x_status: null,
    x_tweet_id: null,
    x_posted_at: null,
    x_error: null,
    x_skip_reason: null,
    dup_of_tweet_id: null,
    duplicate_of: null,
    story_cluster_id: null,
    dup_similarity: null,
    dedupe_status: null,
    dedupe_checked_at: null,
    dedupe_method: null,
    dedupe_confidence: null,
    dedupe_reason: null,
    dedupe_new_facts: null,
    score_breakdown: null,
    feedback_locked: false,
    enrich_status: null,
    enrichment_version: null,
    editorial_commentary: null,
    humanized_commentary: null,
    commentary_hook: null,
    commentary_question: null,
    narrative_callback: null,
    composed_post_text: null,
    creator_angle: null,
    why_it_matters: null,
    source_context: null,
    algorithm_signal_scores: null,
    aggregator_risk_score: null,
    ai_voice_risk_score: null,
    monetization_risk_flags: null,
    enrichment_review_reason: null,
    final_x_text: null,
    post_format_hint: null,
    background_context: null,
    enrich_tokens: null,
    enrich_duration_ms: null,
    ...overrides,
  };
}

function event(overrides: Partial<PipelineEvent>): PipelineEvent {
  return {
    subject_type: "post",
    subject_id: "tweet-1",
    step: "dedupe",
    status: "queued",
    started_at: "2026-05-23T14:00:00.000Z",
    ended_at: null,
    error: null,
    meta: {},
    ...overrides,
  };
}

function node(map: ReturnType<typeof buildProcessTraceMap>, id: ProcessTraceNodeId) {
  const match = map.nodes.find((item) => item.id === id);
  expect(match).toBeDefined();
  return match!;
}

describe("process trace map view-model", () => {
  it("maps completed entry, timeline, and AI ledger evidence into visible process nodes", () => {
    const source = entry({
      text_translated: "ترجمه",
      is_translated: true,
      is_delivered: true,
      telegram_message_ids: ["123"],
      final_score: 16,
      delivery_decision: "deliver",
      dedupe_status: "unique",
      dedupe_checked_at: "2026-05-23T14:00:05.000Z",
      x_status: "posted",
      x_tweet_id: "2056",
      x_posted_at: "2026-05-23T14:05:00.000Z",
      process_observability: {
        available: true,
        source: "workflow_runs",
        partial_reason: null,
        ai_calls: 1,
        failed_ai_calls: 0,
        total_tokens: 1250,
        foglamp_exported: 0,
        foglamp_skipped: 1,
        recent_runs: [],
        latest_run: {
          run_key: "post:tweet-1:job:abc",
          workflow_name: "rss-item-pipeline",
          workflow_run_id: "worker:tweet-1:abc",
          status: "completed",
          source_function: "worker",
          started_at: "2026-05-23T14:00:00.000Z",
          ended_at: "2026-05-23T14:00:05.000Z",
          duration_seconds: 5,
          last_error: null,
          ai_call_count: 1,
          failed_ai_call_count: 0,
          total_tokens: 1250,
          foglamp_exported: 0,
          foglamp_skipped: 1,
          calls: [
            {
              workflow_run_key: "post:tweet-1:job:abc",
              trace_name: "rss-item-pipeline",
              operation_name: "translate",
              agent_name: "translator",
              model: "gpt-4.1-mini",
              endpoint: "chat_completions",
              status: "completed",
              total_tokens: 1250,
              reasoning_tokens: 0,
              duration_ms: 5000,
              started_at: "2026-05-23T14:00:00.000Z",
              ended_at: "2026-05-23T14:00:05.000Z",
              foglamp_exported: false,
              foglamp_span_estimate: 1,
              foglamp_skip_reason: "worker_local_only",
              error_message: null,
            },
          ],
        },
      },
    });

    const map = buildProcessTraceMap(source, [
      event({ step: "dedupe", status: "completed", ended_at: "2026-05-23T14:00:05.000Z" }),
      event({ step: "deliver", status: "completed", ended_at: "2026-05-23T14:04:00.000Z" }),
    ]);

    expect(node(map, "dedupe")).toMatchObject({ status: "completed" });
    expect(node(map, "score").detail).toContain("16");
    expect(node(map, "translate")).toMatchObject({
      status: "completed",
      tokens: 1250,
      model: "gpt-4.1-mini",
      agentName: "translator",
    });
    expect(node(map, "telegram")).toMatchObject({ status: "completed" });
    expect(node(map, "x-post")).toMatchObject({ status: "completed" });
    expect(node(map, "trace-export")).toMatchObject({ status: "skipped", skipReason: "worker_local_only" });
    expect(map.summary).toMatchObject({
      aiCalls: 1,
      tokens: 1250,
      workflowName: "rss-item-pipeline",
      workflowRunId: "worker:tweet-1:abc",
    });
    expect(map.edges.some((edge) => edge.to === "x-post")).toBe(true);
  });

  it("shows duplicate-gate blocks without completing downstream absent work", () => {
    const map = buildProcessTraceMap(entry({
      dup_of_tweet_id: "canonical-tweet",
      dedupe_status: "duplicate",
      dedupe_reason: "same story",
    }));

    expect(node(map, "dedupe")).toMatchObject({ status: "blocked", skipReason: "same story" });
    expect(node(map, "score")).toMatchObject({ status: "skipped", skipReason: "duplicate" });
    expect(node(map, "translate")).toMatchObject({ status: "skipped", skipReason: "duplicate" });
    expect(node(map, "telegram")).toMatchObject({ status: "skipped", skipReason: "duplicate" });
    expect(node(map, "x-post")).toMatchObject({ status: "skipped", skipReason: "duplicate" });
  });

  it("lets a terminal skip decision override stale downstream pending fields", () => {
    const map = buildProcessTraceMap(entry({
      delivery_decision: "skip",
      delivery_status: "pending",
      delivery_job_status: "pending",
      x_status: "pending",
      monitoring_state: {
        code: "below_threshold",
        stage_label: "Below threshold",
        tone: "muted",
        decision_label: "Skipped",
        primary_blocker: null,
        translation_state: "translated",
        telegram_state: "pending",
        x_state: "pending",
        needs_attention: false,
        next_actions: ["details"],
      },
    }));

    expect(node(map, "telegram")).toMatchObject({ status: "skipped", skipReason: "below_threshold" });
    expect(node(map, "x-dispatch")).toMatchObject({ status: "skipped", skipReason: "below_threshold" });
    expect(node(map, "x-post")).toMatchObject({ status: "skipped", skipReason: "below_threshold" });
    expect(map.summary.status).toBe("skipped");
  });

  it("marks an uncertain duplicate gate as blocked review rather than active work", () => {
    const map = buildProcessTraceMap(entry({
      dedupe_status: "uncertain",
      dedupe_reason: "needs manual duplicate review",
    }));

    expect(node(map, "dedupe")).toMatchObject({ status: "blocked", tone: "warn" });
    expect(map.summary.status).toBe("blocked");
  });

  it("keeps actual delivery and posting evidence dominant over a contradictory terminal skip", () => {
    const map = buildProcessTraceMap(entry({
      delivery_decision: "skip",
      delivery_status: "pending",
      is_delivered: true,
      telegram_message_ids: ["123"],
      x_status: "posted",
      x_tweet_id: "2056",
      x_posted_at: "2026-05-23T14:05:00.000Z",
      monitoring_state: {
        code: "below_threshold",
        stage_label: "Below threshold",
        tone: "muted",
        decision_label: "Skipped",
        primary_blocker: null,
        translation_state: "translated",
        telegram_state: "delivered",
        x_state: "posted",
        needs_attention: false,
        next_actions: ["details"],
      },
    }));

    expect(node(map, "telegram")).toMatchObject({ status: "completed" });
    expect(node(map, "x-dispatch")).toMatchObject({ status: "completed" });
    expect(node(map, "x-post")).toMatchObject({ status: "completed" });
  });

  it("keeps timeline-backed delivery evidence dominant over a stale terminal skip", () => {
    const map = buildProcessTraceMap(
      entry({
        delivery_decision: "skip",
        delivery_status: "pending",
        monitoring_state: {
          code: "below_threshold",
          stage_label: "Below threshold",
          tone: "muted",
          decision_label: "Skipped",
          primary_blocker: null,
          translation_state: "translated",
          telegram_state: null,
          x_state: null,
          needs_attention: false,
          next_actions: ["details"],
        },
      }),
      [
        event({
          step: "telegram_delivery",
          status: "completed",
          started_at: "2026-05-23T14:04:00.000Z",
          ended_at: "2026-05-23T14:05:00.000Z",
          error: null,
          meta: {},
        }),
      ],
    );

    expect(node(map, "telegram")).toMatchObject({ status: "completed" });
    expect(map.summary.status).toBe("completed");
  });

  it("keeps pending separate from active running work", () => {
    const map = buildProcessTraceMap(entry({
      delivery_decision: "deliver",
      translation_job_status: "pending",
    }));

    expect(node(map, "translate")).toMatchObject({ status: "pending", tone: "muted" });
    expect(map.summary.running).toBe(0);
    expect(map.summary.pending).toBeGreaterThan(0);
    expect(map.summary.status).toBe("pending");
  });

  it("does not keep posted items running when hosted trace evidence is absent", () => {
    const map = buildProcessTraceMap(entry({
      final_score: 16,
      delivery_decision: "deliver",
      is_translated: true,
      is_delivered: true,
      telegram_message_ids: ["123"],
      x_status: "posted",
      x_tweet_id: "2056",
      x_posted_at: "2026-05-23T14:05:00.000Z",
      monitoring_state: {
        code: "delivered",
        stage_label: "X posted",
        tone: "good",
        decision_label: "X posted",
        primary_blocker: null,
        translation_state: "translated",
        telegram_state: "delivered",
        x_state: "posted",
        needs_attention: false,
        next_actions: ["details"],
      },
    }));

    expect(node(map, "trace-export")).toMatchObject({ status: "skipped", skipReason: "local_only" });
    expect(map.summary.status).toBe("completed");
  });

  it("treats enrichment approval as a manual review checkpoint", () => {
    const map = buildProcessTraceMap(entry({
      final_score: 16,
      delivery_decision: "deliver",
      enrich_status: "awaiting_approval",
      enrichment_version: "voice-v1",
    }));
    const enrich = node(map, "enrich");

    expect(enrich).toMatchObject({
      label: "Manual enrichment",
      shortLabel: "Manual enrich",
      kind: "manual",
      status: "blocked",
      skipReason: "manual_review",
    });
    expect(enrich.detail).toContain("Manual enrichment is awaiting approval");
    expect(map.summary.status).toBe("blocked");
  });

  it("surfaces partial observability and failed AI calls on the matching stage", () => {
    const source = entry({
      process_observability: {
        available: true,
        source: "workflow_runs",
        partial_reason: "workflow_run_without_complete_ledger",
        ai_calls: 1,
        failed_ai_calls: 1,
        total_tokens: 322,
        foglamp_exported: 0,
        foglamp_skipped: 1,
        recent_runs: [],
        latest_run: {
          run_key: "post:tweet-1:job:failed",
          workflow_name: "rss-item-pipeline",
          workflow_run_id: "worker:tweet-1:failed",
          status: "failed",
          source_function: "worker",
          started_at: "2026-05-23T14:00:00.000Z",
          ended_at: "2026-05-23T14:00:02.000Z",
          duration_seconds: 2,
          last_error: "model timeout",
          ai_call_count: 1,
          failed_ai_call_count: 1,
          total_tokens: 322,
          foglamp_exported: 0,
          foglamp_skipped: 1,
          calls: [
            {
              workflow_run_key: "post:tweet-1:job:failed",
              trace_name: "rss-item-pipeline",
              operation_name: "score_post",
              agent_name: "scorer",
              model: "gpt-4.1-mini",
              endpoint: "chat_completions",
              status: "failed",
              total_tokens: 322,
              reasoning_tokens: 0,
              duration_ms: 2000,
              started_at: "2026-05-23T14:00:00.000Z",
              ended_at: "2026-05-23T14:00:02.000Z",
              foglamp_exported: false,
              foglamp_span_estimate: 1,
              foglamp_skip_reason: "worker_local_only",
              error_message: "model timeout",
            },
          ],
        },
      },
    });

    const map = buildProcessTraceMap(source);

    expect(node(map, "score")).toMatchObject({
      status: "failed",
      error: "model timeout",
      tokens: 322,
    });
    expect(map.summary.failed).toBeGreaterThan(0);
    expect(map.partialReasons).toContain("workflow run without complete ledger");
    expect(map.partialReasons).toContain("model timeout");
  });
});
