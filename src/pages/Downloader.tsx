import { useState, FormEvent } from "react";
import {
  Download,
  Loader2,
  AlertCircle,
  Video,
  Image as ImageIcon,
  ExternalLink,
  Twitter,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { invokeAdminAction } from "@/api/adminActions";

type MediaType = "video" | "gif" | "image";

type ResolvedMedia = {
  url: string;
  type: MediaType;
  thumbnail_url?: string;
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
  user_profile_image_url?: string;
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
    throw new Error(data?.error || "Failed to fetch tweet. The post might be private, deleted, or rate-limited.");
  }
  return data.tweet as TweetInfo;
}

export default function Downloader() {
  const { toast } = useToast();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tweetData, setTweetData] = useState<TweetInfo | null>(null);

  const handleFetch = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setTweetData(null);

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

  const handleDownload = async (media: ResolvedMedia, index: number) => {
    if (!tweetData) return;
    const ext = media.type === "image" ? "jpg" : "mp4";
    const resTag = media.resolution ? `_${media.resolution}` : "";
    const filename = `x_${tweetData.user_screen_name}_${tweetData.tweetID}_${index}${resTag}.${ext}`;

    try {
      const response = await fetch(media.url);
      if (!response.ok) throw new Error("Network response was not ok");
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.warn("Direct blob download failed (likely CORS). Falling back to new tab.", err);
      window.open(media.url, "_blank", "noopener,noreferrer");
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
              disabled={loading}
              required
              className="flex-1"
            />
            <Button type="submit" disabled={loading} className="sm:w-44">
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Download className="w-4 h-4 mr-2" />
              )}
              {loading ? "Fetching..." : "Extract Media"}
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
                {tweetData.user_profile_image_url ? (
                  <AvatarImage
                    src={tweetData.user_profile_image_url}
                    alt={tweetData.user_name}
                  />
                ) : null}
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
              className={`grid gap-4 ${
                mediaCount > 1 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"
              }`}
            >
              {tweetData.media.map((media, index) => {
                const isVideo = media.type === "video" || media.type === "gif";
                return (
                  <div
                    key={`${media.url}-${index}`}
                    className="rounded-xl border border-glass-border bg-card overflow-hidden flex flex-col"
                  >
                    <div className="relative bg-muted aspect-video">
                      {isVideo ? (
                        <video
                          src={media.url}
                          poster={media.thumbnail_url}
                          controls
                          className="w-full h-full object-contain bg-black"
                        />
                      ) : (
                        <img
                          src={media.url}
                          alt={`Media ${index + 1}`}
                          className="w-full h-full object-contain"
                          loading="lazy"
                        />
                      )}
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

                    <div className="p-3 flex flex-col sm:flex-row gap-2">
                      <Button
                        onClick={() => handleDownload(media, index)}
                        className="flex-1"
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Download File
                      </Button>
                      <Button variant="outline" asChild className="flex-1">
                        <a href={media.url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="w-4 h-4 mr-2" />
                          Open Direct Link
                        </a>
                      </Button>
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
