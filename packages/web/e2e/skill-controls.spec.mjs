/**
 * Installed skills show activity from a retained Trace. Each theme's switch preserves
 * content, persists across reload and removes the skill from the chat picker. Capture the
 * switch during motion, and check the same row at phone width.
 */
import { test, expect } from "@playwright/test";
import {
  sessionMeta,
  userText,
  toolCall,
  toolCallOutput,
  buildSkillsMessage,
} from "@prismshadow/penguin-core";
import { provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";
const BASE = process.env.BASE_URL;

test("skill statistics and individual switches across themes", async ({ page }, testInfo) => {
  await provisionAndLogin(page.request, "skill_controls_user", "password123");
  const { projects } = await (await page.request.get(`${BASE}/api/projects`)).json();
  const projectId = projects[0].projectId;
  const base = `${BASE}/api/projects/${projectId}/agents/skill_controls`;
  expect(
    (
      await page.request.post(`${BASE}/api/projects/${projectId}/agents`, {
        data: { agentId: "skill_controls" },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (await page.request.post(`${base}/plugins`, { data: { names: ["humanizer"] } })).ok(),
  ).toBe(true);
  const records = [
    sessionMeta({
      session_id: "skill-controls-trace",
      provider: "custom",
      model_id: "m",
      model_context_window: 100000,
      system_prompt: "sp",
      agent_state: "/historical/state",
      workspace: "/work",
      source: "user",
    }),
    userText(buildSkillsMessage(["humanizer"], "Review the text")),
    toolCall({
      name: "read_file",
      arguments: JSON.stringify({ file_path: "/historical/state/skills/humanizer/SKILL.md" }),
      toolCallId: "read",
    }),
    toolCallOutput({ output: "Skill instructions", toolCallId: "read", status: "completed" }),
  ];
  expect(
    (
      await page.request.post(`${base}/traces/import`, {
        data: {
          dataBase64: Buffer.from(records.map((r) => JSON.stringify(r)).join("\n") + "\n").toString(
            "base64",
          ),
        },
      })
    ).ok(),
  ).toBe(true);
  for (const themeId of ["github", "modern", "geek"]) {
    await setAccountPrefs(page.request, { lang: "en", themeId });
    await page.goto(`${BASE}/agents/skill_controls?tab=skills`);
    const row = page
      .getByRole("listitem")
      .filter({ has: page.getByText("humanizer", { exact: true }) });
    await expect(row).toContainText("Selected 1 time");
    await expect(row).toContainText("Read 1 time");
    await expect(row).toContainText("Last used:");
    const toggle = row.getByRole("switch", { name: "Enable humanizer" });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await page.screenshot({
      path: testInfo.outputPath(`${themeId}-switch.png`),
      animations: "allow",
    });
    await page.reload();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(row.getByRole("button", { name: "Export humanizer" })).toBeEnabled();
    const response = await (await page.request.get(`${base}/skills`)).json();
    expect(response.skills[0].enabled).toBe(false);
    await page.goto(`${BASE}/chat/new?agent=skill_controls`);
    await page.getByRole("button", { name: "Skills", exact: true }).click();
    await expect(page.getByRole("button", { name: /^humanizer\b/ })).toHaveCount(0);
    await page.goto(`${BASE}/agents/skill_controls?tab=skills`);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByText("humanizer", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
