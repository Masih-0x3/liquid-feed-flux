import { MAX_RSS_WEBHOOK_MEDIA_CANDIDATES_PER_ITEM } from "./rssWebhookPayloadPolicy.ts";

/** Bound parser work separately from output candidates: malformed tags count too. */
export const MAX_RSS_WEBHOOK_HTML_TAG_ATTEMPTS_PER_ITEM = 128;
export const MAX_RSS_WEBHOOK_HTML_TAG_CHARACTERS = 4_096;
export const MAX_RSS_WEBHOOK_ENTITY_CHARACTERS = 256;
export const MAX_RSS_WEBHOOK_MEDIA_URL_CHARACTERS = 8 * 1024;

export type RssParsedMedia = {
  type: string;
  url: string;
  width?: number;
  height?: number;
  duration?: number;
};

type ParsedHtmlTag = {
  name: string;
  src: string | null;
  type: string | null;
};

function isWhitespace(char: string): boolean {
  return char === " " || char === "\n" || char === "\r" || char === "\t" || char === "\f";
}

function isIdentifierCharacter(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    char === ":" ||
    char === "_" ||
    char === "-"
  );
}

function isAsciiLetter(char: string): boolean {
  const code = char.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isRssTagOpeningCharacter(char: string): boolean {
  return isAsciiLetter(char) || char === "/" || char === "!" || char === "?";
}

function isRssEntityCharacter(char: string): boolean {
  const code = char.charCodeAt(0);
  return isAsciiLetter(char) || (code >= 48 && code <= 57) || char === "#";
}

function boundedRssUrl(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_RSS_WEBHOOK_MEDIA_URL_CHARACTERS
    ? value
    : null;
}

function asRssRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asRssNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Linear-time text normalisation. When `stripMarkup` is true, malformed tags
 * and entities are consumed by a state machine instead of repeated greedy
 * regular expressions that can rescan adversarial unterminated markup.
 */
export function normalizeRssWebhookText(value: string, stripMarkup = false): string {
  const output: string[] = [];
  let lastWasSpace = true;
  let mode: "text" | "tag" | "entity" = "text";
  let tagCandidate: string[] = [];
  let entityCandidate: string[] = [];

  const appendTextChar = (char: string) => {
    if (isWhitespace(char)) {
      if (!lastWasSpace) {
        output.push(" ");
        lastWasSpace = true;
      }
      return;
    }
    output.push(char);
    lastWasSpace = false;
  };
  const flushLiteral = (candidate: string[]) => {
    for (const char of candidate) appendTextChar(char);
  };

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (mode === "tag") {
      if (tagCandidate.length === 1 && !isRssTagOpeningCharacter(char)) {
        // `<3`, mathematical comparisons, and other literal text are not
        // markup. Flush the literal opener and reconsider this character.
        flushLiteral(tagCandidate);
        tagCandidate = [];
        mode = "text";
        index -= 1;
        continue;
      }
      tagCandidate.push(char);
      if (char === ">") {
        // This matches the historical tag replacement behavior: a bounded
        // closed <...> sequence is removed without introducing a separator.
        tagCandidate = [];
        mode = "text";
      } else if (tagCandidate.length > MAX_RSS_WEBHOOK_HTML_TAG_CHARACTERS) {
        // An unclosed or excessive candidate is ordinary text, not markup.
        flushLiteral(tagCandidate);
        tagCandidate = [];
        mode = "text";
      }
      continue;
    }
    if (mode === "entity") {
      if (!isRssEntityCharacter(char) && char !== ";") {
        // A real HTML entity has no whitespace, query punctuation, nested
        // ampersand, or tag opener before its terminating semicolon.
        flushLiteral(entityCandidate);
        entityCandidate = [];
        mode = "text";
        index -= 1;
        continue;
      }
      if (entityCandidate.length === 1 && !isRssEntityCharacter(char)) {
        // Preserve `&;` and other non-entity punctuation literally.
        flushLiteral(entityCandidate);
        entityCandidate = [];
        mode = "text";
        index -= 1;
        continue;
      }
      entityCandidate.push(char);
      if (char === ";" && entityCandidate.length > 2) {
        // The old semicolon-terminated entity replacement used one space.
        appendTextChar(" ");
        entityCandidate = [];
        mode = "text";
      } else if (entityCandidate.length > MAX_RSS_WEBHOOK_ENTITY_CHARACTERS) {
        // Preserve a non-entity ampersand rather than swallowing RSS text,
        // query strings, or identifiers that merely contain `&`.
        flushLiteral(entityCandidate);
        entityCandidate = [];
        mode = "text";
      }
      continue;
    }
    if (stripMarkup && char === "<") {
      tagCandidate = [char];
      mode = "tag";
      continue;
    }
    if (stripMarkup && char === "&") {
      entityCandidate = [char];
      mode = "entity";
      continue;
    }
    appendTextChar(char);
  }

  if (mode === "tag") flushLiteral(tagCandidate);
  if (mode === "entity") flushLiteral(entityCandidate);
  return output.join("").trim();
}

