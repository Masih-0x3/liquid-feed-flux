import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSampleTweets, fetchSettings, fetchSettingsRows, previewTranslation, saveSetting } from "@/api/settingsData";
import { invokeAdminAction, invokeAdminRead } from "@/api/adminActions";
import {
  DEFAULT_CONTENT_FILTER_THRESHOLD,
  defaultConfig,
} from "@/components/settings/ContentFilterSettings";

vi.mock("@/api/adminActions", () => ({
  invokeAdminAction: vi.fn(),
  invokeAdminRead: vi.fn(),
}));

describe("settings data API", () => {
  const invokeAdminActionMock = vi.mocked(invokeAdminAction);
  const invokeAdminReadMock = vi.mocked(invokeAdminRead);

  beforeEach(() => {
    invokeAdminActionMock.mockReset();
    invokeAdminReadMock.mockReset();
  });

  it("saves settings through the admin-actions contract", async () => {
    invokeAdminActionMock.mockResolvedValueOnce({ ok: true });

    await saveSetting({ key: "x_posting_config", value: { enabled: true } });

    expect(invokeAdminActionMock).toHaveBeenCalledWith({
      action: "save_settings",
      key: "x_posting_config",
      value: { enabled: true },
    });
  });

  it("reads selected setting rows through the shared settings API", async () => {
    invokeAdminReadMock.mockResolvedValueOnce({
      success: true,
      rows: [{ key: "voice_guide", value: { guide: "short" } }],
    });

    const rows = await fetchSettingsRows(["voice_guide"]);

    expect(rows).toEqual([{ key: "voice_guide", value: { guide: "short" } }]);
    expect(invokeAdminReadMock).toHaveBeenCalledWith({
      action: "get_settings",
      keys: ["voice_guide"],
    });
  });

  it("runs translation previews through the admin-actions contract", async () => {
    invokeAdminActionMock.mockResolvedValueOnce({
      ok: true,
      result: {
        translated_text: "ترجمه",
        importance_score: 12,
        importance_tags: ["iran"],
        reasoning: "DIRECT",
        model: "gpt-5.4-mini",
        usage: null,
        duration_ms: 1200,
        used_filter: true,
      },
    });

    const result = await previewTranslation({
      text: "source text",
      author_handle: "source",
      translation_settings: {
        system_prompt: "system",
        user_prompt_template: "{text}",
        model: "gpt-5.4-mini",
        temperature: 0,
        max_completion_tokens: 1000,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
      },
    });

    expect(result.translated_text).toBe("ترجمه");
    expect(invokeAdminActionMock).toHaveBeenCalledWith({
      action: "preview_translation",
      text: "source text",
      author_handle: "source",
      translation_settings: expect.objectContaining({ model: "gpt-5.4-mini" }),
    });
  });

  it("reads Settings preview samples through the read-only admin action", async () => {
    invokeAdminReadMock.mockResolvedValueOnce({
      success: true,
      samples: [{ tweet_id: "tweet-1", text_original: "source" }],
    });

    await expect(fetchSampleTweets()).resolves.toEqual([
      { tweet_id: "tweet-1", text_original: "source" },
    ]);
    expect(invokeAdminReadMock).toHaveBeenCalledWith({ action: "get_settings_samples" });
  });

  it("surfaces preview failures as errors", async () => {
    invokeAdminActionMock.mockResolvedValueOnce({ ok: false, error: "preview unavailable" });

    await expect(previewTranslation({
      text: "source text",
      translation_settings: {
        system_prompt: "system",
        user_prompt_template: "{text}",
        model: "gpt-5.4-mini",
        temperature: 0,
        max_completion_tokens: 1000,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
      },
    })).rejects.toThrow("preview unavailable");
  });

  it("merges a historical five-field translation_prompt row with nested defaults so missing fields survive", async () => {
    invokeAdminReadMock.mockResolvedValueOnce({
      success: true,
      rows: [
        {
          key: "translation_prompt",
          value: {
            system_prompt: "Historical system prompt",
            user_prompt_template: "{content}",
            model: "gpt-4o",
            temperature: 0.5,
            max_completion_tokens: 500,
          },
        },
      ],
    });

    const settings = await fetchSettings();

    expect(settings.translation_prompt).toMatchObject({
      system_prompt: "Historical system prompt",
      user_prompt_template: "{content}",
      model: "gpt-4o",
      temperature: 0.5,
      max_completion_tokens: 500,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
    });
    expect(settings.translation_prompt.scoring).toMatchObject({
      model: "gpt-5.4-mini",
      max_completion_tokens: 2000,
    });
  });

  it("keeps baseline defaults when a stored setting has an incompatible container shape", async () => {
    invokeAdminReadMock.mockResolvedValueOnce({
      success: true,
      rows: [
        { key: "translation_prompt", value: [] },
        { key: "telegram_config", value: "malformed" },
        { key: "message_template", value: null },
      ],
    });

    const settings = await fetchSettings();

    expect(settings.translation_prompt).toMatchObject({
      model: "gpt-4o-mini",
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
    });
    expect(settings.telegram_config.parse_mode).toBe("Markdown");
    expect(settings.message_template.template).toContain("{translated_text}");
  });

  it("preserves an explicit content_filter.default_threshold of 12 from a valid settings row", async () => {
    invokeAdminReadMock.mockResolvedValueOnce({
      success: true,
      rows: [
        {
          key: "content_filter",
          value: { enabled: true, default_threshold: 12 },
        },
      ],
    });

    const settings = await fetchSettings();
    expect(settings.content_filter.default_threshold).toBe(12);
  });

  it("preserves an explicit content_filter.default_threshold of 14 from a valid settings row", async () => {
    invokeAdminReadMock.mockResolvedValueOnce({
      success: true,
      rows: [
        {
          key: "content_filter",
          value: { enabled: true, default_threshold: 14 },
        },
      ],
    });

    const settings = await fetchSettings();
    expect(settings.content_filter.default_threshold).toBe(14);
  });
});

describe("ContentFilterSettings threshold defaults", () => {
  it("uses the shared effective default threshold of 14", () => {
    expect(DEFAULT_CONTENT_FILTER_THRESHOLD).toBe(14);
    expect(defaultConfig.default_threshold).toBe(14);
  });
});
