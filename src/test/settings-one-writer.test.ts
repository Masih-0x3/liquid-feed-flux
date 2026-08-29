import { createElement, type ReactNode } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

if (typeof Element !== "undefined") {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
}

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/api/adminActions", () => ({
  invokeAdminAction: vi.fn(),
}));

import EditorialProfilesCard from "@/components/settings/EditorialProfilesCard";
import ContentFilterSettings, { type ContentFilterConfig } from "@/components/settings/ContentFilterSettings";
import { PromptEditor } from "@/components/settings/PromptEditor";
import {
  type EditorialProfile,
  type TranslationSettings,
} from "@/hooks/useSettingsData";

const componentsDir = join(process.cwd(), "src/components/settings");
const readComponent = (name: string) => readFileSync(join(componentsDir, name), "utf8");

function renderWithQueryClient(node: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    createElement(QueryClientProvider, { client: queryClient }, node),
  );
}

const sampleProfiles: EditorialProfile[] = [
  {
    id: "profile-alpha",
    name: "Alpha Escalation",
    threshold: 15,
    weights: {
      iran_relevance: 4.5,
      severity: 3.5,
      novelty: 2.0,
      credibility: 3.0,
      actionability: 2.5,
      noise: 1.0,
    },
    must_include_keywords: ["tehran", "irgc"],
    must_exclude_keywords: ["rumor"],
    required_tags_any: ["security"],
    blocked_tags: ["spam"],
    editorial_note: "Alpha escalation priority notes",
  },
  {
    id: "profile-beta",
    name: "Beta Diplomacy",
    threshold: 9,
    weights: {
      iran_relevance: 2.0,
      severity: 1.5,
      novelty: 4.0,
      credibility: 4.5,
      actionability: 3.0,
      noise: 0.5,
    },
    must_include_keywords: ["treaty", "negotiations"],
    must_exclude_keywords: ["gossip"],
    required_tags_any: ["diplomacy"],
    blocked_tags: ["clickbait"],
    editorial_note: "Beta diplomatic channel notes",
  },
];

const sampleFilterConfig: ContentFilterConfig = {
  enabled: true,
  score_only: false,
  filter_mode: "granular",
  default_threshold: 13,
  editorial_guidelines: "Prioritize regional geopolitical events and official statements.",
  priority_topics: ["sanctions", "missiles"],
  low_priority_topics: ["sports", "entertainment"],
  author_rules: {
    reuters: { rule: "always_deliver" },
    state_media: { rule: "always_skip" },
  },
};

const sampleTranslationSettings: TranslationSettings = {
  system_prompt: "Translate faithfully into Persian.",
  user_prompt_template: "{content}",
  model: "gpt-4.1-mini",
  temperature: 0.3,
  max_completion_tokens: 1000,
  top_p: 1,
  frequency_penalty: 0,
  presence_penalty: 0,
  scoring_system_prompt: "Scoring rubric system prompt",
  classifier_tool_schema: '{"type":"object","properties":{"importance_score":{"type":"number"}}}',
};

