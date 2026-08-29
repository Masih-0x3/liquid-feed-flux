import {
  decideVideoRenderGate,
  type VideoRenderGateDecision,
  type VideoRenderRow,
} from "../_shared/videoRenderGate.ts";
import {
  normalizeVideoRenderConfigValue,
  type VideoRenderConfig,
} from "../_shared/videoRenderConfig.ts";
import type { XMediaRow } from "../_shared/mediaSelection.ts";
import { requireDeliveryCutover } from "../_shared/deliveryCutover.ts";
import { requireExternalPosting } from "../_shared/externalPostingGuard.ts";
import { insertPipelineEvent } from "./jobLifecycle.ts";

const VIDEO_RENDER_VERSION = "persian-subtitles-masihh-v1";
export const VIDEO_RENDER_DEFER_MS = 30_000;

type EdgeRuntimeWithWaitUntil = {
  waitUntil?: (promise: Promise<unknown>) => void;
};

type DispatchVideoRendererForTarget = (
  // deno-lint-ignore no-explicit-any
  supabase: any,
  renderId: string,
  tweetId: string,
  source: string,
) => Promise<void>;

type DispatchXPosterForTarget = (
  // deno-lint-ignore no-explicit-any
  supabase: any,
  tweetId: string,
  source: string,
) => Promise<void>;

type VideoRenderWorkflowDeps = {
  dispatchVideoRendererForTarget?: DispatchVideoRendererForTarget;
  dispatchXPosterForTarget?: DispatchXPosterForTarget;
  requireExternalPosting?: (supabase: any) => Promise<void>;
};

function scheduleBackground(promise: Promise<unknown>): boolean {
  const edgeRuntime =
    (globalThis as { EdgeRuntime?: EdgeRuntimeWithWaitUntil }).EdgeRuntime;
  if (edgeRuntime?.waitUntil) {
    edgeRuntime.waitUntil(promise);
    return true;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// deno-lint-ignore no-explicit-any
async function loadVideoRenderConfig(
  supabase: any,
): Promise<VideoRenderConfig> {
  try {
    const { data, error } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "video_render_config")
      .maybeSingle();
    if (error) throw error;
    return normalizeVideoRenderConfigValue(data?.value);
  } catch (_e) {
    throw new Error("video_render_config_read_failed");
  }
}

// deno-lint-ignore no-explicit-any
async function loadVideoRenderDecision(
  supabase: any,
  tweetId: string,
  renderingEnabled = true,
): Promise<{
  decision: VideoRenderGateDecision;
  mediaRows: XMediaRow[];
}> {
  const [mediaRes, renderRes] = await Promise.all([
    supabase
      .from("media")
      .select(
        "id, storage_path, downloaded_at, mime_type, file_size, kind, duration_ms, src_url, ordering",
      )
      .eq("tweet_id", tweetId)
      .order("ordering", { ascending: true }),
    supabase
      .from("video_renders")
      .select(
        "id, tweet_id, source_media_id, status, failure_policy, output_storage_path, output_mime_type, output_file_size, duration_ms, width, height, render_version, error, block_reason, source_language, target_language, preflight, created_at, updated_at",
      )
      .eq("tweet_id", tweetId)
      .order("updated_at", { ascending: false }),
  ]);
  if (mediaRes.error) throw mediaRes.error;
  if (renderRes.error) throw renderRes.error;
  if (!Array.isArray(mediaRes.data)) {
    throw new Error("video_render_media_result_invalid");
  }
  if (!Array.isArray(renderRes.data)) {
    throw new Error("video_render_result_invalid");
  }
  const mediaRows = mediaRes.data as XMediaRow[];
  const renderRows = renderRes.data as VideoRenderRow[];
  return {
    mediaRows,
    decision: decideVideoRenderGate({
      tweetId,
      mediaRows,
      renderRows,
      renderingEnabled,
    }),
  };
}

// deno-lint-ignore no-explicit-any
async function dispatchVideoRendererForTarget(
  supabase: any,
  renderId: string,
  tweetId: string,
  source: string,
): Promise<void> {
  const rendererUrl = (Deno.env.get("VIDEO_RENDERER_URL") ?? "").replace(
    /\/+$/,
    "",
  );
  const rendererToken = (Deno.env.get("VIDEO_RENDERER_TOKEN") ?? "").trim();
  const meta = { render_id: renderId, dispatch_source: source };

  if (!rendererUrl || !rendererToken) {
    await insertPipelineEvent(
      supabase,
      "post",
      tweetId,
      "video_render_dispatch",
      "queued",
      new Date().toISOString(),
      null,
      null,
      {
        ...meta,
        mode: "poller_only",
        reason: !rendererUrl
          ? "renderer_url_missing"
          : "renderer_token_missing",
      },
    );
    return;
  }

  await insertPipelineEvent(
    supabase,
    "post",
    tweetId,
    "video_render_dispatch",
    "queued",
    new Date().toISOString(),
    null,
    null,
    meta,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  const invokePromise = fetch(`${rendererUrl}/v1/render`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(rendererToken ? { Authorization: `Bearer ${rendererToken}` } : {}),
    },
    body: JSON.stringify({ render_id: renderId, tweet_id: tweetId, source }),
    signal: controller.signal,
  }).then(async (resp) => {
    if (!resp.ok) {
      const status = Number.isInteger(resp.status) && resp.status >= 100 && resp.status <= 599
        ? resp.status
        : 0;
      await insertPipelineEvent(
        supabase,
        "post",
        tweetId,
        "video_render_dispatch",
        "failed",
        null,
        new Date().toISOString(),
        `renderer_http_${status}`,
        meta,
      );
    }
  }).catch((error: unknown) =>
    insertPipelineEvent(
      supabase,
      "post",
      tweetId,
      "video_render_dispatch",
      "failed",
      null,
      new Date().toISOString(),
      "renderer_dispatch_failed",
      meta,
    )
  ).finally(() => clearTimeout(timeout));

  if (!scheduleBackground(invokePromise)) {
    await Promise.race([invokePromise, sleep(1200)]);
  }
}

