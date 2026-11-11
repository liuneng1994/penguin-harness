/** Adapts node RPC to the existing subagent lifecycle and parent approval callback. */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { parse } from "yaml";
import { systemConfigPath } from "@prismshadow/penguin-core";
import { withOrigin } from "@prismshadow/amsp/records";
import type { ControlEnvContext, SubagentHandle, SubagentRunner } from "@prismshadow/penguin-core";
import type { AgentDirectoryService } from "./agent-directory.js";
import type {
  DelegationCall,
  DelegationSpawn,
  DelegationBatch,
  DelegationOwner,
} from "./agent-delegation-protocol.js";

interface RemoteChild {
  nodeId: string;
  agentId: string;
  spawn: DelegationSpawn;
  call: DelegationCall;
  cursor: number;
  release?: Promise<unknown>;
}
export class AgentDelegationClient {
  private readonly children = new Map<string, { owner: string; remote: RemoteChild }>();
  constructor(
    private readonly root: string,
    private readonly directory: AgentDirectoryService,
    private readonly nodeId: string | (() => string),
    private readonly localCall: (
      projectId: string,
      request: Parameters<DelegationCall>[0],
    ) => Promise<unknown>,
  ) {}
  isRemote(sessionId: string): boolean {
    return this.children.has(sessionId);
  }
  runner(context: ControlEnvContext): SubagentRunner {
    const localNodeId = typeof this.nodeId === "function" ? this.nodeId() : this.nodeId;
    const owner: DelegationOwner = { ...context, nodeId: localNodeId };
    const key = JSON.stringify(owner);
    return {
      spawn: async (input) => {
        const config = parse(
          await fs.readFile(
            systemConfigPath(this.root, context.projectId, context.agentId),
            "utf8",
          ),
        );
        if (config?.global_agent_discovery !== true)
          throw new Error("Global Agent discovery is disabled for this Agent.");
        if (!input.nodeId || !input.agentId)
          throw new Error("Remote delegation requires node_id and agent_id.");
        const catalog = await this.directory.forAgent(context.projectId, context.agentId, {
          nodeId: input.nodeId,
          agentId: input.agentId,
        });
        if (
          !catalog.agents.some(
            (agent) =>
              agent.nodeId === input.nodeId && agent.agentId === input.agentId && agent.canDelegate,
          )
        )
          throw new Error("Agent is unavailable for delegation in this Project.");
        const call: DelegationCall =
          input.nodeId === localNodeId
            ? (request) => this.localCall(context.projectId, request)
            : await this.directory.delegationRoute(context.projectId, input.nodeId);
        const spawn = (await call({
          operation: "spawn",
          owner,
          requestId: randomUUID(),
          agentId: input.agentId,
          ...(input.modelId ? { modelId: input.modelId, provider: input.provider } : {}),
          ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
        })) as DelegationSpawn;
        if (
          !spawn ||
          typeof spawn.sessionId !== "string" ||
          typeof spawn.capability !== "string" ||
          !spawn.meta
        )
          throw new Error("Invalid remote subagent response.");
        const remote = { nodeId: input.nodeId, agentId: input.agentId, spawn, call, cursor: 0 };
        this.children.set(spawn.sessionId, { owner: key, remote });
        return this.handle(owner, remote);
      },
      resume: async (input) => {
        const known = this.children.get(input.sessionId);
        if (!known || known.owner !== key || known.remote.nodeId !== input.nodeId)
          throw new Error("Remote subagent does not belong to this conversation.");
        const remote = known.remote;
        await remote.release;
        const spawn = (await remote.call({
          operation: "resume",
          owner,
          requestId: randomUUID(),
          sessionId: input.sessionId,
          capability: remote.spawn.capability,
          agentId: remote.agentId,
        })) as DelegationSpawn;
        remote.spawn = spawn;
        return this.handle(owner, remote);
      },
    };
  }
  private handle(owner: DelegationOwner, remote: RemoteChild): SubagentHandle {
    const { spawn } = remote;
    let sent = false,
      disposed = false,
      running = false;
    let cursor = remote.cursor;
    let roundId: string | undefined;
    const call = (
      operation: Parameters<DelegationCall>[0]["operation"],
      extra: Partial<Parameters<DelegationCall>[0]> = {},
    ) =>
      remote.call({
        ...extra,
        operation,
        owner,
        requestId: extra.requestId ?? randomUUID(),
        sessionId: spawn.sessionId,
        capability: spawn.capability,
      });
    return {
      sessionId: spawn.sessionId,
      takeMeta() {
        if (sent) return null;
        sent = true;
        return withOrigin(spawn.meta, spawn.sessionId);
      },
      async *run({ messages, signal, approve }) {
        if (disposed) throw new Error("Remote subagent has been released.");
        if (signal?.aborted) return { kind: "abort" as const };
        if (!sent) {
          sent = true;
          yield withOrigin(spawn.meta, spawn.sessionId);
        }
        roundId = randomUUID();
        const onAbort = () => {
          void call("abort", { roundId }).catch(() => {});
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        const decisions = new Map<string, Promise<unknown>>();
        let finished = false;
        running = true;
        try {
          await call("run", { messages, requestId: roundId });
          if (signal?.aborted) onAbort();
          for (;;) {
            const batch = (await call("poll", { cursor })) as DelegationBatch;
            if (!batch || !Array.isArray(batch.records) || !Array.isArray(batch.approvals))
              throw new Error("Invalid remote subagent output.");
            for (const item of batch.records) {
              if (
                !Number.isSafeInteger(item.cursor) ||
                item.cursor <= cursor ||
                !item.record ||
                item.record.origin?.[0] !== spawn.sessionId
              )
                throw new Error("Invalid remote subagent record.");
              cursor = item.cursor;
              remote.cursor = cursor;
              yield item.record;
            }
            for (const approval of batch.approvals)
              if (!decisions.has(approval.id)) {
                if (
                  !approval.toolCall ||
                  approval.toolCall.origin?.[0] !== spawn.sessionId ||
                  approval.toolCall.payload.type !== "tool_call"
                )
                  throw new Error("Invalid remote approval request.");
                const pending = Promise.resolve()
                  .then(() =>
                    approve && !signal?.aborted ? approve(approval.toolCall) : ("deny" as const),
                  )
                  .catch(() => "deny" as const)
                  .then((decision) => call("approve", { approvalId: approval.id, decision }));
                decisions.set(approval.id, pending);
                void pending.catch(() => {});
              }
            if (batch.done) {
              if (batch.error) throw new Error(batch.error);
              finished = true;
              return signal?.aborted ? { kind: "abort" as const } : batch.cutoff;
            }
          }
        } finally {
          running = false;
          signal?.removeEventListener("abort", onAbort);
          // Generator failure or consumer interruption must stop billable work remotely.
          if (!finished) await call("abort", { roundId }).catch(() => {});
        }
      },
      steer(messages) {
        if (!running || disposed) return false;
        void call("steer", { messages, roundId }).catch(() => {});
        return true;
      },
      setThinkingLevel(thinkingLevel) {
        void call("thinking", { thinkingLevel }).catch(() => {});
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        remote.release = call("dispose").catch(() => {});
      },
    };
  }
}
