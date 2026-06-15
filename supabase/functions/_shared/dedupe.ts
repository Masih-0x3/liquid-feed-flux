import { callOpenAI, type ToolFunctionDef } from "./openai.ts";
import { isRetryableProviderError } from "./providerErrors.ts";

export type DedupeStatus =
  | "pending"
  | "unique"
  | "duplicate"
  | "related_new_info"
  | "uncertain"
  | "coverage_gap"
  | "failed"
  | "disabled";
export type DedupeMethod =
  | "none"
  | "exact_tweet"
  | "exact_url"
  | "semantic_auto"
  | "semantic_ai";
export type DedupeFailurePhase =
  | "embedding"
  | "candidate_lookup"
  | "coverage_check"
  | "post_update"
  | "event_insert"
  | "signature_upsert"
  | "adjudicator"
  | "unknown";

export interface DuplicateGateConfig {
  enabled: boolean;
  window_hours: number;
  similarity_threshold: number;
  candidate_min_similarity: number;
  auto_duplicate_similarity: number;
  action: "skip" | "mark_and_deliver";
  mode: "hybrid_ai" | "semantic_only" | "review_first";
  adjudicator_model: string;
  adjudicator_reasoning_effort: string;
  adjudicator_confidence_threshold: number;
  bypass_authors: string[];
}

export interface DuplicateGatePost {
  tweet_id: string;
  text_original: string | null;
  text_translated?: string | null;
  author_handle?: string | null;
  url?: string | null;
  created_at?: string | null;
  decision_reason?: string | null;
  feedback_locked?: boolean | null;
}

export interface StoryCandidate {
  tweet_id: string;
  story_cluster_id: string | null;
  similarity: number;
  normalized_text?: string | null;
  text_original?: string | null;
  text_translated?: string | null;
  author_handle?: string | null;
  url?: string | null;
  created_at?: string | null;
  candidate_dedupe_status?: string | null;
  candidate_dup_of_tweet_id?: string | null;
  candidate_delivery_decision?: string | null;
  candidate_final_score?: number | null;
  candidate_importance_score?: number | null;
}

export interface DuplicateGateResult {
  ok: boolean;
  status: DedupeStatus;
  method: DedupeMethod;
  confidence: number | null;
  dup_of_tweet_id: string | null;
  story_cluster_id: string | null;
  similarity: number | null;
  reason: string;
  new_facts: string[];
  should_enqueue_translate: boolean;
  candidates: StoryCandidate[];
  dry_run?: boolean;
  error?: string;
  failure_phase?: DedupeFailurePhase;
  retryable?: boolean;
  coverage?: DuplicateCoverage | null;
}

export interface DuplicateCoverage {
  safe_to_block: boolean;
  state: "delivered" | "active_pipeline" | "coverage_gap" | "unknown";
  reason: string;
}

export interface DedupeThresholdSnapshot {
  similarity_threshold: number;
  candidate_min_similarity: number;
  auto_duplicate_similarity: number;
  adjudicator_confidence_threshold: number;
}

export interface DuplicateGateRunOptions {
  dryRun?: boolean;
  force?: boolean;
  source?: string;
  fetchEmbedding?: (text: string) => Promise<number[]>;
  adjudicate?: (
    post: DuplicateGatePost,
    candidates: StoryCandidate[],
    config: DuplicateGateConfig,
  ) => Promise<DuplicateGateResult>;
}

export interface FinalDuplicateAssertionResult {
  checked: boolean;
  blocked: boolean;
  reason: string | null;
  result: DuplicateGateResult | null;
}

export const DEFAULT_DUPLICATE_GATE: DuplicateGateConfig = {
  enabled: false,
  window_hours: 48,
  similarity_threshold: 0.86,
  candidate_min_similarity: 0.78,
  auto_duplicate_similarity: 0.94,
  action: "skip",
  mode: "hybrid_ai",
  adjudicator_model: "gpt-5.4-mini",
  adjudicator_reasoning_effort: "low",
  adjudicator_confidence_threshold: 0.65,
  bypass_authors: [],
};

export function normalizeDuplicateGateConfig(
  raw: unknown,
): DuplicateGateConfig {
  const input = raw && typeof raw === "object"
    ? raw as Record<string, unknown>
    : {};
  const legacyThreshold = typeof input.similarity_threshold === "number"
    ? input.similarity_threshold
    : DEFAULT_DUPLICATE_GATE.similarity_threshold;
  const mode =
    input.mode === "semantic_only" || input.mode === "review_first" ||
      input.mode === "hybrid_ai"
      ? input.mode
      : DEFAULT_DUPLICATE_GATE.mode;
  const action = input.action === "mark_and_deliver" || input.action === "skip"
    ? input.action
    : DEFAULT_DUPLICATE_GATE.action;
  const windowHours = typeof input.window_hours === "number"
    ? Math.max(
      DEFAULT_DUPLICATE_GATE.window_hours,
      Math.min(168, Math.round(input.window_hours)),
    )
    : DEFAULT_DUPLICATE_GATE.window_hours;
  const candidateMin = typeof input.candidate_min_similarity === "number"
    ? input.candidate_min_similarity
    : Math.min(
      legacyThreshold,
      DEFAULT_DUPLICATE_GATE.candidate_min_similarity,
    );
  const autoDuplicate = typeof input.auto_duplicate_similarity === "number"
    ? input.auto_duplicate_similarity
    : Math.max(
      legacyThreshold + 0.06,
      DEFAULT_DUPLICATE_GATE.auto_duplicate_similarity,
    );

  return {
    ...DEFAULT_DUPLICATE_GATE,
    enabled: input.enabled === true,
    window_hours: windowHours,
    similarity_threshold: clamp(legacyThreshold, 0.5, 0.99),
    candidate_min_similarity: clamp(candidateMin, 0.5, 0.99),
    auto_duplicate_similarity: clamp(autoDuplicate, 0.5, 0.99),
    action,
    mode,
    adjudicator_model: typeof input.adjudicator_model === "string" &&
        input.adjudicator_model.trim()
      ? input.adjudicator_model.trim()
      : DEFAULT_DUPLICATE_GATE.adjudicator_model,
    adjudicator_reasoning_effort:
      typeof input.adjudicator_reasoning_effort === "string" &&
        input.adjudicator_reasoning_effort.trim()
        ? input.adjudicator_reasoning_effort.trim()
        : DEFAULT_DUPLICATE_GATE.adjudicator_reasoning_effort,
    adjudicator_confidence_threshold:
      typeof input.adjudicator_confidence_threshold === "number"
        ? clamp(input.adjudicator_confidence_threshold, 0.5, 0.95)
        : DEFAULT_DUPLICATE_GATE.adjudicator_confidence_threshold,
    bypass_authors: Array.isArray(input.bypass_authors)
      ? input.bypass_authors.map((a) =>
        String(a).trim().replace(/^@/, "").toLowerCase()
      ).filter(Boolean).slice(0, 100)
      : [],
  };
}

