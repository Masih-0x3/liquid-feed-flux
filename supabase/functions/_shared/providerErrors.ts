export function isProviderQuotaExhaustedError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("insufficient_quota") ||
    lower.includes("exceeded your current quota") ||
    lower.includes("check your plan and billing details");
}

export function isRetryableProviderError(message: string): boolean {
  if (isProviderQuotaExhaustedError(message)) return false;
  return /(^|:)(408|409|425|429|500|502|503|504)(:|$)/.test(message) ||
    /timeout|timed out|temporarily|unavailable|rate limit|ECONNRESET|network/i
      .test(message);
}