function parseBoundedHtmlTag(rawTag: string): ParsedHtmlTag | null {
  let index = 0;
  while (index < rawTag.length && isWhitespace(rawTag[index])) index += 1;
  if (rawTag[index] === "/" || rawTag[index] === "!" || rawTag[index] === "?") return null;

  const nameStart = index;
  while (index < rawTag.length && isIdentifierCharacter(rawTag[index])) index += 1;
  if (index === nameStart) return null;
  const name = rawTag.slice(nameStart, index).toLowerCase();
  let src: string | null = null;
  let type: string | null = null;

  while (index < rawTag.length) {
    while (index < rawTag.length && (isWhitespace(rawTag[index]) || rawTag[index] === "/")) index += 1;
    const attributeStart = index;
    while (index < rawTag.length && isIdentifierCharacter(rawTag[index])) index += 1;
    if (index === attributeStart) {
      index += 1;
      continue;
    }
    const attributeName = rawTag.slice(attributeStart, index).toLowerCase();
    while (index < rawTag.length && isWhitespace(rawTag[index])) index += 1;
    if (rawTag[index] !== "=") continue;
    index += 1;
    while (index < rawTag.length && isWhitespace(rawTag[index])) index += 1;

    const quote = rawTag[index] === "\"" || rawTag[index] === "'" ? rawTag[index++] : null;
    const valueStart = index;
    while (index < rawTag.length) {
      const char = rawTag[index];
      if (quote ? char === quote : isWhitespace(char)) break;
      index += 1;
    }
    const attributeValue = rawTag.slice(valueStart, index);
    if (quote && rawTag[index] === quote) index += 1;

    if (attributeName === "src") src = boundedRssUrl(attributeValue);
    if (attributeName === "type" && attributeValue.length <= MAX_RSS_WEBHOOK_MEDIA_URL_CHARACTERS) type = attributeValue;
  }

  return { name, src, type };
}

function forEachBoundedRssHtmlTag(
  html: string,
  visit: (tag: ParsedHtmlTag) => boolean,
): void {
  let tagStart = -1;
  let tagLength = 0;
  let quote: string | null = null;
  let tagAttempts = 0;

  for (let index = 0; index < html.length; index += 1) {
    const char = html[index];
    if (tagStart < 0) {
      if (char !== "<") continue;
      if (tagAttempts >= MAX_RSS_WEBHOOK_HTML_TAG_ATTEMPTS_PER_ITEM) return;
      tagAttempts += 1;
      tagStart = index;
      tagLength = 0;
      quote = null;
      continue;
    }

    tagLength += 1;
    if (tagLength > MAX_RSS_WEBHOOK_HTML_TAG_CHARACTERS) {
      tagStart = -1;
      quote = null;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "<") {
      if (tagAttempts >= MAX_RSS_WEBHOOK_HTML_TAG_ATTEMPTS_PER_ITEM) return;
      tagAttempts += 1;
      tagStart = index;
      tagLength = 0;
      continue;
    }
    if (char !== ">") continue;

    const parsed = parseBoundedHtmlTag(html.slice(tagStart + 1, index));
    tagStart = -1;
    if (parsed && !visit(parsed)) return;
  }
}

function isImageUrl(url: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|svg|bmp|tiff)(\?|$)/i.test(url) ||
    url.includes("pbs.twimg.com/media") ||
    url.includes("pic.twitter.com");
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|avi|mov|wmv|flv|webm|mkv|m4v)(\?|$)/i.test(url);
}

function isAudioUrl(url: string): boolean {
  return /\.(mp3|wav|ogg|aac|flac|m4a|wma)(\?|$)/i.test(url);
}

function getMediaType(mimeType: string, url: string): string | null {
  const normalizedMimeType = mimeType.toLowerCase();
  if (normalizedMimeType.startsWith("image/") || isImageUrl(url)) return "image";
  if (normalizedMimeType.startsWith("video/") || isVideoUrl(url)) return "video";
  if (normalizedMimeType.startsWith("audio/") || isAudioUrl(url)) return "audio";
  return null;
}

function inspectRssMediaCandidate(
  mediaItems: RssParsedMedia[],
  inspected: { count: number },
  candidate: RssParsedMedia | null,
  unique = false,
): boolean {
  // The cap is intentionally checked and consumed before URL/type validation.
  // Invalid/malformed candidates are adversarial parser work too.
  if (inspected.count >= MAX_RSS_WEBHOOK_MEDIA_CANDIDATES_PER_ITEM) return false;
  inspected.count += 1;
  if (!candidate) return true;
  if (unique && mediaItems.some((media) => media.url === candidate.url)) return true;
  mediaItems.push(candidate);
  return true;
}

function mediaFromUrl(type: string | null, url: string | null, extra: Omit<RssParsedMedia, "type" | "url"> = {}): RssParsedMedia | null {
  if (!url) return null;
  const mediaType = type ?? getMediaType("", url);
  return mediaType ? { type: mediaType, url, ...extra } : null;
}