export function normalizeStoryText(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[@#]\w+/g, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchStoryEmbedding(
  apiKey: string,
  text: string,
): Promise<number[]> {
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text.slice(0, 8000),
    }),
  });
  const rawText = await resp.text();
  if (!resp.ok) {
    throw new Error(`embedding_error:${resp.status}:${rawText.slice(0, 300)}`);
  }
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error("embedding_error:invalid_json");
  }
  const embedding = (data?.data as Array<{ embedding?: number[] }> | undefined)
    ?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error("embedding_error:missing_embedding");
  }
  return embedding;
}

export async function runDuplicateGate(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  post: DuplicateGatePost,
  rawConfig: unknown,
  options: DuplicateGateRunOptions = {},
): Promise<DuplicateGateResult> {
  const config = normalizeDuplicateGateConfig(rawConfig);
  const dryRun = options.dryRun === true;
  const nowIso = new Date().toISOString();
  const text = (post.text_translated || post.text_original || "").trim();
  const author = (post.author_handle || "").replace(/^@/, "").toLowerCase();
  const baseResult = (
    overrides: Partial<DuplicateGateResult>,
  ): DuplicateGateResult => ({
    ok: true,
    status: "unique",
    method: "none",
    confidence: null,
    dup_of_tweet_id: null,
    story_cluster_id: null,
    similarity: null,
    reason: "",
    new_facts: [],
    should_enqueue_translate: true,
    candidates: [],
    dry_run: dryRun || undefined,
    ...overrides,
  });

  if (!config.enabled) {
    return baseResult({
      status: "disabled",
      reason: "duplicate_gate_disabled",
      should_enqueue_translate: true,
    });
  }

  if (!text || normalizeStoryText(text).length < 20) {
    const result = baseResult({
      status: "unique",
      method: "none",
      reason: "too_little_text",
    });
    if (!dryRun) {
      await updatePostDedupeState(supabase, post.tweet_id, {
        dedupe_status: "unique",
        dedupe_method: "none",
        dedupe_confidence: null,
        dedupe_reason: "too_little_text",
        dedupe_checked_at: nowIso,
      });
      await insertDedupeEvent(supabase, post.tweet_id, "completed", {
        status: "unique",
        reason: "too_little_text",
        source: options.source,
      });
    }
    return result;
  }

  if (author && config.bypass_authors.includes(author)) {
    const result = baseResult({
      status: "unique",
      method: "none",
      confidence: null,
      reason: `bypass_author:${author}`,
    });
    if (!dryRun) {
      await updatePostDedupeState(supabase, post.tweet_id, {
        dedupe_status: "unique",
        dedupe_method: "none",
        dedupe_confidence: null,
        dedupe_reason: result.reason,
        dedupe_checked_at: nowIso,
        dup_of_tweet_id: null,
      });
      await insertDedupeEvent(supabase, post.tweet_id, "completed", {
        status: "unique",
        reason: result.reason,
        source: options.source,
      });
    }
    return result;
  }

  try {
    const exact = await findExactUrlDuplicate(supabase, post, config);
    if (exact) {
      let result = baseResult({
        status: "duplicate",
        method: "exact_url",
        confidence: 1,
        dup_of_tweet_id: canonicalCandidateTweetId(exact),
        story_cluster_id: exact.story_cluster_id ?? null,
        similarity: 1,
        reason: `same_url:${exact.url}`,
        should_enqueue_translate: config.action !== "skip" ||
          post.feedback_locked === true,
      });
      result = await canonicalizeResultThroughPosts(supabase, result);
      result = await preventUncoveredDuplicateSkip(
        supabase,
        post,
        result,
        config,
      );
      if (!dryRun) {
        await persistDedupeResult(
          supabase,
          post,
          result,
          config,
          nowIso,
          options.source,
        );
      }
      return result;
    }

    const getOpenAiApiKey = () => {
      const key = Deno.env.get("OPENAI_API_KEY") ?? "";
      if (!key) throw new Error("OPENAI_API_KEY is not configured");
      return key;
    };
    const embedding = options.fetchEmbedding
      ? await options.fetchEmbedding(text)
      : await fetchStoryEmbedding(getOpenAiApiKey(), text);
    const embeddingLiteral = `[${embedding.join(",")}]`;
    if (!dryRun) {
      await upsertBareStorySignature(supabase, post, embeddingLiteral);
    }
    const candidates = await findSemanticCandidates(
      supabase,
      embeddingLiteral,
      post.tweet_id,
      config,
    );

    let result: DuplicateGateResult;
    if (candidates.length === 0) {
      result = baseResult({
        status: "unique",
        method: "none",
        confidence: candidates[0]?.similarity ?? null,
        reason: "no_semantic_candidates",
        candidates,
      });
    } else {
      const top = candidates[0];
      if (config.mode === "semantic_only") {
        result = classifySemanticOnly(top, config, candidates);
      } else if (config.mode === "review_first") {
        result = baseResult({
          status: "uncertain",
          method: "semantic_auto",
          confidence: top.similarity,
          story_cluster_id: top.story_cluster_id,
          similarity: top.similarity,
          reason: `review_first_candidate:${top.tweet_id}`,
          candidates,
        });
      } else if (top.similarity >= config.auto_duplicate_similarity) {
        const canonical = await selectBestCanonicalCandidate(
          supabase,
          candidates,
          config.similarity_threshold,
        );
        result = baseResult({
          status: "duplicate",
          method: "semantic_auto",
          confidence: top.similarity,
          dup_of_tweet_id: canonicalCandidateTweetId(canonical),
          story_cluster_id: canonical.story_cluster_id ?? top.story_cluster_id,
          similarity: top.similarity,
          reason: `high_semantic_similarity:${top.similarity.toFixed(3)}`,
          should_enqueue_translate: config.action !== "skip" ||
            post.feedback_locked === true,
          candidates,
        });
      } else {
        result = options.adjudicate
          ? await options.adjudicate(post, candidates, config)
          : await adjudicateWithModel(
            getOpenAiApiKey(),
            post,
            candidates,
            config,
          );
      }
      result = canonicalizeDedupeResult(result, candidates);
    }

    if (result.status === "duplicate" && post.feedback_locked === true) {
      result = {
        ...result,
        should_enqueue_translate: true,
        reason: `${result.reason}; feedback_locked_no_skip`,
      };
    }

    result = await canonicalizeResultThroughPosts(supabase, result);
    result = await preventUncoveredDuplicateSkip(
      supabase,
      post,
      result,
      config,
    );

    if (!dryRun) {
      await upsertStorySignature(supabase, post, embeddingLiteral, result);
      await persistDedupeResult(
        supabase,
        post,
        result,
        config,
        nowIso,
        options.source,
      );
    }
    return result;
  } catch (e) {
    const message = (e as Error).message;
    const failure = classifyDedupeFailure(message);
    const result = baseResult({
      ok: false,
      status: "failed",
      method: "none",
      reason: message,
      should_enqueue_translate: false,
      error: message,
      failure_phase: failure.phase,
      retryable: failure.retryable,
    });
    if (!dryRun) {
      try {
        await updatePostDedupeState(supabase, post.tweet_id, {
          dedupe_status: "failed",
          dedupe_method: "none",
          dedupe_confidence: null,
          dedupe_reason: message,
          dedupe_checked_at: nowIso,
        });
      } catch (_updateError) {
        // Keep the original failure phase; the failed event still prevents a
        // quiet dedupe fail-open if the post row could not be marked failed.
      }
      await insertDedupeEvent(
        supabase,
        post.tweet_id,
        "failed",
        buildDedupeEventMeta(
          result,
          config,
          options.source,
          post.feedback_locked === true,
          {
            error: message,
            failure_phase: failure.phase,
            retryable: failure.retryable,
          },
        ),
      );
    }
    return result;
  }
}

