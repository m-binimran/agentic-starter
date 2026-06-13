import "./_setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isMutating, isDryRun, setDryRun, rateLimitOk, isFileTool,
  setAllowedPaths, pathAllowed,
} from "../src/guardrails.ts";

test("isMutating: write/run mutate, reads do not", () => {
  assert.equal(isMutating("write_file"), true);
  assert.equal(isMutating("run_code"), true);
  assert.equal(isMutating("delete_file"), true);
  assert.equal(isMutating("read_file"), false);
  assert.equal(isMutating("web_browse"), false);
});

test("dry-run toggles", () => {
  setDryRun(false); assert.equal(isDryRun(), false);
  setDryRun(true);  assert.equal(isDryRun(), true);
  setDryRun(false);
});

test("rate limiter allows a burst then blocks", () => {
  const tool = `unit-rate-${Date.now()}`; // fresh bucket
  let allowed = 0;
  for (let i = 0; i < 60; i++) if (rateLimitOk(tool)) allowed++;
  assert.ok(allowed >= 25 && allowed <= 31, `burst ~30, got ${allowed}`);
  assert.equal(rateLimitOk(tool), false, "should be rate-limited after the burst");
});

test("path allowlist: null allows all; a list confines", () => {
  setAllowedPaths(null);
  assert.equal(pathAllowed("C:/anything/x"), true);
  setAllowedPaths(["C:/Users/user/.agentic-starter"]);
  assert.equal(pathAllowed("C:/Users/user/.agentic-starter/vault.db"), true);
  assert.equal(pathAllowed("C:/Windows/System32/secret"), false);
  setAllowedPaths(null); // reset
});

test("isFileTool identifies the fs tools", () => {
  assert.equal(isFileTool("read_file"), true);
  assert.equal(isFileTool("delete_file"), true);
  assert.equal(isFileTool("run_shell"), false);
});
