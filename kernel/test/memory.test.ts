import "./_setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Memory } from "../src/memory.ts";

// Works whether or not Ollama is running: with embeddings it uses cosine, without
// it falls back to keyword recall. Either way these invariants must hold.
test("remember stores and count reflects it", async () => {
  const m = new Memory();
  await m.remember("the secure kernel moat is the authority gate");
  assert.ok(m.count() >= 1);
});

test("recall finds a relevant memory", async () => {
  const m = new Memory();
  await m.remember("the public repo is github dot com slash m-binimran slash agentic-starter");
  const hits = await m.recall("github repo agentic-starter", 3);
  assert.ok(hits.length >= 1);
  assert.match(hits[0].text, /github|agentic-starter/);
});

test("forget removes a memory", async () => {
  const m = new Memory();
  const id = await m.remember("ephemeral note to delete");
  const before = m.count();
  m.forget(id);
  assert.equal(m.count(), before - 1);
});

test("recall always returns an array and never throws (graceful, Ollama up or down)", async () => {
  const m = new Memory();
  const hits = await m.recall("anything at all", 5);
  assert.equal(Array.isArray(hits), true);
  // empty/whitespace query must not throw either
  assert.equal(Array.isArray(await m.recall("   ", 5)), true);
});
