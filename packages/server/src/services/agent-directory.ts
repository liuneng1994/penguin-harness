/** Read-only Project catalogs and queries carried back over a controller's held stream. */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { parse } from "yaml";
import {
  createAgentDiscovery,
  listProjectAgents,
  systemConfigPath,
} from "@prismshadow/penguin-core";
import type { GlobalAgentCatalog } from "@prismshadow/penguin-core";
import type {
  DelegationCall,
  DelegationRpc,
  DelegationRpcReply,
} from "./agent-delegation-protocol.js";
import { Channel } from "../runtime/channel.js";
import type { ChannelListener } from "../runtime/channel.js";
import type { StreamedChannel } from "../http/sse.js";

export interface DirectoryNode {
  nodeId: string;
  nodeName: string;
}
export interface DirectoryTarget {
  nodeId?: string;
  agentId?: string;
}
export interface DirectoryQuery extends DirectoryTarget {
  requestId: string;
  leaseId: string;
  rpc?: DelegationRpc;
}
export interface AgentDirectoryNetwork {
  local(): DirectoryNode;
  peers(projectId: string): DirectoryNode[];
  read(nodeId: string, projectId: string, agentId?: string): Promise<GlobalAgentCatalog>;
  call?(nodeId: string, projectId: string, request: DelegationRpc["request"]): Promise<unknown>;
}

const DEADLINE_MS = 5000;
interface Lease {
  id: string;
  projectId: string;
  controllerId: string;
  send(query: DirectoryQuery): void;
}
interface Pending {
  rpc?: true;
  lease: Lease;
  resolve(value: GlobalAgentCatalog | DelegationRpcReply): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

/** Reject malformed or differently scoped catalogs before they can reach the model. */
export function readDirectoryCatalog(value: unknown, projectId: string): GlobalAgentCatalog {
  if (!value || typeof value !== "object") throw new Error("Invalid Agent directory response.");
  const catalog = value as GlobalAgentCatalog;
  if (
    catalog.projectId !== projectId ||
    typeof catalog.currentNodeId !== "string" ||
    !Array.isArray(catalog.agents) ||
    catalog.agents.length > 2000 ||
    !Array.isArray(catalog.unavailableNodes) ||
    catalog.unavailableNodes.length > 256
  )
    throw new Error("Agent directory response has a different Project or invalid shape.");
  for (const agent of catalog.agents) {
    if (
      !agent ||
      [agent.nodeId, agent.nodeName, agent.agentId, agent.name, agent.description].some(
        (text) => typeof text !== "string" || text.length > 2000,
      ) ||
      (agent.skills !== undefined &&
        (!Array.isArray(agent.skills) ||
          agent.skills.some((skill) => typeof skill !== "string" || skill.length > 200)))
    )
      throw new Error("Invalid Agent directory entry.");
  }
  for (const node of catalog.unavailableNodes) {
    if (
      !node ||
      [node.nodeId, node.nodeName, node.reason].some(
        (text) => typeof text !== "string" || text.length > 2000,
      )
    )
      throw new Error("Invalid unavailable node entry.");
  }
  return {
    projectId: catalog.projectId,
    currentNodeId: catalog.currentNodeId,
    agents: catalog.agents.map((agent) => ({
      nodeId: agent.nodeId,
      nodeName: agent.nodeName,
      agentId: agent.agentId,
      name: agent.name,
      description: agent.description,
      local: agent.local === true,
      canDelegate: agent.canDelegate === true,
      ...(agent.skills === undefined ? {} : { skills: [...agent.skills] }),
    })),
    unavailableNodes: catalog.unavailableNodes.map((node) => ({
      nodeId: node.nodeId,
      nodeName: node.nodeName,
      reason: node.reason,
    })),
  };
}

async function directoryDeadline<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Node directory timed out.")), DEADLINE_MS);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class AgentDirectoryService {
  private readonly parents = new Map<string, Map<string, Lease>>();
  private readonly pending = new Map<string, Pending>();
  constructor(
    private readonly root: string,
    private readonly network: AgentDirectoryNetwork,
  ) {}

  async forAgent(
    projectId: string,
    agentId: string,
    target: DirectoryTarget = {},
  ): Promise<GlobalAgentCatalog> {
    const config = parse(
      await fs.readFile(systemConfigPath(this.root, projectId, agentId), "utf8"),
    );
    if (config?.global_agent_discovery !== true) {
      if (target.nodeId && target.nodeId !== this.network.local().nodeId)
        throw new Error("Global Agent discovery is disabled for this Agent.");
      return this.local(projectId, target.agentId);
    }
    return this.discover(projectId, target);
  }

