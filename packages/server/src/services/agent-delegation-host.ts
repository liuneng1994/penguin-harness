/** Target-node child Sessions. Empty temporary workspaces belong to the target Agent. */
import { randomUUID } from "node:crypto";
import { isSessionMeta, withOrigin } from "@prismshadow/amsp/records";
import type { AmspRecord, ApprovalDecision, ToolCallPayload } from "@prismshadow/amsp/records";
import type { Session } from "@prismshadow/penguin-core";
import type {
  DelegationRequest,
  DelegationBatch,
  DelegationSpawn,
} from "./agent-delegation-protocol.js";

interface Child {
  session: Session;
  owner: string;
  agentId: string;
  resuming?: Promise<Session>;
  capability: string;
  abort: AbortController | null;
  records: DelegationBatch["records"];
  cursor: number;
  bytes: number;
  approvals: Map<
    string,
    { toolCall: AmspRecord<ToolCallPayload>; resolve(decision: ApprovalDecision): void }
  >;
  wake: Set<() => void>;
  cutoff: DelegationBatch["cutoff"];
  error?: string;
  lease?: ReturnType<typeof setTimeout>;
  spawnKey: string;
  releaseVersion: number;
  disposed: boolean;
  rounds: Set<string>;
  roundId?: string;
}
const ownerKey = (request: DelegationRequest) =>
  JSON.stringify([
    request.owner.projectId,
    request.owner.agentId,
    request.owner.sessionId,
    request.owner.nodeId,
  ]);

export class AgentDelegationHost {
  private closed = false;
  private readonly children = new Map<string, Child>();
  private readonly spawns = new Map<string, Promise<DelegationSpawn>>();
  constructor(
    private readonly create: (projectId: string, request: DelegationRequest) => Promise<Session>,
  ) {}

  async execute(projectId: string, request: DelegationRequest): Promise<unknown> {
    if (this.closed) throw new Error("Remote delegation is closed.");
    if (request.owner.projectId !== projectId)
      throw new Error("Delegation is outside this Project.");
    if (request.operation === "spawn") {
      const key = JSON.stringify([projectId, ownerKey(request), request.requestId]);
      const previous = this.spawns.get(key);
      if (previous) return previous;
      if (this.spawns.size >= 128) throw new Error("Remote subagents are at capacity.");
      const pending = this.spawn(key, projectId, request);
      this.spawns.set(key, pending);
      try {
        return await pending;
      } catch (error) {
        this.spawns.delete(key);
        throw error;
      }
    }
    const child = this.children.get(request.sessionId ?? "");
    if (!child || child.owner !== ownerKey(request) || child.capability !== request.capability)
      throw new Error("Remote subagent is unavailable or belongs to another parent.");
    this.touch(child);
    switch (request.operation) {
      case "run": {
        if (child.disposed) throw new Error("Remote subagent has been released; resume it first.");
        if (child.rounds.has(request.requestId)) return {};
        if (child.abort || child.resuming) throw new Error("Remote subagent is still running.");
        child.rounds.add(request.requestId);
        child.roundId = request.requestId;
        child.abort = new AbortController();
        child.cutoff = null;
        delete child.error;
        void this.drive(child, request.messages ?? []);
        return {};
      }
      case "poll":
        return this.poll(child, request.cursor ?? 0);
      case "approve": {
        const approval = child.approvals.get(request.approvalId ?? "");
        if (approval) {
          child.approvals.delete(request.approvalId!);
          approval.resolve(request.decision ?? "deny");
        }
        return {};
      }
      case "abort":
        if (!request.roundId || request.roundId === child.roundId) this.abort(child);
        return {};
      case "dispose":
        this.release(child);
        return {};
      case "resume": {
        // Release frees resources but keeps the same Session and its own history/workspace.
        // A Session cannot run after dispose; the injected creator handles resume by id.
        if (child.abort) throw new Error("Remote subagent is still running.");
        if (child.disposed) {
          const version = child.releaseVersion;
          const pending = (child.resuming ??= this.create(projectId, {
            ...request,
            agentId: child.agentId,
          }));
          try {
            const session = await pending;
            if (
              this.closed ||
              this.children.get(session.sessionId) !== child ||
              version !== child.releaseVersion
            ) {
              session.dispose();
              throw new Error("Remote subagent was released while resuming.");
            }
            child.session = session;
            child.disposed = false;
          } finally {
            delete child.resuming;
          }
        }
        return {
          sessionId: child.session.sessionId,
          capability: child.capability,
          meta: child.session.metaMessage,
        } satisfies DelegationSpawn;
      }
      case "steer":
        return {
          accepted:
            child.abort !== null &&
            (!request.roundId || request.roundId === child.roundId) &&
            child.session.steer(request.messages ?? []),
        };
      case "thinking":
        if (request.thinkingLevel) child.session.thinkingLevel = request.thinkingLevel;
        return {};
    }
  }

