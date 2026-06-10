/**
 * Autonomous agent loop.
 *
 * Give it a goal and it works toward it across multiple steps on its own —
 * planning, acting (through the normal dispatch path, so tools stay behind the
 * authority engine + firewall), and deciding when it's done — until either the
 * goal is reached or a guardrail trips.
 *
 * SECURITY / RELIABILITY GUARDRAILS (this is a "reliable, secure base", so the
 * loop is bounded by design, never open-ended):
 *   - Hard step cap (default 8, absolute max 25) — it cannot run forever.
 *   - Token budget — it stops when the budget is spent.
 *   - Per-step timeout — a stuck step can't wedge the loop.
 *   - Concurrency cap — only a few loops can run at once (runaway-cost guard).
 *   - Cancellable — stopLoop() halts it at the next step boundary.
 *   - Unattended approvals are DENIED — circuit-breaker actions (delete, send,
 *     purchase, …) never auto-fire while no human is watching. The loop can plan
 *     them and report that they need a human, but it won't execute them.
 */

import type { Orchestrator } from "./orchestrator.ts";
import { generateId, now } from "../vault/schema.ts";
import { getAuditTrail } from "../authority/audit.ts";

const HARD_MAX_STEPS = 25;        // absolute ceiling regardless of request
const DEFAULT_MAX_STEPS = 8;
const DEFAULT_TOKEN_BUDGET = 60_000;
const STEP_TIMEOUT_MS = 120_000;
const MAX_CONCURRENT = 3;
const RETAIN_MS = 60 * 60_000;    // keep finished loops for an hour

export type LoopStatus = "running" | "done" | "stopped" | "limit" | "budget" | "error";

export interface LoopStep { n: number; output: string; tokens: number; at: number; }

export interface LoopState {
  id: string;
  goal: string;
  status: LoopStatus;
  steps: LoopStep[];
  maxSteps: number;
  tokenBudget: number;
  tokensUsed: number;
  startedAt: number;
  endedAt?: number;
  summary?: string;
  error?: string;
}

interface LoopRecord extends LoopState { stop: boolean; }

const loops = new Map<string, LoopRecord>();

function sweep(): void {
  const cutoff = Date.now() - RETAIN_MS;
  for (const [id, l] of loops) {
    if (l.status !== "running" && (l.endedAt ?? 0) < cutoff) loops.delete(id);
  }
}

function publicView(l: LoopRecord): LoopState {
  const { stop, ...rest } = l;
  return rest;
}

function runningCount(): number {
  let n = 0;
  for (const l of loops.values()) if (l.status === "running") n++;
  return n;
}

/** Build the per-step instruction: first step kicks off, later steps continue with history. */
function buildPrompt(goal: string, steps: LoopStep[]): string {
  const rules =
    'When the goal is fully achieved, reply with a line that starts EXACTLY with ' +
    '"GOAL COMPLETE:" followed by a one-paragraph summary. If a step needs an action ' +
    'you are not allowed to take unattended (sending, deleting, purchasing, etc.), say so ' +
    'and treat the goal as blocked rather than pretending it is done.';
  if (steps.length === 0) {
    return `You are working autonomously toward this goal:\n\n"${goal}"\n\n` +
      `Take the single next concrete step now (use your tools if needed) and report what you did. ${rules}`;
  }
  const history = steps.map(s => `Step ${s.n}: ${s.output}`).join("\n\n").slice(-6000);
  return `Goal: "${goal}"\n\nWork so far:\n${history}\n\n` +
    `Continue with the next concrete step. Do not repeat work already done. ${rules}`;
}

async function dispatchStep(
  orchestrator: Orchestrator,
  prompt: string,
  conversationId: string,
  agentId: string
): Promise<{ output: string; tokens: number }> {
  const result = await Promise.race([
    orchestrator.dispatch({
      userMessage: prompt,
      conversationId,
      preferredAgentId: agentId,
      // Unattended: never approve circuit-breaker actions. The loop is autonomous,
      // not unrestricted — anything dangerous is blocked until a human is present.
      onApprovalNeeded: async () => false,
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("step timed out")), STEP_TIMEOUT_MS)
    ),
  ]);
  return {
    output: (result as { output?: string }).output ?? "",
    tokens: (result as { tokensUsed?: number }).tokensUsed ?? 0,
  };
}

async function runLoop(orchestrator: Orchestrator, rec: LoopRecord, agentId: string): Promise<void> {
  const conversationId = generateId(); // shared so the agent remembers prior steps
  const audit = getAuditTrail();
  try {
    for (let n = 1; n <= rec.maxSteps; n++) {
      if (rec.stop) { rec.status = "stopped"; break; }
      if (rec.tokensUsed >= rec.tokenBudget) { rec.status = "budget"; break; }

      const { output, tokens } = await dispatchStep(orchestrator, buildPrompt(rec.goal, rec.steps), conversationId, agentId);
      rec.tokensUsed += tokens;
      rec.steps.push({ n, output, tokens, at: now() });
      audit.log({ action: "agent_loop_step", payload: { loopId: rec.id, step: n, tokens } });

      if (/^\s*GOAL COMPLETE:/im.test(output)) {
        rec.status = "done";
        rec.summary = output.replace(/[\s\S]*?GOAL COMPLETE:/i, "").trim().slice(0, 2000);
        break;
      }
    }
    if (rec.status === "running") rec.status = "limit"; // hit the step cap without finishing
  } catch (e) {
    rec.status = "error";
    rec.error = e instanceof Error ? e.message : String(e);
  } finally {
    rec.endedAt = now();
    audit.log({ action: "agent_loop_end", payload: { loopId: rec.id, status: rec.status, steps: rec.steps.length } });
  }
}

/** Start an autonomous loop toward `goal`. Returns the loop id (runs in the background). */
export function startLoop(
  orchestrator: Orchestrator,
  goal: string,
  opts: { maxSteps?: number; tokenBudget?: number; agentId?: string } = {}
): { id: string } | { error: string } {
  sweep();
  if (runningCount() >= MAX_CONCURRENT) {
    return { error: `Too many loops running (max ${MAX_CONCURRENT}). Stop one first.` };
  }
  const id = generateId();
  const rec: LoopRecord = {
    id,
    goal: goal.slice(0, 2000),
    status: "running",
    steps: [],
    maxSteps: Math.min(Math.max(1, opts.maxSteps ?? DEFAULT_MAX_STEPS), HARD_MAX_STEPS),
    tokenBudget: Math.max(1000, opts.tokenBudget ?? DEFAULT_TOKEN_BUDGET),
    tokensUsed: 0,
    startedAt: now(),
    stop: false,
  };
  loops.set(id, rec);
  getAuditTrail().log({ action: "agent_loop_start", payload: { loopId: id, goal: rec.goal, maxSteps: rec.maxSteps } });
  void runLoop(orchestrator, rec, opts.agentId ?? "jarvis");
  return { id };
}

/** Request a running loop to stop at the next step boundary. */
export function stopLoop(id: string): boolean {
  const l = loops.get(id);
  if (!l || l.status !== "running") return false;
  l.stop = true;
  return true;
}

export function getLoop(id: string): LoopState | null {
  sweep();
  const l = loops.get(id);
  return l ? publicView(l) : null;
}

export function listLoops(): LoopState[] {
  sweep();
  return [...loops.values()].sort((a, b) => b.startedAt - a.startedAt).map(publicView);
}