  async local(projectId: string, agentId?: string): Promise<GlobalAgentCatalog> {
    const node = this.network.local();
    const agents = await listProjectAgents(this.root, projectId);
    const selected =
      agentId === undefined ? agents : agents.filter((agent) => agent.agentId === agentId);
    const discovery = createAgentDiscovery(this.root, projectId, agentId ?? "default_agent");
    return {
      projectId,
      currentNodeId: node.nodeId,
      unavailableNodes: [],
      agents: await Promise.all(
        selected.map(async (agent) => ({
          ...agent,
          ...node,
          local: true,
          canDelegate: true,
          ...(agentId === undefined ? {} : { skills: await discovery.skills(agent.agentId) }),
        })),
      ),
    };
  }

  /** Aggregation reads local endpoints only, so controller chains cannot recurse or cycle. */
  async aggregate(projectId: string, target: DirectoryTarget = {}): Promise<GlobalAgentCatalog> {
    const own = this.network.local();
    const result = await this.local(projectId, target.agentId);
    if (target.nodeId && target.nodeId !== own.nodeId) result.agents = [];
    const nodes = this.network
      .peers(projectId)
      .filter((node) => !target.nodeId || node.nodeId === target.nodeId);
    const answers = await Promise.allSettled(
      nodes.map(async (node) => {
        const catalog = readDirectoryCatalog(
          await directoryDeadline(this.network.read(node.nodeId, projectId, target.agentId)),
          projectId,
        );
        if (catalog.currentNodeId !== node.nodeId)
          throw new Error("The connected node's identity changed.");
        return { node, catalog };
      }),
    );
    for (let i = 0; i < answers.length; i++) {
      const answer = answers[i]!;
      if (answer.status === "fulfilled")
        result.agents.push(
          ...answer.value.catalog.agents.map((agent) => ({
            ...agent,
            ...answer.value.node,
            local: false,
            canDelegate: true,
          })),
        );
      else
        result.unavailableNodes.push({
          ...nodes[i]!,
          reason: "Node unavailable or does not support Agent discovery.",
        });
    }
    return result;
  }

  async discover(projectId: string, target: DirectoryTarget = {}): Promise<GlobalAgentCatalog> {
    const own = this.network.local();
    // An unqualified Agent id continues to name the current node, including duplicate peer ids.
    if (target.agentId && !target.nodeId) target = { ...target, nodeId: own.nodeId };
    const result = await this.aggregate(projectId, target);
    const leases = [...(this.parents.get(projectId)?.values() ?? [])];
    const replies = await Promise.allSettled(leases.map((lease) => this.query(lease, target)));
    replies.forEach((reply, index) => {
      if (reply.status === "fulfilled") {
        result.agents.push(...reply.value.agents);
        result.unavailableNodes.push(...reply.value.unavailableNodes);
      } else
        result.unavailableNodes.push({
          nodeId: leases[index]!.controllerId,
          nodeName: "Controller",
          reason: "Controller directory unavailable.",
        });
    });
    const entries = new Map(
      result.agents.map((agent) => [
        JSON.stringify([agent.nodeId, agent.agentId]),
        {
          ...agent,
          local: agent.nodeId === own.nodeId,
          canDelegate: agent.canDelegate,
        },
      ]),
    );
    result.agents = [...entries.values()]
      .filter(
        (agent) =>
          (!target.nodeId || agent.nodeId === target.nodeId) &&
          (!target.agentId || agent.agentId === target.agentId),
      )
      .sort((a, b) => a.nodeId.localeCompare(b.nodeId) || a.agentId.localeCompare(b.agentId));
    const available = new Set(result.agents.map((agent) => agent.nodeId));
    result.unavailableNodes = [
      ...new Map(
        result.unavailableNodes
          .filter((node) => !available.has(node.nodeId))
          .map((node) => [node.nodeId, node]),
      ).values(),
    ];
    return result;
  }