// deno-lint-ignore no-explicit-any
export async function prepareVideoRenderGate(
  supabase: any,
  tweetId: string,
  source: string,
  deps: VideoRenderWorkflowDeps = {},
): Promise<{
  ready: boolean;
  blocked: boolean;
  blockReason?: string;
  decision: VideoRenderGateDecision;
  mediaRows: XMediaRow[];
}> {
  const cfg = await loadVideoRenderConfig(supabase);
  const { decision, mediaRows } = await loadVideoRenderDecision(
    supabase,
    tweetId,
    cfg.mode !== "disabled",
  );
  const dispatchRenderer = deps.dispatchVideoRendererForTarget ??
    dispatchVideoRendererForTarget;

  if (cfg.mode === "disabled") {
    return { ready: true, blocked: false, decision, mediaRows };
  }

  if (decision.action === "enqueue_render") {
    if (!decision.media.id) {
      throw new Error(`video_render_source_missing_id:${tweetId}`);
    }
    const { data: renderId, error } = await supabase.rpc(
      "enqueue_video_render",
      {
        p_tweet_id: tweetId,
        p_source_media_id: decision.media.id,
        p_render_version: cfg.renderVersion,
        p_failure_policy: cfg.failurePolicy,
      },
    );
    if (error) throw error;
    if (renderId) {
      await dispatchRenderer(supabase, String(renderId), tweetId, source);
    }
    if (cfg.mode === "shadow") {
      await insertPipelineEvent(
        supabase,
        "post",
        tweetId,
        "video_render",
        "queued",
        null,
        null,
        null,
        {
          source,
          shadow: true,
          render_id: renderId,
          reason: decision.reason,
        },
      );
      return { ready: true, blocked: false, decision, mediaRows };
    }
    return { ready: false, blocked: false, decision, mediaRows };
  }

  if (decision.action === "wait_media") {
    const { error: downloadQueueError } = await supabase.from("jobs").upsert({
      type: "download_media",
      payload: { tweet_id: tweetId, source: "video_render_gate" },
      status: "pending",
      priority: 12,
      idempotency_key: `download_media:video_render:${tweetId}`,
      next_run_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
      lease_expires_at: null,
      last_error: null,
      attempts: 0,
    }, { onConflict: "idempotency_key", ignoreDuplicates: false });
    if (downloadQueueError) {
      throw new Error("video_render_download_enqueue_failed");
    }
    await insertPipelineEvent(
      supabase,
      "post",
      tweetId,
      "video_render",
      "queued",
      null,
      null,
      null,
      {
        source,
        shadow: cfg.mode === "shadow",
        reason: decision.reason,
        waiting_for: "source_media_download",
      },
    );
    if (cfg.mode === "shadow") {
      return { ready: true, blocked: false, decision, mediaRows };
    }
    return { ready: false, blocked: false, decision, mediaRows };
  }

  if (decision.action === "wait_render") {
    await insertPipelineEvent(
      supabase,
      "post",
      tweetId,
      "video_render",
      "running",
      null,
      null,
      null,
      {
        source,
        shadow: cfg.mode === "shadow",
        render_id: decision.render.id,
        reason: decision.reason,
      },
    );
    if (cfg.mode === "shadow") {
      return { ready: true, blocked: false, decision, mediaRows };
    }
    return { ready: false, blocked: false, decision, mediaRows };
  }

  if (decision.action === "block") {
    await insertPipelineEvent(
      supabase,
      "post",
      tweetId,
      "video_render",
      "blocked",
      null,
      new Date().toISOString(),
      decision.reason,
      {
        source,
        shadow: cfg.mode === "shadow",
        render_id: decision.render.id,
        reason: decision.reason,
      },
    );
    if (cfg.mode === "shadow") {
      return { ready: true, blocked: false, decision, mediaRows };
    }
    return {
      ready: false,
      blocked: true,
      blockReason: decision.reason,
      decision,
      mediaRows,
    };
  }

  if (cfg.mode === "shadow") {
    return { ready: true, blocked: false, decision, mediaRows };
  }
  return { ready: true, blocked: false, decision, mediaRows };
}

