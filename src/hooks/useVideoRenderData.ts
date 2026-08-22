import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { invokeAdminAction } from '@/api/adminActions';
import { useToast } from '@/hooks/use-toast';
import {
  beginVideoRenderRetry,
  isVideoRenderRetryPending,
  settleVideoRenderRetry,
  type VideoRenderRetryInput,
} from '@/lib/videoRenderRetryState';
import {
  beginVideoRenderFeedbackSave,
  isVideoRenderFeedbackSavePending,
  settleVideoRenderFeedbackSave,
  type VideoRenderFeedbackTarget,
} from '@/lib/videoRenderFeedbackState';
import {
  hasActiveVideoRenderRows,
  isActiveVideoRenderStatus,
  videoRenderPollingInterval,
  videoRenderStatusesMayContainActive,
  type VideoRendererHealthState,
} from '@/lib/videoRenderPolling';

export type VideoRenderMode = 'disabled' | 'shadow' | 'enabled';
export type VideoRenderStatus = 'queued' | 'running' | 'completed' | 'failed' | 'blocked' | 'expired';
export type VideoRenderDiagnostic = 'render_failed' | 'render_blocked';
export interface VideoRenderTimingMetrics {
  total_ms: number | null;
  config_load_ms: number | null;
  source_lookup_ms: number | null;
  post_context_lookup_ms: number | null;
  download_ms: number | null;
  probe_ms: number | null;
  preflight_visual_ms: number | null;
  contact_sheet_ms: number | null;
  vision_frames_ms: number | null;
  vision_inspection_sheets_ms: number | null;
  local_ocr_ms: number | null;
  watermark_vision_ms: number | null;
  delogo_recovery_ms: number | null;
  audio_extract_ms: number | null;
  audio_extract_enhanced_ms: number | null;
  audio_extract_early_ms: number | null;
  transcription_ms: number | null;
  transcript_cleanup_ms: number | null;
  translation_ms: number | null;
  subtitle_generate_ms: number | null;
  encode_ms: number | null;
  upload_ms: number | null;
}
type VideoRenderRetryMutationInput = {
  render_id?: string;
  tweet_id?: string;
};
type VideoRenderFeedbackMutationInput = {
  render_id: string;
  render_version: string;
  render_revision: number;
  label: string;
  note?: string;
  metadata?: Record<string, unknown>;
};

export interface VideoRenderConfigValue {
  mode: VideoRenderMode;
  enabled: boolean;
  render_version: string;
  failure_policy: 'post_original' | 'block';
  retention_hours: number;
  renderer_url: string | null;
  transcription_provider: 'deepgram' | 'openai';
  transcription_model: string;
  translation_model: string;
  vision_model: string;
  target_language_rule: 'fa_except_fa_to_en';
  subtitle_style: {
    text_color: string;
    background_color: string;
    font_scale: number;
    max_width_pct: number;
    bottom_padding_pct: number;
    collision_gap_pct: number;
  };
  delogo: {
    vision_mode: 'off' | 'auto' | 'always';
    engine: 'opencv' | 'ffmpeg';
    max_regions: number;
    max_single_area_ratio: number;
    max_total_area_ratio: number;
    opencv_radius: number;
    opencv_kernel: number;
    opencv_dilate_iterations: number;
    opencv_feather: number;
  };
  watermark: {
    apply_when: 'subtitle_track' | 'modified' | 'always' | 'never';
    opacity: number;
    top_right_opacity: number;
    cover_opacity: number;
    multiple: boolean;
    cover_delogo: boolean;
    cover_padding_pct: number;
  };
}

export interface VideoRendererHeartbeat {
  renderer_id: string | null;
  status: 'online' | 'draining' | 'paused' | 'offline' | 'error' | 'unknown';
  version: string | null;
  render_version: string | null;
  running: number;
  processed: number;
  failed: number;
  last_seen_at: string | null;
}

export interface VideoRendererHealth {
  state: VideoRendererHealthState;
  server_observed_at: string | null;
  last_seen_at: string | null;
  age_ms: number | null;
  renderer_id: string | null;
  reported_status: VideoRendererHeartbeat['status'] | null;
}

export interface VideoRenderOverview {
  ok: boolean;
  config: VideoRenderConfigValue;
  counts: Record<string, number>;
  unreviewed_issues: number;
  reviewed_issues: number;
  oldest_queued_at: string | null;
  medians: { render_ms: number | null; total_ms: number | null };
  output_bytes_7d: number;
  heartbeats: VideoRendererHeartbeat[];
  renderer_health: VideoRendererHealth;
}

