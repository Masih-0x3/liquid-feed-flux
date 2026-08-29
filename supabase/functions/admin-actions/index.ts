import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { recordXApiEvent } from "../_shared/xApiLedger.ts";
import {
  bulkReprocessAdminAction,
  cancelPendingJobsAdminAction,
  editTranslationAdminAction,
  getHealthAdminAction,
  postThreadAdminAction,
  reconcileStuckJobsAdminAction,
  reprocessAdminAction,
  retryStepAdminAction,
} from "./basicActions.ts";
import {
  getEnhancedDashboardSummary,
  getSystemPerformanceSummary,
} from "./dashboardSummaries.ts";
import {
  auditDuplicateCandidatesAdminAction,
  backfillDedupeAdminAction,
  clearDuplicateAdminAction,
  runDedupeAdminAction,
} from "./dedupeActions.ts";
import {
  getDashboardProcessHud,
  getPipelineEvents,
  getMonitoringEntries,
  getMonitoringOverview,
} from "./monitoringReads.ts";
import {
  manualVideoIntakeCancelAdminAction,
  manualVideoIntakeCreateAdminAction,
  manualVideoIntakeGetAdminAction,
  manualVideoIntakeListAdminAction,
  manualVideoIntakePostAdminAction,
  manualVideoIntakeRefreshAdminAction,
  manualVideoIntakeSaveCaptionAdminAction,
  manualVideoIntakeSetDuplicateOverrideAdminAction,
} from "./manualVideoIntakeActions.ts";
import {
  bulkIgnoreMonitoringItemsAdminAction,
  ignoreMonitoringItemAdminAction,
} from "./monitoringMutations.ts";
import {
  getVideoRenderDetail,
  getVideoRenderOverview,
  getVideoRenderQueue,
  loadVideoRenderConfigAdmin,
  retryVideoRenderAdmin,
  saveVideoRenderFeedbackAdmin,
  setVideoRenderReviewedAdmin,
  updateVideoRenderConfigAdmin,
} from "./videoRenderActions.ts";
import { getXApiSummary } from "./xApiSummary.ts";
import {
  getSettingsAdminAction,
  getSettingsSamplesAdminAction,
  saveSettingsAdminAction,
} from "./settings.ts";
import { getRecentAuthorStatsAdminAction } from "./authorStats.ts";
import {
  approveEnrichmentAdminAction,
  enrichPostAdminAction,
  generateVoiceProfileAdminAction,
  recordEnrichmentFeedbackAdminAction,
  rejectEnrichmentAdminAction,
  selectEnrichmentVariantAdminAction,
  updateLatestPostEnrichment,
} from "./enrichmentActions.ts";
import {
  dryRunOldMediaCleanupAdminAction,
  getPostPipelineStatusAdminAction,
  rescoreRecentAdminAction,
  resetLearnedBiasesAdminAction,
  runFollowersSnapshotAdminAction,
  summarizeStaleXPendingAdminAction,
} from "./maintenanceActions.ts";
import {
  getXStatusAdminAction,
  recordAdminXApiAttempt,
  sendTestTweetAdminAction,
  testHydrateTweetAdminAction,
  verifyXCredentialsAdminAction,
} from "./xApiActions.ts";
import {
  backfillScoreV2,
  previewScoringPolicy,
  promoteFeedbackToScoringExample,
  recordScoreFeedback,
  runScoringEval,
  scorePostV2,
  setManualScore,
} from "./scoringActions.ts";
import {
  getXPostingDiagnostics,
  hydratePostAdminAction,
  rehydrateRecentTruncatedAdminAction,
  resolveXMediaAdminAction,
  runXPostAdminAction,
} from "./xPostingActions.ts";
import {
  previewTranslationAdminAction,
  rescorePostAdminAction,
  runRescore,
  runTranslationOnly,
  translatePostAdminAction,
} from "./translationRescoreActions.ts";
import {
  insertAdminPipelineEvent,
  recordFeedback,
} from "./sideEffects.ts";
import { queueManualAdvance } from "./manualAdvanceActions.ts";
import {
  getAdminOperationStatus,
  isSupportedAdminOperationId,
  validateAdminOperationIdentity,
} from "./adminOperation.ts";
import { captureEdgeException, initSentryEdge } from "../_shared/sentry.ts";
import {
  isRssWebhookPayloadError,
  parseBoundedAdminActionJson,
  readBoundedRssWebhookBody,
  rssWebhookPayloadErrorStatus,
} from "../_shared/rssWebhookPayloadPolicy.ts";
import { isAdminActionName } from "../_shared/adminActionNames.ts";
import { isReadOnlyAdminActionName } from "../_shared/adminActionNames.ts";
import { resolveCurrentUserRole, type AppRole } from "../_shared/appRole.ts";
import { fetchRuntimeControls } from "../_shared/runtimeControls.ts";
import type { SupabaseAdminClient } from "./types.ts";
import {
  adminActionRequiresExternalPosting,
  evaluateExternalPosting,
  externalPostingBlockedResponse,
} from "../_shared/externalPostingGuard.ts";