export async function assertFinalDuplicateState(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  tweetId: string,
  rawConfig: unknown,
  options: DuplicateGateRunOptions = {},
): Promise<FinalDuplicateAssertionResult> {
  const config = normalizeDuplicateGateConfig(rawConfig);
  const dryRun = options.dryRun === true;
  if (!config.enabled || config.action !== "skip") {
    return {
      checked: false,
      blocked: false,
      reason: "duplicate_gate_disabled",
      result: null,
    };
  }

  const nowIso = new Date().toISOString();
  const { data: post, error } = await supabase
    .from("posts")
    .select(
      "tweet_id, text_original, text_translated, author_handle, url, created_at, delivery_decision, decision_reason, feedback_locked, dedupe_status, dup_of_tweet_id, dedupe_reason, dedupe_confidence, dedupe_method, dup_similarity, story_cluster_id",
    )
    .eq("tweet_id", tweetId)
    .maybeSingle();
  if (error || !post) {
    return {
      checked: true,
      blocked: false,
      reason: `post_lookup_failed:${error?.message ?? "not_found"}`,
      result: null,
    };
  }

  const postRecord = post as DuplicateGatePost & {
    dedupe_status?: string | null;
    dup_of_tweet_id?: string | null;
    dedupe_reason?: string | null;
    dedupe_confidence?: number | null;
    dedupe_method?: DedupeMethod | null;
    dup_similarity?: number | null;
    story_cluster_id?: string | null;
  };

  if (postRecord.dedupe_status === "duplicate") {
    return {
      checked: true,
      blocked: true,
      reason: `duplicate_gate:${postRecord.dup_of_tweet_id ?? "duplicate"}`,
      result: null,
    };
  }
  if (postRecord.dedupe_status === "related_new_info") {
    return {
      checked: true,
      blocked: false,
      reason: "related_new_info",
      result: null,
    };
  }
  if (
    postRecord.dedupe_status === "coverage_gap" && postRecord.dup_of_tweet_id
  ) {
    const coverage = await loadDuplicateCoverage(
      supabase,
      postRecord.dup_of_tweet_id,
    );
    if (coverage.safe_to_block) {
      const result: DuplicateGateResult = {
        ok: true,
        status: "duplicate",
        method: postRecord.dedupe_method ?? "semantic_ai",
        confidence: postRecord.dedupe_confidence ?? null,
        dup_of_tweet_id: postRecord.dup_of_tweet_id,
        story_cluster_id: postRecord.story_cluster_id ?? null,
        similarity: postRecord.dup_similarity ?? null,
        reason: `coverage_gap_resolved:${coverage.reason}; ${
          postRecord.dedupe_reason ?? ""
        }`.slice(0, 1200),
        new_facts: [],
        should_enqueue_translate: false,
        candidates: [],
      };
      if (!dryRun) {
        await persistDedupeResult(
          supabase,
          postRecord,
          result,
          config,
          nowIso,
          options.source ?? "final_assertion",
        );
      }
      return { checked: true, blocked: true, reason: result.reason, result };
    }
    return {
      checked: true,
      blocked: false,
      reason: `coverage_gap:${coverage.reason}`,
      result: null,
    };
  }
  if (postRecord.dedupe_status === "uncertain") {
    return {
      checked: true,
      blocked: false,
      reason: "uncertain_duplicate_review",
      result: null,
    };
  }

  const text = (postRecord.text_translated || postRecord.text_original || "")
    .trim();
  if (!text || normalizeStoryText(text).length < 20) {
    return {
      checked: true,
      blocked: false,
      reason: "too_little_text",
      result: null,
    };
  }

  let embeddingLiteral: string | null = null;
  const { data: signature } = await supabase
    .from("story_signatures")
    .select("embedding")
    .eq("tweet_id", tweetId)
    .maybeSingle();
  embeddingLiteral = toEmbeddingLiteral(
    (signature as { embedding?: unknown } | null)?.embedding,
  );

  if (!embeddingLiteral) {
    try {
      const embedding = options.fetchEmbedding
        ? await options.fetchEmbedding(text)
        : await fetchStoryEmbedding(requiredOpenAiApiKey(), text);
      embeddingLiteral = `[${embedding.join(",")}]`;
      if (!dryRun) {
        await upsertBareStorySignature(supabase, postRecord, embeddingLiteral);
      }
    } catch (e) {
      return {
        checked: true,
        blocked: false,
        reason: `final_assertion_embedding_failed:${(e as Error).message}`,
        result: null,
      };
    }
  }

  const candidates = await findSemanticCandidates(
    supabase,
    embeddingLiteral,
    tweetId,
    config,
  );
  const top = candidates[0];
  if (!top || top.similarity < config.similarity_threshold) {
    return {
      checked: true,
      blocked: false,
      reason: top
        ? `below_final_duplicate_threshold:${top.similarity.toFixed(3)}`
        : "no_semantic_candidates",
      result: null,
    };
  }

  let result: DuplicateGateResult;
  if (top.similarity >= config.auto_duplicate_similarity) {
    const canonical = await selectBestCanonicalCandidate(
      supabase,
      candidates,
      config.similarity_threshold,
    );
    result = {
      ok: true,
      status: "duplicate",
      method: "semantic_auto",
      confidence: top.similarity,
      dup_of_tweet_id: canonicalCandidateTweetId(canonical),
      story_cluster_id: canonical.story_cluster_id ?? top.story_cluster_id,
      similarity: top.similarity,
      reason: `final_assertion_high_semantic_similarity:${
        top.similarity.toFixed(3)
      }`,
      new_facts: [],
      should_enqueue_translate: false,
      candidates,
    };
  } else if (options.adjudicate) {
    result = await options.adjudicate(postRecord, candidates, config);
  } else {
    const key = Deno.env.get("OPENAI_API_KEY") ?? "";
    if (!key) {
      return {
        checked: true,
        blocked: false,
        reason: "final_assertion_openai_key_missing",
        result: null,
      };
    }
    result = await adjudicateWithModel(key, postRecord, candidates, config);
    if (result.status === "unique") {
      result = {
        ...result,
        reason: `final_assertion_distinct:${result.reason}`,
      };
    }
  }

  result = canonicalizeDedupeResult(result, candidates);
  result = await canonicalizeResultThroughPosts(supabase, result);
  result = await preventUncoveredDuplicateSkip(
    supabase,
    postRecord,
    result,
    config,
  );

  if (
    result.status === "duplicate" || result.status === "coverage_gap" ||
    result.status === "related_new_info" || result.status === "uncertain"
  ) {
    if (!dryRun) {
      await persistDedupeResult(
        supabase,
        postRecord,
        result,
        config,
        nowIso,
        options.source ?? "final_assertion",
      );
    }
  }

  return {
    checked: true,
    blocked: result.status === "duplicate",
    reason: result.reason,
    result,
  };
}

