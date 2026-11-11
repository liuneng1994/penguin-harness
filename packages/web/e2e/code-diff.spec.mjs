/**
 * Code and Git changes share one editor. Source line numbers and selections stay intact;
 * changed lines and words are marked, old code appears below its corresponding location,
 * staged code is read from the index, and questions inherit nearby diff context.
 * Auxiliary actions live in More; change navigation reflects zero, one or multiple edits.
 * Copy, refresh, show/hide, three themes and phone layouts remain usable.
 * Loading preserves changed display settings; inconsistent snapshots block questions.
 * Nested menus respect Escape order, stopping permits another question, and deleted
 * files reopen through their complete chat reference.
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
    await expect(page.getByRole("tab", { name: "Code", exact: true })).toHaveCount(0);
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
    await expect(frame.getByRole("button", { name: "Copy diff", exact: true })).toHaveCount(0);
    await frame.getByRole("button", { name: "More", exact: true }).click();
    await frame.getByRole("menu").evaluate((node) => {
      for (const animation of node.parentElement.getAnimations({ subtree: true })) {
        const duration = animation.effect?.getTiming().duration;
        if (typeof duration === "number" && duration > 0) {
          animation.pause();
          animation.currentTime = duration / 2;
        }
      }
    });
    await page.screenshot({
      path: info.outputPath(`${themeId}-more-opening.png`),
      animations: "allow",
    });
    await frame.getByRole("menu").evaluate((node) => {
      for (const animation of node.parentElement.getAnimations({ subtree: true }))
        animation.finish();
    });
    await frame.getByRole("menuitem", { name: "Copy diff", exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected.patch);
    await frame.getByRole("switch", { name: "Show changes", exact: true }).click();
    await expect(frame.locator(".cm-git-modify")).toHaveCount(0);
    await expect(
      frame.getByRole("button", { name: /^(Locate change|Next change|Previous change)$/ }),
    ).toHaveCount(0);
    await expect(frame.locator(".code-removed-block")).toHaveCount(0);
    await expect(source).toContainText("value * 3;");
    expect(await frame.locator(".cm-scroller").evaluate((node) => node.clientHeight)).toBe(height);
    await frame.getByRole("switch", { name: "Show changes", exact: true }).click();
    await expect(frame.getByRole("button", { name: "Next change", exact: true })).toHaveCount(0);
    await expect(frame.getByRole("button", { name: "Previous change", exact: true })).toHaveCount(
      0,
    );
    await frame.getByRole("button", { name: "Locate change", exact: true }).click();
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
    // Keyboard access to More leaves Q&A open; Escape must close the newer layer first.
    await frame.getByRole("button", { name: "More", exact: true }).press("Space");
    await expect(
      frame.getByRole("region", { name: "Private code Q&A", exact: true }),
    ).toBeVisible();
    await frame.getByRole("menuitem", { name: "Copy diff", exact: true }).press("Escape");
    await expect(frame.getByRole("menu")).toHaveCount(0);
    await expect(
      frame.getByRole("region", { name: "Private code Q&A", exact: true }),
    ).toBeVisible();
    if (themeId === "github") {
      const question = frame.getByRole("textbox", { name: "Ask about this code…", exact: true });
      const cancelledRequests = [];
      const record = (request) => {
        if (
          request.url().endsWith("/code-questions") &&
          request.method() === "POST" &&
          request.postDataJSON().question === "cancel-this-question"
        )
          cancelledRequests.push(request);
      };
      page.on("request", record);
      await question.fill("cancel-this-question");
      await frame.getByRole("button", { name: "Ask", exact: true }).click();
      await expect(frame.getByRole("log")).toContainText("Waiting for cancellation");
      await frame.getByRole("button", { name: "Stop", exact: true }).click();
      await expect(frame.getByRole("button", { name: "Ask", exact: true })).toBeEnabled();
      await question.fill("ask-again-after-stop");
      await frame.getByRole("button", { name: "Ask", exact: true }).click();
      await expect(frame.getByRole("log")).toContainText("Follow-up private answer");
      expect(cancelledRequests).toHaveLength(1);
      page.off("request", record);
    }
    await frame.getByRole("textbox", { name: "Ask about this code…", exact: true }).press("Escape");
    await expect(frame.getByRole("region", { name: "Private code Q&A", exact: true })).toHaveCount(
      0,
    );
    await expect(dialog).toBeVisible();
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
    await frame.getByRole("button", { name: lang === "en" ? "More" : "更多", exact: true }).click();
    await expect(
      frame.getByRole("menuitem", { name: lang === "en" ? "Copy diff" : "复制 diff", exact: true }),
    ).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`phone-${lang}-inline-diff.png`) });
    await frame
      .getByRole("menuitem", { name: lang === "en" ? "Copy diff" : "复制 diff", exact: true })
      .press("Escape");
    await expect(frame.getByRole("menu")).toHaveCount(0);
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
  // A distant second edit makes previous/next useful and reveals its source context.
  await fs.writeFile(
    file,
    (await fs.readFile(file, "utf8")).replace("// line 50", "// another edit"),
  );
  await frame.getByRole("button", { name: "Reload code", exact: true }).click();
  await expect(frame.getByRole("button", { name: "Locate change", exact: true })).toHaveCount(0);
  await frame.getByRole("button", { name: "Next change", exact: true }).click();
  await expect(frame.locator(".cm-line").filter({ hasText: "// another edit" })).toBeInViewport();
  await frame.getByRole("switch", { name: "Show changes", exact: true }).click();
  await expect(
    frame.getByRole("button", { name: /^(Locate change|Next change|Previous change)$/ }),
  ).toHaveCount(0);
  await frame.getByRole("switch", { name: "Show changes", exact: true }).click();
  await frame.getByRole("button", { name: "Previous change", exact: true }).click();
  await expect(frame.locator(".cm-line").filter({ hasText: "value * 4;" })).toBeInViewport();
  await write(2);
  await frame.getByRole("button", { name: "Reload code", exact: true }).click();
  await expect(frame.getByText("No unstaged changes in this file.", { exact: true })).toBeVisible();
  await expect(
    frame.getByRole("button", { name: /^(Locate change|Next change|Previous change)$/ }),
  ).toHaveCount(0);
  await expect(frame.getByRole("switch", { name: "Show changes", exact: true })).toHaveCount(0);
  await frame.getByRole("button", { name: "More", exact: true }).click();
  await expect(frame.getByRole("menuitem", { name: "Copy diff", exact: true })).toBeDisabled();
  await frame.getByRole("menuitem", { name: "Show full file", exact: true }).press("Escape");
  await expect(frame.getByRole("menu")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toBeVisible();
  await write(4);
  const pattern = "**/files/git-diff?*";
  const inconsistent = async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      response,
      json: { ...data, text: data.text.replace("value * 4;", "value * 5;") },
    });
  };
  await page.route(pattern, inconsistent);
  await frame.getByRole("button", { name: "Reload code", exact: true }).click();
  await expect(frame.getByRole("alert")).toContainText(
    "The file changed. Reload code before asking about it.",
  );
  await expect(frame.locator(".cm-content")).toHaveCount(0);
  await expect(frame.getByRole("button", { name: "btw Q&A", exact: true })).toHaveCount(0);
  await page.unroute(pattern, inconsistent);
  await fs.writeFile(file, Buffer.from([0, 1, 2]));
  await frame.getByRole("button", { name: "Reload code", exact: true }).click();
  await expect(frame.getByRole("alert")).toContainText("not text");
  await expect(frame.getByRole("button", { name: "Reload code", exact: true })).toBeEnabled();
  await write(4);
  await frame.getByRole("button", { name: "Reload code", exact: true }).click();
  await expect(frame.locator(".cm-git-modify")).toContainText("value * 4;");
  await page.setViewportSize({ width: 390, height: 844 });
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const hold = async (route) => {
    await pending;
    await route.continue();
  };
  await page.route(pattern, hold);
  const loading = page.waitForRequest(
    (r) => r.url().includes("/files/git-diff?") && r.method() === "GET",
  );
  await frame.getByRole("button", { name: "Reload code", exact: true }).click();
  await loading;
  await expect(frame.getByRole("button", { name: "More", exact: true })).toBeDisabled();
  await frame.getByRole("switch", { name: "Wrap lines", exact: true }).click();
  release();
  await expect(frame.locator(".cm-git-modify")).toContainText("value * 4;");
  await page.unroute(pattern, hold);
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
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("link", { name: "bolt/expression/Expr.cpp:785-795", exact: true }).click();
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
