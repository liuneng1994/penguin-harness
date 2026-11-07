// @vitest-environment jsdom
/**
 * - Opening the section fetches a read-only preview; clicking Sync alone performs a POST,
 *   adopts its result, and preserves the preview/results when a later sync is refused.
 * - Members can see the preview but cannot invoke the action.
 */
import { createElement as h } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { Toaster } from "@prismshadow/penguin-ui";
import type { SkillSyncResponse } from "@prismshadow/penguin-server/api";
import { ProjectSkillSync } from "../src/features/skills/project-skill-sync";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { apiError, json, stubFetch } from "./helpers/fetch";
import { button, click, mount, unmountAll, waitFor } from "./helpers/dom";
afterEach(async () => {
  await unmountAll();
  setActiveStrings(zh);
});
const initial: SkillSyncResponse = {
  sourceAgentId: "default_agent",
  targets: 1,
  entries: [{ agentId: "writer", name: "shared", status: "pending" }],
};
const view = (owner: boolean) =>
  h(
    MemoryRouter,
    null,
    h(ProjectSkillSync, { projectId: "p", isOwner: owner, agentNames: { writer: "Writer" } }),
    h(Toaster),
  );

describe("manual Project skill sharing", () => {
  it("previews without writes and synchronizes only after the explicit click", async () => {
    setActiveStrings(en);
    let refuse = false;
    const server = stubFetch((request) => {
      if (request.method === "POST") {
        if (refuse) return apiError(403, "forbidden", "Only the owner can sync");
        return json({
          ...initial,
          entries: [
            { agentId: "writer", name: "shared", status: "conflict", reason: "local_edits" },
          ],
        });
      }
      return json(initial);
    });
    await mount(view(true));
    await waitFor(() => !button(en.project.skillSyncNow).disabled);
    expect(server.requests.every((request) => request.method === "GET")).toBe(true);
    expect(document.body.textContent).toContain("1 to sync");
    await click(button(en.project.skillSyncNow));
    expect(server.requests.filter((request) => request.method === "POST")).toHaveLength(1);
    expect(document.body.textContent).toContain("Local edits to the synced copy preserved");
    expect(document.querySelector('a[href="/agents/writer?tab=skills"]')!.textContent).toBe(
      "Writer",
    );
    refuse = true;
    await click(button(en.project.skillSyncNow));
    expect(document.body.textContent).toContain("Only the owner can sync");
    expect(document.body.textContent).toContain("Local edits to the synced copy preserved");
  });
  it("members preview but cannot invoke the sync action", async () => {
    setActiveStrings(en);
    const server = stubFetch(() => json(initial));
    await mount(view(false));
    await waitFor(() => document.body.textContent!.includes("1 to sync"));
    expect(button(en.project.skillSyncNow).disabled).toBe(true);
    expect(server.requests.every((request) => request.method === "GET")).toBe(true);
  });
});
