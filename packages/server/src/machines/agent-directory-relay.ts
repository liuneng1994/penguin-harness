/** Project directory traffic on the API socket already held to each connected machine. */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { GlobalAgentCatalog } from "@prismshadow/penguin-core";
import type { DelegationRpc, DelegationRpcReply } from "../services/agent-delegation-protocol.js";
import type { Machines } from "./service.js";
import { machineApi } from "./machine-api.js";
import type { MachineSockets, MachineSocket } from "./machine-sockets.js";
import { readDirectoryCatalog } from "../services/agent-directory.js";
import type {
  AgentDirectoryNetwork,
  DirectoryNode,
  DirectoryQuery,
  DirectoryTarget,
} from "../services/agent-directory.js";

export type DirectoryResponder = (
  projectId: string,
  target: DirectoryTarget,
) => Promise<GlobalAgentCatalog>;

@Interface()
export abstract class AgentDirectoryTransport {
  abstract local(): DirectoryNode;
  abstract peers(projectId: string): DirectoryNode[];
  abstract read(nodeId: string, projectId: string, agentId?: string): Promise<GlobalAgentCatalog>;
  abstract respond(handler: DirectoryResponder | null): void;
  abstract call(
    nodeId: string,
    projectId: string,
    request: DelegationRpc["request"],
  ): Promise<unknown>;
  abstract respondDelegation(
    handler: ((projectId: string, rpc: DelegationRpc) => Promise<unknown>) | null,
  ): void;
}

interface Subscription {
  socket: MachineSocket | null;
  id: number | null;
  cancelled: boolean;
  opening?: ReturnType<typeof setTimeout>;
}

export class MachineAgentDirectoryRelay implements AgentDirectoryNetwork, AgentDirectoryTransport {
  private handler: DirectoryResponder | null = null;
  private delegationHandler: ((projectId: string, rpc: DelegationRpc) => Promise<unknown>) | null =
    null;
  private readonly streams = new Map<string, Subscription>();
  private readonly retries = new Set<ReturnType<typeof setTimeout>>();
  constructor(
    private readonly machines: Pick<Machines, "list" | "proxyTarget">,
    private readonly sockets: MachineSockets,
    private readonly projects: () => string[],
  ) {}

  local(): DirectoryNode {
    const local = this.machines.list("default_project").find((machine) => machine.local)!;
    return { nodeId: local.machineId!, nodeName: local.alias };
  }

  peers(projectId: string): DirectoryNode[] {
    return [
      ...new Map(
        this.machines
          .list(projectId)
          .filter((machine) => !machine.local && machine.member && machine.machineId)
          .map((machine) => [
            machine.machineId!,
            { nodeId: machine.machineId!, nodeName: machine.alias },
          ]),
      ).values(),
    ];
  }

  async read(nodeId: string, projectId: string, agentId?: string): Promise<GlobalAgentCatalog> {
    if (!this.peers(projectId).some((node) => node.nodeId === nodeId))
      throw new Error("Node is outside this Project.");
    const target = await this.machines.proxyTarget(nodeId);
    if (!target) throw new Error("Node is not connected.");
    const api = machineApi(target.agent, target.port, target.cookie, {}, 5000);
    const query = agentId === undefined ? "" : `?agent_id=${encodeURIComponent(agentId)}`;
    const response = await api.request(
      "GET",
      `/api/projects/${encodeURIComponent(projectId)}/agent-discovery/local${query}`,
    );
    if (response.status !== 200 || response.text.length > 4 * 1024 * 1024)
      throw new Error("Node directory unavailable.");
    return readDirectoryCatalog(JSON.parse(response.text), projectId);
  }

  async call(
    nodeId: string,
    projectId: string,
    request: DelegationRpc["request"],
  ): Promise<unknown> {
    if (!this.peers(projectId).some((node) => node.nodeId === nodeId))
      throw new Error("Node is outside this Project.");
    const target = await this.machines.proxyTarget(nodeId);
    if (!target) throw new Error("Node is not connected.");
    const api = machineApi(target.agent, target.port, target.cookie, {}, 30_000);
    const response = await api.request(
      "POST",
      `/api/projects/${encodeURIComponent(projectId)}/agent-discovery/delegate`,
      request,
    );
    if (response.text.length > 6 * 1024 * 1024)
      throw new Error("Remote delegation response exceeds its transfer limit.");
    if (response.status !== 200) {
      let message = "Remote delegation is unavailable on that node.";
      try {
        const error = JSON.parse(response.text).error;
        if (typeof error?.message === "string") message = error.message;
      } catch {
        /* An older node may return an HTML error. */
      }
      throw new Error(message);
    }
    return JSON.parse(response.text);
  }
  respondDelegation(
    handler: ((projectId: string, rpc: DelegationRpc) => Promise<unknown>) | null,
  ): void {
    this.delegationHandler = handler;
  }

