import assert from "node:assert/strict";
import test from "node:test";
import { isAuthorizedRendererRequest, normalizeRendererToken } from "../src/config.js";

test("normalizes renderer dispatch tokens", () => {
  assert.equal(normalizeRendererToken("  secret-token  "), "secret-token");
  assert.equal(normalizeRendererToken(""), "");
  assert.equal(normalizeRendererToken(null), "");
});

test("authorizes exact bearer token", () => {
  assert.equal(isAuthorizedRendererRequest({
    authorization: "Bearer secret-token",
  }, "  secret-token  "), true);
});

test("fails closed when token is missing or mismatched", () => {
  assert.equal(isAuthorizedRendererRequest({
    authorization: "Bearer secret-token",
  }, ""), false);
  assert.equal(isAuthorizedRendererRequest({}, "secret-token"), false);
  assert.equal(isAuthorizedRendererRequest({
    authorization: "Bearer other-token",
  }, "secret-token"), false);
});
