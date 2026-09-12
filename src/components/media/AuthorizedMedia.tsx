import { useEffect, useRef, useState } from 'react';
import { Download, Loader2, PlayCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { mediaAccessErrorMessage, mediaAccessMessage, requestMediaAccess, type MediaGrant, type MediaPurpose, type MediaTarget } from '@/api/mediaAccess';

/** The only dashboard playback/download sink. Its inputs are logical IDs, never media URLs. */
export function AuthorizedMedia({ tweetId, mediaId, renderId, title, readOnly = false }: MediaTarget & {
  title: string; readOnly?: boolean;
}) {
  const [grant, setGrant] = useState<MediaGrant | null>(null);
  const [pending, setPending] = useState<MediaPurpose | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    setGrant(null); setPending(null); setMessage(null);
    return () => { generation.current += 1; };
  }, [tweetId, mediaId, renderId, readOnly]);
  useEffect(() => {
    if (!grant) return;
    const timeout = setTimeout(() => {
      setGrant(null); setMessage(mediaAccessMessage('media_expired'));
    }, Math.max(0, Date.parse(grant.expires_at) - Date.now()));
    return () => clearTimeout(timeout);
  }, [grant]);

  async function request(purpose: MediaPurpose) {
    if (readOnly || pending) return;
    const current = ++generation.current;
    setPending(purpose); setMessage(null); setGrant(null);
    try {
      const response = await requestMediaAccess({ tweetId, mediaId, renderId }, purpose);
      if (current !== generation.current) return;
      if (response.asset) setGrant(response.asset);
      else setMessage(mediaAccessMessage(response.code));
    } catch (error) {
      if (current === generation.current) setMessage(mediaAccessErrorMessage(error));
    } finally {
      if (current === generation.current) setPending(null);
    }
  }

  const visibleGrant = !readOnly && grant && grant.tweet_id === tweetId && grant.id === (renderId || mediaId)
    && Date.parse(grant.expires_at) > Date.now() ? grant : null;

  return (
    <section aria-label={title} className="min-w-0 space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-medium">{title}</h4>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void request('preview')} disabled={readOnly || Boolean(pending)} aria-label={`Preview ${title.toLowerCase()}`}>
            {pending === 'preview' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : grant ? <RefreshCw className="mr-2 h-4 w-4" /> : <PlayCircle className="mr-2 h-4 w-4" />}
            {grant ? 'Refresh preview' : 'Preview'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void request('download')} disabled={readOnly || Boolean(pending)} aria-label={`Prepare download for ${title.toLowerCase()}`}>
            {pending === 'download' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Prepare download
          </Button>
        </div>
      </div>
      {readOnly ? <p role="note" className="text-sm text-muted-foreground">{mediaAccessMessage('media_access_denied')}</p>
        : <p className="text-xs text-muted-foreground">Private archive · access expires after two minutes · no processing or posting.</p>}
      {pending && <p role="status" className="text-sm text-muted-foreground">Checking authorized {pending} access…</p>}
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
      {visibleGrant?.purpose === 'preview' && (visibleGrant.kind === 'video'
        ? <video key={visibleGrant.signed_url} src={visibleGrant.signed_url} controls preload="metadata" aria-label={title} className="max-h-[60vh] w-full rounded-md bg-black object-contain" onError={() => { setGrant(null); setMessage('The archive could not play this asset. Try refreshing access or download it for review.'); }} />
        : <img src={visibleGrant.signed_url} alt={title} className="max-h-[60vh] w-full rounded-md object-contain" onError={() => { setGrant(null); setMessage('The archive could not display this asset. Try refreshing access or download it for review.'); }} />)}
      {visibleGrant?.purpose === 'download' && <a className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" href={visibleGrant.signed_url} download={visibleGrant.filename} rel="noreferrer">Download {title.toLowerCase()}</a>}
    </section>
  );
}
