import { describe, expect, it } from "vitest";
import { contentLanguageAttributes, persianContentAttributes } from "@/lib/contentLanguage";

describe("content language attributes", () => {
  const cases: Array<[string | null, ReturnType<typeof contentLanguageAttributes>]> = [
    ["fa", persianContentAttributes],
    ["Persian", persianContentAttributes],
    ["fa-IR", persianContentAttributes],
    ["en", { dir: "ltr", lang: "en" }],
    ["English", { dir: "ltr", lang: "en" }],
    ["en-US", { dir: "ltr", lang: "en" }],
    ["ar", { dir: "auto" }],
    ["mixed", { dir: "auto" }],
    ["unknown", { dir: "auto" }],
    [null, { dir: "auto" }],
  ];

  it.each(cases)("maps %s safely", (language, expected) => {
    expect(contentLanguageAttributes(language)).toEqual(expected);
  });

});
