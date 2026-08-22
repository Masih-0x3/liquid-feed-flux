import { assert } from "jsr:@std/assert";

Deno.test("manual posting guard precedes durable post_requested state and event writes", async () => {
  const source = await Deno.readTextFile(new URL("./manualVideoIntakeActions.ts", import.meta.url));
  const guards = [...source.matchAll(/await runManualExternalPostingGuard\(supabase, deps\);/g)]
    .map((match) => match.index ?? -1);
  const state = source.indexOf('status: "post_requested"');
  const event = source.indexOf('action: "post_requested"');
  const snapshot = source.indexOf("const snapshot = await assembleSnapshot");
  const invoke = source.indexOf("/functions/v1/x-poster");
  assert(guards.length >= 2);
  assert(snapshot > guards[0]);
  assert(guards[1] > snapshot);
  assert(invoke > guards[1]);
  assert(state > invoke);
  assert(event > invoke);
});
