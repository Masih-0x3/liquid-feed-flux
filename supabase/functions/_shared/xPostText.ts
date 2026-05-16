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

export const RLM = '\u200F';

export function safeTruncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  let end = maxLen;
  if (end > 0 && str.charCodeAt(end - 1) >= 0xD800 && str.charCodeAt(end - 1) <= 0xDBFF) end--;
  return str.slice(0, end);
}

export function formatTweet(tpl: string, vars: Record<string, string>, max: number): string {
  let out = tpl;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v);
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  const budget = Math.max(1, max - 1);
  if (out.length > budget) out = out.slice(0, budget - 1).trimEnd() + '…';
  return RLM + out;
}

function normHashtag(s: string): string {
  const t = s.trim().replace(/^#+/, '');
  return t ? `#${t}` : '';
}

export function pickHashtags(pool: string[] | undefined, n: number): string {
  if (!pool || pool.length === 0 || n <= 0) return '';
  const cleaned = pool.map(normHashtag).filter(Boolean);
  if (cleaned.length === 0) return '';
  const take = Math.min(n, cleaned.length);
  const arr = cleaned.slice();
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(Math.random() * (arr.length - i));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, take).join(' ');
}

export function isEnrichmentApprovedForPosting(status: string | null | undefined, allowCompletedEnrichment: boolean): boolean {
  if (status === 'approved') return true;
  if (status === 'enriched') return true;
  if (status === 'completed' && allowCompletedEnrichment) return true;
  return false;
}

export function isEnrichmentBlockingXPost(status: string | null | undefined, allowCompletedEnrichment: boolean): boolean {
  if (!status || status === 'skipped') return false;
  return !isEnrichmentApprovedForPosting(status, allowCompletedEnrichment);
}

export function buildXPostText(params: {
  post: XPostTextPost;
  cfg: XPostTextConfig;
  hashtagsValue: string;
  persianDate: string;
  allowCompletedEnrichment: boolean;
}): string {
  const { post, cfg, hashtagsValue, persianDate, allowCompletedEnrichment } = params;
  const enrichedAllowed = isEnrichmentApprovedForPosting(post.enrich_status, allowCompletedEnrichment);
  const finalXText = (post.final_x_text || '').trim();
  if (finalXText && enrichedAllowed) {
    const withHashtags = [finalXText, hashtagsValue].filter(Boolean).join('\n\n');
    return RLM + safeTruncate(withHashtags, cfg.max_chars - 1);
  }

  const opinionText = (post.composed_post_text || '').trim();
  if (opinionText && enrichedAllowed) {
    const assembled = [
      persianDate,
      `${cfg.leading_emoji} ${post.text_translated || ''}`,
      '── نظر ما ──',
      opinionText,
      hashtagsValue,
    ].filter(Boolean).join('\n\n');
    return RLM + safeTruncate(assembled, cfg.max_chars - 1);
  }

  const accountHandle = post.accounts?.handle || '';
  return formatTweet(cfg.post_template, {
    leading_emoji: cfg.leading_emoji,
    translated_text: post.text_translated || '',
    hashtags: hashtagsValue,
    persian_date: persianDate,
    author_handle: post.author_handle || accountHandle,
    commentary: post.humanized_commentary || '',
    hook: post.commentary_hook || '',
    question: post.commentary_question || '',
    callback: post.narrative_callback || '',
  }, cfg.max_chars);
}
