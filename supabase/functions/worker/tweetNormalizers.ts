export function formatMessageWithTemplate(
  post: Record<string, unknown>,
  account: Record<string, unknown> | null,
  messageTemplate: Record<string, unknown>,
): string {
  const placeholders: Record<string, string> = {
    "{translated_text}": String(
      post.text_translated || post.text_original || "",
    ),
    "{original_text}": String(post.text_original || ""),
    "{author_handle}": String(account?.handle || ""),
    "{author_name}": String(account?.display_name || ""),
    "{source_link}": messageTemplate.include_source_link && post.url
      ? `[${messageTemplate.source_link_text || "View original"}](${post.url})`
      : "",
    "{published_date}": post.tweeted_at
      ? new Date(post.tweeted_at as string).toLocaleDateString("fa-IR")
      : "",
    "{published_time}": post.tweeted_at
      ? new Date(post.tweeted_at as string).toLocaleTimeString("fa-IR", {
        hour: "2-digit",
        minute: "2-digit",
      })
      : "",
    "{hashtags}": String(messageTemplate.custom_hashtags || ""),
    "{media_info}": post.has_media ? "📸 تصویر" : "",
  };

  return Object.entries(placeholders).reduce((template, [key, value]) => {
    return template.replace(
      new RegExp(key.replace(/[{}]/g, "\\$&"), "g"),
      value,
    );
  }, String(messageTemplate.template || "{translated_text}"));
}

export function stripMarkdownToPlain(text: string): string {
  if (!text) return text;
  return text.replace(/[\\*_`\[\]()~>#+=|{}.!-]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Extract numeric tweet id from RSS guid/url. Twitter tweet IDs are 18-19 digit numbers.
export function extractNumericTweetId(
  rawTweetId: string,
  url?: string | null,
): string | null {
  const candidates: string[] = [rawTweetId];
  if (url) candidates.push(url);
  for (const candidate of candidates) {
    if (!candidate) continue;
    const statusMatch = candidate.match(/status\/(\d{5,25})/);
    if (statusMatch) return statusMatch[1];
    const rawIdMatch = candidate.match(/(?:^|[^0-9])(\d{15,25})(?:$|[^0-9])/);
    if (rawIdMatch) return rawIdMatch[1];
  }
  return null;
}

export function extractHandleFromUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (
      !/(^|\.)twitter\.com$/i.test(parsed.hostname) &&
      !/(^|\.)x\.com$/i.test(parsed.hostname)
    ) {
      return null;
    }
    const [handle, nextSegment] = parsed.pathname.split("/").filter(Boolean);
    if (!handle || !/^[A-Za-z0-9_]+$/.test(handle)) return null;
    if (!nextSegment) {
      const reservedPaths = new Set([
        "compose",
        "explore",
        "home",
        "messages",
        "notifications",
        "search",
        "settings",
      ]);
      return reservedPaths.has(handle.toLowerCase()) ? null : handle;
    }
    if (nextSegment.toLowerCase() === "status") return handle;
  } catch {
    // Invalid URLs do not provide a usable handle.
  }
  return null;
}
