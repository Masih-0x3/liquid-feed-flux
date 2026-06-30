export interface XPostTextConfig {
  post_template: string;
  leading_emoji: string;
  max_chars: number;
}

export interface XPostTextPost {
  text_translated?: string | null;
  author_handle?: string | null;
  final_x_text?: string | null;
  composed_post_text?: string | null;
  humanized_commentary?: string | null;
  commentary_hook?: string | null;
  commentary_question?: string | null;
  narrative_callback?: string | null;
  enrich_status?: string | null;
  accounts?: { handle?: string } | null;
}

export const RLM = "\u200F";
export const RLI = "\u2067";
export const PDI = "\u2069";

const OUTER_BIDI_CONTROLS =
  /^[\u200E\u200F\u202A-\u202E\u2066-\u2069]+|[\u200E\u200F\u202A-\u202E\u2066-\u2069]+$/g;

export function safeTruncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  let end = maxLen;
  if (
    end > 0 && str.charCodeAt(end - 1) >= 0xD800 &&
    str.charCodeAt(end - 1) <= 0xDBFF
  ) end--;
  return str.slice(0, end);
}

function stripOuterBidiControls(str: string): string {
  return str.replace(OUTER_BIDI_CONTROLS, "");
}

function markRtlLines(str: string): string {
  return str.split("\n").map((line) => {
    if (!line || line.startsWith(RLM)) return line;
    return `${RLM}${line}`;
  }).join("\n");
}

export function enforceRtlXPostText(
  str: string,
  maxLen: number,
  appendEllipsis = false,
): string {
  const max = Math.max(0, maxLen);
  if (max <= RLI.length + PDI.length) {
    return safeTruncate(`${RLI}${PDI}`, max);
  }

  let body = markRtlLines(stripOuterBidiControls(str.trim()));
  const bodyBudget = max - RLI.length - PDI.length;
  if (body.length > bodyBudget) {
    if (appendEllipsis && bodyBudget > 0) {
      body = `${safeTruncate(body, Math.max(0, bodyBudget - 1)).trimEnd()}…`;
    } else {
      body = safeTruncate(body, bodyBudget);
    }
  }

  return `${RLI}${body}${PDI}`;
}

export function formatTweet(
  tpl: string,
  vars: Record<string, string>,
  max: number,
): string {
  let out = tpl;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v);
  out = out.replace(/\n{3,}/g, "\n\n").trim();
  return enforceRtlXPostText(out, max, true);
}

function normHashtag(s: string): string {
  const t = s.trim().replace(/^#+/, "");
  return t ? `#${t}` : "";
}

export function pickHashtags(pool: string[] | undefined, n: number): string {
  if (!pool || pool.length === 0 || n <= 0) return "";
  const cleaned = pool.map(normHashtag).filter(Boolean);
  if (cleaned.length === 0) return "";
  const take = Math.min(n, cleaned.length);
  const arr = cleaned.slice();
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(Math.random() * (arr.length - i));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, take).join(" ");
}

export function isEnrichmentApprovedForPosting(
  status: string | null | undefined,
  allowCompletedEnrichment: boolean,
): boolean {
  if (status === "approved") return true;
  if (status === "enriched") return true;
  if (status === "completed" && allowCompletedEnrichment) return true;
  return false;
}

export function isEnrichmentBlockingXPost(
  status: string | null | undefined,
  allowCompletedEnrichment: boolean,
  enrichmentRequiredForX = true,
): boolean {
  if (!enrichmentRequiredForX) return false;
  if (!status || status === "skipped") return false;
  return !isEnrichmentApprovedForPosting(status, allowCompletedEnrichment);
}

export function buildXPostText(params: {
  post: XPostTextPost;
  cfg: XPostTextConfig;
  hashtagsValue: string;
  persianDate: string;
  allowCompletedEnrichment: boolean;
}): string {
  const { post, cfg, hashtagsValue, persianDate, allowCompletedEnrichment } =
    params;
  const enrichedAllowed = isEnrichmentApprovedForPosting(
    post.enrich_status,
    allowCompletedEnrichment,
  );
  const finalXText = (post.final_x_text || "").trim();
  if (finalXText && enrichedAllowed) {
    const withHashtags = [finalXText, hashtagsValue].filter(Boolean).join(
      "\n\n",
    );
    return enforceRtlXPostText(withHashtags, cfg.max_chars);
  }

  const opinionText = (post.composed_post_text || "").trim();
  if (opinionText && enrichedAllowed) {
    const assembled = [
      persianDate,
      `${cfg.leading_emoji} ${post.text_translated || ""}`,
      "── نظر ما ──",
      opinionText,
      hashtagsValue,
    ].filter(Boolean).join("\n\n");
    return enforceRtlXPostText(assembled, cfg.max_chars);
  }

  const accountHandle = post.accounts?.handle || "";
  return formatTweet(cfg.post_template, {
    leading_emoji: cfg.leading_emoji,
    translated_text: post.text_translated || "",
    hashtags: hashtagsValue,
    persian_date: persianDate,
    author_handle: post.author_handle || accountHandle,
    commentary: post.humanized_commentary || "",
    hook: post.commentary_hook || "",
    question: post.commentary_question || "",
    callback: post.narrative_callback || "",
  }, cfg.max_chars);
}
