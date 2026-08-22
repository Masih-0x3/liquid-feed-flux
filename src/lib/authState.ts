export type AppRole = "admin" | "read_only";

export type AuthStatus =
  | "booting"
  | "unauthenticated"
  | "authenticated-role-loading"
  | "authorised"
  | "denied"
  | "degraded";

export type AuthOperation = "session" | "role" | "sign_in" | "sign_out";

export interface AuthFailure {
  operation: AuthOperation;
  message: string;
}

export interface AuthStatusInput {
  booting: boolean;
  sessionPresent: boolean;
  role: AppRole | null;
  failure: AuthFailure | null;
}

export const AUTH_BOOTSTRAP_DEADLINE_MS = 15_000;
export const AUTH_ROLE_DEADLINE_MS = 5_000;
export const AUTH_SIGN_IN_DEADLINE_MS = 15_000;
export const AUTH_SIGN_OUT_DEADLINE_MS = 15_000;

export class AuthDeadlineError extends Error {
  constructor(readonly operation: AuthOperation) {
    super("Authentication operation timed out");
    this.name = "AuthDeadlineError";
  }
}

export function withAuthDeadline<T>(
  operation: () => PromiseLike<T>,
  deadlineMs: number,
  operationName: AuthOperation,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== null) clearTimeout(timeoutId);
      callback();
    };

    timeoutId = setTimeout(() => {
      settle(() => reject(new AuthDeadlineError(operationName)));
    }, deadlineMs);

    try {
      void Promise.resolve(operation()).then(
        (value) => settle(() => resolve(value)),
        (error) => settle(() => reject(error)),
      );
    } catch (error) {
      settle(() => reject(error));
    }
  });
}

export function isAppRole(value: unknown): value is AppRole {
  return value === "admin" || value === "read_only";
}

export function deriveAuthStatus(input: AuthStatusInput): AuthStatus {
  if (input.failure) return "degraded";
  if (input.booting) return "booting";
  if (!input.sessionPresent) return "unauthenticated";
  if (input.role === null) return "authenticated-role-loading";
  return isAppRole(input.role) ? "authorised" : "denied";
}

export function isAuthPending(status: AuthStatus): boolean {
  return status === "booting" || status === "authenticated-role-loading";
}

export function canRenderProtectedShell(status: AuthStatus): boolean {
  return status === "authorised";
}
