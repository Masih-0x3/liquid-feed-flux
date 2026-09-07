/**
 * X's per-tweet character limit. Every tweet emitted by `buildThreadTweets` is
 * guaranteed to be at most `TWEET_MAX` characters so the canonical
 * `digests.formatted_tweets` thread stays postable on X. This matches the
 * invariant enforced elsewhere for X text: `enforceRtlXPostText` hard-truncates
 * to `max_chars: 280` and `xApiActions` rejects `text.length > 280`.
 */
export const TWEET_MAX = 280;

/**
 * Soft split trigger. The running tweet buffer is flushed *before* appending a
 * line that would push it past this length, so multiple short bullets pack into
 * one tweet while leaving headroom for the next line plus its trailing newline.
 * Kept below `TWEET_MAX` so the hard cap does not have to fire for normal output.
 */
export const TWEET_SOFT_TRIGGER = 270;

/**
 * Maximum length accepted for `digest_config.header_format` from settings or a
 * dry-run override. The format string is at most one tweet's worth of header
 * text, so a config override alone can never produce a header-only first tweet
 * over `TWEET_MAX`. The `{time}` placeholder (6 chars) expands to `HH:MM`
 * (5 chars), so an expanded header stays one char below this cap when
 * `{time}` is present and is at the cap otherwise.
 */
export const HEADER_FORMAT_MAX = 280;

/**
 * Clamp a `header_format` string from a settings row or dry-run override so a
 * long override alone cannot produce a first tweet over `TWEET_MAX`. Returns
 * the truncated value, or `undefined` if the input is not a string (so the
 * caller can omit the field and keep the default, exactly like `readString`).
 */
export function clampHeaderFormat(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value.length <= HEADER_FORMAT_MAX) return value;
  const truncated = value.slice(0, HEADER_FORMAT_MAX);
  return /[\uD800-\uDBFF]$/.test(truncated) ? truncated.slice(0, -1) : truncated;
}

/**
 * Split an LLM-generated digest summary into a thread of tweets, each at most
 * `TWEET_MAX` characters. The first tweet is prefixed with `header` followed by
 * a blank line. Short bullets are packed several-per-tweet using
 * `TWEET_SOFT_TRIGGER`; a single bullet longer than the remaining budget is
 * split across tweet-sized chunks so no tweet is over the limit and no summary
 * content is dropped. The function is pure (no I/O, no side effects) so it can
 * be unit-tested without the Edge Function's top-level `serve()` handler.
 */
export function buildThreadTweets(summary: string, header: string): string[] {
  const lines = summary.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const tweets: string[] = [];
  let current = `${header}\n\n`;

  const flush = (): void => {
    const trimmed = current.trim();
    current = "";
    if (!trimmed) return;
    // Hard cap: if a single line (or an unclamped long header) left the buffer
    // longer than TWEET_MAX, split it into tweet-sized chunks so every emitted
    // tweet honors the X limit without dropping content.
    for (let i = 0; i < trimmed.length; i += TWEET_MAX) {
      tweets.push(trimmed.slice(i, i + TWEET_MAX));
    }
  };

  for (const line of lines) {
    if ((current + line + "\n").length > TWEET_SOFT_TRIGGER) {
      flush();
    }
    current += `${line}\n`;
    if (current.length > TWEET_MAX) {
      flush();
    }
  }

  flush();
  return tweets;
}
