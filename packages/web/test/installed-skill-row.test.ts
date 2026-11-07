// @vitest-environment jsdom
/**
 * - Given a skill with activity, the row displays its counts and date and keeps a disabled
 *   skill manageable; the composer and slash picker exclude it.
 * - Given an immediate switch, show the new state while saving, adopt the answer on success,
 *   and restore the old state with an error toast when saving is refused.
 * - Given a shared entry, its source and copy action are visible, export stays available, and uninstall is absent.
 */
import { createElement as h, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Toaster } from "@prismshadow/penguin-ui";
import type { SkillMetadataItem } from "@prismshadow/penguin-server/api";
import { InstalledSkillRow } from "../src/features/agents/installed-skill-row";
import { filterSkills, skillSlashItems } from "../src/features/chat/skill-use";
import { LocaleProvider } from "../src/state/locale";
import { en } from "../src/lib/strings-en";
import { click, mount, run, switchNamed, unmountAll } from "./helpers/dom";
import { ApiError } from "../src/api/client";

const skill: SkillMetadataItem = {
  name: "demo",
  description: "A skill",
  version: "2026.11.06.1",
  usage: {
    invocations: 2,
    reads: 3,
    failedReads: 1,
    sessions: 2,
    lastUsedAt: "2026-11-06T04:00:00Z",
  },
};
afterEach(async () => {
  await unmountAll();
});
function Row({
  write,
  disabled = false,
}: {
  write: (enabled: boolean) => Promise<void>;
  disabled?: boolean;
}) {
  const [value, setValue] = useState({ ...skill, enabled: !disabled });
  return h(
    LocaleProvider,
    null,
    h(
      "ul",
      null,
      h(InstalledSkillRow, {
        skill: value,
        busy: false,
        onEnabledChange: async (enabled) => {
          await write(enabled);
          setValue({ ...value, enabled });
        },
        onExport: () => {},
        onRemove: () => {},
      }),
    ),
    h(Toaster),
  );
}

describe("installed skill row", () => {
  it("offers independent copies for shared entries while keeping export and hiding source deletion", async () => {
    let copies = 0,
      exports = 0;
    const mounted = await mount(
      h(
        LocaleProvider,
        null,
        h(
          "ul",
          null,
          h(InstalledSkillRow, {
            skill: { ...skill, sourceAgentId: "default_agent" },
            busy: false,
            onEnabledChange: async () => {},
            onMakeLocal: () => {
              copies++;
            },
            onExport: () => {
              exports++;
            },
          }),
        ),
      ),
    );
    expect(mounted.container.textContent).toContain("Shared from General");
    const buttons = [...mounted.container.querySelectorAll("button")];
    await click(buttons.find((button) => button.textContent === "Create private copy")!);
    await click(buttons.find((button) => button.getAttribute("aria-label") === "Export demo")!);
    expect(copies).toBe(1);
    expect(exports).toBe(1);
    expect(buttons.some((button) => button.getAttribute("aria-label") === "Uninstall demo")).toBe(
      false,
    );
  });
  it("shows activity and preserves management while the composer excludes disabled skills", async () => {
    const mounted = await mount(h(Row, { disabled: true, write: async () => {} }));
    expect(mounted.container.textContent).toContain("Selected 2 times");
    expect(mounted.container.textContent).toContain("Read 3 times");
    expect(mounted.container.textContent).toContain("1 failed read");
    expect(mounted.container.textContent).toContain("2 conversations");
    expect(mounted.container.textContent).toContain("Last used:");
    expect(switchNamed(en.skills.enableSkill("demo")).getAttribute("aria-checked")).toBe("false");
    const entries = [skill, { ...skill, name: "off", enabled: false }];
    expect(filterSkills(entries, "en", "").map((s) => s.name)).toEqual(["demo"]);
    expect(skillSlashItems(entries, "en").map((s) => s.name)).toEqual(["demo"]);
  });
  it("commits a switch immediately, adopts success and rolls back refused writes with a toast", async () => {
    let complete!: () => void;
    let writes = 0;
    await mount(
      h(Row, {
        write: async () => {
          writes++;
          if (writes === 1)
            await new Promise<void>((resolve) => {
              complete = resolve;
            });
          else throw new ApiError(403, "forbidden", "Cannot change this skill");
        },
      }),
    );
    await click(switchNamed(en.skills.enableSkill("demo")));
    expect(switchNamed(en.skills.enableSkill("demo")).getAttribute("aria-checked")).toBe("false");
    expect(switchNamed(en.skills.enableSkill("demo")).disabled).toBe(true);
    await run(() => complete());
    expect(switchNamed(en.skills.enableSkill("demo")).disabled).toBe(false);
    await click(switchNamed(en.skills.enableSkill("demo")));
    expect(switchNamed(en.skills.enableSkill("demo")).getAttribute("aria-checked")).toBe("false");
    expect(document.body.textContent).toContain("Cannot change this skill");
  });
});
