import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Download, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/contexts/AuthContext';
import { getMediaCatalog, mediaAccessErrorMessage, mediaAccessMessage, type ArchivedAsset } from '@/api/mediaAccess';
import { ArchivedMediaAssets } from '@/components/media/ArchivedMediaList';

const TWEET_REGEX = /^https?:\/\/(?:www\.)?(?:twitter\.com|x\.com|fxtwitter\.com|vxtwitter\.com)\/[a-zA-Z0-9_]+\/status\/([0-9]{1,30})(?:[/?#].*)?$/i;

export default function Downloader() {
  const { role } = useAuth();
  const readOnly = role !== 'admin';
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [result, setResult] = useState<{ tweetId: string; assets: ArchivedAsset[]; author?: string } | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1; setResult(null); setLoading(false);
    return () => { generation.current += 1; };
  }, [role]);

  async function handleFetch(event: FormEvent) {
    event.preventDefault(); setError(null); setInvalid(false); setResult(null);
    if (readOnly) { setError(mediaAccessMessage('media_access_denied')); return; }
    const match = url.trim().match(TWEET_REGEX);
    if (!match) { setInvalid(true); setError('Enter a valid X or Twitter status URL, including its post ID.'); return; }
    const current = ++generation.current;
    setLoading(true);
    try {
      const response = await getMediaCatalog(match[1]);
      if (current !== generation.current) return;
      if (response.ok) setResult({ tweetId: match[1], assets: response.assets, author: response.author_handle });
      else setError(mediaAccessMessage(response.code));
    } catch (error) { if (current === generation.current) setError(mediaAccessErrorMessage(error)); }
    finally { if (current === generation.current) setLoading(false); }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 py-2 sm:py-4">
      <div className="space-y-2">
        <h1 className="flex items-center gap-3 text-2xl font-semibold sm:text-3xl"><Download className="h-6 w-6 shrink-0 text-primary" />Media downloader</h1>
        <p className="text-muted-foreground">Preview and download supported images and videos already stored in the private archive.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Find archived media</CardTitle>
          <CardDescription>This lookup is read-only and does not call X, start a render or publish a post. New or expired assets must be processed separately.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {readOnly && <p role="note" className="text-sm text-muted-foreground">{mediaAccessMessage('media_access_denied')}</p>}
          <form onSubmit={handleFetch} noValidate className="space-y-2">
            <Label htmlFor="downloader-post-url">X or Twitter post URL</Label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input id="downloader-post-url" type="url" inputMode="url" placeholder="https://x.com/username/status/1234567890" value={url}
                onChange={(event) => { setUrl(event.target.value); setInvalid(false); setError(null); }}
                disabled={loading || readOnly} required aria-invalid={invalid} aria-describedby={error ? 'downloader-help downloader-error' : 'downloader-help'} className="min-w-0 flex-1" />
              <Button type="submit" disabled={loading || readOnly} className="shrink-0">
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{readOnly ? 'Unavailable' : loading ? 'Checking archive…' : 'Find media'}
              </Button>
            </div>
            <p id="downloader-help" className="text-xs text-muted-foreground">Supports archived JPEG, PNG, WebP, GIF, MP4, WebM and MOV assets. Access is checked for each preview or download.</p>
          </form>
          {error && <Alert variant="destructive"><AlertDescription id="downloader-error">{error}</AlertDescription></Alert>}
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            <Link className="text-primary underline underline-offset-4" to="/monitoring">Review post status</Link>
            <Link className="text-primary underline underline-offset-4" to="/video-renders">Open Video and Manual Intake</Link>
          </div>
        </CardContent>
      </Card>
      {result && <Card>
        <CardHeader><CardTitle className="break-words text-lg">{result.author ? `@${result.author}` : 'Archived post'}</CardTitle><CardDescription>Post {result.tweetId}</CardDescription></CardHeader>
        <CardContent><ArchivedMediaAssets tweetId={result.tweetId} assets={result.assets} readOnly={readOnly} /></CardContent>
      </Card>}
    </div>
  );
}
