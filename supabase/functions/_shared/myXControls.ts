export const MY_X_DISABLED_RESPONSE = {
  ok: true,
  disabled: true,
  reason: "my_x_disabled",
} as const;

export function isMyXEnabled(value: unknown): boolean {
  return Boolean(
    value
      && typeof value === "object"
      && (value as Record<string, unknown>).my_x_enabled === true,
  );
}
