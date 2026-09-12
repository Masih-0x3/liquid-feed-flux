import { useEffect, useRef, useState } from 'react';
import { getMediaCatalog, mediaAccessErrorMessage, mediaAccessMessage, type ArchivedAsset } from '@/api/mediaAccess';
import { AuthorizedMedia } from '@/components/media/AuthorizedMedia';
import { Button } from '@/components/ui/button';

export function ArchivedMediaAssets({ tweetId, assets, readOnly = false }: { tweetId: string; assets: ArchivedAsset[]; readOnly?: boolean }) {
  if (!assets.length) return <p role="status" className="text-sm text-muted-foreground">No source media or render output is archived for this post. Check its processing status in Monitoring.</p>;
  return <div className="space-y-3">{assets.map((asset, index) => (
    <AuthorizedMedia key={`${asset.source}:${asset.id}`} tweetId={tweetId}
      mediaId={asset.source === 'source' ? asset.id : undefined} renderId={asset.source === 'output' ? asset.id : undefined}
      title={`${asset.source === 'source' ? 'Source' : 'Output'} ${asset.kind} ${index + 1}${asset.available ? '' : ' · availability check needed'}`} readOnly={readOnly} />
  ))}</div>;
}

export function ArchivedMediaList({ tweetId, readOnly = false }: { tweetId: string; readOnly?: boolean }) {
  const [assets, setAssets] = useState<ArchivedAsset[] | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1; setAssets(null); setMessage(null); setPending(false);
    return () => { generation.current += 1; };
  }, [tweetId, readOnly]);
  async function load() {
    if (readOnly || pending) return;
    const current = ++generation.current;
    setPending(true); setMessage(null);
    try {
      const response = await getMediaCatalog(tweetId);
      if (current !== generation.current) return;
      if (response.ok) setAssets(response.assets);
      else setMessage(mediaAccessMessage(response.code));
    } catch (error) { if (current === generation.current) setMessage(mediaAccessErrorMessage(error)); }
    finally { if (current === generation.current) setPending(false); }
  }
  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">{readOnly ? mediaAccessMessage('media_access_denied') : 'Review supported media from the private archive. Checking availability does not start processing or posting.'}</p>
    <Button variant="outline" size="sm" disabled={readOnly || pending} onClick={() => void load()}>{pending ? 'Checking archive…' : assets ? 'Refresh archive' : 'Find archived media'}</Button>
    {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    {assets && <ArchivedMediaAssets tweetId={tweetId} assets={assets} readOnly={readOnly} />}
  </div>;
}
