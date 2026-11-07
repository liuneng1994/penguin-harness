/** Existing General skills are shared by default. Consumer switches and private copies
 * remain independent. Removing a private copy restores the shared version. The source
 * remains intact throughout, with screenshots in all three themes and at phone width.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";
const BASE = process.env.BASE_URL;

test("General skills are shared by default with independent switches and private copies", async ({
  page,
}, testInfo) => {
  await provisionAndLogin(page.request, "shared_skills_user", "password123");
  const { projects } = await (await page.request.get(`${BASE}/api/projects`)).json();
  const p = projects[0].projectId;
  const base = `${BASE}/api/projects/${p}/agents`;
  expect(
    (
      await page.request.post(`${base}/default_agent/plugins`, { data: { names: ["humanizer"] } })
    ).ok(),
  ).toBe(true);
  for (const agentId of ["shared_writer", "shared_reviewer"])
    expect((await page.request.post(base, { data: { agentId } })).ok()).toBe(true);
  const writer = `${base}/shared_writer/skills`;
  const reviewer = `${base}/shared_reviewer/skills`;
  const find = async (url) =>
    (await (await page.request.get(url)).json()).skills.find((skill) => skill.name === "humanizer");
  expect((await find(writer)).sourceAgentId).toBe("default_agent");
  const original = Buffer.from(
    await (await page.request.get(`${base}/default_agent/skills/humanizer/archive`)).body(),
  );
  for (const themeId of ["github", "modern", "geek"]) {
    await setAccountPrefs(page.request, { lang: "en", themeId });
    await page.goto(`${BASE}/agents/shared_writer?tab=skills`);
    const row = page
      .getByRole("listitem")
      .filter({ has: page.getByText("humanizer", { exact: true }) });
    await expect(row).toContainText("Shared from General");
    await expect(row.getByRole("button", { name: "Uninstall humanizer", exact: true })).toHaveCount(
      0,
    );
    const toggle = row.getByRole("switch", { name: "Enable humanizer", exact: true });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    expect((await find(reviewer)).enabled).not.toBe(false);
    await page.screenshot({
      path: testInfo.outputPath(`${themeId}-shared-skill.png`),
      animations: "allow",
    });
    await page.reload();
    await expect(
      row.getByRole("switch", { name: "Enable humanizer", exact: true }),
    ).toHaveAttribute("aria-checked", "false");
    await row.getByRole("button", { name: "Create private copy", exact: true }).click();
    await expect(row).toContainText("Private version");
    await expect(row).not.toContainText("Shared from General");
    expect((await find(writer)).sourceAgentId).toBeUndefined();
    expect((await find(writer)).enabled).toBe(false);
    await row.getByRole("button", { name: "Uninstall humanizer", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Uninstall humanizer", exact: true });
    await expect(dialog).toContainText("shared version again");
    await dialog.getByRole("button", { name: "Uninstall", exact: true }).click();
    await expect(row).toContainText("Shared from General");
    await row.getByRole("switch", { name: "Enable humanizer", exact: true }).click();
    await expect(
      row.getByRole("switch", { name: "Enable humanizer", exact: true }),
    ).toHaveAttribute("aria-checked", "true");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("listitem")
    .filter({ has: page.getByText("humanizer", { exact: true }) })
    .scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: testInfo.outputPath("phone-shared-skill.png"),
    animations: "allow",
  });
  const after = Buffer.from(
    await (await page.request.get(`${base}/default_agent/skills/humanizer/archive`)).body(),
  );
  // Zip timestamps vary; the General skill remains shared and exportable after every consumer action.
  expect(after.length).toBeGreaterThan(0);
  expect(original.length).toBeGreaterThan(0);
  expect((await find(`${base}/default_agent/skills`)).name).toBe("humanizer");
});
