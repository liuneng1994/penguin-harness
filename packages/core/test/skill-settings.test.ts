/**
 * - Given an existing skill, absence of a switch keeps its content and prompt unchanged.
 * - Given disabled skills, concurrent switches preserve both, updates preserve the switch,
 *   and re-enabling restores prompt discovery without losing auxiliary files.
 * - Given an unknown name or corrupt setting, refuse rather than creating or enabling it.
 * - Given a stale explicit selection, a Session refuses it before contacting the model.
 * - Given a running Session whose skill is disabled, new entry reads are denied even if a hook allows them.
 * - Given an ordinary file or an enabled entry, reading still succeeds; malformed tool arguments reach validation.
 * - Given paths recorded on another platform, match only the installed entry, never a workspace lookalike.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assistantText,
  toolCall,
  userText,
  isCompleteModelMessage,
} from "@prismshadow/amsp/records";
import { buildSkillsMessage } from "@prismshadow/amsp/markers";
import type { AmspRecord } from "@prismshadow/amsp/records";
import { Session } from "../src/session.js";
import { Environment } from "../src/environment/index.js";
import type { LLMInterface, LLMOutcome } from "../src/interfaces/index.js";
import {
  agentStateDir,
  installSkill,
  listInstalledSkills,
  setSkillEnabled,
  skillEnabled,
  skillMetadataSection,
  installedSkillRead,
} from "../src/state/index.js";

let root: string;
const P = "p",
  A = "a";
const state = () => agentStateDir(root, P, A);
const file = (name: string) => path.join(state(), "skills", name, "SKILL.md");
const install = (name = "demo", text = "Original skill") =>
  installSkill(root, P, A, {
    name,
    content: `---\nname: ${name}\ndescription: ${name} instructions\n---\n${text}\n`,
    files: { "reference/data.txt": "keep this" },
  });
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-switch-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function sessionFor(calls: string[] = []): { session: Session; contacts: () => number } {
  let turn = 0;
  const llm: LLMInterface = {
    async *streamGenerate(): AsyncGenerator<AmspRecord, LLMOutcome> {
      const args = calls[turn++];
      if (args !== undefined)
        yield toolCall({ name: "read_file", arguments: args, toolCallId: `c-${turn}` });
      else yield assistantText("Done");
      return { status: "completed" };
    },
  };
  const environment = new Environment({
    workspaceDir: root,
    toolConfig: {
      customTools: [
        {
          name: "read_file",
          description: "Read a file",
          parameters: {
            type: "object",
            properties: { file_path: { type: "string" } },
            required: ["file_path"],
          },
          permission: "r",
        },
      ],
      mcpServers: [],
    },
  });
  const session = new Session({
    meta: {
      session_id: "s",
      provider: "custom",
      model_id: "m",
      model_context_window: 100000,
      system_prompt: "sp",
      agent_state: state(),
      workspace: root,
      source: "user",
    },
    bootstrap: async () => ({ llm }),
    environment,
    imagesDir: path.join(root, "images"),
    modelHasVision: true,
    hooks: { preToolUse: [{ name: "allow", run: async () => ({ decision: "allow" }) }] },
  });
  return { session, contacts: () => turn };
}
async function collect(session: Session, input = "hello") {
  const output: AmspRecord[] = [];
  for await (const msg of session.run([userText(input)], { approve: async () => "allow" }))
    output.push(msg);
  return output;
}

describe("skill switches", () => {
  it("existing skills remain enabled and require no rewritten content or state", async () => {
    await install();
    const before = await fs.readFile(file("demo"), "utf8");
    expect(await skillEnabled(state(), "demo")).toBe(true);
    expect(skillMetadataSection(await listInstalledSkills(root, P, A))).toContain("demo");
    expect(await fs.readFile(file("demo"), "utf8")).toBe(before);
    await expect(fs.access(path.join(state(), "skill-settings"))).rejects.toThrow();
  });
  it("independent switches survive updates and re-enable discovery without losing files", async () => {
    await install();
    await install("other");
    await Promise.all([
      setSkillEnabled(root, P, A, "demo", false),
      setSkillEnabled(root, P, A, "other", false),
    ]);
    expect(skillMetadataSection(await listInstalledSkills(root, P, A))).toBe("");
    await install("demo", "Updated skill");
    expect(await skillEnabled(state(), "demo")).toBe(false);
    await setSkillEnabled(root, P, A, "demo", true);
    expect(skillMetadataSection(await listInstalledSkills(root, P, A))).toContain("demo");
    expect(skillMetadataSection(await listInstalledSkills(root, P, A))).not.toContain("other");
    expect(await fs.readFile(path.join(state(), "skills/demo/reference/data.txt"), "utf8")).toBe(
      "keep this",
    );
  });
  it("unknown names and invalid settings do not create or silently enable a skill", async () => {
    await expect(setSkillEnabled(root, P, A, "missing", false)).rejects.toThrow();
    await expect(setSkillEnabled(root, P, A, "../bad", false)).rejects.toThrow(/skill_name/);
    await install();
    await fs.mkdir(path.join(state(), "skill-settings"));
    const setting = path.join(state(), "skill-settings/demo.json");
    for (const raw of ["{", "null", "{}", '{"enabled":"false"}']) {
      await fs.writeFile(setting, raw);
      await expect(skillEnabled(state(), "demo")).rejects.toThrow();
    }
  });
  it("a stale explicit selection is refused before contacting the model", async () => {
    await install();
    await setSkillEnabled(root, P, A, "demo", false);
    const { session, contacts } = sessionFor();
    try {
      await expect(collect(session, buildSkillsMessage(["demo"], "task"))).rejects.toThrow(
        /demo.*disabled/,
      );
      expect(contacts()).toBe(0);
    } finally {
      session.dispose();
    }
  });
  it("a newly disabled entry is denied even when a hook allows tools", async () => {
    await install();
    const { session } = sessionFor([JSON.stringify({ file_path: file("demo") })]);
    await setSkillEnabled(root, P, A, "demo", false);
    try {
      const output = await collect(session);
      const results = output
        .filter(isCompleteModelMessage)
        .map((m) => m.payload)
        .filter((p) => p.type === "tool_call_output");
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ status: "aborted" });
      expect(JSON.stringify(results)).not.toContain("Original skill");
      expect(JSON.stringify(results)).toContain("disabled");
    } finally {
      session.dispose();
    }
  });
  it("enabled entries and ordinary files remain readable, and malformed calls are validated", async () => {
    await install();
    await fs.writeFile(path.join(root, "SKILL.md"), "Workspace file");
    const { session } = sessionFor([
      JSON.stringify({ file_path: file("demo") }),
      JSON.stringify({ file_path: "SKILL.md" }),
      "null",
      "invalid",
    ]);
    try {
      const output = await collect(session);
      const results = output
        .filter(isCompleteModelMessage)
        .map((m) => m.payload)
        .filter((p) => p.type === "tool_call_output");
      expect(results[0]).toMatchObject({ status: "completed" });
      expect(results[0]!.output).toContain("Original skill");
      expect(results[1]!.output).toContain("Workspace file");
      expect(results.slice(2).every((p) => p.status !== "completed")).toBe(true);
    } finally {
      session.dispose();
    }
  });
  it("matches installed entries across recorded platforms without counting lookalikes", () => {
    expect(
      installedSkillRead("C:\\data\\state", "C:\\work", "C:\\data\\state\\skills\\demo\\SKILL.md"),
    ).toBe("demo");
    expect(installedSkillRead("/data/state", "/data/state", "skills/demo/SKILL.md")).toBe("demo");
    for (const f of [
      "/work/SKILL.md",
      "/data/state/skills/demo/reference/SKILL.md",
      "/data/state/skills/../SKILL.md",
    ])
      expect(installedSkillRead("/data/state", "/work", f)).toBeNull();
  });
});
