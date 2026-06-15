import { assertEquals } from "jsr:@std/assert";
import {
  recordCompatibilityUsage,
  requestPathForTelemetry,
} from "./compatibilityTelemetry.ts";

Deno.test("requestPathForTelemetry strips query strings", () => {
  const req = new Request(
    "https://example.test/functions/v1/webhooks-rssapp?token=secret",
  );

  assertEquals(requestPathForTelemetry(req), "/functions/v1/webhooks-rssapp");
});

Deno.test("recordCompatibilityUsage writes sanitized event rows", async () => {
  const calls: Array<{ table: string; row: Record<string, unknown> }> = [];
  const supabase = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          calls.push({ table, row });
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  await recordCompatibilityUsage(supabase, {
    source: "webhooks-rssapp",
    feature: "rss_query_token",
    legacyValue: "query:token",
    canonicalValue: "header:x-webhook-token",
    action: "require_rss_webhook_auth",
    request: new Request(
      "https://example.test/functions/v1/webhooks-rssapp?token=secret",
    ),
    metadata: { token_source: "query:token", ignored: undefined },
  });

  assertEquals(calls, [{
    table: "compatibility_usage_events",
    row: {
      source: "webhooks-rssapp",
      feature: "rss_query_token",
      legacy_value: "query:token",
      canonical_value: "header:x-webhook-token",
      action: "require_rss_webhook_auth",
      actor_id: null,
      request_method: "GET",
      request_path: "/functions/v1/webhooks-rssapp",
      metadata: { token_source: "query:token" },
    },
  }]);
});

Deno.test("recordCompatibilityUsage swallows insert failures", async () => {
  const warnings: unknown[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args);
  try {
    await recordCompatibilityUsage({
      from() {
        return {
          insert() {
            throw new Error("missing table");
          },
        };
      },
    }, {
      source: "admin-actions",
      feature: "admin_action_alias",
      legacyValue: "backfill_signatures",
      canonicalValue: "backfill_dedupe",
    });
    await recordCompatibilityUsage({
      from() {
        return {
          insert() {
            return Promise.resolve({ error: { message: "missing table" } });
          },
        };
      },
    }, {
      source: "admin-actions",
      feature: "monitoring_filter_alias",
      legacyValue: "needs-action",
      canonicalValue: "needs_attention",
    });
  } finally {
    console.warn = originalWarn;
  }

  assertEquals(warnings.length, 2);
});
