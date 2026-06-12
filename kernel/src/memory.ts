/**
 * Kernel memory tier — embedded semantic memory, local-first.
 *
 * Stores memories in the same single-file sqlite vault (no new DB, nothing leaves
 * the machine). Embeddings come from a LOCAL Ollama model; similarity is plain
 * cosine computed in-process. Deliberately NO native vector extension: a personal
 * kernel's memory is small, brute-force cosine over a few thousand vectors is
 * sub-millisecond, and avoiding a native build keeps the kernel forkable on any
 * machine (the same reason the sandbox refuses rather than depending on one).
 *
 * Graceful degradation, both axes:
 *   - Ollama up   → real semantic recall (vector cosine).
 *   - Ollama down → keyword recall (LIKE), so remember()/recall() never throw.
 * sqlite-vec can be slotted in later as a pure acceleration; the API won't change.
 */

import { getDb, generateId, now } from "./vault/schema.ts";
import type { MCPConnector } from "./mcp/router.ts";

const EMBED_URL = process.env.JARVIS_OLLAMA_URL || "http://localhost:11434";
const EMBED_MODEL = process.env.JARVIS_EMBED_MODEL || "nomic-embed-text";

let tableReady = false;
function ensureTable(): void {
  if (tableReady) return;
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS kernel_memory (
      id         TEXT PRIMARY KEY,
      text       TEXT NOT NULL,
      embedding  BLOB,
      metadata   TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  tableReady = true;
}

/** Local embedding via Ollama. Returns null if Ollama is unreachable / errored. */
export async function embed(text: string): Promise<Float32Array | null> {
  try {
    const res = await fetch(`${EMBED_URL}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { embedding?: number[] };
    return Array.isArray(data.embedding) && data.embedding.length ? Float32Array.from(data.embedding) : null;
  } catch {
    return null; // Ollama down → caller falls back to keyword recall
  }
}

function toBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}
function fromBlob(b: Buffer): Float32Array {
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  return new Float32Array(ab);
}
function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return -1;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

export interface MemoryHit {
  id: string;
  text: string;
  score: number;          // cosine [0..1], or 0 for keyword hits
  metadata: Record<string, unknown> | null;
  createdAt: number;
}

interface Row {
  id: string;
  text: string;
  embedding: Buffer | null;
  metadata: string | null;
  created_at: number;
}

export class Memory {
  /** Store a memory. Embeds it locally if Ollama is up; stores text either way. */
  async remember(text: string, metadata?: Record<string, unknown>): Promise<string> {
    ensureTable();
    const id = generateId();
    const vec = await embed(text);
    getDb().run(
      `INSERT INTO kernel_memory(id, text, embedding, metadata, created_at) VALUES(?,?,?,?,?)`,
      [id, text, vec ? toBlob(vec) : null, metadata ? JSON.stringify(metadata) : null, now()]
    );
    return id;
  }

  /** Recall the k most relevant memories. Vector cosine if possible, else keyword. */
  async recall(query: string, k = 5): Promise<MemoryHit[]> {
    ensureTable();
    const qv = await embed(query);

    if (qv) {
      const rows = getDb()
        .query<Row>(`SELECT id, text, embedding, metadata, created_at FROM kernel_memory WHERE embedding IS NOT NULL`)
        .all();
      return rows
        .map(r => ({
          id: r.id,
          text: r.text,
          score: r.embedding ? cosine(qv, fromBlob(r.embedding)) : 0,
          metadata: r.metadata ? JSON.parse(r.metadata) : null,
          createdAt: r.created_at,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
    }

    // Keyword fallback (Ollama down or nothing embedded yet): tokenize the query,
    // match memories containing ANY term, rank by how many distinct terms hit.
    const terms = [...new Set(query.toLowerCase().match(/[a-z0-9]+/g) ?? [])].filter(t => t.length >= 2);
    if (terms.length === 0) return [];
    const where = terms.map(() => `text LIKE ?`).join(" OR ");
    const rows = getDb()
      .query<Row>(`SELECT id, text, embedding, metadata, created_at FROM kernel_memory WHERE ${where}`)
      .all(...terms.map(t => `%${t}%`));
    return rows
      .map(r => {
        const lower = r.text.toLowerCase();
        const matched = terms.filter(t => lower.includes(t)).length;
        return {
          id: r.id,
          text: r.text,
          score: matched / terms.length, // fraction of query terms present
          metadata: r.metadata ? JSON.parse(r.metadata) : null,
          createdAt: r.created_at,
        };
      })
      .sort((a, b) => b.score - a.score || b.createdAt - a.createdAt)
      .slice(0, k);
  }

  forget(id: string): void {
    ensureTable();
    getDb().run(`DELETE FROM kernel_memory WHERE id = ?`, [id]);
  }

  count(): number {
    ensureTable();
    const row = getDb().query<{ n: number }>(`SELECT COUNT(*) AS n FROM kernel_memory`).get();
    return row?.n ?? 0;
  }
}

/**
 * Expose memory as gated kernel tools. recall = read_file (auto-approved);
 * remember = write_file (gated for untrusted callers, free for agents).
 */
export function memoryConnector(memory: Memory): MCPConnector {
  return {
    id: "memory",
    name: "Memory",
    description: "Local semantic memory (remember / recall)",
    tools: [
      {
        name: "memory_remember",
        description: "Save a fact or note to long-term memory",
        category: "write_file",
        inputSchema: { text: { type: "string" }, metadata: { type: "object" } },
        handler: async ({ text, metadata }) => ({
          id: await memory.remember(String(text), metadata as Record<string, unknown> | undefined),
        }),
      },
      {
        name: "memory_recall",
        description: "Recall the most relevant memories for a query",
        category: "read_file",
        inputSchema: { query: { type: "string" }, k: { type: "number" } },
        handler: async ({ query, k }) => ({
          hits: await memory.recall(String(query), typeof k === "number" ? k : 5),
        }),
      },
    ],
  };
}