async function preventUncoveredDuplicateSkip(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  post: DuplicateGatePost,
  result: DuplicateGateResult,
  config: DuplicateGateConfig,
): Promise<DuplicateGateResult> {
  const wouldBlock = result.status === "duplicate" &&
    !!result.dup_of_tweet_id &&
    config.action === "skip" &&
    post.feedback_locked !== true;
  if (!wouldBlock) return result;

  const coverage = await loadDuplicateCoverage(
    supabase,
    result.dup_of_tweet_id as string,
  );
  if (coverage.safe_to_block) {
    return {
      ...result,
      coverage,
      reason:
        `${result.reason}; canonical_${coverage.state}:${coverage.reason}`,
    };
  }

  return {
    ...result,
    status: "coverage_gap",
    confidence: result.confidence,
    dup_of_tweet_id: result.dup_of_tweet_id,
    reason: `coverage_gap:${coverage.reason}; ${result.reason}`,
    should_enqueue_translate: true,
    coverage,
  };
}

async function loadDuplicateCoverage(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  canonicalTweetId: string,
): Promise<DuplicateCoverage> {
  try {
    const [
      { data: postRows, error: postError },
      { data: telegramRows },
      { data: xRows },
      { data: jobRows },
    ] = await Promise.all([
      supabase
        .from("posts")
        .select(
          "tweet_id, delivery_decision, decision_reason, final_score, importance_score, dup_of_tweet_id",
        )
        .eq("tweet_id", canonicalTweetId)
        .limit(1),
      supabase
        .from("deliveries")
        .select("status")
        .eq("subject_type", "post")
        .eq("subject_id", canonicalTweetId)
        .in("status", ["posted", "pending", "running"])
        .limit(5),
      supabase
        .from("x_deliveries")
        .select("status")
        .eq("post_id", canonicalTweetId)
        .in("status", ["posted", "pending", "running"])
        .limit(5),
      supabase
        .from("jobs")
        .select("type, status")
        .filter("payload->>tweet_id", "eq", canonicalTweetId)
        .in("status", ["pending", "running", "queued"])
        .limit(10),
    ]);

    if (postError) {
      return {
        safe_to_block: false,
        state: "unknown",
        reason: `canonical_lookup_failed:${postError.message}`,
      };
    }
    const canonical = Array.isArray(postRows)
      ? postRows[0] as Record<string, unknown> | undefined
      : undefined;
    if (!canonical) {
      return {
        safe_to_block: false,
        state: "unknown",
        reason: "canonical_not_found",
      };
    }

    const telegramStatuses = Array.isArray(telegramRows)
      ? telegramRows.map((r) => (r as Record<string, unknown>).status)
      : [];
    const xStatuses = Array.isArray(xRows)
      ? xRows.map((r) => (r as Record<string, unknown>).status)
      : [];
    if (telegramStatuses.includes("posted") || xStatuses.includes("posted")) {
      return {
        safe_to_block: true,
        state: "delivered",
        reason: "canonical_already_delivered",
      };
    }

    const hasActiveDelivery = telegramStatuses.some(isActiveStatusValue) ||
      xStatuses.some(isActiveStatusValue);
    const hasActiveJob = Array.isArray(jobRows) &&
      jobRows.some((row) =>
        isActiveStatusValue((row as Record<string, unknown>).status)
      );
    if (
      canonical.delivery_decision === "deliver" || hasActiveDelivery ||
      hasActiveJob
    ) {
      return {
        safe_to_block: true,
        state: "active_pipeline",
        reason: "canonical_is_deliverable_or_active",
      };
    }

    const canonicalScore = typeof canonical.final_score === "number"
      ? canonical.final_score
      : typeof canonical.importance_score === "number"
      ? canonical.importance_score
      : null;
    const canonicalReason = typeof canonical.decision_reason === "string"
      ? canonical.decision_reason
      : "no_delivery_path";
    const scorePart = canonicalScore == null
      ? ""
      : `; canonical_score:${canonicalScore}`;
    return {
      safe_to_block: false,
      state: "coverage_gap",
      reason:
        `canonical_not_delivered_or_active:${canonicalReason}${scorePart}`,
    };
  } catch (e) {
    return {
      safe_to_block: false,
      state: "unknown",
      reason: `canonical_coverage_error:${(e as Error).message}`,
    };
  }
}

