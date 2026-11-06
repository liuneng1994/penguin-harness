/** Skill activity derived from durable Trace records; no new telemetry or record fields. */
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { createInterface } from "node:readline";
import {
  agentStateDir,
  installedSkillRead,
  isSessionMeta,
  isCompleteModelMessage,
  parseSkillsMessage,
  parseTraceLines,
} from "@prismshadow/penguin-core";
import type { SkillUsage } from "../api/types.js";
import type { TraceFileRow } from "../db/repos/trace-index.js";
import type { TraceIndex, TraceIndexStore } from "../mechanisms/traces.js";
import { traceFilePath } from "./trace-index.js";

const emptyUsage = (): SkillUsage => ({
  invocations: 0,
  reads: 0,
  failedReads: 0,
  sessions: 0,
  lastUsedAt: null,
});

interface CachedSession {
  signature: string;
  usage: Map<string, SkillUsage>;
}

/** Stat every shard on a read so appends are visible even when directory mtimes do not move.
 * Keep only summaries for 128 sessions; scans stream JSONL and never retain tool output bodies.
 */
export class SkillUsageReader {
  private readonly cache = new Map<string, CachedSession>();
  constructor(
    private readonly root: string,
    private readonly index: TraceIndex,
    private readonly store: TraceIndexStore,
  ) {}

  async read(projectId: string, agentId: string): Promise<Map<string, SkillUsage>> {
    await this.index.reconcileAgent(projectId, agentId);
    const sessions = new Map<string, TraceFileRow[]>();
    for (const file of this.store.listFilesByAgent(projectId, agentId)) {
      const files = sessions.get(file.sessionId) ?? [];
      files.push(file);
      sessions.set(file.sessionId, files);
    }
    const result = new Map<string, SkillUsage>();
    for (const [sessionId, rows] of sessions) {
      rows.sort((a, b) => a.fileIndex - b.fileIndex);
      const files: string[] = [];
      const stamps: Array<[string, number, number, number]> = [];
      for (const row of rows) {
        const file = traceFilePath(this.root, row);
        try {
          const stat = await fs.stat(file);
          files.push(file);
          stamps.push([file, stat.size, stat.mtimeMs, stat.ctimeMs]);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      const signature = JSON.stringify(stamps);
      const key = JSON.stringify([projectId, agentId, sessionId]);
      let cached = this.cache.get(key);
      if (cached?.signature !== signature) {
        cached = {
          signature,
          usage: await this.scan(files, agentStateDir(this.root, projectId, agentId)),
        };
      }
      this.cache.delete(key);
      this.cache.set(key, cached);
      if (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value!);
      for (const [name, usage] of cached.usage) {
        const total = result.get(name) ?? emptyUsage();
        total.invocations += usage.invocations;
        total.reads += usage.reads;
        total.failedReads += usage.failedReads;
        total.sessions += 1;
        if (
          usage.lastUsedAt !== null &&
          (total.lastUsedAt === null || usage.lastUsedAt > total.lastUsedAt)
        )
          total.lastUsedAt = usage.lastUsedAt;
        result.set(name, total);
      }
    }
    return result;
  }

  private async scan(files: string[], initialStateDir: string): Promise<Map<string, SkillUsage>> {
    const result = new Map<string, SkillUsage>();
    const pending = new Map<string, string>();
    let stateDir = initialStateDir;
    let workspace = initialStateDir;
    const add = (
      name: string,
      field: "invocations" | "reads" | "failedReads",
      timestamp: string,
    ) => {
      const usage = result.get(name) ?? emptyUsage();
      usage[field] += 1;
      if (field !== "failedReads" && Number.isFinite(Date.parse(timestamp))) {
        const normalized = new Date(timestamp).toISOString();
        if (usage.lastUsedAt === null || normalized > usage.lastUsedAt)
          usage.lastUsedAt = normalized;
      }
      result.set(name, usage);
    };
    for (const file of files) {
      const stream = createReadStream(file, { encoding: "utf8" });
      const lines = createInterface({ input: stream, crlfDelay: Infinity });
      try {
        for await (const line of lines) {
          for (const msg of parseTraceLines(line)) {
            if (!msg || typeof msg !== "object" || !msg.payload || typeof msg.payload !== "object")
              continue;
            // Forwarded child records also exist in the child's own Trace. Only count the
            // records native to this Agent, avoiding double attribution to its parent.
            if ((msg.origin?.length ?? 0) > 0) continue;
            if (isSessionMeta(msg)) {
              const p = msg.payload;
              if (typeof p.agent_state === "string") stateDir = p.agent_state;
              if (typeof p.workspace === "string") workspace = p.workspace;
              continue;
            }
            if (!isCompleteModelMessage(msg)) continue;
            const p = msg.payload;
            if (
              p.type === "text" &&
              p.role === "user" &&
              (p.sender === undefined || p.sender === "user")
            ) {
              const invocation = parseSkillsMessage(p.text);
              if (invocation)
                for (const name of new Set(invocation.skills))
                  add(name, "invocations", msg.timestamp);
            } else if (p.type === "tool_call" && p.name === "read_file") {
              let args: unknown;
              try {
                args = JSON.parse(p.arguments);
              } catch {
                continue;
              }
              if (
                !args ||
                typeof args !== "object" ||
                !("file_path" in args) ||
                typeof args.file_path !== "string"
              )
                continue;
              const name = installedSkillRead(stateDir, workspace, args.file_path);
              if (name !== null) pending.set(p.tool_call_id, name);
            } else if (p.type === "tool_call_output") {
              const name = pending.get(p.tool_call_id);
              if (name === undefined) continue;
              pending.delete(p.tool_call_id);
              add(
                name,
                p.status === undefined || p.status === "completed" ? "reads" : "failedReads",
                msg.timestamp,
              );
            }
          }
        }
      } finally {
        lines.close();
        stream.destroy();
      }
    }
    return result;
  }
}

export { emptyUsage as emptySkillUsage };
