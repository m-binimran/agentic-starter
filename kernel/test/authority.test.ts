import "./_setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { AuthorityEngine, CIRCUIT_BREAKERS } from "../src/authority/engine.ts";

test("circuit breakers ALWAYS require approval — in every mode, even bypass", () => {
  for (const mode of ["safe", "productive", "auto", "bypass"] as const) {
    const eng = new AuthorityEngine(mode);
    for (const cb of CIRCUIT_BREAKERS) {
      const d = eng.check(cb);
      assert.equal(d.requiresApproval, true, `${cb} in ${mode} must require approval`);
      assert.equal(d.isCircuitBreaker, true);
    }
  }
});

test("a prompt/override cannot turn a circuit breaker into auto-approve", () => {
  const eng = new AuthorityEngine("productive");
  eng.setOverride("delete_file", "allow"); // attempt to bypass — must be ignored
  const d = eng.check("delete_file");
  assert.equal(d.requiresApproval, true);
});

test("productive mode auto-approves the safe set", () => {
  const eng = new AuthorityEngine("productive");
  for (const a of ["read_file", "web_browse", "calendar_write", "run_code", "agent_spawn"] as const) {
    assert.equal(eng.check(a).requiresApproval, false, `${a} should auto-approve`);
  }
});

test("imported external_tool is NEVER auto-approved (unknown blast radius)", () => {
  for (const mode of ["safe", "productive", "auto"] as const) {
    assert.equal(new AuthorityEngine(mode).check("external_tool").requiresApproval, true);
  }
});

test("deny override blocks a non-circuit-breaker action", () => {
  const eng = new AuthorityEngine("productive");
  eng.setOverride("read_file", "deny");
  const d = eng.check("read_file");
  assert.equal(d.allowed, false);
});
