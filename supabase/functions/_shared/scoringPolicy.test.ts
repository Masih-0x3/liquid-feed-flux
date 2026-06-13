import { assertEquals } from "jsr:@std/assert";
import {
  DEFAULT_SCORING_POLICY,
  buildScoringPolicyEventMeta,
  computeScoringV2AxisScore,
  finalizeScoringPolicyResult,
  getActiveScoringProfile,
  normalizeScoringPolicy,
  runScoringPolicy,
  shouldAdjudicate,
} from "./scoringPolicy.ts";

Deno.test("normalizeScoringPolicy keeps the default Iran-first profile disabled in shadow mode", () => {
  const policy = normalizeScoringPolicy(null);
  assertEquals(policy.enabled, false);
  assertEquals(policy.mode, "shadow");
  assertEquals(policy.active_profile_id, "iran-first");
  assertEquals(policy.profiles[0].focus_entities.includes("Iran"), true);
});

Deno.test("direct focus can pass without a cap when score clears threshold", () => {
  const policy = normalizeScoringPolicy(DEFAULT_SCORING_POLICY);
  const profile = getActiveScoringProfile(policy);
  const result = finalizeScoringPolicyResult({
    audience_class: "direct_focus",
    audience_confidence: 0.95,
    priority_score: 18,
    axes: highAxes(),
    tags: ["iran", "security"],
    audience_reason: "Directly about Iran security.",
  }, policy, profile, "source");

  assertEquals(result.delivery_decision, "deliver");
  assertEquals(result.cap, 20);
  assertEquals(result.threshold, 12);
  assertEquals(result.final_score >= 12, true);
});

Deno.test("adjacent items cap at 16 but can still pass", () => {
  const policy = normalizeScoringPolicy(DEFAULT_SCORING_POLICY);
  const profile = getActiveScoringProfile(policy);
  const result = finalizeScoringPolicyResult({
    audience_class: "adjacent",
    audience_confidence: 0.9,
    priority_score: 20,
    axes: highAxes(),
    tags: ["regional"],
    audience_reason: "Material regional consequence.",
  }, policy, profile);

  assertEquals(result.delivery_decision, "deliver");
  assertEquals(result.cap, 16);
  assertEquals(result.final_score <= 16, true);
});

Deno.test("balanced adjacent threshold allows 12.5 but skips 12.4", () => {
  const policy = normalizeScoringPolicy({
    ...DEFAULT_SCORING_POLICY,
    profiles: [{
      ...DEFAULT_SCORING_POLICY.profiles[0],
      thresholds: {
        ...DEFAULT_SCORING_POLICY.profiles[0].thresholds,
        adjacent: { threshold: 12.5, cap: 16 },
      },
    }],
  });
  const profile = getActiveScoringProfile(policy);
  const skipped = finalizeScoringPolicyResult({
    audience_class: "adjacent",
    audience_confidence: 0.9,
    priority_score: 12.4,
    axes: boundaryAxes(),
    tags: ["regional"],
    audience_reason: "Relevant but not enough for the balanced adjacent threshold.",
  }, policy, profile);
  const delivered = finalizeScoringPolicyResult({
    audience_class: "adjacent",
    audience_confidence: 0.9,
    priority_score: 12.5,
    axes: boundaryAxes(),
    tags: ["regional"],
    audience_reason: "Relevant enough for the balanced adjacent threshold.",
  }, policy, profile);

  assertEquals(skipped.final_score, 12.4);
  assertEquals(skipped.delivery_decision, "skip");
  assertEquals(skipped.threshold, 12.5);
  assertEquals(delivered.final_score >= 12.5, true);
  assertEquals(delivered.delivery_decision, "deliver");
  assertEquals(delivered.threshold, 12.5);
});