  respond(handler: DirectoryResponder | null): void {
    this.handler = handler;
    if (handler) this.refresh();
    else this.close();
  }

  /** Called when connection or Project membership changes; never starts an SSH connection. */
  refresh(): void {
    if (!this.handler) return;
    const wanted = new Set<string>();
    for (const projectId of this.projects())
      for (const node of this.peers(projectId)) {
        const key = JSON.stringify([projectId, node.nodeId]);
        wanted.add(key);
        if (this.streams.has(key)) continue;
        const subscription: Subscription = { socket: null, id: null, cancelled: false };
        this.streams.set(key, subscription);
        void this.open(projectId, node.nodeId, key, subscription).catch(() =>
          this.remove(key, subscription),
        );
      }
    for (const [key, stream] of this.streams) if (!wanted.has(key)) this.remove(key, stream);
  }

  close(): void {
    for (const [key, stream] of this.streams) this.remove(key, stream);
    for (const timer of this.retries) clearTimeout(timer);
    this.retries.clear();
  }

  private async open(projectId: string, nodeId: string, key: string, subscription: Subscription) {
    const target = await this.machines.proxyTarget(nodeId);
    if (!target || subscription.cancelled) {
      this.remove(key, subscription);
      return;
    }
    // A read-only directory probe must never restart or upgrade the peer to repair a socket.
    const got = await this.sockets.socketFor(nodeId, target, { repair: false });
    if (!("socket" in got) || subscription.cancelled) {
      this.remove(key, subscription);
      return;
    }
    subscription.socket = got.socket;
    const prefix = `/api/projects/${encodeURIComponent(projectId)}/agent-discovery`;
    subscription.opening = setTimeout(() => this.remove(key, subscription), 10000);
    subscription.opening.unref?.();
    subscription.id = got.socket.call(
      {
        method: "GET",
        path: `${prefix}/relay?controller_id=${encodeURIComponent(this.local().nodeId)}`,
      },
      {
        onStart: (status) => {
          clearTimeout(subscription.opening);
          if (status !== 200) this.remove(key, subscription);
        },
        onResponse: () => this.remove(key, subscription),
        onEnd: () => {
          const retry = !subscription.cancelled && this.handler !== null;
          this.remove(key, subscription);
          if (retry) {
            const timer = setTimeout(() => {
              this.retries.delete(timer);
              this.refresh();
            }, 2000);
            timer.unref?.();
            this.retries.add(timer);
          }
        },
        onEvent: (event) => {
          if (
            event.event !== "agent_discovery_query" ||
            subscription.cancelled ||
            event.data.length > 1024 * 1024
          )
            return;
          try {
            const query = JSON.parse(event.data) as DirectoryQuery;
            if (
              !query ||
              typeof query.requestId !== "string" ||
              typeof query.leaseId !== "string" ||
              (query.nodeId !== undefined && typeof query.nodeId !== "string") ||
              (query.agentId !== undefined && typeof query.agentId !== "string")
            )
              return;
            const handler = this.handler;
            if (!handler || !this.peers(projectId).some((node) => node.nodeId === nodeId)) return;
            const reply = query.rpc
              ? (this.delegationHandler
                  ? this.delegationHandler(projectId, query.rpc)
                  : Promise.reject(new Error("Remote delegation is unavailable."))
                )
                  .then((result): DelegationRpcReply => ({
                    rpc: true,
                    controllerId: this.local().nodeId,
                    result,
                  }))
                  .catch((error): DelegationRpcReply => ({
                    rpc: true,
                    controllerId: this.local().nodeId,
                    error: error instanceof Error ? error.message : "Remote delegation failed.",
                  }))
              : handler(projectId, { nodeId: query.nodeId, agentId: query.agentId });
            void reply
              .then(async (value) => {
                if (subscription.cancelled) return;
                const api = machineApi(target.agent, target.port, target.cookie, {}, 5000);
                await api.request(
                  "POST",
                  `${prefix}/relay/${encodeURIComponent(query.leaseId)}/${encodeURIComponent(query.requestId)}`,
                  value,
                );
              })
              .catch(() => {});
          } catch {
            /* A malformed peer query never becomes a catalog read. */
          }
        },
      },
    );
  }

  private remove(key: string, stream: Subscription): void {
    clearTimeout(stream.opening);
    stream.cancelled = true;
    if (this.streams.get(key) === stream) this.streams.delete(key);
    if (stream.id !== null) stream.socket?.cancel(stream.id);
  }
}
