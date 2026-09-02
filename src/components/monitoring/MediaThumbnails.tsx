import { Image as ImageIcon, Film } from "lucide-react";

export function MediaThumbnails() {
  return (
    <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3" role="status">
      <h4 className="font-medium mb-2 text-sm text-muted-foreground flex items-center gap-1">
        <ImageIcon className="w-3 h-3" />
        Media preview unavailable
      </h4>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Film className="h-4 w-4 shrink-0" />
        Authorised media access has not been configured. No remote media was loaded.
      </p>
    </div>
  );
}
