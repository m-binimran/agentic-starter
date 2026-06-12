# The Agentic Starter

**A minimal, secure-by-default starter kit for building your own AI agent or harness.**

Clone it, delete the demo, keep the kernel — and build on a base that's safe from
the first commit. Most agent frameworks let you bolt safety on afterward. This one
makes it the trunk: every tool call travels one path —

```
model → PERMISSION GATE → guardrails → SANDBOX → tool → AUDIT → result
```

— and there is **no bypass**. A tool cannot run without passing the authority
gate, clearing the guardrails, and being written to a tamper-evident audit chain;
code and shell only ever run inside a sandbox. You don't get a framework you
*can* make safe — you get one you can't easily make unsafe.

> 📐 Architecture & the moat → [`kernel/KERNEL.md`](kernel/KERNEL.md) ·
> 🛠️ Build your own agent → [`kernel/SDK.md`](kernel/SDK.md) ·
> 🔒 Zero-telemetry guarantee → [`kernel/PRIVACY.md`](kernel/PRIVACY.md)

## Build your own secure agent (~20 lines)

```ts
import { createKernel, defineTool } from "./kernel/src/kernel.ts";
import { OllamaProvider } from "./kernel/src/llm/ollama.ts"; // local, BYO key, $0

const kernel = createKernel({ llm: new OllamaProvider() });

kernel.addTool(defineTool({
  name: "add",
  description: "Add two numbers",
  category: "run_code",
  inputSchema: { a: { type: "number" }, b: { type: "number" } },
  handler: ({ a, b }) => ({ sum: Number(a) + Number(b) }),
}));

console.log((await kernel.run("What is 2 + 40?")).output); // → "The answer is 42."
```

That agent is already safe: give it a tool whose `category` is a circuit breaker
(`delete_file`, `send_email`, `make_purchase`, …) and the kernel refuses to run it
unattended unless you supply an approval handler — and every call is audited.
Run it: `node --experimental-strip-types kernel/examples/agent.ts`.

## What you're building on

- 🔒 **No-bypass authority + audit chokepoint** — every tool call goes through one
  gate. Untrusted/direct-API callers are permission-checked and audited; circuit
  breakers (delete, send, purchase, credentials…) can never be prompted away.
- 📦 **Sandboxed execution by default** — code/shell runs only inside Docker (no
  network, read-only rootfs, cpu/mem/pids limits). Refuses if Docker is absent —
  no silent host fallback. Shell is off by default.
- 🚦 **Guardrails** — dry-run mode (mutating tools return a preview), per-tool rate
  limits, file-path allowlist.
- 🔌 **Spec-compliant MCP, both ways** — expose your tools to any MCP client over
  JSON-RPC (`POST /mcp`), and import any MCP server's tools — all still gated.
- 🧠 **Local semantic memory** — embedded in a single SQLite vault; local Ollama
  embeddings with a keyword fallback. Nothing leaves the machine.
- 🗣️ **Free voice + bounded autonomous loops** — offline Vosk STT + Edge TTS, and
  goal-seeking loops with hard step/token caps that deny risky actions unattended.
- 🏠 **Local-first, BYO key, zero telemetry** — single local vault, your keys in
  the OS keychain, no analytics, no phone-home. [Audited.](kernel/PRIVACY.md)

## Tested — the invariants are locked

A starter is only useful if it's sturdy, so the security guarantees are covered by
an automated suite (runs in CI on every push). It needs only Node:

```bash
cd kernel && npm test
```

It locks what a fork must be able to trust: circuit breakers can't be
prompted/overridden away, the chokepoint blocks untrusted dangerous calls, every
call hits the audit chain, the audit chain is tamper-evident (and detects forgery),
guardrails fire, inputs are validated, the MCP gate holds, and — where Docker is
present — the sandbox really has no network and a read-only rootfs.

## The demo (delete it freely)

To prove the kernel end-to-end, this ships with a small personal-assistant app you
can rip out: a voice **orb** (web UI), an always-on desktop **pill** with screen
guidance, and a multi-agent workforce. They're reference clients under
[`examples/`](examples) that talk to the kernel purely over its HTTP API — swap
them for your own, or delete them and keep just `kernel/`.

## Architecture

The kernel is the engine; the UIs are swappable clients over its HTTP API.

| Part | Folder | Stack | Port |
|------|--------|-------|------|
| **Kernel** — the secure base | `kernel` | Node + Hono, SQLite vault | `9101` |
| Orb web UI *(example client)* | `examples/orb-ui` | Static HTML + in-browser React/Babel | `3020` |
| Desktop overlay *(example client)* | `examples/overlay` | Electron (electron-forge + Vite) | — |

## Quick start

**Prerequisites:** [Node.js 22+](https://nodejs.org) (runs TypeScript directly via
`--experimental-strip-types`).

```bash
# 1. The kernel
cd kernel
npm install
node --experimental-strip-types src/index.ts      # http://127.0.0.1:9101

# 2. (optional) the demo orb web UI, second terminal
cd examples/orb-ui && node serve.js                # http://127.0.0.1:3020

# 3. (optional) the demo desktop pill + overlay
cd examples/overlay && npm install && npm start
```

Then paste **one** model API key (a free [build.nvidia.com](https://build.nvidia.com)
key works great), or run Ollama for a fully local, fully free, zero-outbound setup.
Keys are stored in your OS keychain.

## Bring your own brain

Speaks the OpenAI-compatible chat API plus Google Gemini and Anthropic:

- **NVIDIA NIM** (`build.nvidia.com`) — free dev credits, the default
- **Google Gemini**, **OpenAI**, **Anthropic**, **DeepSeek** — paid, faster/sharper
- **Ollama** — fully local, fully free (zero outbound calls)

## The seams (build on any layer)

| Layer | Where | Swap in… |
|-------|-------|----------|
| Models | `kernel/src/llm/` | any OpenAI-compatible / Gemini / Anthropic / Ollama adapter |
| Tools | `kernel/src/mcp/` + `defineTool()` | your own tools, or any MCP server (`addMcpServer`) |
| Permissions | `kernel/src/authority/engine.ts` | your own modes/overrides (circuit breakers stay) |
| Memory | `kernel/src/memory.ts` | sqlite-vec or any vector store (same API) |
| Agents | `kernel/src/agents/` | your own orchestration; or just use `kernel.run()` |
| Clients | `examples/` | your own UI over the HTTP API |

## Contributing

Issues and PRs welcome — this is a foundation for others to build on. Please keep
`npm test` green.

## License

**Dual-licensed — take your pick.** Either:

- [Apache License 2.0](LICENSE-APACHE) (explicit patent grant), **or**
- [MIT License](LICENSE-MIT) (dead simple)

**at your option.** `SPDX-License-Identifier: MIT OR Apache-2.0`

Build on it, fork it, ship it (commercial use included) under whichever fits. Keep
the notices. Provided as-is, no warranty.
