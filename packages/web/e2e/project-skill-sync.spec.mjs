/** Only the explicit Project settings action copies General Agent skills. Local conflicts
 * and disabled states are preserved; new Agents borrow shared content until another manual action.
 * Another Project stays unchanged. Capture the settings row in every theme.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";
const BASE = process.env.BASE_URL;

test("General Agent skills sync only on manual action within the Project", async ({
  page,
}, testInfo) => {
  await provisionAndLogin(page.request, "sync_ui_user", "password123");
  const { projects } = await (await page.request.get(`${BASE}/api/projects`)).json();
  const projectId = projects[0].projectId;
  const root = `${BASE}/api/projects/${projectId}`;
  const projectName = "Skill sync Project";
  expect((await page.request.patch(root, { data: { name: projectName } })).ok()).toBe(true);
  const source = `${root}/agents/default_agent`;
  const { skills } = await (await page.request.get(`${source}/skills`)).json();
  for (const skill of skills)
    expect((await page.request.delete(`${source}/skills/${skill.name}`)).ok()).toBe(true);
  expect(
    (await page.request.post(`${source}/plugins`, { data: { names: ["humanizer"] } })).ok(),
  ).toBe(true);
  for (const agentId of ["writer", "local_writer"])
    expect((await page.request.post(`${root}/agents`, { data: { agentId } })).ok()).toBe(true);
  expect(
    (
      await page.request.post(`${root}/agents/local_writer/plugins`, {
        data: { names: ["humanizer"] },
      })
    ).ok(),
  ).toBe(true);
  const other = await (
    await page.request.post(`${BASE}/api/projects`, {
      data: { projectId: "sync_ui_user-other", name: "Other" },
    })
  ).json();
  const otherRoot = `${BASE}/api/projects/${other.project.projectId}`;
  expect(
    (await page.request.post(`${otherRoot}/agents`, { data: { agentId: "other_writer" } })).ok(),
  ).toBe(true);
  const otherBefore = (
    await (await page.request.get(`${otherRoot}/agents/other_writer/skills`)).json()
  ).skills;
  for (const themeId of ["github", "modern", "geek"]) {
    await setAccountPrefs(page.request, { lang: "en", themeId });
    await page.goto(`${BASE}/agents`);
    await page.getByRole("button", { name: projectName, exact: true }).click();
    await page.getByRole("button", { name: "Project settings", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Project settings" });
    const sync = dialog.getByRole("button", { name: "Sync General Agent skills" });
    await expect(sync).toBeEnabled();
    await expect(dialog).toContainText("Local skill with the same name preserved");
    if (themeId === "github")
      expect(
        (await (await page.request.get(`${root}/agents/writer/skills`)).json()).skills,
      ).toEqual([expect.objectContaining({ name: "humanizer", sourceAgentId: "default_agent" })]);
    await expect(dialog.getByRole("switch")).toHaveCount(0);
    await sync.click();
    await expect(dialog).toContainText("1 synced");
    await page.screenshot({
      path: testInfo.outputPath(`${themeId}-project-sync.png`),
      animations: "allow",
    });
    await page.keyboard.press("Escape");
  }
  expect(
    (await (await page.request.get(`${root}/agents/writer/skills`)).json()).skills.map(
      (skill) => skill.name,
    ),
  ).toContain("humanizer");
  expect(
    (
      await page.request.patch(`${root}/agents/writer/skills/humanizer`, {
        data: { enabled: false },
      })
    ).ok(),
  ).toBe(true);
  expect((await page.request.post(`${root}/skill-sync`)).ok()).toBe(true);
  expect(
    (await (await page.request.get(`${root}/agents/writer/skills`)).json()).skills[0].enabled,
  ).toBe(false);
  expect(
    (await page.request.post(`${root}/agents`, { data: { agentId: "new_writer" } })).ok(),
  ).toBe(true);
  expect(
    (await (await page.request.get(`${root}/agents/new_writer/skills`)).json()).skills,
  ).toEqual([expect.objectContaining({ name: "humanizer", sourceAgentId: "default_agent" })]);
  expect((await page.request.post(`${root}/skill-sync`)).ok()).toBe(true);
  expect(
    (await (await page.request.get(`${root}/agents/new_writer/skills`)).json()).skills.map(
      (skill) => skill.name,
    ),
  ).toContain("humanizer");
  expect(
    (await (await page.request.get(`${otherRoot}/agents/other_writer/skills`)).json()).skills,
  ).toEqual(otherBefore);
});