Deno.test("regional escalation adjacent rule auto-delivers only 10+ urgent regional skips", () => {
  const policy = normalizeScoringPolicy({ ...DEFAULT_SCORING_POLICY, enabled: true });
  const profile = getActiveScoringProfile(policy);
  const urgent = finalizeScoringPolicyResult({
    audience_class: "adjacent",
    audience_confidence: 0.9,
    priority_score: 12.4,
    axes: boundaryAxes(),
    tags: ["regional"],
    audience_reason: "Saudi missile alert affects regional escalation.",
  }, policy, profile, "source", "Initial reports of ballistic missile launches now against Saudi Arabia.");
  const low = finalizeScoringPolicyResult({
    audience_class: "adjacent",
    audience_confidence: 0.9,
    priority_score: 9,
    axes: midAxes(),
    tags: ["regional"],
    audience_reason: "Weak regional signal.",
  }, policy, profile, "source", "Air raid sirens sounding in Saudi Arabia.");
  const noTerms = finalizeScoringPolicyResult({
    audience_class: "adjacent",
    audience_confidence: 0.9,
    priority_score: 12.4,
    axes: boundaryAxes(),
    tags: ["regional"],
    audience_reason: "Adjacent context without urgent terms.",
  }, policy, profile, "source", "Regional leaders met for routine diplomacy.");

  assertEquals(urgent.final_score, 12.4);
  assertEquals(urgent.delivery_decision, "deliver");
  assertEquals(urgent.review_status, "none");
  assertEquals(urgent.policy_rule_applied?.kind, "regional_escalation_auto");
  assertEquals(urgent.policy_rule_applied?.original_decision, "skip");
  assertEquals(urgent.policy_rule_applied?.matched_terms.includes("ballistic"), true);
  assertEquals(low.final_score < 10, true);
  assertEquals(low.delivery_decision, "skip");
  assertEquals(noTerms.delivery_decision, "skip");
});

Deno.test("routine off-topic content is capped at 8 and skipped", () => {
  const policy = normalizeScoringPolicy(DEFAULT_SCORING_POLICY);
  const profile = getActiveScoringProfile(policy);
  const result = finalizeScoringPolicyResult({
    audience_class: "off_topic",
    audience_confidence: 0.98,
    priority_score: 19,
    axes: highAxes(),
    tags: ["sports"],
    audience_reason: "Unrelated sports item.",
  }, policy, profile);

  assertEquals(result.delivery_decision, "skip");
  assertEquals(result.cap, 8);
});

Deno.test("world-shock global exception gets the higher configured cap", () => {
  const policy = normalizeScoringPolicy(DEFAULT_SCORING_POLICY);
  const profile = getActiveScoringProfile(policy);
  const result = finalizeScoringPolicyResult({
    audience_class: "global_exception",
    global_exception_class: "world_shock",
    audience_confidence: 0.86,
    priority_score: 20,
    axes: highAxes(),
    tags: ["coup"],
    audience_reason: "A coup is a world-shock exception.",
  }, policy, profile);

  assertEquals(result.delivery_decision, "deliver");
  assertEquals(result.cap, 18);
  assertEquals(result.final_score <= 18, true);
});

Deno.test("oil and major leader global exceptions use the tuned 14 threshold", () => {
  const policy = normalizeScoringPolicy(DEFAULT_SCORING_POLICY);
  const profile = getActiveScoringProfile(policy);
  const oilDelivered = finalizeScoringPolicyResult({
    audience_class: "global_exception",
    global_exception_class: "oil_energy",
    audience_confidence: 0.9,
    priority_score: 11,
    axes: highAxes(),
    tags: ["oil"],
    audience_reason: "Oil terminal disruption affects Gulf energy security.",
  }, policy, profile);
  const leaderSkipped = finalizeScoringPolicyResult({
    audience_class: "global_exception",
    global_exception_class: "major_leader_statement",
    audience_confidence: 0.9,
    priority_score: 10,
    axes: highAxes(),
    tags: ["leader"],
    audience_reason: "Material leader statement but below tuned threshold.",
  }, policy, profile);

  assertEquals(oilDelivered.threshold, 14);
  assertEquals(oilDelivered.delivery_decision, "deliver");
  assertEquals(leaderSkipped.threshold, 14);
  assertEquals(leaderSkipped.final_score < 14, true);
  assertEquals(leaderSkipped.delivery_decision, "skip");
});

Deno.test("global mega-event exception is review-only even when it clears threshold", () => {
  const policy = normalizeScoringPolicy(DEFAULT_SCORING_POLICY);
  const profile = getActiveScoringProfile(policy);
  const result = finalizeScoringPolicyResult({
    audience_class: "global_exception",
    global_exception_class: "global_mega_event",
    audience_confidence: 0.9,
    priority_score: 20,
    axes: highAxes(),
    tags: ["global"],
    audience_reason: "Exceptional global story.",
  }, policy, profile);

  assertEquals(result.final_score, 18);
  assertEquals(result.delivery_decision, "skip");
  assertEquals(result.review_status, "needs_review");
  assertEquals(result.policy_rule_applied?.kind, "global_mega_event_review");
});

