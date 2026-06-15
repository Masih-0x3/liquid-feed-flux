import { assertEquals } from "jsr:@std/assert";
import {
  isProviderQuotaExhaustedError,
  isRetryableProviderError,
} from "./providerErrors.ts";

Deno.test("provider error classification treats insufficient quota as non-retryable", () => {
  const message =
    'OpenAI translation error: 429 {"error":{"code":"insufficient_quota","message":"You exceeded your current quota, please check your plan and billing details."}}';

  assertEquals(isProviderQuotaExhaustedError(message), true);
  assertEquals(isRetryableProviderError(message), false);
});

Deno.test("provider error classification keeps transient provider failures retryable", () => {
  assertEquals(
    isRetryableProviderError("embedding_error:503:upstream unavailable"),
    true,
  );
  assertEquals(
    isRetryableProviderError(
      "OpenAI translation error: 429 rate limit exceeded",
    ),
    true,
  );
  assertEquals(
    isProviderQuotaExhaustedError(
      "OpenAI translation error: 429 rate limit exceeded",
    ),
    false,
  );
});
