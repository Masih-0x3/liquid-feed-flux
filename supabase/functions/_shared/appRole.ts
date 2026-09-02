/** The only application roles. Legacy role names are never accepted. */
export const APP_ROLES = ["admin", "read_only"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export type AppRoleRpcClient = {
  rpc: (name: "current_user_role") => PromiseLike<{
    data?: unknown;
    error?: unknown;
  }>;
};

export class AppRoleError extends Error {
  readonly code = "app_role_forbidden";

  constructor(message: "admin role required" | "read-only role required") {
    super(message);
    this.name = "AppRoleError";
  }
}

export function parseAppRole(value: unknown): AppRole | null {
  if (value === "admin" || value === "read_only") return value;
  return null;
}

/** Resolve only the caller-bound database RPC. There is no metadata fallback. */
export async function resolveCurrentUserRole(
  client: AppRoleRpcClient,
): Promise<AppRole | null> {
  try {
    const result = await client.rpc("current_user_role");
    if (result.error) return null;
    return parseAppRole(result.data);
  } catch (_error) {
    return null;
  }
}

export async function requireAppRole(
  client: AppRoleRpcClient,
  allowedRoles: readonly AppRole[],
  message: "admin role required" | "read-only role required",
): Promise<AppRole> {
  const role = await resolveCurrentUserRole(client);
  if (!role || !allowedRoles.includes(role)) throw new AppRoleError(message);
  return role;
}

export async function requireAdmin(client: AppRoleRpcClient): Promise<"admin"> {
  return await requireAppRole(client, ["admin"], "admin role required") as "admin";
}

export async function requireReadOnlyRead(client: AppRoleRpcClient): Promise<AppRole> {
  return await requireAppRole(client, APP_ROLES, "read-only role required");
}