export interface VideoRenderQueueRow {
  id: string;
  tweet_id: string;
  source_media_id: string;
  status: VideoRenderStatus;
  failure_policy: string;
  render_version: string;
  render_revision: number;
  output_file_size: number | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  source_language: string | null;
  target_language: string | null;
  metrics: VideoRenderTimingMetrics;
  error: VideoRenderDiagnostic | null;
  block_reason: VideoRenderDiagnostic | null;
  attempts: number;
  queued_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  blocked_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  updated_at: string | null;
  created_at: string | null;
  action_label: string;
  activity_at: string;
  post: {
    tweet_id: string;
    text_original: string | null;
    url: string | null;
    author_handle: string | null;
    created_at: string | null;
    delivery_decision: string | null;
    final_score: number | null;
  } | null;
  media: {
    id: string;
    kind: string | null;
    mime_type: string | null;
    file_size: number | null;
    duration_ms: number | null;
    width: number | null;
    height: number | null;
  } | null;
  latest_feedback: { label?: string; note?: string | null; created_at?: string } | null;
}

export interface VideoRenderDetail {
  ok: boolean;
  error?: string;
  render: (Omit<VideoRenderQueueRow, 'post' | 'media' | 'latest_feedback'> & {
    original_srt?: string | null;
    persian_srt?: string | null;
    translated_srt?: string | null;
    ass_subtitles?: string | null;
  }) | null;
  post: VideoRenderQueueRow['post'];
  media: VideoRenderQueueRow['media'];
  feedback: Array<{ id: string; label: string; note: string | null; created_at: string }>;
}

type VideoRenderPollingOptions = {
  isVisible?: boolean;
};

export function useVideoRenderOverview(options: VideoRenderPollingOptions = {}) {
  const isVisible = options.isVisible === true;
  return useQuery({
    queryKey: ['video-render-overview'],
    queryFn: () => invokeAdminAction<VideoRenderOverview>({ action: 'get_video_render_overview' }),
    staleTime: 15_000,
    retry: 1,
    refetchInterval: (query) => {
      const overview = query.state.data;
      return videoRenderPollingInterval({
        isVisible,
        hasActiveRender: (overview?.counts?.queued ?? 0) > 0 || (overview?.counts?.running ?? 0) > 0,
        rendererHealth: overview?.renderer_health?.state ?? 'unknown',
        failureCount: query.state.fetchFailureCount,
      });
    },
    refetchIntervalInBackground: false,
  });
}

export function useVideoRenderQueue(
  statuses?: VideoRenderStatus[],
  reviewState: 'unreviewed' | 'all' = 'unreviewed',
  options: VideoRenderPollingOptions = {},
) {
  const isVisible = options.isVisible === true;
  return useQuery({
    queryKey: ['video-render-queue', statuses?.join(',') ?? 'default', reviewState],
    queryFn: () => invokeAdminAction<{ ok: boolean; rows: VideoRenderQueueRow[] }>({
      action: 'get_video_render_queue',
      statuses,
      review_state: reviewState,
      limit: 100,
    }),
    staleTime: 15_000,
    retry: 1,
    refetchInterval: (query) => {
      const rows = query.state.data?.rows;
      return videoRenderPollingInterval({
        isVisible,
        hasActiveRender: Array.isArray(rows)
          ? hasActiveVideoRenderRows(rows)
          : videoRenderStatusesMayContainActive(statuses),
        failureCount: query.state.fetchFailureCount,
      });
    },
    refetchIntervalInBackground: false,
  });
}

export function useVideoRenderDetail(input: {
  renderId?: string | null;
  tweetId?: string | null;
  status?: VideoRenderStatus | null;
  enabled?: boolean;
  isVisible?: boolean;
}) {
  const isVisible = input.isVisible === true;
  return useQuery({
    queryKey: ['video-render-detail', input.renderId ?? '', input.tweetId ?? ''],
    queryFn: () => invokeAdminAction<VideoRenderDetail>({
      action: 'get_video_render_detail',
      render_id: input.renderId ?? undefined,
      tweet_id: input.tweetId ?? undefined,
    }),
    enabled: input.enabled !== false && Boolean(input.renderId || input.tweetId),
    staleTime: 10_000,
    retry: 1,
    refetchInterval: (query) => {
      const detail = query.state.data;
      const status = detail?.render?.status ?? input.status;
      return videoRenderPollingInterval({
        isVisible,
        hasActiveRender: isActiveVideoRenderStatus(status),
        rendererHealth: detail ? null : 'unknown',
        failureCount: query.state.fetchFailureCount,
      });
    },
    refetchIntervalInBackground: false,
  });
}

