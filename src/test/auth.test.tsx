import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAuth, AuthProvider } from "@/contexts/AuthContext";
import { ReactNode } from "react";

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

describe("useAuth", () => {
  it("throws when used outside AuthProvider", () => {
    expect(() => {
      renderHook(() => useAuth());
    }).toThrow("useAuth must be used within an AuthProvider");
  });

  it("returns loading=true initially inside AuthProvider", () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    // Initial state: loading true, no user
    expect(result.current.loading).toBe(true);
    expect(result.current.user).toBeNull();
    expect(result.current.session).toBeNull();
    expect(result.current.role).toBeNull();
    expect(result.current.isAdmin).toBe(false);
  });
});
