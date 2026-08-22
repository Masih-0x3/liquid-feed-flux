export type ContentDirection = "rtl" | "ltr" | "auto";

export interface ContentLanguageAttributes {
  dir: ContentDirection;
  lang?: "fa" | "en";
}

export const persianContentAttributes: ContentLanguageAttributes = {
  dir: "rtl",
  lang: "fa",
};

export function contentLanguageAttributes(
  language: string | null | undefined,
): ContentLanguageAttributes {
  const normalized = language?.trim().toLowerCase();
  if (normalized === "fa" || normalized === "persian" || normalized?.startsWith("fa-")) {
    return persianContentAttributes;
  }
  if (normalized === "en" || normalized === "english" || normalized?.startsWith("en-")) {
    return { dir: "ltr", lang: "en" };
  }
  return { dir: "auto" };
}
