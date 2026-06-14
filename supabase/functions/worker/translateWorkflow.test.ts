import { assertEquals } from "jsr:@std/assert";
import { renderTranslationUserPrompt } from "./translateWorkflow.ts";

Deno.test("renderTranslationUserPrompt replaces all supported placeholders", () => {
  assertEquals(
    renderTranslationUserPrompt({
      template:
        "{content}|{author}|{author_handle}|{author_name}|{published_at}|{published_date}",
      content: "Original content",
      authorDisplay: "source",
      accountName: "Source Name",
      publishedAt: "2026-01-01T00:00:00.000Z",
    }),
    "Original content|@source|@source|Source Name|2026-01-01T00:00:00.000Z|2026-01-01T00:00:00.000Z",
  );
});

Deno.test("renderTranslationUserPrompt falls back to source content when template is empty", () => {
  assertEquals(
    renderTranslationUserPrompt({
      template: "   ",
      content: "Original content",
      authorDisplay: "source",
      accountName: "Source Name",
      publishedAt: "2026-01-01T00:00:00.000Z",
    }),
    "Original content",
  );
});

Deno.test("renderTranslationUserPrompt uses an empty author name when missing", () => {
  assertEquals(
    renderTranslationUserPrompt({
      template: "{author_name}:{content}",
      content: "Original content",
      authorDisplay: "source",
      accountName: null,
      publishedAt: "unknown",
    }),
    ":Original content",
  );
});
