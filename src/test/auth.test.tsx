import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useAuth, AuthProvider } from "@/contexts/AuthContext";
import { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      getSession: vi.fn(() => new Promise(() => {})),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
    },
    from: vi.fn(),
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

const mockedGetSession = vi.mocked(supabase.auth.getSession);
const mockedFrom = vi.mocked(supabase.from);

function sessionFor(userId = "user-1") {
  return { user: { id: userId } } as never;
}

function roleQuery(rows: Array<{ role: unknown }>) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => Promise.resolve({ data: rows, error: null })),
    })),
  } as never;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useAuth", () => {
  it("throws when used outside AuthProvider", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => {
      renderHook(() => useAuth());
    }).toThrow("useAuth must be used within an AuthProvider");
    consoleError.mockRestore();
  });

  it("returns loading=true initially inside AuthProvider", () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    // Initial state: loading true, no user
    expect(result.current.loading).toBe(true);
    expect(result.current.user).toBeNull();
    expect(result.current.session).toBeNull();
    expect(result.current.role).toBeNull();
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.status).toBe("booting");
    expect(result.current.authError).toBeNull();
  });

  describe("canonical role resolution", () => {
    beforeEach(() => {
      mockedGetSession.mockResolvedValue({ data: { session: sessionFor() }, error: null } as never);
    });

    it.each([
      ["admin", "authorised", true],
      ["read_only", "authorised", false],
    ] as const)("accepts %s as a protected role", async (role, status, isAdmin) => {
      mockedFrom.mockReturnValue(roleQuery([{ role }]) as never);

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => expect(result.current.status).toBe(status));
      expect(result.current.role).toBe(role);
      expect(result.current.isAdmin).toBe(isAdmin);
    });

    it.each([
      ["missing", []],
      ["legacy", [{ role: "viewer" }]],
      ["unknown", [{ role: "owner" }]],
      ["multiple", [{ role: "admin" }, { role: "read_only" }]],
    ] as const)("fails closed for %s role data", async (_name, rows) => {
      mockedFrom.mockReturnValue(roleQuery(rows) as never);

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => expect(result.current.status).toBe("degraded"));
      expect(result.current.role).toBeNull();
      expect(result.current.isAdmin).toBe(false);
      expect(result.current.user).not.toBeNull();
    });
  });
});
