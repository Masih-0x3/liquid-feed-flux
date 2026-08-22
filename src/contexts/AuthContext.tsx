import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { type AuthError, type Session, type User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  AUTH_BOOTSTRAP_DEADLINE_MS,
  AuthDeadlineError,
  AUTH_ROLE_DEADLINE_MS,
  AUTH_SIGN_IN_DEADLINE_MS,
  AUTH_SIGN_OUT_DEADLINE_MS,
  deriveAuthStatus,
  isAppRole,
  isAuthPending,
  withAuthDeadline,
  type AppRole,
  type AuthFailure,
  type AuthOperation,
  type AuthStatus,
} from "@/lib/authState";

export type { AppRole, AuthFailure, AuthStatus } from "@/lib/authState";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  status: AuthStatus;
  authError: AuthFailure | null;
  role: AppRole | null;
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<{ error: AuthError | null }>;
  refreshSession: () => Promise<void>;
}

interface AuthSnapshot {
  user: User | null;
  session: Session | null;
  role: AppRole | null;
  status: AuthStatus;
  authError: AuthFailure | null;
}

const initialSnapshot: AuthSnapshot = {
  user: null,
  session: null,
  role: null,
  status: "booting",
  authError: null,
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function authFailureFor(operation: AuthOperation): AuthFailure {
  const messages: Record<AuthOperation, string> = {
    session: "We could not verify your session. Retry before continuing.",
    role: "We could not verify your access level. Retry before continuing.",
    sign_in: "We could not complete sign-in. Please try again.",
    sign_out: "We could not complete sign-out. Protected work has been paused for safety.",
  };

  return { operation, message: messages[operation] };
}

function authErrorFor(error: unknown, fallback: string): AuthError {
  if (error instanceof AuthDeadlineError) {
    return {
      name: "AuthTimeoutError",
      message: fallback,
      status: 504,
    } as AuthError;
  }

  return {
    name: "AuthError",
    message: fallback,
    status: 503,
  } as AuthError;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthSnapshot>(initialSnapshot);
  const authRef = useRef(auth);
  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const deferredAuthEventTimersRef = useRef(new Set<ReturnType<typeof setTimeout>>());

  const isCurrent = useCallback((generation: number) => (
    mountedRef.current && generation === generationRef.current
  ), []);

  const commit = useCallback((generation: number, next: AuthSnapshot) => {
    if (!isCurrent(generation)) return;
    authRef.current = next;
    setAuth(next);
  }, [isCurrent]);

  const loadUserRole = useCallback(async (userId: string): Promise<AppRole> => {
    const response = await withAuthDeadline(
      () => supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId),
      AUTH_ROLE_DEADLINE_MS,
      "role",
    );

    if (response.error) throw response.error;
    if (!Array.isArray(response.data) || response.data.length !== 1) {
      throw new Error("Expected exactly one application role");
    }

    const role = response.data[0] && typeof response.data[0] === "object"
      ? (response.data[0] as { role?: unknown }).role
      : undefined;
    if (!isAppRole(role)) {
      throw new Error("Received an invalid application role");
    }

    return role;
  }, []);

  const resolveSession = useCallback(async (nextSession: Session | null, generation: number) => {
    if (!isCurrent(generation)) return;

    if (!nextSession?.user) {
      commit(generation, {
        user: null,
        session: null,
        role: null,
        status: "unauthenticated",
        authError: null,
      });
      return;
    }

    commit(generation, {
      user: nextSession.user,
      session: nextSession,
      role: null,
      status: deriveAuthStatus({
        booting: false,
        sessionPresent: true,
        role: null,
        failure: null,
      }),
      authError: null,
    });

    try {
      const role = await loadUserRole(nextSession.user.id);
      if (!isCurrent(generation)) return;

      commit(generation, {
        user: nextSession.user,
        session: nextSession,
        role,
        status: deriveAuthStatus({
          booting: false,
          sessionPresent: true,
          role,
          failure: null,
        }),
        authError: null,
      });
    } catch {
      if (!isCurrent(generation)) return;

      const authError = authFailureFor("role");
      commit(generation, {
        user: nextSession.user,
        session: nextSession,
        role: null,
        status: deriveAuthStatus({
          booting: false,
          sessionPresent: true,
          role: null,
          failure: authError,
        }),
        authError,
      });
    }
  }, [commit, isCurrent, loadUserRole]);

  const refreshSession = useCallback(async () => {
    const generation = ++generationRef.current;
    commit(generation, {
      ...initialSnapshot,
      status: "booting",
    });

    try {
      const response = await withAuthDeadline(
        () => supabase.auth.getSession(),
        AUTH_BOOTSTRAP_DEADLINE_MS,
        "session",
      );
      if (response.error) throw response.error;
      await resolveSession(response.data.session, generation);
    } catch {
      if (!isCurrent(generation)) return;

      const authError = authFailureFor("session");
      commit(generation, {
        user: null,
        session: null,
        role: null,
        status: deriveAuthStatus({
          booting: false,
          sessionPresent: false,
          role: null,
          failure: authError,
        }),
        authError,
      });
    }
  }, [commit, isCurrent, resolveSession]);

  useEffect(() => {
    mountedRef.current = true;
    const deferredTimers = deferredAuthEventTimersRef.current;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        const generation = ++generationRef.current;
        const timer = setTimeout(() => {
          deferredTimers.delete(timer);
          void resolveSession(nextSession, generation);
        }, 0);
        deferredTimers.add(timer);
      },
    );

    void refreshSession();

    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      deferredTimers.forEach((timer) => clearTimeout(timer));
      deferredTimers.clear();
      subscription.unsubscribe();
    };
  }, [refreshSession, resolveSession]);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const { error } = await withAuthDeadline(
        () => supabase.auth.signInWithPassword({ email, password }),
        AUTH_SIGN_IN_DEADLINE_MS,
        "sign_in",
      );
      return { error };
    } catch (error) {
      return { error: authErrorFor(error, authFailureFor("sign_in").message) };
    }
  }, []);

  const signOut = useCallback(async () => {
    const generation = ++generationRef.current;
    const previous = authRef.current;
    commit(generation, {
      ...previous,
      role: null,
      status: "booting",
      authError: null,
    });

    try {
      const { error } = await withAuthDeadline(
        () => supabase.auth.signOut(),
        AUTH_SIGN_OUT_DEADLINE_MS,
        "sign_out",
      );
      if (error) throw error;

      commit(generation, {
        user: null,
        session: null,
        role: null,
        status: "unauthenticated",
        authError: null,
      });
      return { error: null };
    } catch (error) {
      if (isCurrent(generation)) {
        const authError = authFailureFor("sign_out");
        commit(generation, {
          user: previous.user,
          session: previous.session,
          role: null,
          status: deriveAuthStatus({
            booting: false,
            sessionPresent: Boolean(previous.session),
            role: null,
            failure: authError,
          }),
          authError,
        });
      }
      return { error: authErrorFor(error, authFailureFor("sign_out").message) };
    }
  }, [commit, isCurrent]);

  const value: AuthContextType = {
    user: auth.user,
    session: auth.session,
    loading: isAuthPending(auth.status),
    status: auth.status,
    authError: auth.authError,
    role: auth.role,
    isAdmin: auth.status === "authorised" && auth.role === "admin",
    signIn,
    signOut,
    refreshSession,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
