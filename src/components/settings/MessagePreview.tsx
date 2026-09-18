import { createElement, useMemo, type ReactNode } from 'react';

function textNodes(text: string, prefix: string): ReactNode[] {
  return text.split(/((?:https?:\/\/|@)[A-Za-z0-9_./?&=%#:+~-]+)/g).map((part, index) =>
    /^(https?:\/\/|@)/.test(part) ? <bdi key={`${prefix}-${index}`} dir="ltr">{part}</bdi> : part,
  );
}

function decodeEntities(text: string) {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, name: string) => {
    if (!name.startsWith('#')) return named[name.toLowerCase()] ?? entity;
    const code = /^#x/i.test(name) ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : '\ufffd';
  });
}

const textFormattingTags = new Set(['b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'code', 'pre', 'blockquote', 'a', 'tg-spoiler']);

/** Tokenize text formatting only. Parsing a detached HTML document can still load remote resources. */
function telegramHtml(text: string): ReactNode {
  type Frame = { tag: string; key: number; children: ReactNode[] };
  const stack: Frame[] = [{ tag: 'root', key: -1, children: [] }];
  const tokens = text.match(/<!--[\s\S]*?-->|<(?:"[^"]*"|'[^']*'|[^'">])*>|[^<]+|</g) ?? [];
  let blockedTag: string | null = null;
  const closeFrame = () => {
    const frame = stack.pop()!;
    const tag = frame.tag === 'a' || frame.tag === 'tg-spoiler' ? 'span' : frame.tag;
    const className = frame.tag === 'a' ? 'underline' : frame.tag === 'tg-spoiler' ? 'rounded bg-muted px-1' : frame.tag === 'blockquote' ? 'border-s-2 ps-3' : undefined;
    stack[stack.length - 1].children.push(createElement(tag, { key: frame.key, className }, frame.children));
  };

  tokens.forEach((token, index) => {
    if (token.startsWith('<!--')) return;
    const match = /^<(\/)?([a-z][\w-]*)\b/i.exec(token);
    const tag = match?.[2].toLowerCase();
    const closing = Boolean(match?.[1]);
    if (blockedTag) {
      if (closing && tag === blockedTag) blockedTag = null;
      return;
    }
    if (tag && ['script', 'style', 'iframe', 'object'].includes(tag)) {
      if (!closing) blockedTag = tag;
      return;
    }
    if (!tag) {
      stack[stack.length - 1].children.push(...textNodes(decodeEntities(token), String(index)));
    } else if (tag === 'br' && !closing) {
      stack[stack.length - 1].children.push(<br key={index} />);
    } else if (textFormattingTags.has(tag)) {
      if (!closing) stack.push({ tag, key: index, children: [] });
      else {
        const position = stack.map((frame) => frame.tag).lastIndexOf(tag);
        if (position > 0) while (stack.length > position) closeFrame();
      }
    }
  });
  while (stack.length > 1) closeFrame();
  return stack[0].children;
}

/** Render only Telegram's safe formatting subset; never insert supplied HTML into the DOM. */
function formattedNodes(text: string, mode: string): ReactNode {
  if (mode !== 'HTML') {
    // Markdown previews support the common inline syntax; unsupported syntax remains visible.
    return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|__[^_]+__|_[^_]+_|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)]+\))/g).map((part, index) => {
      const link = /^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/.exec(part);
      if (link) return <span key={index} className="underline">{textNodes(link[1], String(index))}</span>;
      if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
      if (part.startsWith('*') && part.endsWith('*')) return <strong key={index}>{part.slice(1, -1)}</strong>;
      if (part.startsWith('__') && part.endsWith('__')) return <u key={index}>{part.slice(2, -2)}</u>;
      if (part.startsWith('_') && part.endsWith('_')) return <em key={index}>{part.slice(1, -1)}</em>;
      if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
      return textNodes(part, String(index));
    });
  }
  return telegramHtml(text);
}

export function MessagePreview({ text, mode = 'plain', destination }: { text: string; mode?: string; destination: 'Telegram' | 'X' }) {
  const content = useMemo(() => mode === 'plain' ? textNodes(text, 'plain') : formattedNodes(text, mode), [mode, text]);
  return <figure className="max-w-lg space-y-2">
    <figcaption className="text-xs text-muted-foreground">{destination} preview · {mode === 'plain' ? 'plain text' : mode} · illustrative width. Links are preview text.</figcaption>
    <div dir="auto" lang={/[\u0600-\u06ff]/.test(text) ? 'fa' : 'en'} className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-background p-4 font-sans text-base leading-8 [text-align:start] [unicode-bidi:plaintext]">{text ? content : <span className="text-muted-foreground">The message is empty.</span>}</div>
  </figure>;
}
