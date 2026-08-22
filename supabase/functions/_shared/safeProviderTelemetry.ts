const TELEGRAM_METHODS = new Set([
  "sendAudio",
  "sendMediaGroup",
  "sendMessage",
  "sendPhoto",
  "sendVideo",
]);

function safeTelegramMethod(value: unknown): string {
  return typeof value === "string" && TELEGRAM_METHODS.has(value)
    ? value
    : "unknown";
}

function safeTelegramStatus(value: unknown): number | "unknown" {
  return typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 400 &&
      value <= 599
    ? value
    : "unknown";
}

export function safeTelegramErrorMessage(
  method: unknown,
  statusCode: unknown,
  retryAfterSeconds: unknown,
): string {
  const safeMethod = safeTelegramMethod(method);
  if (
    typeof retryAfterSeconds === "number" &&
    Number.isInteger(retryAfterSeconds) &&
    retryAfterSeconds >= 1 &&
    retryAfterSeconds <= 86_400
  ) {
    return `Telegram ${safeMethod} failed: Too Many Requests (retry after ${retryAfterSeconds})`;
  }
  return `Telegram ${safeMethod} failed with status ${safeTelegramStatus(statusCode)}`;
}
