import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getSupabaseDashboardUrl } from "@/components/settings/XAutomationSettings";

const PREVIEW_PROJECT_REF = "abcdefghijklmnopqrst";
const PRODUCTION_PROJECT_REF = "jzirqfzzvlbxwfzndaer";
const componentSource = readFileSync(
  join(process.cwd(), "src/components/settings/XAutomationSettings.tsx"),
  "utf8",
);

describe("X automation Supabase dashboard link", () => {
  it("does not pin the browser source to the production project", () => {
    expect(componentSource).not.toContain(
      `https://supabase.com/dashboard/project/${PRODUCTION_PROJECT_REF}/settings/functions`,
    );
    expect(componentSource).toContain("import.meta.env.VITE_SUPABASE_PROJECT_ID");
    expect(componentSource).toContain("href={supabaseDashboardUrl}");
  });

  it("uses the configured Preview project ref instead of production", () => {
    expect(
      getSupabaseDashboardUrl(
        PREVIEW_PROJECT_REF,
        `https://${PREVIEW_PROJECT_REF}.supabase.co`,
      ),
    ).toBe(`https://supabase.com/dashboard/project/${PREVIEW_PROJECT_REF}/settings/functions`);
    expect(
      getSupabaseDashboardUrl(
        PREVIEW_PROJECT_REF,
        `https://${PREVIEW_PROJECT_REF}.supabase.co`,
      ),
    ).not.toContain(PRODUCTION_PROJECT_REF);
  });

  it("preserves a paired production project link when production is configured", () => {
    expect(
      getSupabaseDashboardUrl(
        PRODUCTION_PROJECT_REF,
        `https://${PRODUCTION_PROJECT_REF}.supabase.co`,
      ),
    ).toBe(`https://supabase.com/dashboard/project/${PRODUCTION_PROJECT_REF}/settings/functions`);
  });

  it("falls back to the generic dashboard for unsafe or mismatched identity", () => {
    const genericDashboardUrl = "https://supabase.com/dashboard";

    expect(getSupabaseDashboardUrl("not-a-project-ref", undefined)).toBe(genericDashboardUrl);
    expect(
      getSupabaseDashboardUrl(
        PREVIEW_PROJECT_REF,
        `https://${PRODUCTION_PROJECT_REF}.supabase.co`,
      ),
    ).toBe(genericDashboardUrl);
  });
});
