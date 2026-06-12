import "./_setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createKernel, defineTool } from "../src/kernel.ts";
import type { LLMProvider, LLMResponse } from "../src/llm/provider.ts";

// Deterministic stub model: asks for the tool once, then answers from the result.
const stub: LLMProvider = {
  name: "stub", defaultModel: "stub",
  async isAvailable() { return true; },
  async complete(messages): Promise<LLMResponse> {
    const last = messages[messages.length - 1].content;
    const content = last.startsWith("TOOL_RESULT")
      ? `Final: ${JSON.parse(last.slice("TOOL_RESULT:".length)).sum}`
      : `TOOL_CALL:add:{ "a": 2, "b": 40 }`;
    return { content, model: "stub", provider: "stub", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 } };
  },
  async *stream() { yield { delta: "", done: true }; },
};

function addTool() {
  return defineTool({
    name: "add", description: "add", category: "run_code",
    inputSchema: { a: { type: "number" }, b: { type: "number" } },
    handler: ({ a, b }) => ({ sum: Number(a) + Number(b) }),
  });
}

test("createKernel + defineTool + run() drives a tool call to a final answer", async () => {
  const k = createKernel({ llm: stub, memory: false });
  k.addTool(addTool());
  const res = await k.run("what is 2 + 40?");
  assert.match(res.output, /42/);
  assert.equal(res.toolCalls, 1);
});

test("kernel.call() is untrusted by default — circuit breakers are blocked", async () => {
  const k = createKernel({ memory: false });
  k.addTool(defineTool({ name: "wipe", description: "del", category: "delete_file", handler: () => ({ ok: true }) }));
  await assert.rejects(() => k.call("wipe", { path: "x" }), /AUTHORITY/);
});

test("run() is unattended-safe: approval-required actions are denied by default", async () => {
  // model tries to call a gated tool; with no onApproval the kernel must refuse it.
  const denyStub: LLMProvider = {
    ...stub,
    async complete(messages): Promise<LLMResponse> {
      const last = messages[messages.length - 1].content;
      const content = last.startsWith("TOOL_RESULT") ? "done" : `TOOL_CALL:send:{}`;
      return { content, model: "stub", provider: "stub", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 } };
    },
  };
  const k = createKernel({ llm: denyStub, memory: false });
  let executed = false;
  k.addTool(defineTool({ name: "send", description: "send mail", category: "send_email", handler: () => { executed = true; return { sent: true }; } }));
  await k.run("send it");
  assert.equal(executed, false, "a circuit-breaker tool must NOT execute unattended");
});

test("memory is on by default, and opt-out works", () => {
  assert.notEqual(createKernel({ memory: true }).memory, null);
  assert.equal(createKernel({ memory: false }).memory, null);
});
