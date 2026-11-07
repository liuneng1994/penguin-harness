/** Compose a context's delegation catalog once so its request prefix stays stable. */
import type { ToolDefinitionConfig } from "../interfaces/index.js";
import type { ProjectAgentInfo } from "../state/agent-catalog.js";

export function withAgentDiscovery(
  tools: ToolDefinitionConfig[],
  agents: ProjectAgentInfo[],
  discoveryTool: ToolDefinitionConfig,
): ToolDefinitionConfig[] {
  const delegation = tools.some((tool) => tool.name === "run_subagent");
  // Discovery accompanies configured delegation permanently, including stored tool lists
  // from before list_agents existed. Explicit configurations without either tool stay closed.
  const available =
    delegation && !tools.some((tool) => tool.name === "list_agents")
      ? [...tools, discoveryTool]
      : tools;
  const catalog = agents
    .map(
      (agent) =>
        `- ${JSON.stringify(agent.agentId)}: ${JSON.stringify({ name: agent.name, description: agent.description })}`,
    )
    .join("\n");
  return available.map((tool) => {
    if (tool.name !== "run_subagent") return tool;
    const parameters = tool.parameters;
    const properties = parameters?.properties as Record<string, unknown> | undefined;
    const argument = properties?.agent_id;
    if (!argument || typeof argument !== "object") return tool;
    const field = argument as Record<string, unknown>;
    return {
      ...tool,
      parameters: {
        ...parameters,
        properties: {
          ...properties,
          agent_id: {
            ...field,
            description: [
              typeof field.description === "string" ? field.description : "",
              "Available Agents on this node, in this Project. Choose a target according to your plan and its declared role; omit agent_id to reuse your own Agent. Use list_agents to refresh this catalog or inspect an Agent's enabled skills.",
              catalog || "No other Agent metadata is available.",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        },
      },
    };
  });
}