function firstRssText(item: Record<string, unknown>): string | null {
  for (const value of [item.description_html, item.description, item.content]) {
    if (typeof value === "string") return value;
  }
  return null;
}

function collectBoundedDirectRssMedia(
  input: string,
  mediaItems: RssParsedMedia[],
  inspected: { count: number },
  unique = false,
): void {
  const lower = input.toLowerCase();
  let searchAt = 0;
  while (searchAt < lower.length) {
    const httpsIndex = lower.indexOf("https://pbs.twimg.com/", searchAt);
    const httpIndex = lower.indexOf("http://pbs.twimg.com/", searchAt);
    const start = httpsIndex < 0 ? httpIndex : httpIndex < 0 ? httpsIndex : Math.min(httpsIndex, httpIndex);
    if (start < 0) return;

    let end = start;
    while (end < input.length && !isWhitespace(input[end]) && !["\"", "'", "<", ">"].includes(input[end])) end += 1;
    const url = boundedRssUrl(input.slice(start, end));
    if (!inspectRssMediaCandidate(mediaItems, inspected, mediaFromUrl(null, url), unique)) return;
    searchAt = Math.max(end, start + 1);
  }
}

/**
 * Parses a bounded RSS item without regexes that repeatedly rescan malformed
 * markup. It caps both inspected inputs and emitted media candidates.
 */
export function parseBoundedRssItemMedia(item: Record<string, unknown>, text?: string): RssParsedMedia[] {
  const mediaItems: RssParsedMedia[] = [];
  const inspected = { count: 0 };

  try {
    if (text) collectBoundedDirectRssMedia(text, mediaItems, inspected);

    if (item.thumbnail !== undefined) {
      const thumbnail = boundedRssUrl(item.thumbnail);
      if (!inspectRssMediaCandidate(
        mediaItems,
        inspected,
        thumbnail ? { type: "image", url: thumbnail } : null,
      )) return mediaItems;
    }

    const enclosureValue = item.enclosure;
    const enclosures = enclosureValue === undefined
      ? []
      : Array.isArray(enclosureValue) ? enclosureValue : [enclosureValue];
    for (const rawEnclosure of enclosures) {
      const enclosure = asRssRecord(rawEnclosure);
      const url = enclosure ? boundedRssUrl(enclosure.url) : null;
      const type = enclosure && typeof enclosure.type === "string" ? enclosure.type : "";
      const candidate = mediaFromUrl(getMediaType(type, url ?? ""), url, {
        width: enclosure ? asRssNumber(enclosure.width) : undefined,
        height: enclosure ? asRssNumber(enclosure.height) : undefined,
        duration: enclosure ? asRssNumber(enclosure.length) : undefined,
      });
      if (!inspectRssMediaCandidate(mediaItems, inspected, candidate)) return mediaItems;
    }

    const mediaContentValue = item["media:content"];
    const mediaContent = mediaContentValue === undefined
      ? []
      : Array.isArray(mediaContentValue) ? mediaContentValue : [mediaContentValue];
    for (const rawMedia of mediaContent) {
      const media = asRssRecord(rawMedia);
      const url = media ? boundedRssUrl(media.url) : null;
      const type = media && typeof media.type === "string" ? media.type : "";
      const candidate = mediaFromUrl(getMediaType(type, url ?? ""), url, {
        width: media ? asRssNumber(media.width) : undefined,
        height: media ? asRssNumber(media.height) : undefined,
        duration: media ? asRssNumber(media.duration) : undefined,
      });
      if (!inspectRssMediaCandidate(mediaItems, inspected, candidate)) return mediaItems;
    }

    const htmlContent = firstRssText(item);
    if (htmlContent) {
      forEachBoundedRssHtmlTag(htmlContent, (tag) => {
        if (tag.name === "img") {
          return inspectRssMediaCandidate(
            mediaItems,
            inspected,
            tag.src && isImageUrl(tag.src) ? { type: "image", url: tag.src } : null,
            true,
          );
        }
        if (tag.name === "video") {
          return inspectRssMediaCandidate(
            mediaItems,
            inspected,
            tag.src && isVideoUrl(tag.src) ? { type: "video", url: tag.src } : null,
            true,
          );
        }
        if (tag.name === "audio") {
          return inspectRssMediaCandidate(
            mediaItems,
            inspected,
            tag.src && isAudioUrl(tag.src) ? { type: "audio", url: tag.src } : null,
            true,
          );
        }
        if (tag.name === "source") {
          const type = getMediaType(tag.type ?? "", tag.src ?? "");
          return inspectRssMediaCandidate(
            mediaItems,
            inspected,
            type && tag.src ? { type, url: tag.src } : null,
            true,
          );
        }
        return true;
      });
      collectBoundedDirectRssMedia(htmlContent, mediaItems, inspected, true);
    }
  } catch {
    // A malformed item is rejected from media extraction without logging its
    // content, URL, or parser exception.
  }

  return mediaItems;
}