const DEPLOY_SHA = Deno.env.get('DEPLOY_GIT_SHA') ?? 'unknown';
const DEPLOY_TIME = Deno.env.get('DEPLOY_TIME') ?? new Date().toISOString();
initSentryEdge();

type CorsHeaders = Readonly<Record<string, string>>;

function makeCorsHeaders(req: Request): CorsHeaders {
  const configuredOrigins = (Deno.env.get('ALLOWED_CORS_ORIGIN') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowedOrigins = new Set([
    ...configuredOrigins,
    'https://xot.iraneyes.com',
    'https://xot.vercel.app',
    'https://liquid-feed-flux.lovable.app',
    'http://127.0.0.1:5173',
    'http://localhost:5173',
    'http://127.0.0.1:8080',
    'http://localhost:8080',
  ]);

  const origin = req.headers.get('Origin');
  const varyHeader = {
    'Vary': 'Origin',
  };

  if (!origin || !allowedOrigins.has(origin)) {
    return Object.freeze(varyHeader);
  }

  return Object.freeze({
    ...varyHeader,
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  });
}

// Validate JWT and resolve the caller-bound canonical application role.
// The service-role client is created only after this check succeeds.
async function requireAuthenticatedAppRole(
  req: Request,
  corsHeaders: CorsHeaders,
): Promise<{ userId: string; role: AppRole; authClient: any } | Response> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized: missing token' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseAuth = createClient<any, any>(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  );

  const token = authHeader.replace('Bearer ', '');
  const { data, error } = await supabaseAuth.auth.getUser(token);
  if (error || !data?.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized: invalid token' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const role = await resolveCurrentUserRole(supabaseAuth);
  if (!role) {
    return new Response(JSON.stringify({
      error: 'Forbidden: canonical application role required',
      code: 'app_role_forbidden',
    }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return { userId: data.user.id, role, authClient: supabaseAuth };
}

// Keep the stable entrypoint seam. Role resolution remains in the shared
// canonical helper above.
async function requireAdmin(
  req: Request,
  corsHeaders: CorsHeaders,
): Promise<{ userId: string; role: AppRole; authClient: any } | Response> {
  return await requireAuthenticatedAppRole(req, corsHeaders);
}

function forbiddenReadOnlyAction(corsHeaders: CorsHeaders): Response {
  return new Response(JSON.stringify({
    error: 'Forbidden: admin role required',
    code: 'admin_role_required',
  }), {
    status: 403,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function createJsonResponse(body: unknown, status: number, corsHeaders: CorsHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function asAdminActionBody(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function isExactRuntimeControlsUpdateBody(body: Record<string, unknown>): boolean {
  const keys = Object.keys(body).sort();
  return keys.length === 3 &&
    keys[0] === "action" &&
    keys[1] === "dedupe_enabled" &&
    keys[2] === "translation_enabled" &&
    body.action === "update_runtime_controls" &&
    typeof body.dedupe_enabled === "boolean" &&
    typeof body.translation_enabled === "boolean";
}

async function runTranslationOnlyForAdmin(supabase: SupabaseAdminClient, tweetId: string) {
  return await runTranslationOnly(supabase, tweetId, {
    insertAdminPipelineEvent,
    recordFeedback,
  });
}

serve(async (req: Request): Promise<Response> => {
  const corsHeaders = makeCorsHeaders(req);
  const jsonResponse = (body: unknown, status = 200) => createJsonResponse(body, status, corsHeaders);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { ...corsHeaders } });
  }

  let actionForSentry: string | undefined;
  try {
    const authResult = await requireAdmin(req, corsHeaders);
    if (authResult instanceof Response) return authResult;

    let body: Record<string, unknown>;
    try {
      const boundedBody = await readBoundedRssWebhookBody(req);
      const parsedBody = parseBoundedAdminActionJson(boundedBody.text);
      const candidateBody = asAdminActionBody(parsedBody);
      if (!candidateBody) {
        return jsonResponse({ error: 'Invalid admin action body', code: 'admin_action_body_invalid' }, 400);
      }
      body = candidateBody;
    } catch (error: unknown) {
      if (isRssWebhookPayloadError(error)) {
        return jsonResponse(
          { error: 'Invalid admin action body', code: 'admin_action_body_invalid' },
          rssWebhookPayloadErrorStatus(error),
        );
      }
      return jsonResponse({ error: 'Invalid admin action body', code: 'admin_action_body_read_failed' }, 400);
    }

    const requestedAction = body.action;
    if (typeof requestedAction !== 'string' || requestedAction.trim().length === 0) {
      return jsonResponse({ error: 'Missing action parameter', code: 'admin_action_missing' }, 400);
    }
    if (!isAdminActionName(requestedAction)) {
      return jsonResponse({ error: 'Unknown admin action', code: 'admin_action_unknown' }, 400);
    }

    const action = requestedAction;
    actionForSentry = action;

    if (authResult.role === "read_only" && !isReadOnlyAdminActionName(action)) {
      return forbiddenReadOnlyAction(corsHeaders);
    }

    if (action === "reprocess" || action === "hydrate_post") {
      const tweetId = typeof body.tweet_id === "string" ? body.tweet_id : "";
      if (!validateAdminOperationIdentity(action, tweetId, body.operation_id)) {
        return jsonResponse({
          error: "Invalid admin operation identity",
          code: "admin_operation_identity_invalid",
        }, 400);
      }
    }

    const supabase = createClient<any, any>(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    if (!action) {
      console.error('[admin-actions] missing action', { contentType: req.headers.get('content-type') });
      return jsonResponse({ error: 'Missing action parameter' }, 400);
    }

    if (adminActionRequiresExternalPosting(action, body?.step)) {
      const postingDecision = await evaluateExternalPosting(supabase);
      if (!postingDecision.allowed) {
        return externalPostingBlockedResponse(postingDecision.reason, corsHeaders);
      }
    }

    switch (action) {
      case 'version': {
        return jsonResponse({ ok: true, sha: DEPLOY_SHA, deployed_at: DEPLOY_TIME });
      }

      case 'get_runtime_controls': {
        try {
          const controls = await fetchRuntimeControls(supabase);
          return jsonResponse({ ok: true, controls });
        } catch {
          return jsonResponse({
            ok: false,
            error: 'runtime_controls_unavailable',
            code: 'runtime_controls_unavailable',
          }, 503);
        }
      }

      case 'update_runtime_controls': {
        if (!isExactRuntimeControlsUpdateBody(body)) {
          return jsonResponse({
            ok: false,
            error: 'only action, dedupe_enabled, and translation_enabled are accepted',
            code: 'runtime_controls_input_invalid',
          }, 400);
        }
        const dedupeEnabled = body.dedupe_enabled;
        const translationEnabled = body.translation_enabled;
        const { error: updateError } = await authResult.authClient.rpc(
          'update_runtime_controls',
          {
            p_dedupe_enabled: dedupeEnabled,
            p_translation_enabled: translationEnabled,
          },
        );
        if (updateError) {
          return jsonResponse({
            ok: false,
            error: 'runtime_controls_update_failed',
            code: 'runtime_controls_update_failed',
          }, 503);
        }
        try {
          const controls = await fetchRuntimeControls(supabase);
          return jsonResponse({ ok: true, controls });
        } catch {
          return jsonResponse({
            ok: false,
            error: 'runtime_controls_unavailable',
            code: 'runtime_controls_unavailable',
          }, 503);
        }
      }

      // ===== Settings =====
      case 'save_settings': {
        const result = await saveSettingsAdminAction(supabase, body);
        return jsonResponse(result.body, result.status);
      }

      case 'get_settings': {
        const result = await getSettingsAdminAction(supabase, body);
        return jsonResponse(result.body, result.status);
      }

      case 'get_settings_samples': {
        const result = await getSettingsSamplesAdminAction(supabase);
        return jsonResponse(result.body, result.status);
      }

      case 'get_recent_author_stats': {
        const result = await getRecentAuthorStatsAdminAction(supabase, body);
        return jsonResponse(result.body, result.status);
      }

      // ===== Edit translation =====
      case 'edit_translation': {
        const result = await editTranslationAdminAction(supabase, body, recordFeedback);
        return jsonResponse(result.body, result.status);
      }

      // ===== Retry step (translate/deliver/media) =====
      case 'retry_step': {
        const result = await retryStepAdminAction(supabase, body, recordFeedback);
        return jsonResponse(result.body, result.status);
      }

      // ===== Reprocess (full re-run) =====
      case 'reprocess': {
        const result = await reprocessAdminAction(supabase, body, recordFeedback);
        const operation = await getAdminOperationStatus(supabase, body.operation_id as string);
        return jsonResponse({
          ...(result.body as Record<string, unknown>),
          ...operation,
        }, result.status);
      }

      // ===== Cancel pending/running jobs =====
      case 'cancel_pending_jobs': {
        const result = await cancelPendingJobsAdminAction(supabase, body);
        return jsonResponse(result.body, result.status);
      }

      // ===== Bulk reprocess =====
      case 'bulk_reprocess': {
        const result = await bulkReprocessAdminAction(supabase, body);
        return jsonResponse(result.body, result.status);
      }

      // ===== Bulk ignore =====
      case 'bulk_ignore': {
        const result = await bulkIgnoreMonitoringItemsAdminAction(supabase, body, {
          updateLatestPostEnrichment,
          recordFeedback,
          insertAdminPipelineEvent,
        });
        return jsonResponse(result.body, result.status);
      }

      // ===== Post thread =====
      case 'post_thread': {
        const result = await postThreadAdminAction(supabase, body);
        return jsonResponse(result.body, result.status);
      }

      // ===== System health =====
      case 'get_health': {
        const result = await getHealthAdminAction(supabase);
        return jsonResponse(result.body, result.status);
      }

      case 'reconcile_stuck_jobs': {
        const result = await reconcileStuckJobsAdminAction(supabase);
        return jsonResponse(result.body, result.status);
      }

      case 'get_dashboard_summary': {
        const dashboard = await getEnhancedDashboardSummary(supabase);
        return jsonResponse({ success: true, dashboard });
      }

      case 'get_system_performance_summary': {
        return jsonResponse(await getSystemPerformanceSummary(supabase));
      }

      case 'dry_run_old_media_cleanup': {
        const result = await dryRunOldMediaCleanupAdminAction(supabase, body);
        return jsonResponse(result.body, result.status);
      }

      case 'get_monitoring_overview': {
        return jsonResponse(await getMonitoringOverview(supabase, body));
      }

      case 'get_monitoring_entries': {
        return jsonResponse(await getMonitoringEntries(supabase, body));
      }

      case 'get_pipeline_events': {
        return jsonResponse(await getPipelineEvents(supabase, body));
      }

      case 'get_dashboard_process_hud': {
        return jsonResponse(await getDashboardProcessHud(supabase, body));
      }

      case 'get_x_api_summary': {
        const result = await getXApiSummary(supabase, body, {
          recordAdminXApiAttempt,
          recordXApiEvent,
          role: authResult.role,
        });
        return jsonResponse(result, typeof result.status === "number" ? result.status : 200);
      }

      case 'get_video_render_config': {
        return jsonResponse(await loadVideoRenderConfigAdmin(supabase));
      }

      case 'update_video_render_config': {
        return jsonResponse(await updateVideoRenderConfigAdmin(supabase, body));
      }

      case 'get_video_render_overview': {
        return jsonResponse(await getVideoRenderOverview(supabase));
      }

      case 'get_video_render_queue': {
        return jsonResponse(await getVideoRenderQueue(supabase, body));
      }

      case 'get_video_render_detail': {
        return jsonResponse(await getVideoRenderDetail(supabase, body));
      }

      case 'retry_video_render': {
        return jsonResponse(await retryVideoRenderAdmin(supabase, body, insertAdminPipelineEvent));
      }

      case 'set_video_render_reviewed': {
        return jsonResponse(await setVideoRenderReviewedAdmin(supabase, body, authResult.userId));
      }

      case 'save_video_render_feedback': {
        return jsonResponse(await saveVideoRenderFeedbackAdmin(supabase, body, insertAdminPipelineEvent, authResult.userId));
      }

      case 'manual_video_intake_create': {
        const result = await manualVideoIntakeCreateAdminAction(supabase, body, {
          runTranslationOnly: runTranslationOnlyForAdmin,
          insertAdminPipelineEvent,
        }, authResult.userId);
        return jsonResponse(result.body, result.status);
      }

      case 'manual_video_intake_get': {
        if (authResult.role === "read_only" &&
          (body.refresh_dedupe === true || body.queue_render === true)) {
          return forbiddenReadOnlyAction(corsHeaders);
        }
        const result = await manualVideoIntakeGetAdminAction(supabase, body, {
          runTranslationOnly: runTranslationOnlyForAdmin,
          insertAdminPipelineEvent,
        });
        return jsonResponse(result.body, result.status);
      }

      case 'manual_video_intake_list': {
        const result = await manualVideoIntakeListAdminAction(supabase, body);
        return jsonResponse(result.body, result.status);
      }

      case 'manual_video_intake_refresh': {
        const result = await manualVideoIntakeRefreshAdminAction(supabase, body, {
          runTranslationOnly: runTranslationOnlyForAdmin,
          insertAdminPipelineEvent,
        });
        return jsonResponse(result.body, result.status);
      }

      case 'manual_video_intake_save_caption': {
        const result = await manualVideoIntakeSaveCaptionAdminAction(supabase, body, {
          insertAdminPipelineEvent,
        });
        return jsonResponse(result.body, result.status);
      }

      case 'manual_video_intake_set_duplicate_override': {
        const result = await manualVideoIntakeSetDuplicateOverrideAdminAction(supabase, body, {
          insertAdminPipelineEvent,
        });
        return jsonResponse(result.body, result.status);
      }

      case 'manual_video_intake_cancel': {
        const result = await manualVideoIntakeCancelAdminAction(supabase, body, {
          insertAdminPipelineEvent,
        });
        return jsonResponse(result.body, result.status);
      }

      case 'manual_video_intake_post': {
        const result = await manualVideoIntakePostAdminAction(supabase, body, {
          insertAdminPipelineEvent,
        });
        return jsonResponse(result.body, result.status);
      }

      case 'get_x_posting_diagnostics': {
        return jsonResponse(await getXPostingDiagnostics(supabase, body));
      }

      case 'score_post_v2': {
        return jsonResponse(await scorePostV2(supabase, body, { insertAdminPipelineEvent }));
      }

      case 'preview_scoring_policy': {
        return jsonResponse(await previewScoringPolicy(supabase, body, {}));
      }

      case 'run_scoring_eval': {
        return jsonResponse(await runScoringEval(supabase, body, {}));
      }

      case 'promote_feedback_to_scoring_example': {
        return jsonResponse(await promoteFeedbackToScoringExample(supabase, body, authResult.userId));
      }

      case 'backfill_score_v2': {
        return jsonResponse(await backfillScoreV2(supabase, body));
      }

      case 'run_dedupe': {
        return jsonResponse(await runDedupeAdminAction(supabase, body));
      }

      case 'backfill_dedupe': {
        return jsonResponse(await backfillDedupeAdminAction(supabase, body));
      }

      case 'audit_duplicate_candidates': {
        return jsonResponse(await auditDuplicateCandidatesAdminAction(supabase, body));
      }

      case 'summarize_stale_x_pending': {
        const result = await summarizeStaleXPendingAdminAction(supabase, body);
        return jsonResponse(result.body, result.status);
      }

      case 'hydrate_post': {
        const result = await hydratePostAdminAction(supabase, body, { insertAdminPipelineEvent });
        const operation = await getAdminOperationStatus(supabase, body.operation_id as string);
        return jsonResponse({
          ...(result.body as Record<string, unknown>),
          ...operation,
        }, result.status);
      }

      case 'get_admin_operation_status': {
        if (!isSupportedAdminOperationId(body.operation_id)) {
          return jsonResponse({
            error: "Invalid admin operation identity",
            code: "admin_operation_identity_invalid",
          }, 400);
        }
        return jsonResponse(await getAdminOperationStatus(supabase, body.operation_id));
      }

      case 'get_post_pipeline_status': {
        const result = await getPostPipelineStatusAdminAction(supabase, body);
        return jsonResponse(result.body, result.status);
      }

      case 'resolve_x_media': {
        const result = await resolveXMediaAdminAction(body);
        return jsonResponse(result.body, result.status);
      }

      // ===== X Posting: dry run / retry =====
      case 'dry_run_x_post':
      case 'retry_x_post': {
        const result = await runXPostAdminAction(supabase, body, action, {
          runRescore,
          recordFeedback,
          insertAdminPipelineEvent,
        });
        return jsonResponse(result.body, result.status);
      }

      // ===== X API: credential status =====
      case 'get_x_status': {
        return jsonResponse(getXStatusAdminAction());
      }

      // ===== X API: verify credentials =====
      case 'x_verify_credentials': {
        const result = await verifyXCredentialsAdminAction(supabase);
        return jsonResponse(result.body, result.status);
      }

      // ===== X API: send test tweet =====
      case 'send_test_tweet': {
        const result = await sendTestTweetAdminAction(supabase, body);
        return jsonResponse(result.body, result.status);
      }

      // ===== X API: test hydration (no DB write) =====
      case 'test_hydrate_tweet': {
        const result = await testHydrateTweetAdminAction(supabase, body);
        return jsonResponse(result.body, result.status);
      }

      // ===== Backfill: re-hydrate recent truncated tweets matching new heuristics =====
      case 'rehydrate_recent_truncated': {
        const result = await rehydrateRecentTruncatedAdminAction(supabase, body);
        return jsonResponse(result.body, result.status);
      }

      // ===== Re-score recent posts that are missing score_axes =====
      case 'rescore_recent': {
        const result = await rescoreRecentAdminAction(supabase, body);
        return jsonResponse(result.body, result.status);
      }

      case 'preview_translation': {
        const result = await previewTranslationAdminAction(body, { supabase });
        return jsonResponse(result.body, result.status);
      }

      // ===== Re-score an existing post using current settings =====
      case 'rescore_post': {
        const result = await rescorePostAdminAction(supabase, body, {
          insertAdminPipelineEvent,
          recordFeedback,
        });
        return jsonResponse(result.body, result.status);
      }

      case 'translate_post': {
        const result = await translatePostAdminAction(supabase, body, {
          runTranslationOnly: runTranslationOnlyForAdmin,
        });
        return jsonResponse(result.body, result.status);
      }

      case 'set_manual_score': {
        return jsonResponse(await setManualScore(supabase, body, {
          recordFeedback,
          insertAdminPipelineEvent,
          runTranslationOnly: runTranslationOnlyForAdmin,
          queueManualAdvance,
        }));
      }

      case 'record_score_feedback': {
        return jsonResponse(await recordScoreFeedback(supabase, body, {
          recordFeedback,
          insertAdminPipelineEvent,
        }));
      }

      case 'ignore_monitoring_item': {
        const result = await ignoreMonitoringItemAdminAction(supabase, body, {
          updateLatestPostEnrichment,
          recordFeedback,
          insertAdminPipelineEvent,
        });
        return jsonResponse(result.body, result.status);
      }

      // ===== Run X followers snapshot manually =====
      case 'run_followers_snapshot': {
        const result = await runFollowersSnapshotAdminAction(supabase, body);
        return jsonResponse(result.body, result.status);
      }

      // ===== Clear duplicate (not-a-duplicate feedback) =====
      case 'clear_dup': {
        const result = await clearDuplicateAdminAction(supabase, body, {
          recordFeedback,
        });
        return jsonResponse(result.body, result.status);
      }

      // ===== Reset learned biases =====
      case 'reset_learned_biases': {
        const result = await resetLearnedBiasesAdminAction(supabase);
        return jsonResponse(result.body, result.status);
      }

      // ===== Approve enrichment and queue delivery =====
      case 'approve_enrichment': {
        const result = await approveEnrichmentAdminAction(supabase, body, { insertAdminPipelineEvent });
        return jsonResponse(result.body, result.status);
      }

      // ===== Reject enrichment (plain X posting can still proceed unless enrichment is explicitly required) =====
      case 'reject_enrichment': {
        const result = await rejectEnrichmentAdminAction(supabase, body);
        return jsonResponse(result.body, result.status);
      }

      // ===== Record enrichment feedback without posting =====
      case 'record_enrichment_feedback': {
        const result = await recordEnrichmentFeedbackAdminAction(supabase, body, { insertAdminPipelineEvent });
        return jsonResponse(result.body, result.status);
      }

      // ===== Generate and persist @masihh voice profile from the canonical guide =====
      case 'generate_voice_profile': {
        const result = await generateVoiceProfileAdminAction(supabase, body, { insertAdminPipelineEvent });
        return jsonResponse(result.body, result.status);
      }

      // ===== Select one manual enrichment variant for the X preview, without posting =====
      case 'select_enrichment_variant': {
        const result = await selectEnrichmentVariantAdminAction(supabase, body, { insertAdminPipelineEvent });
        return jsonResponse(result.body, result.status);
      }

      // ===== Manually trigger enrichment on a post (never auto-posts) =====
      case 'enrich_post': {
        const result = await enrichPostAdminAction(supabase, body, {
          insertAdminPipelineEvent,
          runTranslationOnly: runTranslationOnlyForAdmin,
        });
        return jsonResponse(result.body, result.status);
      }

      default:
        return jsonResponse({ error: 'Unknown admin action', code: 'admin_action_unknown' }, 400);
    }
  } catch {
    const code = 'admin_action_handler_failed';
    const action = actionForSentry ?? 'handler';
    console.error('[admin-actions] handler failed', { code, action });
    try {
      await captureEdgeException(new Error(code), {
        functionName: "admin-actions",
        action,
        request: req,
      });
    } catch {
      console.error('[admin-actions] error capture failed', { code });
    }
    return jsonResponse({ error: 'Admin action failed', code }, 500);
  }
});