describe("settings scoring control plane contract", () => {
  it("keeps scoring_policy as the only scoring settings writer in source", () => {
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

describe("EditorialProfilesCard legacy read-only behavior", () => {
  it("allows selecting and inspecting multiple legacy profiles without mutation", async () => {
    render(
      createElement(EditorialProfilesCard, {
        profiles: sampleProfiles,
        activeProfileId: "profile-alpha",
      }),
    );

    // Snapshot notice is visible
    expect(
      screen.getByText(/Read-only legacy snapshot\. Edit the canonical scoring policy in Scoring Studio above\./i),
    ).toBeInTheDocument();

    // Active profile badge
    expect(screen.getByText(/Active: Alpha Escalation/i)).toBeInTheDocument();

    // Initial inspection: Alpha Escalation profile
    const nameInput = screen.getByDisplayValue("Alpha Escalation");
    expect(nameInput).toBeDisabled();
    expect(screen.getByText("15/20")).toBeInTheDocument();
    expect(screen.getByText("tehran")).toBeInTheDocument();
    expect(screen.getByText("irgc")).toBeInTheDocument();
    expect(screen.getByText("security")).toBeInTheDocument();
    expect(screen.getByText("spam")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Alpha escalation priority notes")).toBeDisabled();

    // No delete X icons rendered on badges for removing keywords/tags
    expect(screen.queryByTestId("remove-tag-x")).not.toBeInTheDocument();

    // No profile creation, deletion, duplicate, set active, or save buttons exist
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /duplicate/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /set active/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /clear active/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /new profile/i })).toBeNull();

    // Profile selector is enabled for switching between profiles
    const selectTrigger = screen.getByRole("combobox", { name: /legacy profile snapshot/i });
    expect(selectTrigger).toBeEnabled();

    // Switch to Beta profile
    fireEvent.keyDown(selectTrigger, { key: "ArrowDown" });
    const betaOption = await screen.findByRole("option", { name: /Beta Diplomacy/i });
    fireEvent.click(betaOption);

    // Inspection view updates to Beta Diplomacy
    await waitFor(() => {
      expect(screen.getByDisplayValue("Beta Diplomacy")).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue("Beta Diplomacy")).toBeDisabled();
    expect(screen.getByText("9/20")).toBeInTheDocument();
    expect(screen.getByText("treaty")).toBeInTheDocument();
    expect(screen.getByText("negotiations")).toBeInTheDocument();
    expect(screen.getByText("diplomacy")).toBeInTheDocument();
    expect(screen.getByText("clickbait")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Beta diplomatic channel notes")).toBeDisabled();

    // Still no save or mutation actions available
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  });
});

describe("ContentFilterSettings legacy read-only behavior & layout", () => {
  it("keeps content-filter values visible with no enabled save action and stacks on narrow screens", () => {
    const onTranslationChange = vi.fn();
    const { container } = renderWithQueryClient(
      createElement(ContentFilterSettings, {
        initialConfig: sampleFilterConfig,
        translationSettings: sampleTranslationSettings,
        onTranslationSettingsChange: onTranslationChange,
      }),
    );

    // Status card grid uses responsive classes: 1 column on mobile, 3 columns on sm+
    const statusGrid = container.querySelector(".grid-cols-1.sm\\:grid-cols-3");
    expect(statusGrid).toBeInTheDocument();

    // Read-only notice
    expect(
      screen.getByText(/Read-only legacy snapshot\. Scoring Studio is the only writable scoring policy\./i),
    ).toBeInTheDocument();

    // 3-way status buttons are visible but disabled
    const activeStatusButton = screen.getByRole("button", { name: /Active/i });
    const offStatusButton = screen.getByRole("button", { name: /^Off/i });
    const scoreOnlyButton = screen.getByRole("button", { name: /Score Only/i });
    expect(activeStatusButton).toBeDisabled();
    expect(offStatusButton).toBeDisabled();
    expect(scoreOnlyButton).toBeDisabled();

    // Filter mode options are disabled
    const globalModeRadio = screen.getByRole("radio", { name: /Global Only/i });
    const granularModeRadio = screen.getByRole("radio", { name: /Granular \(Per-Author\)/i });
    expect(globalModeRadio).toBeDisabled();
    expect(granularModeRadio).toBeDisabled();

    // Default threshold is displayed (13/20) and slider is disabled
    expect(screen.getByText("13/20")).toBeInTheDocument();
    const sliders = screen.getAllByRole("slider");
    expect(sliders.length).toBeGreaterThan(0);
    for (const slider of sliders) {
      expect(slider).toHaveAttribute("data-disabled");
    }

    // Editorial guidelines are visible and read-only
    const guidelinesTextarea = screen.getByDisplayValue(
      "Prioritize regional geopolitical events and official statements.",
    );
    expect(guidelinesTextarea).toHaveAttribute("readonly");

    // Priority & low-priority topics are visible
    expect(screen.getByText("sanctions")).toBeInTheDocument();
    expect(screen.getByText("missiles")).toBeInTheDocument();
    expect(screen.getByText("sports")).toBeInTheDocument();
    expect(screen.getByText("entertainment")).toBeInTheDocument();

    // Topic inputs and Add buttons are disabled
    const topicInputs = screen.getAllByPlaceholderText("Add topic...");
    for (const input of topicInputs) {
      expect(input).toBeDisabled();
    }

    // No enabled save action exists for content filter settings
    expect(screen.queryByRole("button", { name: /save.*filter/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();

    // Explanatory footer is visible
    expect(
      screen.getByText(/Legacy content-filter settings are read-only\. To change scoring or thresholds, use Scoring Studio/i),
    ).toBeInTheDocument();
  });
});

describe("PromptEditor read-only behavior", () => {
  it("suppresses reset and editing when readOnly is true", () => {
    const onReset = vi.fn();
    const onChange = vi.fn();

    render(
      createElement(PromptEditor, {
        value: "Sample read-only prompt content",
        onChange,
        onReset,
        readOnly: true,
        title: "Test Read Only Prompt",
      }),
    );

    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveAttribute("readonly");
    expect(textarea).toHaveValue("Sample read-only prompt content");

    // Reset button is suppressed
    expect(screen.queryByRole("button", { name: /reset to default/i })).toBeNull();

    // Copy and Expand inspection buttons remain available
    expect(screen.getByRole("button", { name: /copy prompt/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /expand prompt editor/i })).toBeEnabled();
  });

  it("enables editing and reset when readOnly is false", () => {
    const onReset = vi.fn();
    const onChange = vi.fn();

    render(
      createElement(PromptEditor, {
        value: "Sample editable prompt",
        onChange,
        onReset,
        readOnly: false,
        title: "Test Editable Prompt",
      }),
    );

    const textarea = screen.getByRole("textbox");
    expect(textarea).not.toHaveAttribute("readonly");

    // Reset button is rendered and callable
    const resetButton = screen.getByRole("button", { name: /reset to default/i });
    expect(resetButton).toBeEnabled();
    fireEvent.click(resetButton);
    expect(onReset).toHaveBeenCalledTimes(1);

    // Editing fires onChange
    fireEvent.change(textarea, { target: { value: "Updated prompt" } });
    expect(onChange).toHaveBeenCalledWith("Updated prompt");
  });
});
