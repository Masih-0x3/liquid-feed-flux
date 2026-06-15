import {
  hashUrl,
  rmPickBestVariant,
  rmUpgradeImageUrl,
} from "./workerUtils.ts";

type ResolvedMediaRow = {
  kind: "video" | "image" | "gif";
  url: string;
  width?: number;
  height?: number;
  duration_ms?: number;
};

type MediaUpsertRow = {
  tweet_id: string;
  kind: ResolvedMediaRow["kind"];
  src_url: string;
  src_url_hash: string;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  ordering: number;
  storage_path: null;
  downloaded_at: null;
  file_size: null;
  mime_type: null;
};

type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type FxTwitterVariant = {
  url: string;
  bitrate?: number;
  content_type?: string;
};

export async function rmFetchFromFx(
  handle: string,
  id: string,
  fetchImpl: FetchFn = fetch,
): Promise<ResolvedMediaRow[] | null> {
  try {
    const res = await fetchImpl(
      `https://api.fxtwitter.com/${handle}/status/${id}`,
    );
    if (!res.ok) return null;
    const json = await res.json() as Record<string, unknown>;
    const t = (json?.tweet ?? {}) as Record<string, unknown>;
    const media = (t.media ?? {}) as Record<string, unknown>;
    const out: ResolvedMediaRow[] = [];

    const videos =
      (media.videos as Array<Record<string, unknown>> | undefined) ?? [];
    for (const v of videos) {
      const variants = (v.variants as FxTwitterVariant[] | undefined) ?? [];
      let url = (v.url as string) || "";
      if (variants.length) {
        const best = rmPickBestVariant(variants);
        if (best?.url) url = best.url;
      }
      if (!url) continue;
      // fxtwitter returns `duration` in SECONDS (often fractional, e.g. 5.9).
      // Our media.duration_ms column is INTEGER; convert and round.
      const rawDur = v.duration as number | undefined;
      const durMs = typeof rawDur === "number" && isFinite(rawDur)
        ? Math.round(rawDur * 1000)
        : null;
      out.push({
        kind: (v.type as string) === "gif" ? "gif" : "video",
        url,
        width: v.width as number | undefined,
        height: v.height as number | undefined,
        duration_ms: durMs ?? undefined,
      });
    }

    const photos =
      (media.photos as Array<Record<string, unknown>> | undefined) ?? [];
    for (const p of photos) {
      const url = p.url as string | undefined;
      if (!url) continue;
      out.push({
        kind: "image",
        url: rmUpgradeImageUrl(url),
        width: p.width as number | undefined,
        height: p.height as number | undefined,
      });
    }
    return out.length ? out : null;
  } catch (e) {
    console.warn("resolve_media: fxtwitter failed", (e as Error).message);
    return null;
  }
}

export async function rmFetchFromVx(
  handle: string,
  id: string,
  fetchImpl: FetchFn = fetch,
): Promise<ResolvedMediaRow[] | null> {
  try {
    const res = await fetchImpl(
      `https://api.vxtwitter.com/${handle}/status/${id}`,
    );
    if (!res.ok) return null;
    const json = await res.json() as Record<string, unknown>;
    const extended =
      (json.media_extended as Array<Record<string, unknown>> | undefined) ?? [];
    const out: ResolvedMediaRow[] = [];
    for (const m of extended) {
      const type = String(m.type || "");
      const url = m.url as string | undefined;
      if (!url) continue;
      if (type === "video" || type === "gif") {
        out.push({
          kind: type === "gif" ? "gif" : "video",
          url,
          duration_ms: m.duration_millis as number | undefined,
        });
      } else if (type === "image") {
        out.push({ kind: "image", url: rmUpgradeImageUrl(url) });
      }
    }
    return out.length ? out : null;
  } catch (e) {
    console.warn("resolve_media: vxtwitter failed", (e as Error).message);
    return null;
  }
}

export async function buildResolvedMediaRows(
  tweetId: string,
  resolved: ResolvedMediaRow[],
): Promise<MediaUpsertRow[]> {
  return await Promise.all(resolved.map(async (media, index) => ({
    tweet_id: tweetId,
    kind: media.kind,
    src_url: media.url,
    src_url_hash: await hashUrl(media.url),
    width: media.width != null ? Math.round(media.width) : null,
    height: media.height != null ? Math.round(media.height) : null,
    duration_ms: media.duration_ms != null
      ? Math.round(media.duration_ms)
      : null,
    ordering: index,
    storage_path: null,
    downloaded_at: null,
    file_size: null,
    mime_type: null,
  })));
}

export function buildResolveMediaDownloadJob(
  tweetId: string,
  nowMs = Date.now(),
): Record<string, unknown> {
  return {
    type: "download_media",
    payload: { tweet_id: tweetId },
    status: "pending",
    idempotency_key: `download_media:resolve:${tweetId}:${nowMs}`,
    next_run_at: new Date(nowMs).toISOString(),
  };
}
