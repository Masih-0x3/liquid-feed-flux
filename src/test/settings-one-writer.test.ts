import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const componentsDir = join(process.cwd(), "src/components/settings");
const readComponent = (name: string) => readFileSync(join(componentsDir, name), "utf8");

describe("settings scoring control plane", () => {
  it("keeps scoring_policy as the only scoring settings writer", () => {
    const studio = readComponent("ScoringStudio.tsx");
    const editorialProfiles = readComponent("EditorialProfilesCard.tsx");
    const contentFilter = readComponent("ContentFilterSettings.tsx");

    expect(studio).toMatch(/mutateAsync\(\{ key: ['"]scoring_policy['"], value: policy \}/);
    expect(editorialProfiles).not.toMatch(/mutateAsync\(\{ key: ['"](?:editorial_profiles|active_profile_id)['"]/);
    expect(contentFilter).not.toMatch(/mutateAsync\(\{ key: ['"](?:content_filter|translation_prompt)['"]/);
  });

  it("retains legacy settings as reads in the Settings page", () => {
    const settingsPage = readFileSync(join(process.cwd(), "src/pages/Settings.tsx"), "utf8");

    expect(settingsPage).toMatch(/settings\?\.scoring_policy/);
    expect(settingsPage).toMatch(/settings\?\.editorial_profiles/);
    expect(settingsPage).toMatch(/settings\?\.active_profile_id/);
    expect(settingsPage).toMatch(/settings\?\.content_filter/);
  });
});
