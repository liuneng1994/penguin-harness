/**
 * Code and Git changes share one editor. Source line numbers and selections stay intact;
 * changed lines and words are marked, old code appears below its corresponding location,
 * staged code is read from the index, and questions inherit nearby diff context.
 * Copy, refresh, navigation, show/hide, three themes and phone layouts remain usable.
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
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.test",
    "commit",
    "--allow-empty",
    "-qm",
    "initial",
  );
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
    const source = frame.locator(".cm-content");
    await expect(frame.locator(".cm-git-modify")).toContainText("value * 3;");
    await expect(frame.getByRole("img", { name: "Modified code", exact: true })).toBeVisible();
    await expect(frame.locator(".cm-git-word")).toContainText("3");
    await expect(frame.getByRole("table", { name: "Old code", exact: true })).toBeVisible();
    const height = await frame.locator(".cm-scroller").evaluate((node) => node.clientHeight);
    const old = frame.getByRole("table", { name: "Old code", exact: true });
    await expect(old).toContainText("value * 2;");
    await expect(old).not.toContainText("value * 3;");
    await expect(source).not.toContainText("unrelated-file-secret");
    const rowBox = await frame.locator(".cm-git-modify").boundingBox();
    expect((await old.boundingBox()).y).toBeGreaterThan(rowBox.y);
    await frame.locator(".code-removed-block").evaluate((node) => {
      for (const animation of node.getAnimations({ subtree: true })) {
        const duration = animation.effect?.getTiming().duration;
        if (typeof duration === "number" && duration > 0) {
          animation.pause();
          animation.currentTime = duration / 2;
        }
      }
    });
    await page.screenshot({
      path: info.outputPath(`${themeId}-inline-changes-opening.png`),
      animations: "allow",
    });
    await frame.locator(".code-removed-block").evaluate((node) => {
      for (const animation of node.getAnimations({ subtree: true })) animation.finish();
    });
    await frame.getByRole("button", { name: "Copy code", exact: true }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain("value * 3;");
    expect(copied).not.toContain("value * 2;");
    const expected = await (
      await page.request.get(
        `${BASE}/api/sessions/${sid}/files/git-diff?path=bolt/expression/Expr.cpp`,
      )
    ).json();
    await frame.getByRole("button", { name: "Copy diff", exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected.patch);
    await frame.getByRole("switch", { name: "Show changes", exact: true }).click();
    await expect(frame.locator(".cm-git-modify")).toHaveCount(0);
    await expect(frame.locator(".code-removed-block")).toHaveCount(0);
    await expect(source).toContainText("value * 3;");
    expect(await frame.locator(".cm-scroller").evaluate((node) => node.clientHeight)).toBe(height);
    await frame.getByRole("switch", { name: "Show changes", exact: true }).click();
    await frame.getByRole("button", { name: "Next change", exact: true }).click();
    await frame.getByRole("button", { name: "Previous change", exact: true }).click();
    await frame.getByRole("button", { name: "Staged", exact: true }).click();
    await expect(frame.locator(".cm-git-modify")).toContainText("value * 2;");
    await expect(source).not.toContainText("value * 3;");
    await expect(old).toContainText("value * 1;");
    await page.screenshot({ path: info.outputPath(`${themeId}-staged-inline-diff.png`) });
    // Ask against index code, even though the disk contains a different expression.
    const historyBefore = await (
      await page.request.get(`${BASE}/api/sessions/${sid}/messages`)
    ).json();
    const snapshot = await (
      await page.request.get(
        `${BASE}/api/sessions/${sid}/files/git-diff?path=bolt/expression/Expr.cpp&scope=staged`,
      )
    ).json();
    await frame.getByRole("button", { name: "btw Q&A", exact: true }).click();
    await expect(frame.locator(".cm-cited-line")).toHaveCount(11);
    await expect(frame.locator(".cm-git-modify")).toContainText("value * 2;");
    const request = page.waitForRequest(
      (r) => r.url().endsWith("/code-questions") && r.method() === "POST",
    );
    await frame
      .getByRole("textbox", { name: "Ask about this code…", exact: true })
      .fill("private-question-one");
    await frame.getByRole("button", { name: "Ask", exact: true }).click();
    const body = (await request).postDataJSON();
    expect(body.gitScope).toBe("staged");
    expect(body.gitVersion).toBe(snapshot.version);
    await expect(frame.getByRole("log")).toContainText("First private answer");
    expect(await (await page.request.get(`${BASE}/api/sessions/${sid}/messages`)).json()).toEqual(
      historyBefore,
    );
    await frame.getByRole("button", { name: "Collapse Q&A", exact: true }).click();
    await frame.locator(".cm-content").press("Escape");
  }
  for (const lang of ["en", "zh"]) {
    await setAccountPrefs(page.request, { lang, textSize: "xl" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/chat/${sid}`);
    await page.getByRole("link", { name: "Expr.cpp:785-795", exact: true }).click();
    const frame = page.getByRole("dialog").frameLocator("iframe");
    await expect(frame.locator(".cm-git-modify")).toContainText("value * 3;");
    await expect(frame.getByRole("table")).toContainText("value * 2;");
    expect(
      await frame.locator("body").evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath(`phone-${lang}-inline-diff.png`) });
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
  await expect(frame.locator(".cm-git-modify")).toContainText("value * 3;");
  await write(4);
  await frame.getByRole("button", { name: "Reload code", exact: true }).click();
  await expect(frame.locator(".cm-git-modify")).toContainText("value * 4;");
  await fs.writeFile(file, Buffer.from([0, 1, 2]));
  await frame.getByRole("button", { name: "Reload code", exact: true }).click();
  await expect(frame.getByRole("alert")).toContainText("not text");
  await expect(frame.getByRole("button", { name: "Reload code", exact: true })).toBeEnabled();
  await write(4);
  await frame.getByRole("button", { name: "Reload code", exact: true }).click();
  await expect(frame.locator(".cm-git-modify")).toContainText("value * 4;");
  await page.setViewportSize({ width: 390, height: 844 });
  await frame.getByRole("switch", { name: "Wrap lines", exact: true }).click();
  await frame.getByRole("button", { name: "Reload code", exact: true }).click();
  await expect(frame.locator(".cm-git-modify")).toContainText("value * 4;");
  const longLine = await frame
    .locator(".cm-line")
    .filter({ hasText: "const char* detail" })
    .boundingBox();
  const shortLine = await frame
    .locator(".cm-line")
    .filter({ hasText: "// line 789" })
    .boundingBox();
  expect(longLine.height).toBeGreaterThan(shortLine.height * 2);
  await fs.rm(file);
  await frame.getByRole("button", { name: "Reload code", exact: true }).click();
  await expect(frame.getByRole("table")).toContainText("value * 2;");
  await frame.getByRole("button", { name: "btw Q&A", exact: true }).click();
  await frame
    .getByRole("textbox", { name: "Ask about this code…", exact: true })
    .fill("private-question-one");
  await frame.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(frame.getByRole("log")).toContainText("First private answer");
  await write(4);
  await frame.getByRole("button", { name: "Reload code", exact: true }).click();
  await expect(frame.locator(".cm-git-modify")).toContainText("value * 4;");
  console.log(`Git diff demo: ${BASE}/chat/${sid}`);
});
