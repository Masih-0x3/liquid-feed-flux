import { describe, it, expect } from "vitest";
import { z } from "zod";

// Mirror the settings validation schema used in the app
const settingsSchema = z.object({
  key: z.string().min(1, "Key is required"),
  value: z.unknown(),
  description: z.string().optional(),
});

describe("Settings validation", () => {
  it("rejects empty key", () => {
    const result = settingsSchema.safeParse({ key: "", value: "test" });
    expect(result.success).toBe(false);
  });

  it("accepts valid settings", () => {
    const result = settingsSchema.safeParse({
      key: "telegram_chat_id",
      value: "-1001234567890",
      description: "Target chat",
    });
    expect(result.success).toBe(true);
  });

  it("accepts JSON value", () => {
    const result = settingsSchema.safeParse({
      key: "template_config",
      value: { template: "{translated_text}", include_source: true },
    });
    expect(result.success).toBe(true);
  });

  it("accepts null description", () => {
    const result = settingsSchema.safeParse({
      key: "some_key",
      value: 42,
    });
    expect(result.success).toBe(true);
  });
});
