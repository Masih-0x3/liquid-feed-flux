import { useState, FormEvent } from "react";
import {
  Download,
  Loader2,
  AlertCircle,
  Video,
  Image as ImageIcon,
  Twitter,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { invokeAdminAction } from "@/api/adminActions";
import { useAuth } from "@/contexts/AuthContext";

type MediaType = "video" | "gif" | "image";

type ResolvedMedia = {
  type: MediaType;
  /** e.g. "1280x720" */
  resolution?: string;
  /** kbps for videos, useful in filename */
  bitrate?: number;
  /** human label e.g. "orig", "720p @ 2.5Mbps" */
  qualityLabel?: string;
};

type TweetInfo = {
  user_name: string;
  user_screen_name: string;
  tweetID: string;
  media: ResolvedMedia[];
};

const TWEET_REGEX =
  /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com|fxtwitter\.com|vxtwitter\.com)\/([a-zA-Z0-9_]+)\/status\/([0-9]+)/;

async function fetchTweet(username: string, id: string): Promise<TweetInfo> {
  const data = await invokeAdminAction<{ success?: boolean; tweet?: TweetInfo; error?: string }>(
    { action: "resolve_x_media", username, tweet_id: id },
    { throwOnFailure: false },
  );
  if (!data?.success || !data?.tweet) {
    throw new Error("Media metadata could not be resolved. The post may be private, deleted, or unavailable.");
  }
  return data.tweet as TweetInfo;
}

export default function Downloader() {
  const { role } = useAuth();
  const readOnly = role === "read_only";
  const { toast } = useToast();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tweetData, setTweetData] = useState<TweetInfo | null>(null);

  const handleFetch = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setTweetData(null);

    if (readOnly) {
      setError("Media metadata lookup is unavailable for read-only access.");
      return;
    }

    const match = url.trim().match(TWEET_REGEX);
    if (!match) {
      setError("Please enter a valid X or Twitter status URL.");
      return;
    }

    setLoading(true);
    try {
      const data = await fetchTweet(match[1], match[2]);
      setTweetData(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "An unexpected error occurred.";
      setError(msg);
      toast({ title: "Could not extract media", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const mediaCount = tweetData?.media?.length ?? 0;

  return (
    <div className="container mx-auto p-6 max-w-4xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-display font-semibold flex items-center gap-3">
          <span className="w-10 h-10 rounded-lg bg-gradient-primary flex items-center justify-center">
            <Download className="w-5 h-5 text-primary-foreground" />
          </span>
          X Media Downloader
        </h1>
        <p className="text-muted-foreground">
          Paste a link to an X post to extract its media at the highest available quality
          (original images, max-bitrate video variants).
        </p>
        {readOnly && (
          <p role="note" className="text-xs text-muted-foreground">
            Read-only access: media metadata lookup is unavailable for this role. No external media URL is opened here.
          </p>
        )}
      </div>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg">Extract media</CardTitle>
          <CardDescription>Supports public posts from x.com and twitter.com.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleFetch} className="flex flex-col sm:flex-row gap-3">
            <Input
              type="url"
              placeholder="https://x.com/username/status/1234567890"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={loading || readOnly}
              required
              className="flex-1"
            />
            <Button type="submit" disabled={loading || readOnly} className="sm:w-44">
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Download className="w-4 h-4 mr-2" />
              )}
              {readOnly ? "Unavailable" : loading ? "Fetching..." : "Extract Media"}
            </Button>
          </form>

          {error && (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {tweetData && (
        <Card className="glass-card">
          <CardHeader>
            <div className="flex items-center gap-3">
              <Avatar>
                <AvatarFallback>
                  <Twitter className="w-4 h-4" />
                </AvatarFallback>
              </Avatar>
              <div>
                <CardTitle className="text-base">{tweetData.user_name}</CardTitle>
                <CardDescription>@{tweetData.user_screen_name}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div
              role="status"
              className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-muted-foreground"
            >
              Preview and download are temporarily unavailable until authorised media access is implemented. No remote media URL was opened.
            </div>
            <div
              className={`grid gap-4 ${
                mediaCount > 1 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"
              }`}
            >
              {tweetData.media.map((media, index) => {
                const isVideo = media.type === "video" || media.type === "gif";
                return (
                  <div
                    key={`media-${index}`}
                    className="rounded-xl border border-glass-border bg-card overflow-hidden flex flex-col"
                  >
                    <div className="relative flex aspect-video items-center justify-center bg-muted p-4">
                      <div className="flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
                        {isVideo ? <Video className="h-6 w-6" /> : <ImageIcon className="h-6 w-6" />}
                        <span>Authorised preview unavailable</span>
                      </div>
                      <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
                        <Badge variant="secondary" className="flex items-center gap-1">
                          {isVideo ? (
                            <Video className="w-3 h-3" />
                          ) : (
                            <ImageIcon className="w-3 h-3" />
                          )}
                          {media.type}
                        </Badge>
                        {(media.resolution || media.qualityLabel) && (
                          <Badge variant="outline" className="bg-background/70 backdrop-blur">
                            {media.resolution ?? media.qualityLabel}
                            {media.resolution && media.qualityLabel
                              ? ` · ${media.qualityLabel}`
                              : ""}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
