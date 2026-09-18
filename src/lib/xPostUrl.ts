/** Match the archive intake server parser; the server remains authoritative. */
export function isSupportedXPostUrl(input: string): boolean {
  const raw = input.trim();
  if (!raw || raw.length > 500) return false;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!['x.com', 'twitter.com', 'mobile.twitter.com'].includes(host)) return false;
    const parts = url.pathname.split('/').filter(Boolean);
    const index = parts.findIndex((part) => ['status', 'statuses'].includes(part.toLowerCase()));
    if (index < 0 || !parts[index + 1]) return false;
    return /^[0-9]{5,32}$/.test(parts[index + 1].replace(/[^0-9].*$/, ''));
  } catch {
    return false;
  }
}