Deno.test("runScoringPolicy keeps global mega-event review-only after adjudication", async () => {
  const result = await runScoringPolicy({
    text: "A major AI company IPO becomes a global market shock.",
  }, { ...DEFAULT_SCORING_POLICY, enabled: true }, {
    apiKey: "test",
    model: "gpt-5.4-mini",
  }, {
    callOpenAIImpl: async () => ({
      ok: true,
      status: 200,
      rawText: "{}",
      raw: {},
      content: "",
      outputItems: [],
      webSearchResults: [],
      endpoint: "responses",
      usage: { total_tokens: 10 },
      toolCall: {
        name: "score_for_audience",
        arguments: JSON.stringify({
          audience_class: "global_exception",
          global_exception_class: "global_mega_event",
          audience_confidence: 0.92,
          audience_reason: "Exceptional global market story.",
          priority_score: 20,
          axes: highAxes(),
          tags: ["ai", "markets"],
        }),
      },
    }),
  });

  assertEquals(result.adjudicated, true);
  assertEquals(result.delivery_decision, "skip");
  assertEquals(result.review_status, "needs_review");
  assertEquals(result.policy_rule_applied?.kind, "global_mega_event_review");
});

Deno.test("switching profile changes class thresholds without changing code", () => {
  const policy = normalizeScoringPolicy({
    ...DEFAULT_SCORING_POLICY,
    active_profile_id: "turkey-first",
    profiles: [{
      ...DEFAULT_SCORING_POLICY.profiles[0],
      id: "turkey-first",
      name: "Turkey-first",
      focus_entities: ["Turkey", "Ankara", "Erdogan"],
      thresholds: {
        ...DEFAULT_SCORING_POLICY.profiles[0].thresholds,
        adjacent: { threshold: 15, cap: 16 },
      },
    }],
  });
  const profile = getActiveScoringProfile(policy);
  const result = finalizeScoringPolicyResult({
    audience_class: "adjacent",
    audience_confidence: 0.95,
    priority_score: 14,
    axes: midAxes(),
    tags: ["regional"],
    audience_reason: "Related but not central.",
  }, policy, profile);

  assertEquals(profile.id, "turkey-first");
  assertEquals(result.threshold, 15);
});

Deno.test("borderline and low-confidence outcomes require adjudication", () => {
  const policy = normalizeScoringPolicy(DEFAULT_SCORING_POLICY);
  assertEquals(shouldAdjudicate({ audience_class: "direct_focus", audience_confidence: 0.6, final_score: 17, threshold: 12 }, policy), true);
  assertEquals(shouldAdjudicate({ audience_class: "direct_focus", audience_confidence: 0.9, final_score: 12.4, threshold: 12 }, policy), true);
  assertEquals(shouldAdjudicate({ audience_class: "direct_focus", audience_confidence: 0.9, final_score: 18, threshold: 12 }, policy), false);
});

Deno.test("runScoringPolicy uses injected GPT calls and adjudicates global exceptions", async () => {
  let calls = 0;
  const result = await runScoringPolicy({
    text: "Bitcoin breaks a major all-time high.",
  }, { ...DEFAULT_SCORING_POLICY, enabled: true }, {
    apiKey: "test",
    model: "gpt-5.4-mini",
  }, {
    callOpenAIImpl: async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        rawText: "{}",
        raw: {},
        content: "",
        outputItems: [],
        webSearchResults: [],
        endpoint: "responses",
        usage: { total_tokens: 10 },
        toolCall: {
          name: "score_for_audience",
          arguments: JSON.stringify({
            audience_class: "global_exception",
            audience_confidence: 0.82,
            audience_reason: "Bitcoin milestone configured as global exception.",
            global_exception_class: "bitcoin_milestone",
            priority_score: 16,
            axes: highAxes(),
            tags: ["bitcoin"],
          }),
        },
      };
    },
  });
  assertEquals(result.delivery_decision, "deliver");
  assertEquals(result.adjudicated, true);
  assertEquals(result.review_status, "none");
  assertEquals(calls, 2);
});