function isActiveStatusValue(status: unknown): boolean {
  return status === "pending" || status === "running" || status === "queued";
}

function classifySemanticOnly(
  top: StoryCandidate,
  config: DuplicateGateConfig,
  candidates: StoryCandidate[],
): DuplicateGateResult {
  const duplicate = top.similarity >= config.similarity_threshold;
  const canonicalTweetId = canonicalCandidateTweetId(top);
  return {
    ok: true,
    status: duplicate ? "duplicate" : "unique",
    method: "semantic_auto",
    confidence: top.similarity,
    dup_of_tweet_id: duplicate ? canonicalTweetId : null,
    story_cluster_id: top.story_cluster_id,
    similarity: top.similarity,
    reason: duplicate
      ? `semantic_threshold:${top.similarity.toFixed(3)}`
      : `below_semantic_threshold:${top.similarity.toFixed(3)}`,
    new_facts: [],
    should_enqueue_translate: !duplicate || config.action !== "skip",
    candidates,
  };
}

async function adjudicateWithModel(
  apiKey: string,
  post: DuplicateGatePost,
  candidates: StoryCandidate[],
  config: DuplicateGateConfig,
): Promise<DuplicateGateResult> {
  const tool: ToolFunctionDef = {
    name: "classify_story_duplicate",
    description:
      "Decide whether a current news item is redundant, a meaningful update, or distinct.",
    parameters: {
      type: "object",
      properties: {
        decision: {
          type: "string",
          enum: ["duplicate", "related_new_info", "distinct"],
        },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        canonical_tweet_id: { type: "string" },
        new_facts: { type: "array", items: { type: "string" } },
        reason: { type: "string" },
      },
      required: [
        "decision",
        "confidence",
        "canonical_tweet_id",
        "new_facts",
        "reason",
      ],
    },
  };

  const current = {
    tweet_id: post.tweet_id,
    author_handle: post.author_handle,
    url: post.url,
    created_at: post.created_at,
    text: post.text_translated || post.text_original || "",
  };
  const compactCandidates = candidates.slice(0, 10).map((c) => ({
    tweet_id: c.tweet_id,
    author_handle: c.author_handle,
    url: c.url,
    created_at: c.created_at,
    similarity: c.similarity,
    text: c.text_translated || c.text_original || c.normalized_text || "",
  }));

  const result = await callOpenAI({
    apiKey,
    model: config.adjudicator_model,
    messages: [
      {
        role: "system",
        content: [
          "You are a duplicate-detection editor for a live news pipeline.",
          "Classify the current item against candidate items.",
          "duplicate = same event and same material facts, no meaningful new information.",
          "duplicate also includes small numeric deltas, same-source restatements, minor timing/wording changes, repeated target counts, repeated escort reports, and side-topic additions that do not materially change the core story.",
          "Examples that are duplicate by default: 109 vessels to 111 vessels, repeated IDF target counts, repeated Hormuz escort reports, or the same strike with only damage wording changed.",
          "related_new_info = same story cluster but adds a genuinely material fact: confirmed casualty change, denial or reversal, new actor, new location, new attack, official confirmation, or operational consequence.",
          "distinct = related topic or vocabulary, but not the same story.",
          "Do not mark a post duplicate merely because it discusses the same country, war, person, or theme.",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify(
          { current, candidates: compactCandidates },
          null,
          2,
        ),
      },
    ],
    tool,
    maxOutputTokens: 1200,
    reasoningEffort: config.adjudicator_reasoning_effort,
    verbosity: "low",
    topP: 1,
  });

  if (!result.ok) {
    throw new Error(
      `dedupe_ai_error:${result.status}:${result.rawText.slice(0, 300)}`,
    );
  }
  if (!result.toolCall) throw new Error("dedupe_ai_error:missing_tool_call");

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(result.toolCall.arguments);
  } catch (e) {
    throw new Error(
      `dedupe_ai_error:invalid_tool_json:${(e as Error).message}`,
    );
  }

  const top = candidates[0];
  const decision =
    args.decision === "duplicate" || args.decision === "related_new_info" ||
      args.decision === "distinct"
      ? args.decision
      : "distinct";
  const confidence = clamp(Number(args.confidence) || 0, 0, 1);
  const canonicalId = typeof args.canonical_tweet_id === "string" &&
      args.canonical_tweet_id.trim()
    ? args.canonical_tweet_id.trim()
    : top.tweet_id;
  const canonical =
    candidates.find((c) =>
      c.tweet_id === canonicalId || c.candidate_dup_of_tweet_id === canonicalId
    ) ?? top;
  const canonicalTweetId = canonicalCandidateTweetId(canonical);
  const reason = typeof args.reason === "string"
    ? args.reason.slice(0, 1000)
    : `ai_${decision}`;
  const newFacts = Array.isArray(args.new_facts)
    ? args.new_facts.map((f) => String(f).trim()).filter(Boolean).slice(0, 10)
    : [];

  if (confidence < config.adjudicator_confidence_threshold) {
    return {
      ok: true,
      status: "uncertain",
      method: "semantic_ai",
      confidence,
      dup_of_tweet_id: null,
      story_cluster_id: canonical.story_cluster_id,
      similarity: canonical.similarity,
      reason: `low_confidence:${reason}`,
      new_facts: newFacts,
      should_enqueue_translate: true,
      candidates,
    };
  }

  if (decision === "duplicate") {
    return {
      ok: true,
      status: "duplicate",
      method: "semantic_ai",
      confidence,
      dup_of_tweet_id: canonicalTweetId,
      story_cluster_id: canonical.story_cluster_id,
      similarity: canonical.similarity,
      reason,
      new_facts: newFacts,
      should_enqueue_translate: config.action !== "skip",
      candidates,
    };
  }

  if (decision === "related_new_info") {
    return {
      ok: true,
      status: "related_new_info",
      method: "semantic_ai",
      confidence,
      dup_of_tweet_id: null,
      story_cluster_id: canonical.story_cluster_id,
      similarity: canonical.similarity,
      reason,
      new_facts: newFacts,
      should_enqueue_translate: true,
      candidates,
    };
  }

  return {
    ok: true,
    status: "unique",
    method: "semantic_ai",
    confidence,
    dup_of_tweet_id: null,
    story_cluster_id: null,
    similarity: canonical.similarity,
    reason,
    new_facts: newFacts,
    should_enqueue_translate: true,
    candidates,
  };
}