// deno-lint-ignore no-explicit-any
async function enqueueDeliverJob(
  supabase: any,
  tweetId: string,
  source: string,
  resetExisting = true,
  delayMs = 0,
): Promise<boolean> {
  const idempotencyKey = `deliver:${tweetId}`;
  const nextRunAt = new Date(Date.now() + Math.max(0, delayMs)).toISOString();
  const { error: deliveryJobError } = await supabase
    .from("jobs")
    .upsert({
      type: "deliver",
      payload: { tweet_id: tweetId },
      status: "pending",
      priority: 20,
      idempotency_key: idempotencyKey,
      next_run_at: nextRunAt,
      locked_at: null,
      locked_by: null,
      lease_expires_at: null,
      last_error: null,
      attempts: 0,
  }, { onConflict: "idempotency_key", ignoreDuplicates: !resetExisting });
  if (deliveryJobError) {
    throw new Error("deliver_enqueue_failed");
  }

  await insertPipelineEvent(
    supabase,
    "post",
    tweetId,
    "deliver",
    "queued",
    null,
    null,
    null,
    { source, next_run_at: nextRunAt },
  );
  const { data: existingDel, error: existingDelError } = await supabase
      .from("deliveries")
      .select("id")
      .eq("subject_type", "post")
      .eq("subject_id", tweetId)
      .eq("status", "pending")
      .limit(1);
  if (existingDelError) {
    throw new Error("deliver_pending_receipt_read_failed");
  }
  if (!Array.isArray(existingDel) || existingDel.some((row: unknown) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return true;
    const id = (row as Record<string, unknown>).id;
    return typeof id !== "string" || id.trim().length === 0;
  })) {
    throw new Error("deliver_pending_receipt_invalid_response");
  }
  if (existingDel.length === 0) {
    const { error: pendingReceiptError } = await supabase.from("deliveries").insert({
        subject_type: "post",
        subject_id: tweetId,
        status: "pending",
        attempts: 0,
      });
    if (pendingReceiptError) {
      throw new Error("deliver_pending_receipt_write_failed");
    }
  }
  return true;
}

