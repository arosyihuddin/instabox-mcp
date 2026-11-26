// Checks that machine and snapshot deletes send InstaBox's X-Confirm-Delete header.
// Runs against the built dist/ (npm test builds first) and a local mock of the InstaBox API.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const seen = [];
const mock = http.createServer((req, res) => {
  seen.push({ method: req.method, url: req.url, headers: req.headers });
  res.setHeader("Content-Type", "application/json");
  if (req.method === "DELETE" && req.url.startsWith("/v1/machines/")) {
    const id = decodeURIComponent(req.url.split("/")[3]);
    if (req.headers["x-confirm-delete"] !== id) {
      res.statusCode = 409;
      return res.end(JSON.stringify({ error: { code: "delete_confirmation_required", message: `send X-Confirm-Delete: ${id}` } }));
    }
    res.statusCode = 202;
    return res.end(JSON.stringify({ id: "op_1", machineId: id, type: "delete", state: "succeeded", error: null }));
  }
  if (req.method === "DELETE" && req.url.startsWith("/v1/snapshots/")) {
    const id = decodeURIComponent(req.url.split("/")[3]);
    if (req.headers["x-confirm-delete"] !== id) {
      res.statusCode = 409;
      return res.end(JSON.stringify({ error: { code: "delete_confirmation_required", message: `send X-Confirm-Delete: ${id}` } }));
    }
    res.statusCode = 204;
    return res.end();
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: { code: "not_found", message: "mock" } }));
});

let client;

before(async () => {
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  Object.assign(process.env, {
    PUBLIC_URL: "http://localhost:3000",
    INSTABOX_API_KEY: "ib_test",
    INSTABOX_API_URL: `http://127.0.0.1:${mock.address().port}`,
    AUTH_PASSWORD: "test-password",
    TOKEN_SECRET: "x".repeat(32),
  });
  const { configureRuntime } = await import("../dist/config.js");
  configureRuntime({ PUBLIC_URL: process.env.PUBLIC_URL, AUTH_PASSWORD: process.env.AUTH_PASSWORD, INSTABOX_API_KEY: process.env.INSTABOX_API_KEY, INSTABOX_API_URL: process.env.INSTABOX_API_URL });
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { registerTools } = await import("../dist/tools.js");
  const server = new McpServer({ name: "test", version: "0" });
  registerTools(server);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "test", version: "0" });
  await client.connect(b);
});

after(async () => {
  await client?.close();
  mock.close();
});

const last = () => seen[seen.length - 1];

test("delete_machine sends X-Confirm-Delete with the machine ID", async () => {
  const r = await client.callTool({ name: "delete_machine", arguments: { id: "m_abc123", wait: false } });
  assert.ok(!r.isError, r.content?.[0]?.text);
  assert.equal(last().method, "DELETE");
  assert.equal(last().url, "/v1/machines/m_abc123");
  assert.equal(last().headers["x-confirm-delete"], "m_abc123");
  assert.ok(last().headers["idempotency-key"]);
});

test("delete_machine by name confirms with that name", async () => {
  const r = await client.callTool({ name: "delete_machine", arguments: { id: "my-box", wait: false } });
  assert.ok(!r.isError, r.content?.[0]?.text);
  assert.equal(last().headers["x-confirm-delete"], "my-box");
});

test("delete_snapshot sends X-Confirm-Delete with the snapshot ID", async () => {
  const r = await client.callTool({ name: "delete_snapshot", arguments: { snapshotId: "sn_xyz789" } });
  assert.ok(!r.isError, r.content?.[0]?.text);
  assert.equal(last().url, "/v1/snapshots/sn_xyz789");
  assert.equal(last().headers["x-confirm-delete"], "sn_xyz789");
  assert.ok(last().headers["idempotency-key"]);
});

test("other calls do not send X-Confirm-Delete", async () => {
  await client.callTool({ name: "get_machine", arguments: { id: "m_abc123" } });
  assert.equal(last().method, "GET");
  assert.equal(last().headers["x-confirm-delete"], undefined);
});

test("a 409 delete_confirmation_required is reported with its code", async () => {
  // The tools always confirm with the ID they were given, so call the API helper directly
  // with a mismatched header to check the error text.
  const { api } = await import("../dist/instabox.js");
  await assert.rejects(
    api("DELETE", "/v1/machines/m_abc123", { idempotent: true, headers: { "X-Confirm-Delete": "m_other" } }),
    /409 delete_confirmation_required/,
  );
});
