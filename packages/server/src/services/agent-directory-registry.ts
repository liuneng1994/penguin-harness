/** A lazy Session-facing binding keeps discovery independent of authentication boot order. */
import { Interface, Module, Provide } from "@prismshadow/penguin-core/kernel";
import type {
  ControlEnvContext,
  SubagentRunner,
  GlobalAgentCatalog,
} from "@prismshadow/penguin-core";
import type { DelegationRequest } from "./agent-delegation-protocol.js";
import type { DirectoryTarget } from "./agent-directory.js";

export type DirectoryReader = (
  projectId: string,
  agentId: string,
  target?: DirectoryTarget,
) => Promise<GlobalAgentCatalog>;

@Interface()
export abstract class AgentDirectoryBinding {
  abstract discover(
    projectId: string,
    agentId: string,
    target?: DirectoryTarget,
  ): Promise<GlobalAgentCatalog>;
  abstract bind(reader: DirectoryReader | null): void;
}

export interface RemoteDelegationClient {
  runner(context: ControlEnvContext): SubagentRunner;
  isRemote(sessionId: string): boolean;
}
@Interface()
export abstract class AgentDelegationBinding {
  abstract runner(context: ControlEnvContext): SubagentRunner;
  abstract isRemote(sessionId: string): boolean;
  abstract execute(projectId: string, request: DelegationRequest): Promise<unknown>;
  abstract bindClient(client: RemoteDelegationClient | null): void;
  abstract bindHost(
    host: ((projectId: string, request: DelegationRequest) => Promise<unknown>) | null,
  ): void;
}

@Module()
export class AgentDirectoryRegistry {
  @Provide() binding!: AgentDirectoryBinding;
  @Provide() delegation!: AgentDelegationBinding;
  setup() {
    let reader: DirectoryReader | null = null;
    const remoteSessions = new Set<string>();
    let client: Parameters<AgentDelegationBinding["bindClient"]>[0] = null;
    let host: Parameters<AgentDelegationBinding["bindHost"]>[0] = null;
    this.delegation = {
      bindClient: (next) => {
        client = next;
      },
      bindHost: (next) => {
        host = next;
      },
      runner: (context) => {
        const runner = client?.runner(context);
        const remember = <T extends { sessionId: string }>(handle: T): T => {
          remoteSessions.add(handle.sessionId);
          if (remoteSessions.size > 10_000)
            remoteSessions.delete(remoteSessions.values().next().value!);
          return handle;
        };
        return {
          spawn: async (input) => {
            if (!runner) throw new Error("Remote delegation is unavailable.");
            return remember(await runner.spawn(input));
          },
          ...(runner?.resume
            ? {
                resume: async (input: Parameters<NonNullable<SubagentRunner["resume"]>>[0]) =>
                  remember(await runner.resume!(input)),
              }
            : {}),
        };
      },
      isRemote: (sessionId) =>
        remoteSessions.has(sessionId) || (client?.isRemote(sessionId) ?? false),
      execute: (projectId, request) =>
        host
          ? host(projectId, request)
          : Promise.reject(new Error("Remote delegation is unavailable.")),
    };
    this.binding = {
      bind: (next) => {
        reader = next;
      },
      discover: (projectId, agentId, target) =>
        reader
          ? reader(projectId, agentId, target)
          : Promise.reject(new Error("Global Agent discovery is unavailable in this host.")),
    };
  }
}
