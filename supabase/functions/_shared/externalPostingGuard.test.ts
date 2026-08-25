import {
  evaluateExternalPosting,
  type ExternalPostingClient,
} from "./externalPostingGuard.ts";

function client(
  data: unknown,
  error: { message: string } | null = null,
): ExternalPostingClient {
  return {
    from: () => ({
      select: () => {
        const query = Promise.resolve({ data, error }) as unknown as ReturnType<
          ReturnType<ExternalPostingClient["from"]>["select"]
        >;
        query.limit = () => query;
        return query;
      },
    }),
  };
}

Deno.test("posting requires all three production controls", async () => {
  const result = await evaluateExternalPosting(
    client([{ environment: "production", posting_mode: "enabled" }]),
    { environment: "production", allowExternalPosting: "true" },
  );
  if (!result.allowed || result.reason !== "allowed") {
    throw new Error(`expected allowed, got ${JSON.stringify(result)}`);
  }
});

Deno.test("blocked database control wins even when environment allows posting", async () => {
  const result = await evaluateExternalPosting(
    client([{ environment: "production", posting_mode: "blocked" }]),
    { environment: "production", allowExternalPosting: "true" },
  );
  if (result.allowed || result.reason !== "database_control") {
    throw new Error(`expected database_control, got ${JSON.stringify(result)}`);
  }
});

Deno.test("preview, missing rows, duplicate rows, and environment breaker fail closed", async () => {
  const cases = [
    await evaluateExternalPosting(
      client([{ environment: "preview", posting_mode: "blocked" }]),
      { environment: "preview", allowExternalPosting: "true" },
    ),
    await evaluateExternalPosting(client([]), {
      environment: "production",
      allowExternalPosting: "true",
    }),
    await evaluateExternalPosting(
      client([
        { environment: "production", posting_mode: "enabled" },
        { environment: "production", posting_mode: "enabled" },
      ]),
      { environment: "production", allowExternalPosting: "true" },
    ),
    await evaluateExternalPosting(
      client([{ environment: "production", posting_mode: "enabled" }]),
      { environment: "production", allowExternalPosting: "false" },
    ),
  ];
  const reasons = cases.map((item) => item.reason);
  const expected = [
    "preview_environment",
    "controls_unavailable",
    "controls_unavailable",
    "environment_breaker",
  ];
  if (JSON.stringify(reasons) !== JSON.stringify(expected)) {
    throw new Error(`unexpected reasons ${JSON.stringify(reasons)}`);
  }
});
