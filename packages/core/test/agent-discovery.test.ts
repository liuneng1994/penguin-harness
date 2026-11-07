/**
 * - Given local and foreign Projects/nodes, discovery reads only valid local Agent metadata without writing state.
 * - Given stored delegation tools, a model sees peer roles without a config migration; a context's roster stays fixed until the next context.
 * - Given a child Session, discovery stays available while a second delegation level remains unavailable.
 * - Given a model refreshing or inspecting an Agent, the tool returns current roles and enabled shared/private skills, excluding secrets.
 * - Given invalid, absent or foreign targets, discovery refuses them without creating an Agent.
 * - Given a model's own chosen target, delegation passes that choice to the runner without routing by task keywords.
 */
import fs from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAgent,
  createAgentDiscovery,
  defaultSystemConfig,
  installSkill,
  isCompleteModelMessage,
  listProjectAgents,
  saveProjectConfig,
  setSkillEnabled,
  systemConfigPath,
  userText,
  assistantText,
  partialText,
  withOrigin,
} from "../src/index.js";
import { Session } from "../src/session.js";
import { Environment } from "../src/environment/index.js";
import type {
  ToolDefinition,
  ToolDefinitionConfig,
  SubagentRunner,
} from "../src/interfaces/index.js";
import type { AmspRecord } from "@prismshadow/amsp/records";
import { allowAll, modelConfig, recordingModel } from "./helpers/prompt-cache/index.js";
import type { ScriptedReply } from "./helpers/prompt-cache/index.js";

let root: string;
const P = "p",
  A = "general";
const defaults = () => defaultSystemConfig().tools!.builtin!;
const oldTools = () => defaults().filter((tool) => tool.name !== "list_agents");
async function writeAgent(
  id: string,
  description: string,
  options: { projectId?: string; node?: string; tools?: ToolDefinitionConfig[] } = {},
) {
  const file = systemConfigPath(options.node ?? root, options.projectId ?? P, id);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    JSON.stringify({
      system_prompt: "You complete the assigned task.",
      name: `Name ${id}`,
      description,
      tools: { builtin: options.tools ?? oldTools(), mcpServers: [] },
      compaction: { enabled: false },
    }),
  );
  return file;
}
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-discovery-"));
  await saveProjectConfig(root, P, {
    default_model: { provider: "custom", model_id: "m" },
    providers: {
      custom: { client_type: "openai-chat", base_url: "http://127.0.0.1:1/v1", api_key: "test" },
    },
    models: [{ provider: "custom", model_id: "m", context_window: 100000 }],
  });
  await writeAgent(A, "Coordinates the user's task");
  await writeAgent("writer", "Drafts technical documentation");
  await writeAgent("reviewer", "Reviews code changes");
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function openedTools(depth = 0): Promise<ToolDefinition[]> {
  const agent = await createAgent({ root, projectId: P, agentId: A });
  const session = await agent.createSession({ workspaceDir: root, subagentDepth: depth });
  const iterator = session.run([userText("Prepare a plan")]);
  try {
    for (;;) {
      const next = await iterator.next();
      if (next.done) throw new Error("No tool list emitted");
      const payload = next.value.payload as { type?: string; tools?: ToolDefinition[] };
      if (payload.type === "tool_list_ready") return payload.tools!;
    }
  } finally {
    await iterator.return(null);
    await session.dispose();
  }
}

function argsOf(tool: ToolDefinition): Record<string, Record<string, unknown>> {
  return tool.parameters!.properties as Record<string, Record<string, unknown>>;
}

async function runScript(
  script: ScriptedReply[],
  runner?: SubagentRunner,
  beforeRequest?: (index: number) => void,
) {
  const defs = defaults().filter(
    (tool) => tool.name === "list_agents" || (runner && tool.name === "run_subagent"),
  );
  const environment = new Environment({
    workspaceDir: root,
    toolConfig: { customTools: defs, mcpServers: [] },
    services: {
      agentDiscovery: createAgentDiscovery(root, P, A),
      ...(runner ? { subagentRunner: runner } : {}),
    },
  });
  const tools = await environment.listTools();
  const { model, requests } = recordingModel(
    modelConfig({ tools, systemPrompt: "Plan the task using the available Agents." }),
    script,
    { onRequest: (request) => beforeRequest?.(request.index) },
  );
  const session = new Session({
    meta: {
      session_id: "script",
      provider: "custom",
      model_id: "m",
      model_context_window: 100000,
      system_prompt: "Plan the task using the available Agents.",
      agent_state: path.dirname(systemConfigPath(root, P, A)),
      workspace: root,
      source: "user",
    },
    bootstrap: async () => ({ llm: model }),
    environment,
    imagesDir: path.join(root, "images"),
    modelHasVision: true,
  });
  const records: AmspRecord[] = [];
  try {
    for await (const record of session.run([userText("Review this code and document the result")], {
      approve: allowAll,
    }))
      records.push(record);
  } finally {
    await session.dispose();
  }
  return { records, requests };
}
const call = (agentId?: unknown) => ({
  id: "discover",
  name: "list_agents",
  args: {
    description: "Find a suitable Agent",
    ...(agentId !== undefined ? { agent_id: agentId } : {}),
  },
});
const outputs = (records: AmspRecord[]) =>
  records
    .filter(isCompleteModelMessage)
    .map((record) => record.payload)
    .filter((payload) => payload.type === "tool_call_output");