  close(): void {
    this.closed = true;
    for (const child of this.children.values()) {
      clearTimeout(child.lease);
      this.release(child);
    }
    this.children.clear();
    this.spawns.clear();
  }

  private async spawn(
    spawnKey: string,
    projectId: string,
    request: DelegationRequest,
  ): Promise<DelegationSpawn> {
    const session = await this.create(projectId, request);
    if (this.closed) {
      session.dispose();
      throw new Error("Remote delegation was closed while starting.");
    }
    const child: Child = {
      session,
      owner: ownerKey(request),
      agentId: request.agentId!,
      capability: randomUUID(),
      abort: null,
      records: [],
      cursor: 0,
      bytes: 0,
      approvals: new Map(),
      wake: new Set(),
      cutoff: null,
      spawnKey,
      releaseVersion: 0,
      disposed: false,
      rounds: new Set(),
    };
    this.children.set(session.sessionId, child);
    this.touch(child);
    return {
      sessionId: session.sessionId,
      capability: child.capability,
      meta: session.metaMessage,
    };
  }

  private touch(child: Child): void {
    clearTimeout(child.lease);
    if (this.closed || !this.children.has(child.session.sessionId)) return;
    // Running clients poll even while waiting for approval. A lost parent cannot leave a
    // billable child indefinitely; idle research sessions keep their workspace for follow-ups.
    child.lease = setTimeout(
      () => {
        this.release(child);
        this.children.delete(child.session.sessionId);
        this.spawns.delete(child.spawnKey);
      },
      child.abort ? 60_000 : 30 * 60_000,
    );
    child.lease.unref?.();
  }

  private abort(child: Child): void {
    child.abort?.abort();
    for (const approval of child.approvals.values()) approval.resolve("deny");
    child.approvals.clear();
    this.notify(child);
  }
  private release(child: Child): void {
    child.releaseVersion++;
    this.abort(child);
    if (!child.disposed) {
      child.disposed = true;
      void child.session.dispose();
    }
  }
  private notify(child: Child): void {
    for (const wake of child.wake) wake();
    child.wake.clear();
  }
  private append(child: Child, record: AmspRecord): void {
    const tagged = withOrigin(record, child.session.sessionId);
    const size = Buffer.byteLength(JSON.stringify(tagged));
    if (size > 4 * 1024 * 1024)
      throw new Error("Remote subagent record exceeds the transfer limit.");
    child.records.push({ cursor: ++child.cursor, record: tagged });
    child.bytes += size;
    // Never silently drop records: stop the task if a disconnected consumer falls behind.
    if (child.bytes > 8 * 1024 * 1024)
      throw new Error("Remote subagent output exceeded its delivery buffer.");
    this.notify(child);
  }
  private async drive(child: Child, messages: AmspRecord[]): Promise<void> {
    this.touch(child);
    const approve = (toolCall: AmspRecord<ToolCallPayload>) =>
      new Promise<ApprovalDecision>((resolve) => {
        const id = randomUUID();
        child.approvals.set(id, {
          toolCall: withOrigin(toolCall, child.session.sessionId),
          resolve,
        });
        this.notify(child);
      });
    const iterator = child.session.run(messages, { signal: child.abort!.signal, approve });
    try {
      let inputs = false;
      for (;;) {
        const step = await iterator.next();
        if (step.done) {
          child.cutoff = step.value;
          break;
        }
        if (isSessionMeta(step.value) && !step.value.origin?.length) continue;
        this.append(child, step.value);
        if (!inputs) {
          inputs = true;
          for (const message of messages) this.append(child, message);
        }
      }
    } catch (error) {
      child.error = error instanceof Error ? error.message : "Remote subagent failed.";
      this.abort(child);
    } finally {
      await iterator.return(null);
      child.abort = null;
      this.touch(child);
      this.notify(child);
    }
  }
  private async poll(child: Child, cursor: number): Promise<DelegationBatch> {
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > child.cursor)
      throw new Error("Invalid remote output cursor.");
    while (child.records[0] && child.records[0].cursor <= cursor) {
      const item = child.records.shift()!;
      child.bytes -= Buffer.byteLength(JSON.stringify(item.record));
    }
    if (child.abort && !child.records.length) {
      await new Promise<void>((resolve) => {
        const wake = () => {
          clearTimeout(timer);
          child.wake.delete(wake);
          resolve();
        };
        const timer = setTimeout(wake, 20_000);
        timer.unref?.();
        child.wake.add(wake);
      });
    }
    let bytes = 0;
    const records = child.records.filter((item) => {
      if (bytes >= 2 * 1024 * 1024) return false;
      bytes += Buffer.byteLength(JSON.stringify(item.record));
      return true;
    });
    return {
      records,
      approvals: [...child.approvals].map(([id, { toolCall }]) => ({ id, toolCall })),
      done: child.abort === null && records.length === child.records.length,
      cutoff: child.cutoff,
      ...(child.error ? { error: child.error } : {}),
    };
  }
}