function requiredOpenAiApiKey(): string {
  const key = Deno.env.get("OPENAI_API_KEY") ?? "";
  if (!key) throw new Error("OPENAI_API_KEY is not configured");
  return key;
}

async function findExactUrlDuplicate(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  post: DuplicateGatePost,
  config: DuplicateGateConfig,
): Promise<StoryCandidate | null> {
  const url = (post.url || "").trim();
  if (!url) return null;
  const since = new Date(Date.now() - config.window_hours * 60 * 60 * 1000)
    .toISOString();
  const { data, error } = await supabase
    .from("posts")
    .select(
      "tweet_id, url, story_cluster_id, created_at, dedupe_status, dup_of_tweet_id, delivery_decision",
    )
    .eq("url", url)
    .neq("tweet_id", post.tweet_id)
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw new Error(`exact_url_lookup_failed:${error.message}`);
  const row = data?.[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    tweet_id: String(row.tweet_id),
    story_cluster_id: typeof row.story_cluster_id === "string"
      ? row.story_cluster_id
      : null,
    similarity: 1,
    url: row.url as string | null,
    created_at: row.created_at as string | null,
    candidate_dedupe_status: row.dedupe_status as string | null,
    candidate_dup_of_tweet_id: row.dup_of_tweet_id as string | null,
    candidate_delivery_decision: row.delivery_decision as string | null,
  };
}

async function findSemanticCandidates(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  embeddingLiteral: string,
  tweetId: string,
  config: DuplicateGateConfig,
): Promise<StoryCandidate[]> {
  const { data, error } = await supabase.rpc("find_story_candidates_v3", {
    query_embedding: embeddingLiteral,
    exclude_tweet_id: tweetId,
    window_hours: config.window_hours,
    candidate_min_similarity: config.candidate_min_similarity,
    match_limit: 10,
  });
  if (error) {
    throw new Error(`find_story_candidates_v3_failed:${error.message}`);
  }
  return (data ?? []).map((row: Record<string, unknown>) => ({
    tweet_id: String(row.tweet_id),
    story_cluster_id: typeof row.story_cluster_id === "string"
      ? row.story_cluster_id
      : null,
    similarity: Number(row.similarity ?? 0),
    normalized_text: row.normalized_text as string | null,
    text_original: row.text_original as string | null,
    text_translated: row.text_translated as string | null,
    author_handle: row.author_handle as string | null,
    url: row.url as string | null,
    created_at: row.created_at as string | null,
    candidate_dedupe_status: row.candidate_dedupe_status as string | null,
    candidate_dup_of_tweet_id: row.candidate_dup_of_tweet_id as string | null,
    candidate_delivery_decision: row.candidate_delivery_decision as
      | string
      | null,
    candidate_final_score: typeof row.candidate_final_score === "number"
      ? row.candidate_final_score
      : Number(row.candidate_final_score ?? NaN) || null,
    candidate_importance_score:
      typeof row.candidate_importance_score === "number"
        ? row.candidate_importance_score
        : Number(row.candidate_importance_score ?? NaN) || null,
  }));
}

