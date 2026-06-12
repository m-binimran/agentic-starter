/**
 * Test setup — give each test file its own throwaway vault so the suite never
 * touches the user's real data and tests can't interfere with each other.
 * `node --test` runs each file in its own process, so this is per-file isolated.
 */
import { initDatabase } from "../src/vault/schema.ts";
import os from "node:os";
import path from "node:path";

const tmp = path.join(os.tmpdir(), `jarvis-test-${process.pid}-${Date.now()}.db`);
initDatabase(tmp);
