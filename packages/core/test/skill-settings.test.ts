/**
 * - Given an existing skill, absence of a switch keeps its content and prompt unchanged.
 * - Given disabled skills, concurrent switches preserve both, updates preserve the switch,
 *   and re-enabling restores prompt discovery without losing auxiliary files.
 * - Given an unknown name or corrupt setting, refuse rather than creating or enabling it.
 * - Given a stale explicit selection, a Session refuses it before contacting the model.
 * - Given a shared skill without a switch, explicit selections are refused until the consumer enables it.
 * - Given General's shared entry is temporarily absent during replacement, explicit selections stay disabled and never contact the model.
 * - Given a running Session whose skill is disabled, new entry reads are denied even if a hook allows them.
 * - Given an ordinary file or an enabled entry, reading still succeeds; malformed tool arguments reach validation.
 * - Given paths recorded on another platform, match only the installed entry, never a workspace lookalike.
 * - Given a shared entry in a running Session, its consumer's switch blocks entry reads even when General keeps it enabled.
 * - Given a disabled local or shared entry, case aliases and workspace symlinks cannot bypass its switch.
 * - Given an entry alias changes target, the next read follows the new target; missing historical entries keep lexical identity.
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
  resolveInstalledSkillRead,
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

function sessionFor(calls: (string | undefined)[] = []): {
  session: Session;
  contacts: () => number;
} {
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
  it("keeps shared selections disabled while General's entry is absent during replacement", async () => {
    await installSkill(root, P, "default_agent", {
      name: "shared",
      content: "---\nname: shared\n---\nOriginal instructions\n",
    });
    const source = path.join(agentStateDir(root, P, "default_agent"), "skills", "shared");
    const retained = path.join(root, "retained-shared");
    const { session, contacts } = sessionFor();
    const input = buildSkillsMessage(["shared"], "Task");
    try {
      await expect(collect(session, input)).rejects.toThrow(/shared.*disabled/);
      // Hold the same absent-entry state reached between removing the old directory and
      // publishing its replacement, without relying on filesystem timing or fake modules.
      await fs.rename(source, retained);
      await expect(collect(session, input)).rejects.toThrow(/shared.*disabled/);
      expect(await skillEnabled(agentStateDir(root, P, "default_agent"), "shared")).toBe(true);
      await installSkill(root, P, "default_agent", {
        name: "shared",
        content: "---\nname: shared\n---\nUpdated instructions\n",
      });
      await expect(collect(session, input)).rejects.toThrow(/shared.*disabled/);
      expect(contacts()).toBe(0);
      await expect(fs.access(path.join(state(), "skill-settings"))).rejects.toThrow();
      await setSkillEnabled(root, P, A, "shared", true);
      await collect(session, input);
      expect(contacts()).toBe(1);
    } finally {
      await session.dispose();
    }
  });
  it("refuses a shared selection with no saved switch before contacting the model", async () => {
    await installSkill(root, P, "default_agent", {
      name: "shared",
      content: "---\nname: shared\n---\nShared instructions\n",
    });
    const { session, contacts } = sessionFor();
    try {
      await expect(collect(session, buildSkillsMessage(["shared"], "Task"))).rejects.toThrow(
        /shared.*disabled/,
      );
      expect(contacts()).toBe(0);
      await setSkillEnabled(root, P, A, "shared", true);
      await collect(session, buildSkillsMessage(["shared"], "Task"));
      expect(contacts()).toBe(1);
    } finally {
      await session.dispose();
    }
  });
  it.each([A, "default_agent"])(
    "blocks aliases of disabled content installed on %s using the consumer's switch",
    async (owner) => {
      await installSkill(root, P, owner, {
        name: "Mixed_Name",
        content: "---\nname: Mixed_Name\n---\nDisabled content\n",
      });
      await setSkillEnabled(root, P, A, "Mixed_Name", false);
      const entryDir = path.join(agentStateDir(root, P, owner), "skills", "Mixed_Name");
      const entry = path.join(entryDir, "SKILL.md");
      const link = path.join(root, "entry-alias.md");
      const dirLink = path.join(root, "skill-alias");
      await fs.symlink(entry, link);
      await fs.symlink(entryDir, dirLink, process.platform === "win32" ? "junction" : "dir");
      const paths = [entry, link, path.join(dirLink, "SKILL.md")];
      for (const alias of [
        path.join(entryDir, "skill.md"),
        path.join(path.dirname(entryDir), "mixed_name", "SKILL.md"),
      ]) {
        if (
          await fs.access(alias).then(
            () => true,
            () => false,
          )
        )
          paths.push(alias);
      }
      const { session } = sessionFor(paths.map((file_path) => JSON.stringify({ file_path })));
      try {
        const results = (await collect(session))
          .filter(isCompleteModelMessage)
          .map((message) => message.payload)
          .filter((payload) => payload.type === "tool_call_output");
        expect(results).toHaveLength(paths.length);
        for (const result of results) {
          expect(result.status).toBe("aborted");
          expect(result.output).toContain("Mixed_Name is disabled");
          expect(result.output).not.toContain("Disabled content");
        }
      } finally {
        await session.dispose();
      }
    },
  );

  it("resolves changed aliases afresh and preserves missing historical entry identities", async () => {
    await install();
    const link = path.join(root, "entry-alias.md");
    await fs.symlink(file("demo"), link);
    expect(await resolveInstalledSkillRead(state(), root, link)).toBe("demo");
    await fs.unlink(link);
    await fs.writeFile(path.join(root, "SKILL.md"), "Ordinary workspace file");
    await fs.symlink(path.join(root, "SKILL.md"), link);
    expect(await resolveInstalledSkillRead(state(), root, link)).toBeNull();
    await fs.unlink(file("demo"));
    expect(await resolveInstalledSkillRead(state(), root, file("demo"))).toBe("demo");
    expect(
      await resolveInstalledSkillRead(
        "C:\\old-host\\state",
        "C:\\work",
        "C:\\old-host\\state\\skills\\demo\\SKILL.md",
      ),
    ).toBe("demo");
  });

  it("enforces the consumer's switch on General's shared entry while allowing enabled reads", async () => {
    await installSkill(root, P, "default_agent", {
      name: "shared",
      content: "---\nname: shared\n---\nShared body\n",
    });
    const sharedPath = path.join(agentStateDir(root, P, "default_agent"), "skills/shared/SKILL.md");
    const { session } = sessionFor([
      JSON.stringify({ file_path: sharedPath }),
      undefined,
      JSON.stringify({ file_path: sharedPath }),
    ]);
    const denied = await collect(session);
    expect(
      denied.some(
        (msg) =>
          isCompleteModelMessage(msg) &&
          msg.payload.type === "tool_call_output" &&
          msg.payload.status === "aborted",
      ),
    ).toBe(true);
    await setSkillEnabled(root, P, A, "shared", true);
    const allowed = await collect(session);
    expect(
      allowed.some(
        (msg) =>
          isCompleteModelMessage(msg) &&
          msg.payload.type === "tool_call_output" &&
          msg.payload.output.includes("Shared body"),
      ),
    ).toBe(true);
    await session.dispose();
  });
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
