export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 512 * 1024 * 1024;
export const MAX_STANDARD_VIDEO_DURATION_MS = 140_000;

const VIDEO_EXT_RE = /\.(mp4|mov|webm|m4v)(?:[?#].*)?$/i;
const VIDEO_THUMB_RE = /(tweet_video_thumb|amplify_video_thumb|ext_tw_video_thumb)/i;

export type XMediaKind = 'image' | 'video' | 'gif' | 'thumbnail' | string | null;

export interface XMediaRow {
  id?: string | null;
  storage_path?: string | null;
  downloaded_at?: string | null;
  mime_type?: string | null;
  file_size?: number | null;
  kind?: XMediaKind;
  duration_ms?: number | null;
  src_url?: string | null;
}

export type MediaTier = 'text' | 'image' | 'video' | 'blocked';

export interface MediaTierSelection {
  tier: MediaTier;
  items: XMediaRow[];
  reason?: string;
}

export function isLikelyVideoThumbnailUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return VIDEO_THUMB_RE.test(url);
}

export function hasVideoIntent(row: XMediaRow): boolean {
  const kind = String(row.kind ?? '').toLowerCase();
  const mime = String(row.mime_type ?? '').toLowerCase();
  const src = String(row.src_url ?? '').toLowerCase();
  return kind === 'video'
    || kind === 'gif'
    || typeof row.duration_ms === 'number'
    || mime.startsWith('video/')
    || src.includes('video.twimg.com')
    || VIDEO_EXT_RE.test(src)
    || isLikelyVideoThumbnailUrl(src);
}

function hasDownloadedBytes(row: XMediaRow): boolean {
  return Boolean(row.downloaded_at && row.storage_path);
}

export function isValidVideoDownload(row: XMediaRow): boolean {
  const fileSize = row.file_size ?? 0;
  return hasVideoIntent(row)
    && hasDownloadedBytes(row)
    && String(row.mime_type ?? '').toLowerCase().startsWith('video/')
    && fileSize > 0
    && fileSize <= MAX_VIDEO_BYTES;
}

export function isSendableImage(row: XMediaRow): boolean {
  const fileSize = row.file_size ?? 0;
  const kind = String(row.kind ?? '').toLowerCase();
  return hasDownloadedBytes(row)
    && kind !== 'thumbnail'
    && !hasVideoIntent(row)
    && ALLOWED_IMAGE_MIME_TYPES.includes(String(row.mime_type ?? '').toLowerCase())
    && fileSize > 0
    && fileSize <= MAX_IMAGE_BYTES;
}

export function mediaIntegrityBlocker(rows: XMediaRow[]): string | null {
  const videoIntentRows = rows.filter(hasVideoIntent);
  if (videoIntentRows.length === 0) return null;
  if (videoIntentRows.some(isValidVideoDownload)) return null;

  const downloadedVideoIntent = videoIntentRows.find(hasDownloadedBytes);
  if (downloadedVideoIntent) {
    return 'video_media_mismatch';
  }

  return 'video_pending_resolution';
}

export function selectMediaTier(
  rows: XMediaRow[],
  options: { allowVideo?: boolean } = {},
): MediaTierSelection {
  const downloaded = rows.filter(hasDownloadedBytes);
  if (downloaded.length === 0) {
    return rows.some(hasVideoIntent)
      ? { tier: 'blocked', items: [], reason: 'video_pending_resolution' }
      : { tier: 'text', items: [], reason: 'no_downloaded_media' };
  }

  const video = downloaded.find(isValidVideoDownload);
  if (video) {
    if (options.allowVideo !== true) {
      return { tier: 'blocked', items: [video], reason: 'video_disabled_by_config' };
    }
    return { tier: 'video', items: [video] };
  }

  const videoBlocker = mediaIntegrityBlocker(rows);
  if (videoBlocker) {
    return { tier: 'blocked', items: downloaded.filter(hasVideoIntent), reason: videoBlocker };
  }

  const images = downloaded.filter(isSendableImage);
  if (images.length > 0) return { tier: 'image', items: images.slice(0, 4) };

  return { tier: 'text', items: [], reason: 'no_supported_media' };
}

export interface IngestMediaItem {
  type: string;
  url: string;
  width?: number;
  height?: number;
  duration?: number;
}

export function filterSendableIngestMedia(
  mediaItems: IngestMediaItem[],
  hasVideoSignal: boolean,
): IngestMediaItem[] {
  if (!hasVideoSignal) return mediaItems;

  return mediaItems.filter((media) => {
    if (media.type === 'video') return true;
    if (media.type === 'image') return false;
    return !isLikelyVideoThumbnailUrl(media.url);
  });
}
