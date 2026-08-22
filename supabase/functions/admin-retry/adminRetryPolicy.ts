export const ADMIN_RETRY_ACTIONS = [
  "resend_delivery",
  "retry_failed_deliveries",
  "test_template",
  "test_webhook",
  "retry_delivery",
] as const;

/** `test_webhook` is inbound RSS validation/ingest. It is not provider posting. */
export const ADMIN_RETRY_INBOUND_INGEST_ACTION = "test_webhook" as const;

export type AdminRetryActionClass =
  | "inbound_rss_ingest"
  | "telegram_provider_write"
  | "external_delivery_retry"
  | "legacy_delivery_retry";

export type AdminRetryAction = typeof ADMIN_RETRY_ACTIONS[number];

const ADMIN_RETRY_ACTION_SET = new Set<string>(ADMIN_RETRY_ACTIONS);

export function isAdminRetryAction(value: unknown): value is AdminRetryAction {
  return typeof value === "string" && ADMIN_RETRY_ACTION_SET.has(value);
}

export function classifyAdminRetryAction(
  action: AdminRetryAction,
): AdminRetryActionClass {
  if (action === ADMIN_RETRY_INBOUND_INGEST_ACTION) return "inbound_rss_ingest";
  if (action === "test_template") return "telegram_provider_write";
  if (action === "retry_delivery") return "legacy_delivery_retry";
  return "external_delivery_retry";
}

export function adminRetryActionError(value: unknown): {
  status: 400;
  body: { success: false; error: "action is required" | "unknown admin-retry action"; code: string };
} {
  return typeof value === "undefined"
    ? {
      status: 400,
      body: { success: false, error: "action is required", code: "admin_retry_action_missing" },
    }
    : {
      status: 400,
      body: { success: false, error: "unknown admin-retry action", code: "admin_retry_action_unknown" },
    };
}