function toEmbeddingLiteral(value: unknown): string | null {
  if (typeof value === "string" && value.trim().startsWith("[")) {
    return value.trim();
  }
  if (Array.isArray(value) && value.every((v) => typeof v === "number")) {
    return `[${value.join(",")}]`;
  }
  return null;
}

async function selectBestCanonicalCandidate(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  candidates: StoryCandidate[],
  minSimilarity: number,
): Promise<StoryCandidate> {
  const eligible = candidates.filter((candidate) =>
    candidate.similarity >= minSimilarity
  );
  const pool = eligible.length > 0 ? eligible : candidates;
  const ranked = await Promise.all(pool.map(async (candidate, index) => {
    const canonicalTweetId = canonicalCandidateTweetId(candidate);
    const coverage = await loadDuplicateCoverage(supabase, canonicalTweetId);
    const coverageRank = coverage.state === "delivered"
      ? 4
      : coverage.state === "active_pipeline"
      ? 3
      : coverage.state === "coverage_gap"
      ? 1
      : 0;
    const score = candidate.candidate_final_score ??
      candidate.candidate_importance_score ?? 0;
    const created = candidate.created_at
      ? new Date(candidate.created_at).getTime()
      : Number.MAX_SAFE_INTEGER;
    return { candidate, index, coverageRank, score, created };
  }));
  ranked.sort((a, b) =>
    b.coverageRank - a.coverageRank ||
    b.score - a.score ||
    a.created - b.created ||
    a.index - b.index
  );
  return ranked[0]?.candidate ?? candidates[0];
}

function canonicalCandidateTweetId(
  candidate: Pick<
    StoryCandidate,
    "tweet_id" | "candidate_dedupe_status" | "candidate_dup_of_tweet_id"
  >,
): string {
  const candidateTarget =
    typeof candidate.candidate_dup_of_tweet_id === "string"
      ? candidate.candidate_dup_of_tweet_id.trim()
      : "";
  if (candidate.candidate_dedupe_status === "duplicate" && candidateTarget) {
    return candidateTarget;
  }
  return candidate.tweet_id;
}

function canonicalizeDedupeResult(
  result: DuplicateGateResult,
  candidates: StoryCandidate[],
): DuplicateGateResult {
  if (!result.dup_of_tweet_id) return result;
  const matched = candidates.find((candidate) =>
    candidate.tweet_id === result.dup_of_tweet_id
  );
  if (!matched) return result;
  const canonicalTweetId = canonicalCandidateTweetId(matched);
  if (canonicalTweetId === result.dup_of_tweet_id) return result;
  return {
    ...result,
    dup_of_tweet_id: canonicalTweetId,
    reason: `${result.reason}; canonicalized_from:${matched.tweet_id}`,
  };
}

async function canonicalizeResultThroughPosts(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  result: DuplicateGateResult,
): Promise<DuplicateGateResult> {
  if (!result.dup_of_tweet_id) return result;
  const canonicalTweetId = await resolveCanonicalTweetId(
    supabase,
    result.dup_of_tweet_id,
  );
  if (!canonicalTweetId || canonicalTweetId === result.dup_of_tweet_id) {
    return result;
  }
  return {
    ...result,
    dup_of_tweet_id: canonicalTweetId,
    reason: `${result.reason}; canonical_chain:${canonicalTweetId}`,
  };
}

async function resolveCanonicalTweetId(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  tweetId: string,
): Promise<string> {
  let current = tweetId;
  const seen = new Set<string>();
  for (let depth = 0; depth < 8; depth += 1) {
    if (seen.has(current)) return current;
    seen.add(current);
    const { data, error } = await supabase
      .from("posts")
      .select("tweet_id, dedupe_status, dup_of_tweet_id")
      .eq("tweet_id", current)
      .limit(1);
    if (error) return current;
    const row = Array.isArray(data)
      ? data[0] as Record<string, unknown> | undefined
      : undefined;
    const next = typeof row?.dup_of_tweet_id === "string"
      ? row.dup_of_tweet_id.trim()
      : "";
    if (!row || row.dedupe_status !== "duplicate" || !next || seen.has(next)) {
      return current;
    }
    current = next;
  }
  return current;
}

async function upsertStorySignature(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  post: DuplicateGatePost,
  embeddingLiteral: string,
  result: DuplicateGateResult,
): Promise<void> {
  const raw = (post.text_translated || post.text_original || "").trim();
  const normalized = normalizeStoryText(raw);
  const payload: Record<string, unknown> = {
    tweet_id: post.tweet_id,
    embedding: embeddingLiteral,
    normalized_text: normalized,
  };
  if (result.story_cluster_id) {
    payload.story_cluster_id = result.story_cluster_id;
  }
  const { error } = await supabase.from("story_signatures").upsert(payload, {
    onConflict: "tweet_id",
  });
  if (error) throw new Error(`story_signature_upsert_failed:${error.message}`);
  if (result.status === "duplicate" && result.dup_of_tweet_id) {
    await supabase.rpc("bump_coverage_count", {
      p_tweet_id: result.dup_of_tweet_id,
    })
      .then(() => null, () => null);
  }
}

async function upsertBareStorySignature(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  post: DuplicateGatePost,
  embeddingLiteral: string,
): Promise<void> {
  const raw = (post.text_translated || post.text_original || "").trim();
  const normalized = normalizeStoryText(raw);
  const { error } = await supabase.from("story_signatures").upsert({
    tweet_id: post.tweet_id,
    embedding: embeddingLiteral,
    normalized_text: normalized,
  }, { onConflict: "tweet_id" });
  if (error) throw new Error(`story_signature_upsert_failed:${error.message}`);
}

