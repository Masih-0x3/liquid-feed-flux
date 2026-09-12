import { invokeAdminRead } from '@/api/adminActions';
import { AdminActionClientError } from '@/api/adminActionErrors';

export type MediaTarget = { tweetId: string; mediaId?: string; renderId?: string };
export type MediaPurpose = 'preview' | 'download';
export type ArchivedAsset = {
  id: string;
  source: 'source' | 'output';
  kind: 'image' | 'video';
  mime_type: string;
  file_size: number | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  available: boolean;
};
export type MediaGrant = Omit<ArchivedAsset, 'available'> & {
  tweet_id: string;
  purpose: MediaPurpose;
  signed_url: string;
  expires_at: string;
  filename: string;
  provenance: 'private_archive';
};
const MEDIA_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime']);
export const MEDIA_ACCESS_MESSAGES: Record<string, string> = {
  media_access_denied: 'An administrator account is required to preview or download archived media.',
  media_access_unavailable: 'Secure media access is unavailable. Retry the check; if it persists, ask an administrator to check private archive access.',
  media_post_not_archived: 'This post is not in the archive. Review it in Monitoring, or use Manual Intake after reviewing its processing costs.',
  media_not_found: 'This asset is no longer in the archive. Refresh the post to check current media availability.',
  media_expired: 'This asset or access link has expired. Request access again; an expired archive item must be processed again separately.',
  media_not_ready: 'This asset is still processing or has no completed output. Check its render status before requesting access again.',
  media_type_unsupported: 'This asset has an unsupported or unverified media format. Review its processing status; it will not be opened here.',
};
export function mediaAccessMessage(code?: string): string {
  return MEDIA_ACCESS_MESSAGES[code ?? ''] ?? MEDIA_ACCESS_MESSAGES.media_access_unavailable;
}
export function mediaAccessErrorMessage(error: unknown): string {
  return mediaAccessMessage(error instanceof AdminActionClientError && error.code === 'authorization_failed'
    ? 'media_access_denied' : 'media_access_unavailable');
}

/** Defense in depth: only a short-lived grant for this exact logical target reaches a browser sink. */
export function validateMediaGrant(
  value: unknown, target: MediaTarget, purpose: MediaPurpose,
  storageOrigin = import.meta.env.VITE_SUPABASE_URL, now = Date.now(),
): MediaGrant | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const grant = value as MediaGrant;
  const source = target.renderId ? 'output' : 'source';
  if (grant.id !== (target.renderId || target.mediaId) || grant.tweet_id !== target.tweetId
    || grant.source !== source || grant.purpose !== purpose || grant.provenance !== 'private_archive'
    || !MEDIA_MIMES.has(grant.mime_type) || grant.kind !== (grant.mime_type.startsWith('video/') ? 'video' : 'image')
    || !Number.isSafeInteger(grant.file_size) || !grant.file_size || grant.file_size < 0 || grant.file_size > 512 * 1024 * 1024
    || typeof grant.filename !== 'string' || grant.filename.length > 128 || !/^[a-zA-Z0-9._-]+$/.test(grant.filename)) return null;
  const expires = Date.parse(grant.expires_at);
  if (!Number.isFinite(expires) || expires <= now || expires > now + 125_000) return null;
  try {
    const expected = new URL(storageOrigin);
    const signed = new URL(grant.signed_url);
    const prefix = '/storage/v1/object/sign/temp-media/';
    // Canonical archive paths contain only the server's ASCII path alphabet.
    // Reject percent-encoded path construction instead of decoding a route.
    const path = signed.pathname;
    if (expected.protocol !== 'https:' || signed.origin !== expected.origin || signed.username || signed.password
      || !path.startsWith(prefix) || !/^[A-Za-z0-9/_.,-]+$/.test(path.slice(prefix.length))
      || path.slice(prefix.length).split('/').some((part) => !part || part === '.' || part === '..')
      || !signed.searchParams.get('token') || signed.hash
      || [...signed.searchParams.keys()].some((key) => !['token', 'download'].includes(key))
      || (purpose === 'download' && signed.searchParams.get('download') !== grant.filename)
      || (purpose === 'preview' && signed.searchParams.has('download'))) return null;
    return grant;
  } catch { return null; }
}

export async function requestMediaAccess(target: MediaTarget, purpose: MediaPurpose): Promise<{ asset?: MediaGrant; code?: string }> {
  const response = await invokeAdminRead<{ ok: boolean; asset?: unknown; code?: string }>({
    action: 'get_media_access', tweet_id: target.tweetId, purpose,
    ...(target.renderId ? { render_id: target.renderId } : { media_id: target.mediaId }),
  }, { throwOnFailure: false });
  if (!response?.ok) return { code: response?.code };
  const asset = validateMediaGrant(response.asset, target, purpose);
  return asset ? { asset } : { code: 'media_access_unavailable' };
}

export async function getMediaCatalog(tweetId: string): Promise<{ ok: boolean; code?: string; assets: ArchivedAsset[]; author_handle?: string }> {
  const response = await invokeAdminRead<{ ok: boolean; code?: string; tweet_id?: string; assets?: ArchivedAsset[]; author_handle?: string }>({
    action: 'get_media_catalog', tweet_id: tweetId,
  }, { throwOnFailure: false });
  if (response?.ok !== true) return { ok: false, code: response?.code, assets: [] };
  if (response.tweet_id !== tweetId || !Array.isArray(response.assets) || response.assets.length > 24
    || response.assets.some((asset) => !asset || typeof asset !== 'object'
      || typeof asset.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(asset.id)
      || !['source', 'output'].includes(asset.source) || !['image', 'video'].includes(asset.kind)
      || typeof asset.mime_type !== 'string' || typeof asset.available !== 'boolean')) {
    return { ok: false, code: 'media_access_unavailable', assets: [] };
  }
  return {
    ok: true, author_handle: typeof response.author_handle === 'string' ? response.author_handle : undefined,
    assets: response.assets.map((asset) => ({
      id: asset.id, source: asset.source, kind: asset.kind, mime_type: asset.mime_type,
      available: asset.available, file_size: asset.file_size, width: asset.width, height: asset.height, duration_ms: asset.duration_ms,
    })),
  };
}
