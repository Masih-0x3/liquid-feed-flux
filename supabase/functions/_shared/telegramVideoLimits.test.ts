import { assertEquals } from "jsr:@std/assert";
import {
  isTelegramBotVideoTooLarge,
  TELEGRAM_BOT_VIDEO_UPLOAD_MAX_BYTES,
  telegramVideoTooLargeReason,
} from "./telegramVideoLimits.ts";

Deno.test("Telegram Bot API video upload cap is deterministic", () => {
  assertEquals(TELEGRAM_BOT_VIDEO_UPLOAD_MAX_BYTES, 50 * 1024 * 1024);
  assertEquals(isTelegramBotVideoTooLarge(30 * 1024 * 1024), false);
  assertEquals(isTelegramBotVideoTooLarge(50 * 1024 * 1024), false);
  assertEquals(isTelegramBotVideoTooLarge(51 * 1024 * 1024), true);
  assertEquals(telegramVideoTooLargeReason(51 * 1024 * 1024), "telegram_video_too_large_for_bot_api:51MB>50MB");
});
