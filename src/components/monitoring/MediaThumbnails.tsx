import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Image as ImageIcon, Film } from "lucide-react";

interface MediaRow {
  id: string;
  kind: string | null;
  mime_type: string | null;
  storage_path: string | null;
  src_url: string | null;
  ordering: number | null;
}

interface ResolvedMedia extends MediaRow {
  display_url: string | null;
  is_video: boolean;
}

const BUCKET = "temp-media";
const SIGN_TTL = 60 * 60; // 1 hour

export function MediaThumbnails({ tweetId }: { tweetId: string }) {
  const [items, setItems] = useState<ResolvedMedia[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("media")
        .select("id, kind, mime_type, storage_path, src_url, ordering")
        .eq("tweet_id", tweetId)
        .order("ordering", { ascending: true });
      if (error || !data || data.length === 0) {
        if (!cancelled) setItems([]);
        return;
      }
      const paths = data.map(m => m.storage_path).filter(Boolean) as string[];
      const signedMap: Record<string, string> = {};
      if (paths.length > 0) {
        const { data: signed } = await supabase.storage
          .from(BUCKET)
          .createSignedUrls(paths, SIGN_TTL);
        signed?.forEach((s) => {
          if (s.path && s.signedUrl) signedMap[s.path] = s.signedUrl;
        });
      }
      const resolved: ResolvedMedia[] = data.map((m) => {
        const signedUrl = m.storage_path ? signedMap[m.storage_path] : null;
        const display_url = signedUrl || m.src_url || null;
        const is_video = (m.kind === "video") || (m.mime_type?.startsWith("video/") ?? false);
        return { ...m, display_url, is_video };
      });
      if (!cancelled) setItems(resolved);
    })();
    return () => { cancelled = true; };
  }, [tweetId]);

  if (items === null || items.length === 0) return null;

  return (
    <div className="mb-4">
      <h4 className="font-medium mb-2 text-sm text-muted-foreground flex items-center gap-1">
        <ImageIcon className="w-3 h-3" />
        Media ({items.length})
      </h4>
      <div className="flex flex-wrap gap-2">
        {items.map((m) => (
          <a
            key={m.id}
            href={m.display_url ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="relative block w-20 h-20 rounded border border-border overflow-hidden bg-muted hover:ring-2 hover:ring-primary transition"
            title={m.is_video ? "Video (thumbnail)" : "Image"}
          >
            {m.display_url ? (
              <img
                src={m.display_url}
                alt={m.is_video ? "Video thumbnail" : "Tweet media"}
                loading="lazy"
                className="w-full h-full object-cover"
                onError={(e) => {
                  // Fallback to src_url if signed URL failed
                  const img = e.currentTarget;
                  if (m.src_url && img.src !== m.src_url) img.src = m.src_url;
                }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                <ImageIcon className="w-5 h-5" />
              </div>
            )}
            {m.is_video && (
              <div className="absolute bottom-1 right-1 bg-background/80 rounded p-0.5">
                <Film className="w-3 h-3" />
              </div>
            )}
          </a>
        ))}
      </div>
    </div>
  );
}