async function persistDedupeResult(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  post: DuplicateGatePost,
  result: DuplicateGateResult,
  config: DuplicateGateConfig,
  nowIso: string,
  source?: string,
): Promise<void> {
  const locked = post.feedback_locked === true;
  const duplicateBlocks = result.status === "duplicate" &&
    config.action === "skip" && !locked;
  const update: Record<string, unknown> = {
    dedupe_status: result.status,
    dedupe_method: result.method,
    dedupe_confidence: result.confidence,
    dedupe_reason: result.reason,
    dedupe_new_facts: result.new_facts,
    dedupe_checked_at: nowIso,
    story_cluster_id: result.story_cluster_id,
    dup_similarity: result.similarity,
  };

  if (
    (result.status === "duplicate" || result.status === "uncertain" ||
      result.status === "coverage_gap") && result.dup_of_tweet_id
  ) {
    update.dup_of_tweet_id = result.dup_of_tweet_id;
    if (duplicateBlocks) {
      update.delivery_decision = "skip";
      update.decision_reason =
        `duplicate_gate:${result.method}:${result.dup_of_tweet_id}`;
    }
  } else {
    update.dup_of_tweet_id = null;
    const previousReason = typeof post.decision_reason === "string"
      ? post.decision_reason
      : "";
    if (previousReason.startsWith("duplicate_gate:")) {
      update.decision_reason = null;
    }
  }

  await updatePostDedupeState(supabase, post.tweet_id, update);
  await insertDedupeEvent(
    supabase,
    post.tweet_id,
    "completed",
    buildDedupeEventMeta(result, config, source, locked),
    { throwOnError: true },
  );
}

async function updatePostDedupeState(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  tweetId: string,
  update: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from("posts").update(update).eq(
    "tweet_id",
    tweetId,
  );
  if (error) throw new Error(`dedupe_post_update_failed:${error.message}`);
}

async function insertDedupeEvent(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  tweetId: string,
  status: string,
  meta: Record<string, unknown>,
  options: { throwOnError?: boolean } = {},
): Promise<void> {
  const { error } = await supabase.from("pipeline_events").insert({
    subject_type: "post",
    subject_id: tweetId,
    step: "dedupe",
    status,
    started_at: status === "running" ? new Date().toISOString() : null,
    ended_at: status !== "running" ? new Date().toISOString() : null,
    error: status === "failed" ? String(meta.error ?? "dedupe failed") : null,
    meta,
  });
  if (error && options.throwOnError) {
    throw new Error(`dedupe_event_insert_failed:${error.message}`);
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function thresholdSnapshot(
  config: DuplicateGateConfig,
): DedupeThresholdSnapshot {
  return {
    similarity_threshold: config.similarity_threshold,
    candidate_min_similarity: config.candidate_min_similarity,
    auto_duplicate_similarity: config.auto_duplicate_similarity,
    adjudicator_confidence_threshold: config.adjudicator_confidence_threshold,
  };
}

function buildDedupeEventMeta(
  result: DuplicateGateResult,
  config: DuplicateGateConfig,
  source: string | undefined,
  feedbackLocked: boolean,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    status: result.status,
    method: result.method,
    confidence: result.confidence,
    similarity: result.similarity,
    dup_of: result.dup_of_tweet_id,
    canonical_tweet_id: result.dup_of_tweet_id,
    reason: result.reason,
    source,
    action: config.action,
    window_hours: config.window_hours,
    thresholds: thresholdSnapshot(config),
    candidate_count: result.candidates.length,
    top_candidates: summarizeCandidates(result.candidates),
    coverage: result.coverage ? serializeCoverage(result.coverage) : null,
    failure_phase: result.failure_phase ?? null,
    feedback_locked: feedbackLocked,
    new_facts: result.new_facts,
    ...extra,
  };
}

function summarizeCandidates(
  candidates: StoryCandidate[],
): Array<Record<string, unknown>> {
  return candidates.slice(0, 10).map((candidate) => ({
    tweet_id: candidate.tweet_id,
    similarity: candidate.similarity,
    dedupe_status: candidate.candidate_dedupe_status ?? null,
    dup_of_tweet_id: candidate.candidate_dup_of_tweet_id ?? null,
    delivery_decision: candidate.candidate_delivery_decision ?? null,
    final_score: candidate.candidate_final_score ?? null,
    importance_score: candidate.candidate_importance_score ?? null,
    story_cluster_id: candidate.story_cluster_id ?? null,
    created_at: candidate.created_at ?? null,
  }));
}

function serializeCoverage(
  coverage: DuplicateCoverage,
): Record<string, unknown> {
  return {
    safe_to_block: coverage.safe_to_block,
    state: coverage.state,
    reason: coverage.reason,
  };
}

function classifyDedupeFailure(
  message: string,
): { phase: DedupeFailurePhase; retryable: boolean } {
  if (
    message.startsWith("embedding_error:") ||
    message === "OPENAI_API_KEY is not configured"
  ) {
    return {
      phase: "embedding",
      retryable: message.startsWith("embedding_error:") &&
        isRetryableProviderError(message),
    };
  }
  if (
    message.startsWith("find_story_candidates_v3_failed:") ||
    message.startsWith("exact_url_lookup_failed:")
  ) {
    return { phase: "candidate_lookup", retryable: true };
  }
  if (message.startsWith("canonical_coverage_error:")) {
    return { phase: "coverage_check", retryable: true };
  }
  if (message.startsWith("dedupe_post_update_failed:")) {
    return { phase: "post_update", retryable: false };
  }
  if (message.startsWith("dedupe_event_insert_failed:")) {
    return { phase: "event_insert", retryable: false };
  }
  if (message.startsWith("story_signature_upsert_failed:")) {
    return { phase: "signature_upsert", retryable: false };
  }
  if (message.startsWith("dedupe_ai_error:")) {
    return {
      phase: "adjudicator",
      retryable: isRetryableProviderError(message),
    };
  }
  return { phase: "unknown", retryable: false };
}