// deno-lint-ignore no-explicit-any
export async function enqueuePostDeliveryAfterRenderGate(
  supabase: any,
  tweetId: string,
  source = "worker",
  resetExisting = true,
  deps: VideoRenderWorkflowDeps,
): Promise<void> {
  const gate = await prepareVideoRenderGate(supabase, tweetId, source, deps);
  if (gate.blocked) {
    await insertPipelineEvent(
      supabase,
      "post",
      tweetId,
      "deliver",
      "completed",
      null,
      new Date().toISOString(),
      null,
      {
        skipped: "video_render_blocked",
        reason: gate.blockReason,
        gate_action: gate.decision.action,
        source,
      },
    );
    console.log(JSON.stringify({
      function: "worker",
      action: "delivery_skipped_video_render_blocked",
      tweet_id: tweetId,
      source,
      reason: gate.blockReason,
    }));
    return;
  }
  // Rendering may continue in render-only mode, but release of a delivery
  // queue job and its dispatch event must re-check the server posting gate.
  // This check is a fast path; the database release trigger closes the
  // read-to-write race for direct callers and concurrent toggles.
  try {
    await (deps.requireExternalPosting ?? requireExternalPosting)(supabase);
  } catch (error) {
    console.log(JSON.stringify({
      function: "worker",
      action: "delivery_skipped_external_posting_blocked",
      tweet_id: tweetId,
      source,
      reason: error instanceof Error ? error.message : "external_posting_blocked",
    }));
    return;
  }
  try {
    // Rendering remains allowed for historical posts, but render completion
    // must never create a new delivery job or dispatch X for them.
    await requireDeliveryCutover(supabase, tweetId);
  } catch (error) {
    await insertPipelineEvent(
      supabase,
      "post",
      tweetId,
      "deliver",
      "completed",
      null,
      new Date().toISOString(),
      null,
      {
        skipped: "delivery_cutover_blocked",
        reason: error instanceof Error ? error.message : String(error),
        source,
      },
    );
    console.log(JSON.stringify({
      function: "worker",
      action: "delivery_skipped_cutover",
      tweet_id: tweetId,
      source,
    }));
    return;
  }
  const delayMs = gate.ready ? 0 : VIDEO_RENDER_DEFER_MS;
  const queued = await enqueueDeliverJob(
    supabase,
    tweetId,
    source,
    resetExisting,
    delayMs,
  );
  if (queued && gate.ready) {
    if (!deps.dispatchXPosterForTarget) {
      throw new Error("dispatch_x_poster_missing");
    }
    await deps.dispatchXPosterForTarget(supabase, tweetId, source);
  }
  if (!gate.ready) {
    console.log(JSON.stringify({
      function: "worker",
      action: "delivery_waiting_video_render",
      tweet_id: tweetId,
      source,
      gate_action: gate.decision.action,
    }));
  }
}

// deno-lint-ignore no-explicit-any
export async function markVideoRenderPosted(
  supabase: any,
  tweetId: string,
): Promise<void> {
  const cfg = await loadVideoRenderConfig(supabase);
  try {
    const { error } = await supabase.rpc("mark_video_render_posted", {
      p_tweet_id: tweetId,
      p_retention_hours: cfg.retentionHours,
    });
    if (error) {
      console.warn(JSON.stringify({
        function: "worker",
        action: "video_render_posted_update_failed",
        error: "video_render_posted_update_failed",
        tweet_id: tweetId,
      }));
    }
  } catch (_e) {
    console.warn(JSON.stringify({
      function: "worker",
      action: "video_render_posted_update_failed",
      error: "video_render_posted_update_failed",
      tweet_id: tweetId,
    }));
  }
}
