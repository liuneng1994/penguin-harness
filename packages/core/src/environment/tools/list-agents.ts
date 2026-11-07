/** Read the local Project's Agent roster; the model chooses its own delegation plan. */
import { partialToolCallOutput } from "@prismshadow/amsp/records";
import type { EnvironmentServices, ToolDefinitionConfig } from "../../interfaces/index.js";
import type { BuiltinTool } from "./types.js";

export const LIST_AGENTS_NAME = "list_agents";

export function createListAgentsTool(
  definition: ToolDefinitionConfig,
  services?: EnvironmentServices,
): BuiltinTool {
  return {
    name: LIST_AGENTS_NAME,
    definition,
    async *execute(args, ctx) {
      const discovery = services?.agentDiscovery;
      if (!discovery)
        return { status: "fatal", note: "Agent discovery is unavailable in this environment." };
      if (args.agent_id !== undefined && typeof args.agent_id !== "string")
        return { status: "fatal", note: "agent_id must be a string." };
      const catalog = await discovery.list();
      const agents =
        args.agent_id === undefined
          ? catalog
          : catalog.filter((agent) => agent.agentId === args.agent_id);
      if (args.agent_id !== undefined && agents.length === 0)
        return {
          status: "fatal",
          note: `Agent is not available in this Project on this node: ${JSON.stringify(args.agent_id)}`,
        };
      const roster = await Promise.all(
        agents.map(async (agent) => ({
          agent_id: agent.agentId,
          name: agent.name,
          description: agent.description,
          ...(args.agent_id !== undefined ? { skills: await discovery.skills(agent.agentId) } : {}),
        })),
      );
      yield partialToolCallOutput({
        eventType: "delta",
        toolCallId: ctx.toolCallId,
        output: JSON.stringify({
          project_id: discovery.projectId,
          current_agent_id: discovery.agentId,
          agents: roster,
        }),
      });
      return { status: "completed" };
    },
  };
}
