import "./_setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleMcpRequest, MCP_PROTOCOL_VERSION } from "../src/mcp/protocol.ts";
import { buildDefaultRouter } from "../src/mcp/router.ts";
import { AuthorityEngine } from "../src/authority/engine.ts";

function router() {
  const r = buildDefaultRouter();
  r.setAuthority(new AuthorityEngine("productive"));
  return r;
}

test("initialize returns the protocol version + server info", async () => {
  const res = await handleMcpRequest(router(), { jsonrpc: "2.0", id: 1, method: "initialize" });
  assert.equal((res!.result as any).protocolVersion, MCP_PROTOCOL_VERSION);
  assert.ok((res!.result as any).serverInfo.name);
});

test("tools/list returns proper JSON-Schema inputSchemas", async () => {
  const res = await handleMcpRequest(router(), { jsonrpc: "2.0", id: 2, method: "tools/list" });
  const tools = (res!.result as any).tools as any[];
  assert.ok(tools.length > 0);
  for (const t of tools) assert.equal(t.inputSchema.type, "object");
});

test("tools/call routes through the gate: delete_file is BLOCKED (isError)", async () => {
  const res = await handleMcpRequest(router(), {
    jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: "delete_file", arguments: { path: "x" } },
  });
  assert.equal((res!.result as any).isError, true);
  assert.match((res!.result as any).content[0].text, /AUTHORITY|Circuit breaker/);
});

test("tools/call surfaces tool errors as isError (bad input)", async () => {
  const res = await handleMcpRequest(router(), {
    jsonrpc: "2.0", id: 4, method: "tools/call",
    params: { name: "read_file", arguments: {} },
  });
  assert.equal((res!.result as any).isError, true);
});

test("malformed request → JSON-RPC -32600", async () => {
  const res = await handleMcpRequest(router(), { jsonrpc: "1.0" as any, id: 5, method: "x" });
  assert.equal(res!.error!.code, -32600);
});

test("notifications (no id) get no response", async () => {
  const res = await handleMcpRequest(router(), { jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(res, null);
});

test("unknown tool → tool error, not a crash", async () => {
  const res = await handleMcpRequest(router(), {
    jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "ghost", arguments: {} },
  });
  assert.equal((res!.result as any).isError, true);
});
