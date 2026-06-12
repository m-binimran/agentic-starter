import "./_setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { isShellEnabled, setShellEnabled, dockerAvailable, runInSandbox } from "../src/sandbox.ts";

test("shell is OFF by default and toggles", () => {
  // (assumes JARVIS_ENABLE_SHELL is not set in the test env)
  assert.equal(isShellEnabled(), false);
  setShellEnabled(true);  assert.equal(isShellEnabled(), true);
  setShellEnabled(false); assert.equal(isShellEnabled(), false);
});

test("dockerAvailable returns a boolean (never throws)", () => {
  assert.equal(typeof dockerAvailable(true), "boolean");
});

test("runInSandbox refuses when Docker is absent (no host fallback)", { skip: dockerAvailable() }, () => {
  const r = runInSandbox("echo", ["hi"]);
  assert.equal(r.ok, false);
  assert.match(String(r.error), /unavailable|refused/i);
});

// These only run where Docker is present; they prove real isolation.
test("sandbox executes code in an isolated container", { skip: !dockerAvailable() }, () => {
  const r = runInSandbox("python3", ["-c", "print(6*7)"]);
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout.trim(), "42");
});

test("sandbox has NO network", { skip: !dockerAvailable() }, () => {
  const r = runInSandbox("python3", ["-c",
    "import urllib.request as u\ntry:\n u.urlopen('http://example.com',timeout=4);print('REACHED')\nexcept Exception:\n print('NO_NETWORK')"]);
  assert.equal(r.stdout.trim(), "NO_NETWORK");
});

test("sandbox rootfs is read-only (only /work is writable)", { skip: !dockerAvailable() }, () => {
  const r = runInSandbox("sh", ["-c", "echo x > /etc/x 2>&1 || echo READONLY; echo y > /work/f && cat /work/f"]);
  assert.match(r.stdout, /READONLY/);
  assert.match(r.stdout, /y/);
});
