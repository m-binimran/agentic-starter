import "./_setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { getAuditTrail } from "../src/authority/audit.ts";
import { getDb } from "../src/vault/schema.ts";

test("the audit chain is a valid hash chain after writes", () => {
  const a = getAuditTrail();
  a.log({ action: "tool_call", payload: { tool: "x" } });
  a.log({ action: "tool_result", payload: { ok: true } });
  a.log({ action: "permission_check", payload: { c: "read_file" } });
  const v = a.verify();
  assert.equal(v.valid, true);
  assert.ok(v.totalRecords >= 3);
});

test("tampering with a past record breaks the chain (tamper-evident)", () => {
  const a = getAuditTrail();
  a.log({ action: "tool_call", payload: { amount: 1 } });
  a.log({ action: "tool_result", payload: { ok: true } });
  assert.equal(a.verify().valid, true);

  // Forge a historical payload directly in the DB...
  const row = getDb().query<{ id: string }>(
    `SELECT id FROM audit_trail ORDER BY created_at ASC LIMIT 1`
  ).get();
  getDb().run(`UPDATE audit_trail SET payload=? WHERE id=?`, [JSON.stringify({ amount: 999999 }), row!.id]);

  // ...and the chain must now report itself broken.
  const v = a.verify();
  assert.equal(v.valid, false);
  assert.ok(v.brokenAt);
});
