/** Compose a context's delegation catalog once so its request prefix stays stable. */
import type { ToolDefinitionConfig } from "../interfaces/index.js";
import type { ProjectAgentInfo } from "../state/agent-catalog.js";
import type { AmspRecord } from "@prismshadow/amsp/records";
import { isEventMessage } from "@prismshadow/amsp/records";

const CATALOG_HINT =
  "Available Agents on this node, in this Project. Choose a target according to your plan and its declared role; omit agent_id to reuse your own Agent. Use list_agents to refresh this catalog or inspect an Agent's enabled skills.";

/** Keep only our descriptive suffix from this context's last native tool record. Runtime
 * configuration still comes from disk. Traces without the suffix use a fresh catalog
 * permanently; no record or configuration migration is required.
 */
export function recordedAgentCatalog(records: readonly AmspRecord[]): string | undefined {
  const record = records.findLast(
    (record) =>
      (record.origin?.length ?? 0) === 0 &&
      isEventMessage(record) &&
      record.payload.type === "tool_list_ready",
  );
  if (
    !record ||
    !isEventMessage(record) ||
    record.payload.type !== "tool_list_ready" ||
    !Array.isArray(record.payload.tools)
  )
    return undefined;
  const tool = record.payload.tools.find((tool) => tool?.name === "run_subagent");
  const properties = tool?.parameters?.properties as Record<string, unknown> | undefined;
  const description = (properties?.agent_id as Record<string, unknown> | undefined)?.description;
  if (typeof description !== "string") return undefined;
  const start = description.indexOf(CATALOG_HINT);
  return start === -1 ? undefined : description.slice(start);
}

export function withAgentDiscovery(
  tools: ToolDefinitionConfig[],
  agents: ProjectAgentInfo[],
  discoveryTool: ToolDefinitionConfig,
  recordedCatalog?: string,
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
              recordedCatalog ??
                [CATALOG_HINT, catalog || "No other Agent metadata is available."].join("\n"),
            ]
              .filter(Boolean)
              .join("\n"),
          },
        },
      },
    };
  });
}
