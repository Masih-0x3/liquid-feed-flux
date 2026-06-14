export const TELEGRAM_BOT_VIDEO_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

export function isTelegramBotVideoTooLarge(bytes: number): boolean {
  return Number.isFinite(bytes) && bytes > TELEGRAM_BOT_VIDEO_UPLOAD_MAX_BYTES;
}

export function telegramVideoSizeMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  const rounded = mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10;
  return String(rounded);
}

export function telegramVideoTooLargeReason(bytes: number): string {
  return `telegram_video_too_large_for_bot_api:${telegramVideoSizeMb(bytes)}MB>50MB`;
}
