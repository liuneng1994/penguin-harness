/**
 * The current file's staged/working diff has old/new line numbers, semantic change colors,
 * unified and split views, copy and refresh. Other files stay out of the diff. Returning to
 * Code preserves read-only selection and side questions. Three themes and phone layouts fit.
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";
const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
let workspace;
test.afterAll(async () => {
  if (workspace && !process.env.CODE_DIFF_DEMO_ROOT)
    await fs.rm(workspace, { recursive: true, force: true });
});
test("current-file Git diff and code questions", async ({ page }, info) => {
  workspace =
    process.env.CODE_DIFF_DEMO_ROOT ||
    (await fs.mkdtemp(path.join(os.tmpdir(), "penguin-code-diff-")));
  await fs.mkdir(path.join(workspace, "bolt/expression"), { recursive: true });
  const file = path.join(workspace, "bolt/expression/Expr.cpp");
  const lines = Array.from({ length: 900 }, (_, i) => `// line ${i + 1}`);
  lines[783] = "int evaluateExpression(int value) {";
  lines[784] = "  const int result = value * 1;";
  lines[785] = "  return result;";
  lines[786] = "}";
  lines[787] = `const char* detail = "${"description ".repeat(25)}";`;
  const write = (n) =>
    fs.writeFile(
      file,
      lines.map((line, i) => (i === 784 ? `  const int result = value * ${n};` : line)).join("\n"),
    );
  const git = (...args) => execFileSync("git", args, { cwd: workspace });
  git("init", "-q");
  await write(1);
  await fs.writeFile(path.join(workspace, "other.cpp"), "old\n");
  git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-qm", "initial");
  await write(2);
  git("add", "bolt/expression/Expr.cpp");
  await write(3);
  await fs.writeFile(path.join(workspace, "other.cpp"), "unrelated-file-secret\n");
  await provisionAndLogin(page.request, "codediff", "penguin-2026");
  const { projects } = await (await page.request.get(`${BASE}/api/projects`)).json();
  const project = projects[0].projectId;
  const base = `${BASE}/api/projects/${project}/agents/default_agent`;
  expect(
    (
      await page.request.put(`${BASE}/api/projects/${project}/models`, {
        data: {
          defaultModel: { provider: "custom", modelId: "claude-4-8" },
          models: [
            {
              provider: "custom",
              modelId: "claude-4-8",
              apiKey: "sk-mock",
              baseUrl: MOCK,
              contextWindow: 200000,
            },
          ],
        },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (await page.request.post(`${base}/plugins`, { data: { names: ["code-viewer"] } })).ok(),
  ).toBe(true);
  const workbenches = await (await page.request.get(`${base}/workbenches`)).json();
  expect(
    workbenches.workbenches.find((workbench) =>
      workbench.tabs.some((tab) => tab.key === "code-preview"),
    )?.error,
    JSON.stringify(workbenches),
  ).toBeNull();
  const { session } = await (
    await page.request.post(`${base}/sessions`, {
      data: { provider: "custom", modelId: "claude-4-8", workspace, approvalMode: "allow-all" },
    })
  ).json();
  const sid = session.sessionId;
  await page.request.post(`${BASE}/api/sessions/${sid}/tasks`, {
    data: { input: [{ type: "text", text: "code viewer test" }] },
  });
  for (const themeId of ["github", "modern", "geek"]) {
    await setAccountPrefs(page.request, { lang: "en", themeId, textSize: "md" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${BASE}/chat/${sid}`);
    await page.getByRole("link", { name: "Expr.cpp:785-795", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const frame = dialog.frameLocator("iframe");
    await frame.getByRole("button", { name: "Git diff", exact: true }).click();
    const diff = frame.getByRole("table", {
      name: "Changes to bolt/expression/Expr.cpp",
      exact: true,
    });
    await expect(diff).toContainText("value * 2;");
    await expect(diff).toContainText("value * 3;");
    await expect(diff).not.toContainText("unrelated-file-secret");
    await expect(diff.locator("tr[data-kind=add] ins")).toContainText("value * 3;");
    await expect(diff.locator("tr[data-kind=del] del")).toContainText("value * 2;");
    const colors = await diff.evaluate((node) => ({
      add: getComputedStyle(node.querySelector("[data-kind=add]")).backgroundColor,
      del: getComputedStyle(node.querySelector("[data-kind=del]")).backgroundColor,
    }));
    expect(colors.add).not.toBe(colors.del);
    await frame.getByRole("region", { name: "Git diff", exact: true }).evaluate((node) => {
      for (const animation of node.getAnimations({ subtree: true })) {
        const duration = animation.effect?.getTiming().duration;
        if (typeof duration === "number" && duration > 0) {
          animation.pause();
          animation.currentTime = duration / 2;
        }
      }
    });
    await page.screenshot({
      path: info.outputPath(`${themeId}-diff-opening.png`),
      animations: "allow",
    });
    await frame.getByRole("region", { name: "Git diff", exact: true }).evaluate((node) => {
      for (const animation of node.getAnimations({ subtree: true })) animation.finish();
    });
    const expected = await (
      await page.request.get(
        `${BASE}/api/sessions/${sid}/files/git-diff?path=bolt/expression/Expr.cpp`,
      )
    ).json();
    await frame.getByRole("button", { name: "Copy diff", exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected.patch);
    await frame.getByRole("button", { name: "Staged", exact: true }).click();
    await expect(diff).toContainText("value * 1;");
    await expect(diff).toContainText("value * 2;");
    await expect(diff).not.toContainText("value * 3;");
    await frame.getByRole("button", { name: "Side by side", exact: true }).click();
    expect(await diff.locator("tbody tr").nth(1).locator("td").count()).toBe(6);
    await page.screenshot({ path: info.outputPath(`${themeId}-split-diff.png`) });
    await frame.getByRole("button", { name: "Code", exact: true }).click();
    await expect(frame.locator(".cm-cited-line")).toHaveCount(11);
    await expect(frame.locator(".cm-content")).toBeVisible();
    await frame.locator(".cm-content").press("Escape");
  }
  for (const lang of ["en", "zh"]) {
    await setAccountPrefs(page.request, { lang, textSize: "xl" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/chat/${sid}`);
    await page.getByRole("link", { name: "Expr.cpp:785-795", exact: true }).click();
    const frame = page.getByRole("dialog").frameLocator("iframe");
    await frame.getByRole("button", { name: "Git diff", exact: true }).click();
    await expect(frame.getByRole("table")).toContainText("value * 3;");
    expect(
      await frame.locator("body").evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath(`phone-${lang}-git-diff.png`) });
    await page
      .getByRole("dialog")
      .getByRole("button", { name: lang === "en" ? "Close" : "关闭", exact: true })
      .click();
  }
  await setAccountPrefs(page.request, { lang: "en", themeId: "github", textSize: "md" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/chat/${sid}`);
  await page.getByRole("link", { name: "Expr.cpp:785-795", exact: true }).click();
  const frame = page.getByRole("dialog").frameLocator("iframe");
  await frame.getByRole("button", { name: "Git diff", exact: true }).click();
  await expect(frame.getByRole("table")).toContainText("value * 3;");
  await write(4);
  await frame.getByRole("button", { name: "Reload code", exact: true }).click();
  await expect(frame.getByRole("table")).toContainText("value * 4;");
  await fs.writeFile(file, Buffer.from([0, 1, 2]));
  await frame.getByRole("button", { name: "Reload code", exact: true }).click();
  await expect(
    frame.getByText("Binary file changed. Open it in VS Code.", { exact: true }),
  ).toBeVisible();
  await expect(frame.getByRole("alert")).toHaveCount(0);
  await expect(frame.getByRole("button", { name: "Reload code", exact: true })).toBeEnabled();
  await write(4);
  await frame.getByRole("button", { name: "Reload code", exact: true }).click();
  await expect(frame.getByRole("table")).toContainText("value * 4;");
  await page.setViewportSize({ width: 390, height: 844 });
  await frame.getByRole("switch", { name: "Wrap lines", exact: true }).click();
  await frame.getByRole("button", { name: "Reload code", exact: true }).click();
  await expect(frame.getByRole("table")).toContainText("value * 4;");
  await frame.getByRole("button", { name: "Code", exact: true }).click();
  await expect(frame.locator(".cm-content")).toContainText("value * 4;");
  const longLine = await frame
    .locator(".cm-line")
    .filter({ hasText: "const char* detail" })
    .boundingBox();
  const shortLine = await frame
    .locator(".cm-line")
    .filter({ hasText: "// line 789" })
    .boundingBox();
  expect(longLine.height).toBeGreaterThan(shortLine.height * 2);
  await frame.getByRole("button", { name: "btw Q&A", exact: true }).click();
  await frame
    .getByRole("textbox", { name: "Ask about this code…", exact: true })
    .fill("private-question-one");
  await frame.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(frame.getByRole("log")).toContainText("First private answer");
  console.log(`Git diff demo: ${BASE}/chat/${sid}`);
});
