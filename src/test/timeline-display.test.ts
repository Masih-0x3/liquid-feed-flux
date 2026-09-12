import { describe, expect, it } from "vitest";
import { buildDeliverySummary, buildPipelineTimelineGroups, describePipelineEvent } from "@/lib/timelineDisplay";
import type { MonitoringEntry, PipelineEvent } from "@/hooks/useMonitoringData";

function entry(overrides: Partial<MonitoringEntry>): MonitoringEntry {
  return {
    tweet_id: "tweet-1",
    text_original: "original",
    text_translated: "",
    url: "",
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
    started_at: "2026-05-23T14:48:42.000Z",
    ended_at: null,
    error: null,
    meta: {},
    ...overrides,
  };
}

describe("timeline display helpers", () => {
  it("labels platform delivery states separately from internal work", () => {
    const summary = buildDeliverySummary(
      entry({
        is_delivered: true,
        telegram_message_ids: ["123"],
        x_status: "posted",
        x_tweet_id: "2056",
        x_posted_at: "2026-05-23T15:05:00.000Z",
      }),
      [event({ step: "deliver", status: "completed", ended_at: "2026-05-23T15:01:00.000Z" })],
    );

    expect(summary.map((item) => item.platform)).toEqual(["Telegram", "X"]);
    expect(summary[0]).toMatchObject({ label: "Delivered", tone: "good" });
    expect(summary[0].timestampLabel).toBe("Delivered at");
    expect(summary[0].timestamp).toContain("May 23");
    expect(summary[1]).toMatchObject({ label: "Posted", tone: "good" });
    expect(summary[1].detail).toContain("Tweet 2056");
  });

  it("does not use the post creation time as a fake Telegram delivery time", () => {
    const summary = buildDeliverySummary(entry({
      is_delivered: true,
      telegram_message_ids: ["123"],
      created_at: "2026-05-23T14:00:00.000Z",
    }));

    expect(summary[0].timestamp).toBeNull();
    expect(summary[0].detail).toContain("delivery time unavailable");
  });

  it("does not treat a completed skipped delivery job as a Telegram send", () => {
    const post = entry({ delivery_decision: "skip", delivery_job_status: "completed", delivery_status: "pending" });
    const completed = event({ step: "deliver", status: "completed", ended_at: "2026-05-23T15:01:00.000Z" });
    expect(buildDeliverySummary(post, [completed])[0]).toMatchObject({ label: "Skipped", timestamp: null, timestampLabel: null });
    expect(describePipelineEvent(completed, post)).toMatchObject({ statusLabel: "Skipped", statusTone: "muted" });
    expect(describePipelineEvent({ ...completed, step: "translate" }, post).statusLabel).toBe("Skipped");
  });

  it("requires outcome evidence for completed external work and never invents a message count", () => {
    const completed = event({ step: "deliver", status: "completed" });
    expect(describePipelineEvent(completed, entry({})).statusLabel).toBe("No delivery receipt");
    const delivered = buildDeliverySummary(entry({ is_delivered: true }), [completed])[0];
    expect(delivered.detail).toContain("message count unavailable");
    expect(delivered.detail).not.toContain("1 message");
  });

  it("honors explicit skipped metadata even without a post snapshot", () => {
    const skipped = event({ step: "deliver", status: "completed", meta: { skipped: true } });
    expect(describePipelineEvent(skipped).statusLabel).toBe("Skipped");
    expect(buildDeliverySummary(entry({ is_delivered: true }), [skipped])[0].timestamp).toBeNull();
  });

  it('uses explicit platform receipts when the post snapshot is stale', () => {
    const post = entry({ delivery_decision: 'skip', x_status: 'skipped' });
    const receipts = [event({ step: 'deliver', status: 'delivered' }), event({ step: 'x_post', status: 'posted' })];
    expect(buildDeliverySummary(post, receipts).map((item) => item.label)).toEqual(['Delivered', 'Posted']);
    expect(buildDeliverySummary(post, [event({ step: 'x_post', status: 'completed' })])[1].timestamp).toBeNull();
  });

  it.each([
    { status: 'pending', label: 'Pending', tone: 'warn' },
    { status: 'blocked', label: 'Blocked', tone: 'warn' },
    { status: 'failed', label: 'Failed', tone: 'bad' },
    { status: 'skipped', label: 'Skipped', tone: 'muted' },
  ])('keeps $status delivery states distinct in the shared row and summary model', ({ status, label, tone }) => {
    const post = entry({ delivery_status: status, delivery_job_status: 'completed', x_status: status });
    const summaries = buildDeliverySummary(post);
    for (const summary of summaries) {
      expect(summary).toMatchObject({ label, tone, timestamp: null, timestampLabel: null });
    }
    expect(describePipelineEvent(event({ step: 'deliver', status }), post).statusLabel).toBe(label);
    expect(describePipelineEvent(event({ step: 'x_post', status }), post).statusLabel).toBe(label);
  });

  it('does not call historical queue completion a current blocked send', () => {
    const post = entry({ delivery_status: 'blocked', delivery_job_status: 'completed' });
    const historical = event({ step: 'deliver', status: 'completed' });
    expect(buildDeliverySummary(post, [historical])[0]).toMatchObject({ label: 'Blocked', timestamp: null });
    expect(describePipelineEvent(historical, post)).toMatchObject({ statusLabel: 'No delivery receipt', statusTone: 'muted' });
  });

  it('keeps an explicit receipt time instead of a later queue-completion time', () => {
    const receiptTime = '2026-05-23T15:01:00.000Z';
    const laterQueueTime = '2026-05-23T16:00:00.000Z';
    const post = entry({ is_delivered: true, x_status: 'posted' });
    const history = [
      event({ step: 'deliver', status: 'delivered', ended_at: receiptTime }),
      event({ step: 'x_post', status: 'posted', ended_at: receiptTime }),
      event({ step: 'deliver', status: 'completed', ended_at: laterQueueTime }),
      event({ step: 'x_post', status: 'completed', ended_at: laterQueueTime }),
    ];
    expect(buildDeliverySummary(post, history).map((summary) => summary.rawTimestamp)).toEqual([receiptTime, receiptTime]);
  });

  it('keeps failed attempts visible when receipts confirm that both platforms received the post', () => {
    const post = entry({ delivery_status: 'posted', delivery_error: 'Older Telegram failure', x_status: 'posted', x_error: 'Older X failure' });
    const failedAttempts = [
      event({ step: 'deliver', status: 'failed', error: 'Older Telegram failure' }),
      event({ step: 'x_post', status: 'failed', error: 'Older X failure' }),
    ];
    expect(buildDeliverySummary(post, failedAttempts).map((summary) => summary.label)).toEqual(['Delivered', 'Posted']);
    for (const attempt of failedAttempts) {
      expect(describePipelineEvent(attempt, post)).toMatchObject({ statusLabel: 'Failed', statusTone: 'bad', errorDetail: attempt.error });
    }
  });

  it("turns raw pipeline steps into readable labels, platforms, and timings", () => {
    const item = describePipelineEvent(event({
      step: "hydrate_tweet",
      status: "completed",
      started_at: "2026-05-23T14:48:42.000Z",
      ended_at: "2026-05-23T14:49:12.000Z",
    }));

    expect(item.title).toBe("Tweet hydration");
    expect(item.platform).toBe("X read");
    expect(item.statusLabel).toBe("Completed");
    expect(item.duration).toBe("30s");
    expect(item.timestamp).toContain("May 23");
  });

  it("surfaces delivery errors with a platform-specific label", () => {
    const item = describePipelineEvent(event({
      step: "deliver",
      status: "failed",
      error: "telegram_bad_request: chat not found",
    }));

    expect(item.title).toBe("Telegram delivery");
    expect(item.platform).toBe("Telegram");
    expect(item.statusTone).toBe("bad");
    expect(item.errorTitle).toBe("Telegram request failed");
  });

  it("explains Telegram signed-URL video fetch failures", () => {
    const item = describePipelineEvent(event({
      step: "deliver",
      status: "failed",
      error: "deliver[123]: Telegram sendVideo failed: Bad Request: failed to get HTTP URL content",
    }));

    expect(item.errorTitle).toBe("Telegram URL fetch failed; video should use multipart upload");
    expect(item.errorDetail).toContain("failed to get HTTP URL content");
  });

  it("groups repeated queue updates into one readable stage", () => {
    const groups = buildPipelineTimelineGroups([
      event({ step: "dedupe", status: "queued", started_at: "2026-05-23T14:48:00.000Z" }),
      event({ step: "dedupe", status: "running", started_at: "2026-05-23T14:49:00.000Z" }),
      event({ step: "dedupe", status: "completed", started_at: null, ended_at: "2026-05-23T14:50:00.000Z" }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      title: "Duplicate gate",
      platform: "Internal",
      statusLabel: "Completed",
      updateCount: 3,
    });
    expect(groups[0].events.map((item) => item.statusLabel)).toEqual(["Queued", "Running", "Completed"]);
  });
});
