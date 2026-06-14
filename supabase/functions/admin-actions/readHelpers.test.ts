import { assertEquals } from "jsr:@std/assert";
import {
  isFailedJobActionable,
  isMissingSchemaError,
  jobReferenceValues,
  monitoringPolicyRuleKind,
  tweetReferenceVariants,
} from "./readHelpers.ts";

Deno.test("tweetReferenceVariants expands numeric and URL tweet references", () => {
  assertEquals(tweetReferenceVariants("https://x.com/status/1234567890"), [
    "https://x.com/status/1234567890",
    "1234567890",
    "https://twitter.com/i/status/1234567890",
    "https://twitter.com/status/1234567890",
    "https://x.com/i/status/1234567890",
  ]);
});

Deno.test("jobReferenceValues collects payload and idempotency tweet references", () => {
  const refs = jobReferenceValues({
    payload: {
      tweet_id: "1111111111",
      src_url: "https://twitter.com/status/2222222222",
    },
    idempotency_key: "deliver:3333333333",
  });

  assertEquals(refs.includes("1111111111"), true);
  assertEquals(refs.includes("https://twitter.com/status/2222222222"), true);
  assertEquals(refs.includes("2222222222"), true);
  assertEquals(refs.includes("3333333333"), true);
});

Deno.test("isFailedJobActionable ignores resolved admin and terminal skipped failures", () => {
  assertEquals(isFailedJobActionable({ status: "failed" }, null), true);
  assertEquals(isFailedJobActionable({ status: "running" }, null), false);
  assertEquals(isFailedJobActionable({ status: "failed", result_meta: { admin_ignored: true } }, null), false);
  assertEquals(
    isFailedJobActionable(
      { status: "failed" },
      { delivery_decision: "skip", score_review_status: "rejected" },
    ),
    false,
  );
  assertEquals(
    isFailedJobActionable(
      { status: "failed" },
      { delivery_decision: "skip", score_review_status: "needs_review" },
    ),
    true,
  );
});

Deno.test("schema and policy helpers preserve dashboard and monitoring fallbacks", () => {
  assertEquals(isMissingSchemaError({ code: "42703", message: "column missing" }), true);
  assertEquals(isMissingSchemaError({ message: "relation does not exist" }), true);
  assertEquals(isMissingSchemaError({ code: "23505", message: "duplicate key" }), false);
  assertEquals(monitoringPolicyRuleKind({ policy_rule_applied: "regional_escalation_auto" }), "regional_escalation_auto");
  assertEquals(monitoringPolicyRuleKind({ policy_rule: { kind: "global_mega_event_review" } }), "global_mega_event_review");
});
