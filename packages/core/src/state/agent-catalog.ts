/** Agent identities and declared roles from the current node's Project directory. */
import fs from "node:fs/promises";
import { parse } from "yaml";
import { assertValidId, isValidId } from "./ids.js";
import { agentsDir, systemConfigPath } from "./paths.js";
import { listAvailableSkills } from "./skill-catalog.js";

export interface ProjectAgentInfo {
  agentId: string;
  name: string;
  description: string;
}

export interface AgentDiscovery {
  projectId: string;
  agentId: string;
  list(): Promise<ProjectAgentInfo[]>;
  skills(agentId: string): Promise<string[]>;
  /** Host-provided, read-only discovery; absent keeps the local catalog unchanged. */
  global?(target?: { nodeId?: string; agentId?: string }): Promise<GlobalAgentCatalog>;
}

export interface GlobalAgentInfo extends ProjectAgentInfo {
  nodeId: string;
  nodeName: string;
  local: boolean;
  canDelegate: boolean;
  skills?: string[];
}

export interface GlobalAgentCatalog {
  projectId: string;
  currentNodeId: string;
  agents: GlobalAgentInfo[];
  unavailableNodes: Array<{ nodeId: string; nodeName: string; reason: string }>;
}

export function createAgentDiscovery(
  root: string,
  projectId: string,
  agentId: string,
): AgentDiscovery {
  assertValidId("project_id", projectId);
  assertValidId("agent_id", agentId);
  return {
    projectId,
    agentId,
    list: () => listProjectAgents(root, projectId),
    skills: async (target) =>
      (await listAvailableSkills(root, projectId, target))
        .filter((skill) => skill.enabled !== false)
        .map((skill) => skill.name),
  };
}

/** Read metadata only: discovery never initializes an Agent or reads its secrets or history. */
export async function listProjectAgents(
  root: string,
  projectId: string,
): Promise<ProjectAgentInfo[]> {
  assertValidId("project_id", projectId);
  let entries;
  try {
    entries = await fs.readdir(agentsDir(root, projectId), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const agents = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && isValidId(entry.name))
      .map(async (entry) => {
        try {
          const config: unknown = parse(
            await fs.readFile(systemConfigPath(root, projectId, entry.name), "utf8"),
          );
          if (
            !config ||
            typeof config !== "object" ||
            !("system_prompt" in config) ||
            typeof config.system_prompt !== "string"
          )
            return null;
          return {
            agentId: entry.name,
            name: "name" in config && typeof config.name === "string" ? config.name : entry.name,
            description:
              "description" in config && typeof config.description === "string"
                ? config.description
                : "",
          };
        } catch {
          // Incomplete, deleted or invalid states cannot be loaded as delegation targets.
          return null;
        }
      }),
  );
  return agents
    .filter((agent) => agent !== null)
    .sort((a, b) => (a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0));
}
