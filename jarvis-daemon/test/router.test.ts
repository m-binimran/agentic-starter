import "./_setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { MCPRouter, buildDefaultRouter, type MCPConnector } from "../src/mcp/router.ts";
import { AuthorityEngine } from "../src/authority/engine.ts";
import { getAuditTrail } from "../src/authority/audit.ts";
import { setDryRun } from "../src/guardrails.ts";

// Hermetic router of inert tools so we test the chokepoint, not the filesystem.
function testRouter(): MCPRouter {
  const r = new MCPRouter();
  const conn: MCPConnector = {
    id: "t", name: "t", description: "test",
    tools: [
      { name: "t_read", description: "", category: "read_file", inputSchema: {}, handler: async () => ({ ok: true }) },
      { name: "t_write", description: "", category: "write_file", inputSchema: {}, handler: async () => ({ ok: true }) },
      { name: "t_delete", description: "", category: "delete_file", inputSchema: {}, handler: async () => ({ ok: true }) },
    ],
  };
  r.register(conn);
  r.setAuthority(new AuthorityEngine("productive"));
  return r;
}

test("unknown tool is rejected", async () => {
  await assert.rejects(() => testRouter().call("nope", {}), /not found/);
});

test("untrusted call to a circuit breaker is BLOCKED at the chokepoint", async () => {
  await assert.rejects(() => testRouter().call("t_delete", {}), /AUTHORITY/);
});

test("trusted (agent) call passes the gate", async () => {
  const out = await testRouter().call("t_delete", {}, { trusted: true });
  assert.deepEqual(out, { ok: true });
});

test("untrusted auto-approved tool runs", async () => {
  const out = await testRouter().call("t_read", {});
  assert.deepEqual(out, { ok: true });
});

test("every call is written to the audit chain (and the chain stays valid)", async () => {
  const r = testRouter();
  await r.call("t_read", {});
  await r.call("t_read", {});
  const v = getAuditTrail().verify();
  assert.equal(v.valid, true);
  assert.ok(v.totalRecords >= 2);
});

test("dry-run intercepts a mutating tool (no execution, returns a preview)", async () => {
  const r = testRouter();
  setDryRun(true);
  const out = await r.call("t_write", { a: 1 }, { trusted: true }) as { dryRun?: boolean; wouldRun?: string };
  setDryRun(false);
  assert.equal(out.dryRun, true);
  assert.equal(out.wouldRun, "t_write");
});

test("rate limiter eventually blocks a hammered tool", async () => {
  const r = testRouter();
  let blocked = false;
  for (let i = 0; i < 40; i++) {
    try { await r.call("t_read", {}, { trusted: true }); }
    catch (e) { if (/Rate limit/.test(String(e))) { blocked = true; break; } }
  }
  assert.equal(blocked, true);
});

test("required string params are validated at the boundary (no 'undefined' path)", async () => {
  const r = buildDefaultRouter();
  r.setAuthority(new AuthorityEngine("productive"));
  await assert.rejects(() => r.call("read_file", {}), /required/);
});