export function useVideoRenderConfig() {
  return useQuery({
    queryKey: ['video-render-config'],
    queryFn: () => invokeAdminAction<{ ok: boolean; config: VideoRenderConfigValue }>({ action: 'get_video_render_config' }),
    staleTime: 30_000,
    retry: 1,
  });
}

export function useUpdateVideoRenderConfig() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (config: Partial<VideoRenderConfigValue>) => invokeAdminAction<{ ok: boolean; config: VideoRenderConfigValue }>({
      action: 'update_video_render_config',
      config,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['video-render-config'] });
      queryClient.invalidateQueries({ queryKey: ['video-render-overview'] });
      toast({ title: 'Video rendering settings saved' });
    },
    onError: (error) => {
      toast({ title: 'Could not save video rendering settings', description: (error as Error).message, variant: 'destructive' });
    },
  });
}

export function useRetryVideoRender() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const retry = useMutation({
    mutationFn: (input: VideoRenderRetryMutationInput) => invokeAdminAction<{ ok: boolean; render_id: string; tweet_id: string; mode: VideoRenderMode }>({
      action: 'retry_video_render',
      ...input,
    }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['video-render-overview'] });
      queryClient.invalidateQueries({ queryKey: ['video-render-queue'] });
      queryClient.invalidateQueries({ queryKey: ['video-render-detail'] });
      toast({ title: 'Video render queued', description: `Mode: ${data.mode}` });
    },
    onError: (error) => {
      toast({ title: 'Could not queue video render', description: (error as Error).message, variant: 'destructive' });
    },
  });
  const [pendingRetryKeys, setPendingRetryKeys] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  );

  const mutate = useCallback((input: VideoRenderRetryMutationInput) => {
    setPendingRetryKeys((pending) => beginVideoRenderRetry(pending, input));
    void retry.mutateAsync(input)
      .catch(() => undefined)
      .finally(() => {
        setPendingRetryKeys((pending) => settleVideoRenderRetry(pending, input));
      });
  }, [retry]);

  const isPendingFor = useCallback(
    (input: VideoRenderRetryInput) =>
      isVideoRenderRetryPending(pendingRetryKeys, input),
    [pendingRetryKeys],
  );

  return { ...retry, mutate, isPendingFor };
}

export function useSetVideoRenderReviewed() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (input: { render_id?: string; render_ids?: string[]; reviewed: boolean }) => invokeAdminAction<{
      ok: boolean;
      reviewed: boolean;
      updated: number;
      render_ids: string[];
    }>({
      action: 'set_video_render_reviewed',
      ...input,
    }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['video-render-overview'] });
      queryClient.invalidateQueries({ queryKey: ['video-render-queue'] });
      queryClient.invalidateQueries({ queryKey: ['video-render-detail'] });
      toast({
        title: data.reviewed ? 'Video issue marked reviewed' : 'Video issue restored',
        description: `${data.updated} render${data.updated === 1 ? '' : 's'} updated`,
      });
    },
    onError: (error) => {
      toast({ title: 'Could not update review state', description: (error as Error).message, variant: 'destructive' });
    },
  });
}

export function useSaveVideoRenderFeedback() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const feedback = useMutation({
    mutationFn: (input: VideoRenderFeedbackMutationInput) => invokeAdminAction({
      action: 'save_video_render_feedback',
      ...input,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['video-render-queue'] });
      queryClient.invalidateQueries({ queryKey: ['video-render-detail'] });
      toast({ title: 'Video feedback saved' });
    },
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: ['video-render-queue'] });
      queryClient.invalidateQueries({ queryKey: ['video-render-detail'] });
      toast({ title: 'Could not save feedback', description: (error as Error).message, variant: 'destructive' });
    },
  });
  const [pendingFeedbackKeys, setPendingFeedbackKeys] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  );

  const mutate = useCallback((input: VideoRenderFeedbackMutationInput) => {
    setPendingFeedbackKeys((pending) => beginVideoRenderFeedbackSave(pending, input));
    void feedback.mutateAsync(input)
      .catch(() => undefined)
      .finally(() => {
        setPendingFeedbackKeys((pending) => settleVideoRenderFeedbackSave(pending, input));
      });
  }, [feedback]);

  const isPendingFor = useCallback(
    (input: VideoRenderFeedbackTarget) =>
      isVideoRenderFeedbackSavePending(pendingFeedbackKeys, input),
    [pendingFeedbackKeys],
  );

  return { ...feedback, mutate, isPendingFor };
}
