export const ADMIN_ACTION_NAMES = [
  'version',
  'save_settings',
  'get_recent_author_stats',
  'edit_translation',
  'retry_step',
  'reprocess',
  'cancel_pending_jobs',
  'bulk_reprocess',
  'bulk_ignore',
  'post_thread',
  'get_health',
  'reconcile_stuck_jobs',
  'get_dashboard_summary',
  'get_dashboard_process_hud',
  'get_system_performance_summary',
  'dry_run_old_media_cleanup',
  'get_monitoring_overview',
  'get_monitoring_entries',
  'get_x_api_summary',
  'get_video_render_config',
  'update_video_render_config',
  'get_video_render_overview',
  'get_video_render_queue',
  'get_video_render_detail',
  'retry_video_render',
  'set_video_render_reviewed',
  'save_video_render_feedback',
  'manual_video_intake_create',
  'manual_video_intake_get',
  'manual_video_intake_list',
  'manual_video_intake_refresh',
  'manual_video_intake_save_caption',
  'manual_video_intake_set_duplicate_override',
  'manual_video_intake_cancel',
  'manual_video_intake_post',
  'get_x_posting_diagnostics',
  'score_post_v2',
  'preview_scoring_policy',
  'run_scoring_eval',
  'promote_feedback_to_scoring_example',
  'backfill_score_v2',
  'run_dedupe',
  'backfill_dedupe',
  'audit_duplicate_candidates',
  'summarize_stale_x_pending',
  'hydrate_post',
  'get_post_pipeline_status',
  'get_admin_operation_status',
  'get_runtime_controls',
  'update_runtime_controls',
  'resolve_x_media',
  'dry_run_x_post',
  'retry_x_post',
  'get_x_status',
  'x_verify_credentials',
  'send_test_tweet',
  'test_hydrate_tweet',
  'rehydrate_recent_truncated',
  'rescore_recent',
  'preview_translation',
  'rescore_post',
  'translate_post',
  'set_manual_score',
  'record_score_feedback',
  'ignore_monitoring_item',
  'run_followers_snapshot',
  'clear_dup',
  'reset_learned_biases',
  'approve_enrichment',
  'reject_enrichment',
  'record_enrichment_feedback',
  'generate_voice_profile',
  'select_enrichment_variant',
  'enrich_post',
] as const;

export type AdminActionName = typeof ADMIN_ACTION_NAMES[number];

/**
 * Actions that only read normal dashboard operational or status data.
 *
 * Keep this list explicit. Anything that is not listed is admin-only,
 * including provider verification, dry runs, self-heal, and cost-bearing
 * reads.
 */
export const READ_ONLY_ADMIN_ACTION_NAMES = [
  'version',
  'get_recent_author_stats',
  'get_health',
  'get_dashboard_summary',
  'get_dashboard_process_hud',
  'get_system_performance_summary',
  'get_monitoring_overview',
  'get_monitoring_entries',
  'get_x_api_summary',
  'get_video_render_config',
  'get_video_render_overview',
  'get_video_render_queue',
  'get_video_render_detail',
  'manual_video_intake_get',
  'manual_video_intake_list',
  'get_x_posting_diagnostics',
  'get_admin_operation_status',
  'get_post_pipeline_status',
  'get_x_status',
  'get_runtime_controls',
] as const satisfies readonly AdminActionName[];

export type ReadOnlyAdminActionName = typeof READ_ONLY_ADMIN_ACTION_NAMES[number];

const READ_ONLY_ADMIN_ACTION_NAME_SET = new Set<string>(
  READ_ONLY_ADMIN_ACTION_NAMES,
);

export function isReadOnlyAdminActionName(
  value: string,
): value is ReadOnlyAdminActionName {
  return READ_ONLY_ADMIN_ACTION_NAME_SET.has(value);
}

const ADMIN_ACTION_NAME_SET = new Set<string>(ADMIN_ACTION_NAMES);

export function isAdminActionName(value: string): value is AdminActionName {
  return ADMIN_ACTION_NAME_SET.has(value);
}
