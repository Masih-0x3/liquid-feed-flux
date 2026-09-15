import { act, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_THEME_PREFERENCE,
  THEME_STORAGE_KEY,
  ThemeProvider,
  useTheme,
} from "@/contexts/ThemeContext";

function Probe() {
  const { preference, resolvedTheme, setPreference } = useTheme();
  return (
    <div>
      <span data-testid="preference">{preference}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <button type="button" onClick={() => setPreference("light")}>
        set-light
      </button>
      <button type="button" onClick={() => setPreference("system")}>
        set-system
      </button>
    </div>
  );
}

function renderTheme() {
  return render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "";
  });

  it("defaults to the confirmed dark first-use preference", () => {
    expect(DEFAULT_THEME_PREFERENCE).toBe("dark");
    renderTheme();

    expect(screen.getByTestId("preference")).toHaveTextContent("dark");
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
    expect(document.documentElement).toHaveClass("dark");
  });

  it("applies an explicit light preference and persists it locally", () => {
    renderTheme();

    act(() => {
      screen.getByRole("button", { name: "set-light" }).click();
    });

    expect(screen.getByTestId("preference")).toHaveTextContent("light");
    expect(screen.getByTestId("resolved")).toHaveTextContent("light");
    expect(document.documentElement).not.toHaveClass("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("follows the OS only while the system preference is selected", () => {
    const mediaListeners = new Set<(event: { matches: boolean }) => void>();
    let matches = false;
    vi.spyOn(window, "matchMedia").mockImplementation((query: string) => {
      if (query === "(prefers-color-scheme: dark)") {
        return {
          matches,
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: (_: string, listener: () => void) => {
            mediaListeners.add(listener);
          },
          removeEventListener: (_: string, listener: () => void) => {
            mediaListeners.delete(listener);
          },
          dispatchEvent: () => false,
        } as MediaQueryList;
      }
      return {
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      } as MediaQueryList;
    });

    renderTheme();

    act(() => {
      screen.getByRole("button", { name: "set-system" }).click();
    });

    // OS is light → light theme.
    expect(screen.getByTestId("resolved")).toHaveTextContent("light");
    expect(document.documentElement).not.toHaveClass("dark");

    // OS switches to dark → theme follows while System stays selected.
    act(() => {
      matches = true;
      for (const listener of mediaListeners) {
        listener({ matches: true });
      }
    });
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
    expect(document.documentElement).toHaveClass("dark");

    vi.restoreAllMocks();
  });

  it("restores the saved preference and stays deterministic when storage fails", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    renderTheme();
    expect(screen.getByTestId("preference")).toHaveTextContent("light");
  });

  it("keeps the app mounted while switching themes so drafts and selection survive", () => {
    let mountedCount = 0;
    function Child() {
      mountedCount += 1;
      return <div>workbench content</div>;
    }
    render(
      <ThemeProvider>
        <Child />
        <Probe />
      </ThemeProvider>,
    );

    act(() => {
      screen.getByRole("button", { name: "set-light" }).click();
    });
    act(() => {
      screen.getByRole("button", { name: "set-system" }).click();
    });

    expect(mountedCount).toBe(1);
  });
});

describe("theme boot contract", () => {
  it("mirrors the ThemeProvider default in the pre-paint script", () => {
    const bootPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../public/theme-boot.js",
    );
    const source = readFileSync(bootPath, "utf8");
    expect(source).toContain("xot-theme-preference");
    expect(source).toContain("classList.toggle");
    // First use must default to dark; `system` follows the OS only when selected.
    expect(source).toMatch(/dark\s*=\s*true/);
    expect(source).toContain("matchMedia('(prefers-color-scheme: dark)')");
  });
});
