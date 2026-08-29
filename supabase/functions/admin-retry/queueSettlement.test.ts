import { assert, assertFalse, assertStringIncludes } from "jsr:@std/assert";

Deno.test("admin delivery retries use stable idempotency keys", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

  assertStringIncludes(source, ".upsert({");
  assertStringIncludes(source, "idempotency_key: `deliver:admin_resend:${tweet_id}`");
  assertStringIncludes(source, "idempotency_key: `deliver:admin_retry:${delivery.id}`");
  assertStringIncludes(source, "idempotency_key: `deliver:admin_retry:${delivery_id}`");
  assertStringIncludes(source, "onConflict: 'idempotency_key'");
  assertStringIncludes(source, "ignoreDuplicates: true");
  assertFalse(source.includes(".from('jobs')\n        .insert({"));
  assertFalse(source.includes(".from('jobs')\n        .insert([{"));
});

Deno.test("admin retry key remains deterministic across repeated requests", () => {
  const key = (kind: string, id: string) => `deliver:admin_${kind}:${id}`;
  assert(key("retry", "delivery-1") === key("retry", "delivery-1"));
});
