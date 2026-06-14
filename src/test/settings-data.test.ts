import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSettingsRows, previewTranslation, saveSetting } from "@/api/settingsData";
import { invokeAdminAction } from "@/api/adminActions";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock("@/api/adminActions", () => ({
  invokeAdminAction: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: mocks.from,
  },
}));

describe("settings data API", () => {
  const invokeAdminActionMock = vi.mocked(invokeAdminAction);

  beforeEach(() => {
    invokeAdminActionMock.mockReset();
    mocks.from.mockReset();
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
    const filteredQuery = {
      in: vi.fn().mockResolvedValue({
        data: [{ key: "voice_guide", value: { guide: "short" } }],
        error: null,
      }),
    };
    const select = vi.fn(() => filteredQuery);
    mocks.from.mockReturnValueOnce({ select });

    const rows = await fetchSettingsRows(["voice_guide"]);

    expect(rows).toEqual([{ key: "voice_guide", value: { guide: "short" } }]);
    expect(mocks.from).toHaveBeenCalledWith("settings");
    expect(select).toHaveBeenCalledWith("key, value");
    expect(filteredQuery.in).toHaveBeenCalledWith("key", ["voice_guide"]);
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
});