Deno.test("runScoringPolicy renders at most 8 calibration examples", async () => {
  let systemPrompt = "";
  const examples = Array.from({ length: 9 }, (_, index) => ({
    text_original: `Example ${index + 1}`,
    author_handle: "source",
    expected_audience_class: "adjacent" as const,
    expected_decision: "deliver" as const,
    expected_score: 18,
    note: "regional_escalation",
  }));
  const result = await runScoringPolicy({
    text: "Routine item.",
  }, { ...DEFAULT_SCORING_POLICY, enabled: true }, {
    apiKey: "test",
    model: "gpt-5.4-mini",
  }, {
    calibrationExamples: examples,
    callOpenAIImpl: async (request) => {
      systemPrompt = String(request.messages[0]?.content ?? "");
      return {
        ok: true,
        status: 200,
        rawText: "{}",
        raw: {},
        content: "",
        outputItems: [],
        webSearchResults: [],
        endpoint: "responses",
        usage: { total_tokens: 10 },
        toolCall: {
          name: "score_for_audience",
          arguments: JSON.stringify({
            audience_class: "off_topic",
            audience_confidence: 0.9,
            audience_reason: "Routine.",
            priority_score: 1,
            axes: midAxes(),
            tags: [],
          }),
        },
      };
    },
  });

  assertEquals(result.ok, true);
  assertEquals(systemPrompt.includes("Recent human calibration examples"), true);
  assertEquals(systemPrompt.includes("Example 8"), true);
  assertEquals(systemPrompt.includes("Example 9"), false);
});

Deno.test("scoring policy event metadata includes production rollout fields", () => {
  const policy = normalizeScoringPolicy(DEFAULT_SCORING_POLICY);
  const profile = getActiveScoringProfile(policy);
  const result = finalizeScoringPolicyResult({
    audience_class: "direct_focus",
    audience_confidence: 0.82,
    priority_score: 15,
    axes: highAxes(),
    tags: ["Iran"],
    audience_reason: "Direct Iran item.",
  }, policy, profile, "source");

  const meta = buildScoringPolicyEventMeta(result, "shadow");

  assertEquals(meta.mode, "shadow");
  assertEquals(meta.profile_id, "iran-first");
  assertEquals(meta.audience_class, "direct_focus");
  assertEquals(meta.audience_confidence, 0.82);
  assertEquals(meta.audience_reason, "Direct Iran item.");
  assertEquals(meta.final_score, result.final_score);
  assertEquals(meta.threshold, 12);
  assertEquals(meta.cap, 20);
  assertEquals(meta.decision, "deliver");
  assertEquals(meta.review_status, result.review_status);
  assertEquals(meta.adjudicated, false);
  assertEquals(meta.global_exception_class, null);
});

Deno.test("scoring policy event metadata includes applied tuning rule details", () => {
  const policy = normalizeScoringPolicy(DEFAULT_SCORING_POLICY);
  const profile = getActiveScoringProfile(policy);
  const result = finalizeScoringPolicyResult({
    audience_class: "adjacent",
    audience_confidence: 0.9,
    priority_score: 12.4,
    axes: boundaryAxes(),
    tags: ["regional"],
    audience_reason: "Regional escalation.",
  }, policy, profile, "source", "Reports of explosions in Erbil.");

  const meta = buildScoringPolicyEventMeta(result, "active");

  assertEquals(meta.policy_rule_applied, "regional_escalation_auto");
  assertEquals((meta.policy_rule as { original_decision?: string } | undefined)?.original_decision, "skip");
  assertEquals(((meta.policy_rule as { matched_terms?: string[] } | undefined)?.matched_terms ?? []).includes("explosion"), true);
});

function highAxes() {
  return {
    focus_relevance: 9,
    geopolitical_weight: 9,
    audience_value: 9,
    materiality: 9,
    freshness: 8,
    credibility: 8,
    noise_penalty: 0,
  };
}

function midAxes() {
  return {
    focus_relevance: 5,
    geopolitical_weight: 6,
    audience_value: 6,
    materiality: 6,
    freshness: 6,
    credibility: 7,
    noise_penalty: 1,
  };
}

function boundaryAxes() {
  return {
    focus_relevance: 7,
    geopolitical_weight: 7,
    audience_value: 6,
    materiality: 6,
    freshness: 6,
    credibility: 6,
    noise_penalty: 0,
  };
}

Deno.test("axis score stays in 1-20 range", () => {
  const score = computeScoringV2AxisScore(highAxes(), DEFAULT_SCORING_POLICY.profiles[0].axis_weights);
  assertEquals(score > 1 && score <= 20, true);
});
