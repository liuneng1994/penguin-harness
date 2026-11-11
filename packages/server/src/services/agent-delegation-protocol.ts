/** Private node RPC; Project and admin access are checked at its HTTP entry. */
import type { AmspRecord, ApprovalDecision, ToolCallPayload } from "@prismshadow/amsp/records";
import type { ControlEnvContext, RunCutoff, ThinkingLevelName } from "@prismshadow/penguin-core";

export interface DelegationOwner extends ControlEnvContext {
  nodeId: string;
}
export interface DelegationRequest {
  operation:
    "spawn" | "run" | "poll" | "approve" | "abort" | "dispose" | "resume" | "steer" | "thinking";
  owner: DelegationOwner;
  requestId: string;
  roundId?: string;
  agentId?: string;
  sessionId?: string;
  capability?: string;
  modelId?: string;
  provider?: string;
  thinkingLevel?: ThinkingLevelName;
  messages?: AmspRecord[];
  cursor?: number;
  approvalId?: string;
  decision?: ApprovalDecision;
}
export interface DelegationBatch {
  records: Array<{ cursor: number; record: AmspRecord }>;
  approvals: Array<{ id: string; toolCall: AmspRecord<ToolCallPayload> }>;
  done: boolean;
  cutoff: RunCutoff | null;
  error?: string;
}
export interface DelegationSpawn {
  sessionId: string;
  capability: string;
  meta: AmspRecord;
}
export type DelegationCall = (request: DelegationRequest) => Promise<unknown>;
export interface DelegationRpc {
  nodeId: string;
  request: DelegationRequest;
}
export interface DelegationRpcReply {
  rpc: true;
  controllerId: string;
  result?: unknown;
  error?: string;
}

/** Strip unknown data and reject executable/path overrides before any Session is created. */
export function readDelegationRequest(value: unknown, projectId: string): DelegationRequest {
  if (!value || typeof value !== "object") throw new Error("Invalid delegation request.");
  const raw = value as Record<string, unknown>;
  const operations = [
    "spawn",
    "run",
    "poll",
    "approve",
    "abort",
    "dispose",
    "resume",
    "steer",
    "thinking",
  ];
  if (typeof raw.operation !== "string" || !operations.includes(raw.operation))
    throw new Error("Invalid delegation operation.");
  const owner = raw.owner as DelegationOwner;
  if (
    !owner ||
    owner.projectId !== projectId ||
    [owner.projectId, owner.agentId, owner.nodeId, owner.sessionId].some(
      (id) => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id),
    )
  )
    throw new Error("Invalid delegation owner or Project.");
  if (typeof raw.requestId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(raw.requestId))
    throw new Error("Invalid delegation request id.");
  const request: DelegationRequest = {
    operation: raw.operation as DelegationRequest["operation"],
    requestId: raw.requestId,
    owner: {
      projectId: owner.projectId,
      agentId: owner.agentId,
      sessionId: owner.sessionId,
      nodeId: owner.nodeId,
    },
  };
  for (const name of [
    "agentId",
    "sessionId",
    "capability",
    "modelId",
    "provider",
    "approvalId",
    "roundId",
  ] as const) {
    const text = raw[name];
    if (text !== undefined) {
      if (typeof text !== "string" || !text.trim() || text.length > 2000)
        throw new Error(`Invalid delegation ${name}.`);
      request[name] = text;
    }
  }
  if ((request.modelId === undefined) !== (request.provider === undefined))
    throw new Error("Remote model requires provider and modelId together.");
  if (
    raw.workspaceDir !== undefined ||
    raw.workspace_dir !== undefined ||
    raw.subagentDepth !== undefined
  )
    throw new Error("Remote research always uses a temporary workspace and one delegation level.");
  if (
    request.operation === "spawn" &&
    (!request.agentId || !/^[A-Za-z0-9_-]+$/.test(request.agentId))
  )
    throw new Error("Remote delegation requires a valid agentId.");
  if (request.operation !== "spawn" && (!request.sessionId || !request.capability))
    throw new Error("Remote session and capability are required.");
  if (raw.thinkingLevel !== undefined) {
    if (!["none", "low", "medium", "high", "xhigh", "max"].includes(String(raw.thinkingLevel)))
      throw new Error("Invalid remote thinking level.");
    request.thinkingLevel = raw.thinkingLevel as ThinkingLevelName;
  }
  if (raw.cursor !== undefined) {
    if (!Number.isSafeInteger(raw.cursor) || (raw.cursor as number) < 0)
      throw new Error("Invalid remote output cursor.");
    request.cursor = raw.cursor as number;
  }
  if (raw.decision !== undefined) {
    if (!["allow", "deny", "forbidden"].includes(String(raw.decision)))
      throw new Error("Invalid approval decision.");
    request.decision = raw.decision as ApprovalDecision;
  }
  if (raw.messages !== undefined) {
    if (
      !Array.isArray(raw.messages) ||
      raw.messages.length > 32 ||
      JSON.stringify(raw.messages).length > 512 * 1024 ||
      !raw.messages.every(
        (message) =>
          message &&
          message.type === "model_msg" &&
          message.payload?.type === "text" &&
          message.payload?.role === "user" &&
          typeof message.payload?.text === "string",
      )
    )
      throw new Error("Remote research input must contain user text records.");
    request.messages = raw.messages as AmspRecord[];
  }
  if ((request.operation === "run" || request.operation === "steer") && !request.messages?.length)
    throw new Error("Remote research requires a task message.");
  return request;
}