describe("Agent discovery", () => {
  it("lists only valid Agents in this Project on this node without writing their state", async () => {
    await writeAgent("foreign_project", "Not local to this Project", { projectId: "other" });
    await writeAgent("foreign_node", "Not local to this node", {
      node: path.join(root, "other-node"),
    });
    const incomplete = systemConfigPath(root, P, "incomplete");
    await fs.mkdir(path.dirname(incomplete), { recursive: true });
    const corrupt = await writeAgent("corrupt", "Invalid");
    await fs.writeFile(corrupt, "null");
    const file = systemConfigPath(root, P, A);
    const before = await fs.readFile(file, "utf8");
    expect((await listProjectAgents(root, P)).map((agent) => agent.agentId)).toEqual([
      A,
      "reviewer",
      "writer",
    ]);
    expect(await fs.readFile(file, "utf8")).toBe(before);
    await expect(fs.access(incomplete)).rejects.toThrow();
    expect(await listProjectAgents(root, "missing")).toEqual([]);
    await expect(listProjectAgents(root, "../other")).rejects.toThrow();
  });

  it("exposes roles from stored configurations and refreshes only at the next context", async () => {
    const file = systemConfigPath(root, P, A);
    const before = await fs.readFile(file, "utf8");
    const tools = await openedTools();
    const delegation = tools.find((tool) => tool.name === "run_subagent")!;
    expect(argsOf(delegation).agent_id!.description).toContain("Drafts technical documentation");
    expect(argsOf(delegation).agent_id!.enum).toBeUndefined();
    expect(tools.some((tool) => tool.name === "list_agents")).toBe(true);
    await writeAgent("writer", "Writes release notes");
    expect(argsOf(delegation).agent_id!.description).not.toContain("Writes release notes");
    const next = (await openedTools()).find((tool) => tool.name === "run_subagent")!;
    expect(argsOf(next).agent_id!.description).toContain("Writes release notes");
    expect(await fs.readFile(file, "utf8")).toBe(before);
    await writeAgent(A, "No tools", { tools: [] });
    expect(await openedTools()).toEqual([]);
  });

  it("lets child Sessions discover peers while preserving one delegation level", async () => {
    const tools = await openedTools(1);
    expect(tools.some((tool) => tool.name === "list_agents")).toBe(true);
    expect(
      tools.some((tool) => tool.name === "run_subagent" || tool.name === "input_subagent"),
    ).toBe(false);
  });

  it("refreshes roles and returns enabled skills without exposing Agent secrets", async () => {
    await installSkill(root, P, "writer", {
      name: "disabled",
      content: "---\nname: disabled\n---\n",
    });
    await installSkill(root, P, "default_agent", {
      name: "shared",
      content: "---\nname: shared\n---\n",
    });
    await setSkillEnabled(root, P, "writer", "disabled", false);
    await setSkillEnabled(root, P, "writer", "shared", true);
    await fs.writeFile(
      path.join(path.dirname(systemConfigPath(root, P, "writer")), ".vault.toml"),
      'SECRET="hidden"',
    );
    const { records } = await runScript(
      [
        { toolCalls: [call()] },
        { toolCalls: [{ ...call("writer"), id: "inspect" }] },
        { text: "Ready" },
      ],
      undefined,
      (index) => {
        if (index === 1) {
          const file = systemConfigPath(root, P, "writer");
          const config = JSON.parse(readFileSync(file, "utf8"));
          writeFileSync(file, JSON.stringify({ ...config, description: "Writes release notes" }));
        }
      },
    );
    const results = outputs(records);
    const roster = JSON.parse(results[0]!.output);
    expect(roster.project_id).toBe(P);
    expect(
      roster.agents.find((agent: { agent_id: string }) => agent.agent_id === "writer").description,
    ).toBe("Drafts technical documentation");
    expect(JSON.parse(results[1]!.output).agents[0].description).toBe("Writes release notes");
    expect(JSON.parse(results[1]!.output).agents[0].skills).toEqual(["shared"]);
    expect(JSON.stringify(results)).not.toContain("hidden");
  });

  it.each(["missing", "../other", "foreign_project", "foreign_node", 42])(
    "refuses an unavailable target %j without creating state",
    async (target) => {
      const { records } = await runScript([{ toolCalls: [call(target)] }, { text: "Done" }]);
      expect(outputs(records)[0]!.status).toBe("fatal");
      expect((await listProjectAgents(root, P)).map((agent) => agent.agentId)).toEqual([
        A,
        "reviewer",
        "writer",
      ]);
    },
  );

  it("delegates to the model's chosen Agent without selecting a target from task keywords", async () => {
    const choices: string[] = [];
    const runner: SubagentRunner = {
      async spawn(input) {
        choices.push(input.agentId!);
        return {
          sessionId: "child",
          async *run() {
            yield withOrigin(partialText("delta", "Completed the assigned task"), "child");
            yield withOrigin(assistantText("Completed the assigned task"), "child");
            return null;
          },
          dispose() {},
        };
      },
    };
    const { records, requests } = await runScript(
      [
        { toolCalls: [call()] },
        {
          toolCalls: [
            {
              id: "delegate",
              name: "run_subagent",
              args: {
                description: "Delegate documentation",
                agent_id: "writer",
                prompt: "Caller agent: general. Document the review result.",
              },
            },
          ],
        },
        { text: "Done" },
      ],
      runner,
    );
    expect(choices).toEqual(["writer"]);
    expect(requests).toHaveLength(3);
    expect(
      outputs(records).some(
        (output) =>
          output.status === "completed" && output.output.includes("Completed the assigned task"),
      ),
    ).toBe(true);
  });
});