  /** Pins one Project-authorized route. Controller relays only local/direct peers, never recurse. */
  async delegationRoute(projectId: string, nodeId: string): Promise<DelegationCall> {
    if (this.network.peers(projectId).some((node) => node.nodeId === nodeId) && this.network.call)
      return (request) => this.network.call!(nodeId, projectId, request);
    for (const lease of this.parents.get(projectId)?.values() ?? []) {
      try {
        const catalog = await this.query(lease, { nodeId });
        if (!catalog.agents.some((agent) => agent.nodeId === nodeId && agent.canDelegate)) continue;
        return async (request) => {
          const reply = await this.queryRpc(lease, { nodeId, request });
          if (reply.error) throw new Error(reply.error);
          return reply.result;
        };
      } catch {
        /* Another same-Project controller may still have the node. */
      }
    }
    throw new Error("Remote node is disconnected or outside this Project.");
  }

  /** One authenticated controller stream; its queries and replies live only for this lease. */
  relay(projectId: string, controllerId: string): StreamedChannel {
    const channel = new Channel({ maxBufferCount: 0, maxBufferBytes: 0 });
    return {
      replayAfter: (id) => channel.replayAfter(id),
      sendTo: (listener, data, event) => channel.sendTo(listener, data, event),
      subscribe: (listener: ChannelListener) => {
        const unsubscribe = channel.subscribe(listener);
        const previous = this.parents.get(projectId)?.get(controllerId);
        if (previous) this.detach(previous);
        const lease: Lease = {
          id: randomUUID(),
          projectId,
          controllerId,
          send: (query) => {
            channel.sendTo(listener, query, "agent_discovery_query");
          },
        };
        const group = this.parents.get(projectId) ?? new Map();
        group.set(controllerId, lease);
        this.parents.set(projectId, group);
        channel.sendTo(listener, { leaseId: lease.id }, "agent_discovery_ready");
        return () => {
          unsubscribe();
          this.detach(lease);
        };
      },
    };
  }

  answer(projectId: string, leaseId: string, requestId: string, value: unknown): boolean {
    const pending = this.pending.get(requestId);
    if (!pending || pending.lease.projectId !== projectId || pending.lease.id !== leaseId)
      return false;
    let reply: GlobalAgentCatalog | DelegationRpcReply;
    if (pending.rpc) {
      const rpc = value as DelegationRpcReply;
      if (
        !rpc ||
        rpc.rpc !== true ||
        rpc.controllerId !== pending.lease.controllerId ||
        (rpc.error !== undefined && typeof rpc.error !== "string")
      )
        throw new Error("Invalid delegation controller reply.");
      reply = rpc;
    } else {
      const catalog = readDirectoryCatalog(value, projectId);
      if (catalog.currentNodeId !== pending.lease.controllerId)
        throw new Error("The directory controller's identity changed.");
      reply = catalog;
    }
    clearTimeout(pending.timer);
    this.pending.delete(requestId);
    pending.resolve(reply);
    return true;
  }

  close(): void {
    for (const group of this.parents.values())
      for (const lease of group.values()) this.detach(lease);
  }

  private query(lease: Lease, target: DirectoryTarget): Promise<GlobalAgentCatalog> {
    return this.request(lease, target) as Promise<GlobalAgentCatalog>;
  }
  private queryRpc(lease: Lease, rpc: DelegationRpc): Promise<DelegationRpcReply> {
    return this.request(lease, { rpc }, 30_000) as Promise<DelegationRpcReply>;
  }
  private request(
    lease: Lease,
    target: DirectoryTarget & { rpc?: DelegationRpc },
    timeoutMs = DEADLINE_MS,
  ): Promise<GlobalAgentCatalog | DelegationRpcReply> {
    if (this.pending.size >= 256) return Promise.reject(new Error("Agent directory is busy."));
    if (this.parents.get(lease.projectId)?.get(lease.controllerId) !== lease)
      return Promise.reject(new Error("Controller disconnected."));
    return new Promise((resolve, reject) => {
      const requestId = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("Agent node request timed out."));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(requestId, {
        lease,
        resolve,
        reject,
        timer,
        ...(target.rpc ? { rpc: true } : {}),
      });
      lease.send({ ...target, requestId, leaseId: lease.id });
    });
  }

  private detach(lease: Lease): void {
    const group = this.parents.get(lease.projectId);
    if (group?.get(lease.controllerId) === lease) group.delete(lease.controllerId);
    if (group?.size === 0) this.parents.delete(lease.projectId);
    for (const [id, pending] of this.pending)
      if (pending.lease === lease) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(new Error("Controller directory disconnected."));
      }
  }
}
