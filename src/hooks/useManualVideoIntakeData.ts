import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invokeAdminAction } from '@/api/adminActions';
import { useToast } from '@/hooks/use-toast';

export type ManualVideoIntakeStatus =
  | 'draft'
  | 'fetching'
  | 'media_resolving'
  | 'media_downloading'
  | 'translating'
  | 'render_queued'
  | 'rendering'
  | 'ready'
  | 'blocked'
  | 'post_requested'
  | 'posted'
  | 'failed'
  | 'canceled';

export interface ManualVideoIntakeRow {
  id: string;
  tweet_id: string;
  source_url: string;
  source_handle: string | null;
  created_by: string | null;
  status: ManualVideoIntakeStatus;
  caption_draft: string | null;
  caption_edited: string | null;
  selected_render_id: string | null;
  safety_flags: Record<string, unknown> | null;
  duplicate_override: boolean;
  duplicate_override_reason: string | null;
  posted_x_tweet_id: string | null;
  posted_at: string | null;
  last_error: string | null;
  blocks_auto_delivery: boolean;
  created_at: string;
  updated_at: string;
}

export interface ManualVideoMediaRow {
  id: string;
  tweet_id: string;
  kind: string | null;
  src_url: string | null;
  storage_path: string | null;
  ordering: number | null;
  downloaded_at: string | null;
  mime_type: string | null;
  file_size: number | null;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
}

export interface ManualVideoRenderRow {
  id: string;
  tweet_id: string;
  source_media_id: string | null;
  status: string;
  output_storage_path: string | null;
  output_mime_type: string | null;
  output_file_size: number | null;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  source_language: string | null;
  target_language: string | null;
  error: string | null;
  block_reason: string | null;
  updated_at: string | null;
  completed_at: string | null;
  translated_srt?: string | null;
  persian_srt?: string | null;
}

export interface ManualVideoSnapshot {
  ok: boolean;
  error?: string;
  intake: ManualVideoIntakeRow;
  post: {
    tweet_id: string;
    text_original: string | null;
    text_translated: string | null;
    author_handle: string | null;
    url: string | null;
    has_media: boolean | null;
    dedupe_status: string | null;
    dup_of_tweet_id: string | null;
    dup_similarity: number | null;
    dedupe_reason: string | null;
  } | null;
  media: ManualVideoMediaRow[];
  renders: ManualVideoRenderRow[];
  latest_render: ManualVideoRenderRow | null;
  preview: {
    render_id: string | null;
    source_signed_url: string | null;
    output_signed_url: string | null;
    subtitle_text: string | null;
  };
  caption: {
    draft: string | null;
    edited: string | null;
    effective: string;
    max_chars: number;
    chars: number;
  };
  safety: Record<string, unknown>;
  x_delivery: Record<string, unknown> | null;
}

function invalidateManualIntake(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['manual-video-intakes'] });
  queryClient.invalidateQueries({ queryKey: ['video-render-overview'] });
  queryClient.invalidateQueries({ queryKey: ['video-render-queue'] });
  queryClient.invalidateQueries({ queryKey: ['video-render-detail'] });
}

export function useManualVideoIntakeList() {
  return useQuery({
    queryKey: ['manual-video-intakes', 'list'],
    queryFn: () => invokeAdminAction<{ ok: boolean; rows: ManualVideoIntakeRow[] }>({
      action: 'manual_video_intake_list',
      limit: 40,
    }),
    staleTime: 10_000,
    retry: 1,
  });
}

export function useManualVideoIntakeDetail(input: {
  intakeId?: string | null;
  tweetId?: string | null;
  renderId?: string | null;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: ['manual-video-intakes', 'detail', input.intakeId ?? '', input.tweetId ?? '', input.renderId ?? ''],
    queryFn: () => invokeAdminAction<ManualVideoSnapshot>({
      action: 'manual_video_intake_get',
      intake_id: input.intakeId ?? undefined,
      tweet_id: input.tweetId ?? undefined,
      render_id: input.renderId ?? undefined,
      refresh_dedupe: false,
    }),
    enabled: input.enabled !== false && Boolean(input.intakeId || input.tweetId),
    staleTime: 5_000,
    retry: 1,
  });
}

export function useCreateManualVideoIntake() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (input: { url: string }) => invokeAdminAction<ManualVideoSnapshot>({
      action: 'manual_video_intake_create',
      url: input.url,
    }),
    onSuccess: (data) => {
      invalidateManualIntake(queryClient);
      toast({ title: 'Manual intake queued', description: `Tweet ${data.intake.tweet_id}` });
    },
    onError: (error) => {
      toast({ title: 'Manual intake failed', description: (error as Error).message, variant: 'destructive' });
    },
  });
}

export function useRefreshManualVideoIntake() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (input: { intake_id: string }) => invokeAdminAction<ManualVideoSnapshot>({
      action: 'manual_video_intake_refresh',
      intake_id: input.intake_id,
    }),
    onSuccess: () => {
      invalidateManualIntake(queryClient);
      toast({ title: 'Manual intake refreshed' });
    },
    onError: (error) => {
      toast({ title: 'Refresh failed', description: (error as Error).message, variant: 'destructive' });
    },
  });
}

export function useSaveManualVideoCaption() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (input: { intake_id: string; caption: string }) => invokeAdminAction<ManualVideoSnapshot>({
      action: 'manual_video_intake_save_caption',
      intake_id: input.intake_id,
      caption: input.caption,
    }),
    onSuccess: () => {
      invalidateManualIntake(queryClient);
      toast({ title: 'Caption saved' });
    },
    onError: (error) => {
      toast({ title: 'Caption save failed', description: (error as Error).message, variant: 'destructive' });
    },
  });
}

export function useSetManualVideoDuplicateOverride() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (input: { intake_id: string; enabled: boolean; reason?: string }) => invokeAdminAction<ManualVideoSnapshot>({
      action: 'manual_video_intake_set_duplicate_override',
      intake_id: input.intake_id,
      enabled: input.enabled,
      reason: input.reason,
    }),
    onSuccess: (data) => {
      invalidateManualIntake(queryClient);
      toast({ title: data.intake.duplicate_override ? 'Duplicate override enabled' : 'Duplicate override disabled' });
    },
    onError: (error) => {
      toast({ title: 'Duplicate override failed', description: (error as Error).message, variant: 'destructive' });
    },
  });
}

export function useCancelManualVideoIntake() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (input: { intake_id: string }) => invokeAdminAction<{ ok: boolean; intake_id: string; status: string }>({
      action: 'manual_video_intake_cancel',
      intake_id: input.intake_id,
    }),
    onSuccess: () => {
      invalidateManualIntake(queryClient);
      toast({ title: 'Manual intake canceled' });
    },
    onError: (error) => {
      toast({ title: 'Cancel failed', description: (error as Error).message, variant: 'destructive' });
    },
  });
}

export function usePostManualVideoIntake() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (input: { intake_id: string; render_id: string; caption: string }) => invokeAdminAction<{ ok: boolean; posted?: boolean; error?: string; code?: string }>({
      action: 'manual_video_intake_post',
      intake_id: input.intake_id,
      render_id: input.render_id,
      caption: input.caption,
      confirm_manual_post: true,
    }),
    onSuccess: () => {
      invalidateManualIntake(queryClient);
      toast({ title: 'Manual X post requested' });
    },
    onError: (error) => {
      toast({ title: 'Manual post failed', description: (error as Error).message, variant: 'destructive' });
    },
  });
}
