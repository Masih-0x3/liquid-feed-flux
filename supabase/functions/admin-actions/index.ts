import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { recordXApiEvent } from "../_shared/xApiLedger.ts";
import {
  doesEnrichmentBlockX,
  normalizeEnrichmentConfig,
  type EnrichmentConfig,
} from "../_shared/enrich.ts";
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
  backfillSignaturesAdminAction,
  clearDuplicateAdminAction,
  runDedupeAdminAction,
} from "./dedupeActions.ts";
import {
  getMonitoringEntries,
  getMonitoringOverview,
} from "./monitoringReads.ts";
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
  updateVideoRenderConfigAdmin,
} from "./videoRenderActions.ts";
import { getXApiSummary } from "./xApiSummary.ts";
import { saveSettingsAdminAction } from "./settings.ts";
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
  queueHydrationJob,
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

const DEPLOY_SHA = Deno.env.get('DEPLOY_GIT_SHA') ?? 'unknown';
const DEPLOY_TIME = Deno.env.get('DEPLOY_TIME') ?? new Date().toISOString();

function makeCorsHeaders(req?: Request): Record<string, string> {
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
  const origin = req?.headers.get('Origin') ?? '';
  const fallbackOrigin = configuredOrigins[0] ?? 'https://xot.iraneyes.com';
  return {
    'Access-Control-Allow-Origin': origin && allowedOrigins.has(origin) ? origin : fallbackOrigin,
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

let corsHeaders = makeCorsHeaders();

// Validate JWT and check admin role
async function requireAdmin(req: Request): Promise<{ userId: string } | Response> {
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

  const serviceClient = createClient<any, any>(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const { data: roleData } = await serviceClient
    .from('user_roles')
    .select('role')
    .eq('user_id', data.user.id)
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle();

  if (!roleData) {
    return new Response(JSON.stringify({ error: 'Forbidden: admin role required' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return { userId: data.user.id };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// deno-lint-ignore no-explicit-any
async function recordFeedback(
  supabase: any,
  tweetId: string,
  feedbackAction: string,
  polarity: number,
  meta?: Record<string, unknown>,
  relatedTweetId?: string | null,
) {
  await supabase.from('feedback_events').insert({
    tweet_id: tweetId,
    related_tweet_id: relatedTweetId ?? null,
    action: feedbackAction,
    polarity,
    meta: meta ?? {},
    source: 'admin_action',
  });

  if (polarity === 0 || ['not_duplicate', 'confirm_duplicate'].includes(feedbackAction)) return;

  const { data: post } = await supabase
    .from('posts')
    .select('author_handle, importance_tags')
    .eq('tweet_id', tweetId)
    .maybeSingle();
  if (!post) return;

  const { data: biasRow } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'learned_biases')
    .maybeSingle();
  const biases = (biasRow?.value ?? { author_bias: {}, tag_bias: {}, keyword_bias: {} }) as {
    author_bias: Record<string, number>;
    tag_bias: Record<string, number>;
    keyword_bias: Record<string, number>;
  };

  const PER_EVENT_CLAMP = 0.5;
  const PER_KEY_CAP = 3;
  const clampD = (d: number) => Math.max(-PER_EVENT_CLAMP, Math.min(PER_EVENT_CLAMP, d));
  const clampT = (t: number) => Math.max(-PER_KEY_CAP, Math.min(PER_KEY_CAP, t));

  if (post.author_handle) {
    const handle = (post.author_handle as string).toLowerCase();
    biases.author_bias[handle] = clampT((biases.author_bias[handle] || 0) + clampD(polarity * 0.6));
  }

  const tags = Array.isArray(post.importance_tags) ? post.importance_tags as string[] : [];
  if (tags.length > 0) {
    const perTag = polarity * 0.2 / tags.length;
    for (const tag of tags) {
      const t = String(tag).toLowerCase();
      biases.tag_bias[t] = clampT((biases.tag_bias[t] || 0) + clampD(perTag));
    }
  }

  await supabase.from('settings').upsert({
    key: 'learned_biases',
    value: biases,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'key' });
}

// deno-lint-ignore no-explicit-any
async function insertAdminPipelineEvent(
  supabase: any,
  tweetId: string,
  step: string,
  status: string,
  meta?: Record<string, unknown>,
  error?: string | null,
) {
  await supabase.from('pipeline_events').insert({
    subject_type: 'post',
    subject_id: tweetId,
    step,
    status,
    started_at: new Date().toISOString(),
    ended_at: status === 'completed' || status === 'failed' || status === 'skipped' ? new Date().toISOString() : null,
    error: error ?? null,
    meta: { source: 'admin-actions', ...(meta ?? {}) },
  }).then(() => null, () => null);
}

// deno-lint-ignore no-explicit-any
async function runTranslationOnlyForAdmin(supabase: any, tweetId: string) {
  return await runTranslationOnly(supabase, tweetId, {
    insertAdminPipelineEvent,
    recordFeedback,
  });
}

// deno-lint-ignore no-explicit-any
async function queueManualAdvance(supabase: any, tweetId: string): Promise<{ queued: string; reason?: string }> {
  const { data: post } = await supabase
    .from('posts')
    .select('tweet_id, text_translated, translated_at, is_truncated, hydrated_at, enrich_status')
    .eq('tweet_id', tweetId)
    .maybeSingle();
  if (!post) return { queued: 'none', reason: 'post_not_found' };
  if (!post.text_translated && !post.translated_at) return { queued: 'none', reason: 'translation_missing' };
  if (post.is_truncated === true && !post.hydrated_at) {
    const result = await queueHydrationJob(supabase, tweetId, 'manual_score', { insertAdminPipelineEvent });
    return { queued: 'hydrate', reason: result.reason };
  }

  const { data: enrichCfgRow } = await supabase.from('settings').select('value').eq('key', 'enrichment_config').maybeSingle();
  const enrichCfg = normalizeEnrichmentConfig((enrichCfgRow?.value ?? { enabled: false }) as Partial<EnrichmentConfig>);
  if (doesEnrichmentBlockX(enrichCfg) && post.enrich_status !== 'approved' && post.enrich_status !== 'skipped') {
    await supabase.from('jobs').upsert({
      type: 'enrich',
      payload: { tweet_id: tweetId, source: 'manual_score' },
      status: 'pending',
      priority: 18,
      idempotency_key: `enrich:${tweetId}`,
      next_run_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
      lease_expires_at: null,
      last_error: null,
      attempts: 0,
    }, { onConflict: 'idempotency_key', ignoreDuplicates: false });
    await insertAdminPipelineEvent(supabase, tweetId, 'enrich', 'queued', { source: 'manual_score' });
    return { queued: 'enrich' };
  }

  await supabase.from('jobs').upsert({
    type: 'deliver',
    payload: { tweet_id: tweetId, source: 'manual_score' },
    status: 'pending',
    priority: 20,
    idempotency_key: `deliver:${tweetId}`,
    next_run_at: new Date().toISOString(),
    locked_at: null,
    locked_by: null,
    lease_expires_at: null,
    last_error: null,
    attempts: 0,
  }, { onConflict: 'idempotency_key', ignoreDuplicates: false });
  const { data: pendingDel } = await supabase
    .from('deliveries')
    .select('id')
    .eq('subject_type', 'post')
    .eq('subject_id', tweetId)
    .eq('status', 'pending')
    .limit(1);
  if (!pendingDel || pendingDel.length === 0) {
    await supabase.from('deliveries').insert({ subject_type: 'post', subject_id: tweetId, status: 'pending', attempts: 0 });
  }
  await insertAdminPipelineEvent(supabase, tweetId, 'deliver', 'queued', { source: 'manual_score' });
  return { queued: 'deliver' };
}

// deno-lint-ignore no-explicit-any
serve(async (req) => {
  corsHeaders = makeCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const rawText = await req.text();
    let body: any = {};
    try { body = rawText ? JSON.parse(rawText) : {}; } catch (e) {
      console.error('[admin-actions] body parse failed', { rawText: rawText.slice(0, 200), err: (e as Error).message });
    }
    const { action } = body;

    const authResult = await requireAdmin(req);
    if (authResult instanceof Response) return authResult;

    const supabase = createClient<any, any>(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    if (!action) {
      console.error('[admin-actions] missing action', { rawText: rawText.slice(0, 200), contentType: req.headers.get('content-type') });
      return jsonResponse({ error: 'Missing action parameter', received: rawText.slice(0, 200) }, 400);
    }

    switch (action) {
      case 'version': {
        return jsonResponse({ ok: true, sha: DEPLOY_SHA, deployed_at: DEPLOY_TIME });
      }

      // ===== Settings =====
      case 'save_settings': {
        const result = await saveSettingsAdminAction(supabase, body);
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
        return jsonResponse(result.body, result.status);
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

      case 'get_x_api_summary': {
        return jsonResponse(await getXApiSummary(supabase, body, {
          recordAdminXApiAttempt,
          recordXApiEvent,
        }));
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

      case 'save_video_render_feedback': {
        return jsonResponse(await saveVideoRenderFeedbackAdmin(supabase, body, insertAdminPipelineEvent, authResult.userId));
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
        return jsonResponse(result.body, result.status);
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

      // ===== Backward-compatible alias for old Story Memory backfill =====
      case 'backfill_signatures': {
        return jsonResponse(await backfillSignaturesAdminAction(supabase, body));
      }

      // ===== Re-score recent posts that are missing score_axes =====
      case 'rescore_recent': {
        const result = await rescoreRecentAdminAction(supabase, body);
        return jsonResponse(result.body, result.status);
      }

      case 'preview_translation': {
        const result = await previewTranslationAdminAction(body);
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
        return jsonResponse({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Admin action error:', message);
    return jsonResponse({ error: message }, 500);
  }
});
