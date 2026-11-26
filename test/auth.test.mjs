import { test } from "node:test";
import assert from "node:assert/strict";
import { constantTimeEqual, resolveStaticBearerToken } from "../dist/auth.js";

const configuredToken = "test-static-bearer-token-0123456789abcdef";
const audience = "https://instabox.example/mcp";

test("static bearer token resolves to an identity scoped to the MCP resource", async () => {
  assert.deepEqual(
    await resolveStaticBearerToken(configuredToken, configuredToken, audience),
    { props: { userId: "static-bearer" }, audience },
  );
});

test("invalid static bearer token is rejected", async () => {
  assert.equal(await resolveStaticBearerToken("wrong-token", configuredToken, audience), null);
});

test("static bearer authentication is disabled when no token is configured", async () => {
  assert.equal(await resolveStaticBearerToken(configuredToken, undefined, audience), null);
});

test("secret comparison accepts equal values and rejects different values", async () => {
  assert.equal(await constantTimeEqual("same-secret", "same-secret"), true);
  assert.equal(await constantTimeEqual("same-secret", "other-secret"), false);
});
