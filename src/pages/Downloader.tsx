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

type MediaItem = {
  url: string;
  type: "video" | "gif" | "image" | string;
  thumbnail_url?: string;
};

type TweetData = {
  user_name: string;
  user_screen_name: string;
  user_profile_image_url?: string;
  tweetID?: string;
  media_extended?: MediaItem[];
};

const TWEET_REGEX =
  /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)\/status\/([0-9]+)/;

export default function Downloader() {
  const { toast } = useToast();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tweetData, setTweetData] = useState<TweetData | null>(null);

  const extractTweetDetails = (input: string) => {
    const match = input.match(TWEET_REGEX);
    if (match && match.length === 3) {
      return { username: match[1], id: match[2] };
    }
    return null;
  };

  const handleFetch = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setTweetData(null);

    const details = extractTweetDetails(url.trim());
    if (!details) {
      setError("Please enter a valid X or Twitter status URL.");
      return;
    }

    setLoading(true);
    try {
      const apiUrl = `https://api.vxtwitter.com/${details.username}/status/${details.id}`;
      const response = await fetch(apiUrl);
      if (!response.ok) {
        throw new Error("Failed to fetch data. The post might be private or deleted.");
      }
      const data: TweetData = await response.json();
      if (!data.media_extended || data.media_extended.length === 0) {
        throw new Error("No media found in this post.");
      }
      setTweetData(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "An unexpected error occurred.";
      setError(msg);
      toast({ title: "Could not extract media", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (mediaUrl: string, type: string, index: number) => {
    if (!tweetData) return;
    const extension = type === "video" || type === "gif" ? "mp4" : "jpg";
    const filename = `x_media_${tweetData.user_screen_name}_${tweetData.tweetID || index}_${index}.${extension}`;

    try {
      const response = await fetch(mediaUrl);
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
      window.open(mediaUrl, "_blank", "noopener,noreferrer");
    }
  };

  const mediaCount = tweetData?.media_extended?.length ?? 0;

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
          Paste a link to an X post below to extract and download its attached videos or images.
        </p>
      </div>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg">Extract media</CardTitle>
          <CardDescription>
            Supports public posts from x.com and twitter.com.
          </CardDescription>
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

      {tweetData && tweetData.media_extended && (
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
              {tweetData.media_extended.map((media, index) => {
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
                      <Badge
                        variant="secondary"
                        className="absolute top-2 right-2 flex items-center gap-1"
                      >
                        {isVideo ? (
                          <Video className="w-3 h-3" />
                        ) : (
                          <ImageIcon className="w-3 h-3" />
                        )}
                        {media.type}
                      </Badge>
                    </div>

                    <div className="p-3 flex flex-col sm:flex-row gap-2">
                      <Button
                        onClick={() => handleDownload(media.url, media.type, index)}
                        className="flex-1"
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Download File
                      </Button>
                      <Button
                        variant="outline"
                        asChild
                        className="flex-1"
                      >
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
