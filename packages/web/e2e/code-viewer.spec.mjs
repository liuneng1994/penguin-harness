/**
 * Given an installed optional viewer, a chat range opens actual C++ code with real line numbers,
 * context, copy, search, read-only behavior and Escape back to the same chat in all three themes.
 * Missing and ambiguous references stay in the preview with a useful error. Phone layouts fit.
 * Floating questions follow a scrolled selection without resizing code or changing main history.
 * Mouse drags select partial and multiline code outside the original citation for questions.
 * A wide main chat uses the available width and aligns its messages with the composer.
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";
const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
let workspace;
async function codePoint(frame, text, column) {
  const line = frame.locator(".cm-line").filter({ hasText: text });
  const box = await line.boundingBox();
  const character = await line.evaluate((node) => {
    const text = document.createTreeWalker(node, NodeFilter.SHOW_TEXT).nextNode();
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 1);
    const rect = range.getBoundingClientRect();
    return { width: rect.width, inset: rect.left - node.getBoundingClientRect().left };
  });
  return { x: box.x + character.inset + character.width * (column - 1), y: box.y + box.height / 2 };
}
async function dragCode(page, start, end) {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
}
test.afterAll(async () => {
  if (workspace && !process.env.CODE_VIEWER_DEMO_ROOT)
    await fs.rm(workspace, { recursive: true, force: true });
});

test("chat code preview and errors across themes", async ({ page }, testInfo) => {
  workspace =
    process.env.CODE_VIEWER_DEMO_ROOT ||
    (await fs.mkdtemp(path.join(os.tmpdir(), "penguin-code-preview-")));
  await fs.mkdir(path.join(workspace, "bolt/expression"), { recursive: true });
  await fs.mkdir(path.join(workspace, "other"), { recursive: true });
  const lines = Array.from({ length: 900 }, (_, i) => `// source line ${i + 1}`);
  lines[0] = "#include <memory>";
  lines[779] = "namespace bolt {";
  lines[783] = "int evaluateExpression(int value) {";
  lines[784] = "  const int doubled = value * 2;";
  lines[785] = "  // Preserve null semantics while evaluating the expression.";
  lines[786] = "  if (value < 0) {";
  lines[787] = "    return 0;";
  lines[788] = "  }";
  lines[789] = "  for (int offset = 0; offset < 4; ++offset) {";
  lines[790] = "    value += offset;";
  lines[791] = "  }";
  lines[792] = "  return doubled + value;";
  lines[793] = "}";
  lines[795] = "} // namespace bolt";
  lines[879] = "// search_outside_context";
  await fs.writeFile(path.join(workspace, "bolt/expression/Expr.cpp"), lines.join("\n"));
  await fs.writeFile(
    path.join(workspace, "bolt/expression/Expr.h"),
    Array.from({ length: 150 }, (_, i) =>
      i === 107 ? "int evaluateExpression(int value);" : `// header line ${i + 1}`,
    ).join("\n"),
  );
  for (const dir of ["bolt/expression", "other"])
    await fs.writeFile(path.join(workspace, dir, "duplicate.cpp"), "// ambiguous\n");
  await fs.writeFile(path.join(workspace, "binary.cpp"), Buffer.from([0, 255, 1, 2]));
  await fs.writeFile(path.join(workspace, "large.cpp"), "x".repeat(2 * 1024 * 1024 + 1));
  execFileSync("git", ["init", "-q", workspace]);
  execFileSync("git", ["-C", workspace, "add", "."]);
  await provisionAndLogin(page.request, "codeviewer", "penguin-2026");
  const { projects } = await (await page.request.get(`${BASE}/api/projects`)).json();
  const projectId = projects[0].projectId;
  const base = `${BASE}/api/projects/${projectId}/agents/default_agent`;
  expect(
    (
      await page.request.put(`${BASE}/api/projects/${projectId}/models`, {
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
  const viewer = workbenches.workbenches.find((w) => w.tabs.some((t) => t.key === "code-preview"));
  expect(viewer?.error, JSON.stringify(workbenches)).toBeNull();
  const created = await (
    await page.request.post(`${base}/sessions`, {
      data: { provider: "custom", modelId: "claude-4-8", workspace, approvalMode: "allow-all" },
    })
  ).json();
  const sessionId = created.session.sessionId;
  expect(
    (
      await page.request.post(`${BASE}/api/sessions/${sessionId}/tasks`, {
        data: { input: [{ type: "text", text: "code viewer test" }] },
      })
    ).ok(),
  ).toBe(true);
  for (const themeId of ["github", "modern", "geek"]) {
    await setAccountPrefs(page.request, { lang: "en", themeId, textSize: "md" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${BASE}/chat/${sessionId}`);
    const citation = page.getByRole("link", { name: "Expr.cpp:785-795", exact: true });
    await expect(citation).toBeVisible();
    const before = await page
      .locator("[data-chat-scroll]")
      .evaluateAll((els) => els.map((el) => el.scrollTop));
    await citation.click();
    const dialog = page.getByRole("dialog", { name: "Expr.cpp:785–795", exact: true });
    await expect(dialog).toBeVisible();
    await dialog.evaluate((el) => {
      for (const animation of el.getAnimations({ subtree: true })) {
        const duration = animation.effect?.getTiming().duration;
        if (typeof duration === "number" && duration > 0) {
          animation.pause();
          animation.currentTime = duration / 2;
        }
      }
    });
    await page.screenshot({
      path: testInfo.outputPath(`${themeId}-preview-opening.png`),
      animations: "allow",
    });
    await dialog.evaluate((el) => {
      for (const animation of el.getAnimations({ subtree: true })) animation.finish();
    });
    const frame = dialog.frameLocator("iframe");
    await expect(frame.locator(".cm-cited-line")).toHaveCount(11);
    await expect(frame.getByText("bolt/expression/Expr.cpp", { exact: true })).toBeVisible();
    await expect(frame.getByText("Lines 773–807 of 900", { exact: false })).toBeVisible();
    expect(await frame.locator(".cm-content").getAttribute("contenteditable")).toBe("false");
    const box = await dialog.boundingBox();
    expect(box.width).toBeGreaterThan(1050);
    expect(Math.abs(box.x + box.width / 2 - 720)).toBeLessThan(3);
    await page.screenshot({ path: testInfo.outputPath(`${themeId}-code-preview.png`) });
    await frame.getByRole("button", { name: "btw Q&A", exact: true }).click();
    const popup = frame.getByRole("region", { name: "Private code Q&A", exact: true });
    await expect(popup).toBeVisible();
    await popup.evaluate((node) => {
      for (const animation of node.parentElement.getAnimations({ subtree: true })) {
        const duration = animation.effect?.getTiming().duration;
        if (typeof duration === "number" && duration > 0) {
          animation.pause();
          animation.currentTime = duration / 2;
        }
      }
    });
    await page.screenshot({
      path: testInfo.outputPath(`${themeId}-floating-opening.png`),
      animations: "allow",
    });
    await popup.evaluate((node) => {
      for (const animation of node.parentElement.getAnimations({ subtree: true }))
        animation.finish();
    });
    await popup.getByRole("button", { name: "Collapse Q&A", exact: true }).click();
    await frame.getByRole("button", { name: "Copy code", exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      lines.slice(784, 795).join("\n"),
    );
    await frame.getByRole("button", { name: "Show 40 lines above", exact: true }).click();
    await expect(frame.getByText("Lines 733–807 of 900", { exact: false })).toBeVisible();
    await frame.getByRole("switch", { name: "Wrap lines", exact: true }).click();
    await expect(frame.getByRole("switch", { name: "Wrap lines", exact: true })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await frame.getByRole("button", { name: "Search", exact: true }).click();
    await frame.getByRole("textbox", { name: "Find" }).pressSequentially("search_outside_context");
    await frame.getByRole("textbox", { name: "Find" }).press("Enter");
    await expect(
      frame.locator(".cm-line").filter({ hasText: "search_outside_context" }),
    ).toBeVisible();
    await frame.getByRole("textbox", { name: "Find" }).press("Escape");
    await expect(dialog).toBeVisible();
    await expect(frame.getByRole("button", { name: "Show full file", exact: true })).toHaveCount(0);
    await frame.getByRole("button", { name: "More", exact: true }).click();
    await frame.getByRole("menuitem", { name: "Show full file", exact: true }).click();
    await expect(frame.getByText("Lines 1–900 of 900", { exact: false })).toBeVisible();
    await frame.locator(".cm-content").press("Escape");
    await expect(dialog).toHaveCount(0);
    expect(
      await page.locator("[data-chat-scroll]").evaluateAll((els) => els.map((el) => el.scrollTop)),
    ).toEqual(before);
  }
  for (const [name, message] of [
    ["missing.cpp:10", /not found|does not exist/i],
    ["duplicate.cpp:5", /several|multiple|ambiguous/i],
    ["binary.cpp:1", /not text/i],
    ["large.cpp:1", /2 MB/i],
  ]) {
    await page.getByRole("link", { name, exact: true }).click();
    await expect(page.getByRole("dialog").frameLocator("iframe").getByRole("alert")).toContainText(
      message,
    );
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  }
  await page.setViewportSize({ width: 2200, height: 1000 });
  await page.reload();
  await expect(page.getByRole("link", { name: "Expr.cpp:785-795", exact: true })).toBeVisible();
  const reading = await page.locator(".chat-reading-column").evaluateAll((nodes) =>
    nodes
      .map((node) => {
        const r = node.getBoundingClientRect();
        return { x: r.x, width: r.width, right: r.right };
      })
      .filter((rect) => rect.width > 0),
  );
  const mainBox = await page.locator("main").first().boundingBox();
  expect(reading).toHaveLength(2);
  expect(reading[0].width).toBeGreaterThan(mainBox.width * 0.85);
  expect(Math.abs(reading[0].x - reading[1].x)).toBeLessThan(2);
  expect(Math.abs(reading[0].width - reading[1].width)).toBeLessThan(2);
  expect(mainBox.x + mainBox.width - reading[0].right).toBeLessThan(140);
  await page.screenshot({ path: testInfo.outputPath("wide-main-chat.png") });
  for (const lang of ["en", "zh"]) {
    await setAccountPrefs(page.request, { lang, textSize: "xl" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/chat/${sessionId}`);
    const headerLink = page.getByRole("link", { name: "Expr.h:108–120", exact: true });
    await expect(headerLink).toBeVisible();
    // An inline link wraps at phone width; its bounding box includes unrelated text.
    const point = await headerLink.evaluate((el) => {
      const rect = el.getClientRects()[0];
      return { x: rect.left + 3, y: rect.top + rect.height / 2 };
    });
    await page.mouse.click(point.x, point.y);
    const dialog = page.getByRole("dialog");
    const frame = dialog.frameLocator("iframe");
    await expect(frame.locator(".cm-cited-line")).toHaveCount(13);
    expect(
      await frame.locator("body").evaluate((body) => body.scrollWidth <= body.clientWidth),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`phone-${lang}-code-preview.png`) });
    await page.keyboard.press("Escape");
  }
  await setAccountPrefs(page.request, { lang: "en", textSize: "md", themeId: "github" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/chat/${sessionId}`);
  const codeLink = page.getByRole("link", { name: "Expr.cpp:785-795", exact: true });
  await codeLink.click();
  const codeDialog = page.getByRole("dialog");
  const codeFrame = codeDialog.frameLocator("iframe");
  await expect(codeFrame.locator(".cv-keyword").first()).toBeVisible();
  const syntax = await codeFrame
    .locator(".cv-keyword")
    .first()
    .evaluate((node) => ({
      token: getComputedStyle(node).color,
      text: getComputedStyle(node.parentElement).color,
    }));
  expect(syntax.token).not.toBe(syntax.text);
  await codeFrame.locator(".cm-content").press("Shift+End");

  const historyBefore = await (
    await page.request.get(`${BASE}/api/sessions/${sessionId}/messages`)
  ).json();
  // Leave scrollable context below the selection instead of testing at the snippet's bottom.
  await codeFrame.getByRole("button", { name: "Show 40 lines below", exact: true }).click();
  const heightBefore = await codeFrame
    .locator(".cm-scroller")
    .evaluate((node) => node.clientHeight);
  await codeFrame.getByRole("button", { name: "btw Q&A", exact: true }).click();
  await expect(codeFrame.getByText("Line 785", { exact: true })).toBeVisible();
  const question = codeFrame.getByRole("textbox", { name: "Ask about this code…", exact: true });
  await question.fill("private-question-one");
  await codeFrame.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(codeFrame.getByRole("log")).toContainText("First private answer");
  await expect(question).toHaveValue("");
  await question.fill("private-question-follow-up");
  await codeFrame.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(codeFrame.getByRole("log")).toContainText("Follow-up private answer");
  await expect(
    codeFrame.locator(".cm-line").filter({ hasText: "const int doubled" }),
  ).toBeInViewport();
  const historyAfter = await (
    await page.request.get(`${BASE}/api/sessions/${sessionId}/messages`)
  ).json();
  expect(historyAfter).toEqual(historyBefore);
  expect(await codeFrame.locator(".cm-scroller").evaluate((node) => node.clientHeight)).toBe(
    heightBefore,
  );
  const popupBox = await codeFrame
    .getByRole("region", { name: "Private code Q&A", exact: true })
    .boundingBox();
  const selectedLine = await codeFrame
    .locator(".cm-line")
    .filter({ hasText: "const int doubled" })
    .boundingBox();
  expect(popupBox.y).toBeGreaterThanOrEqual(selectedLine.y + selectedLine.height);
  const yBefore = popupBox.y;
  const scrollDelta = await codeFrame.locator(".cm-scroller").evaluate((node) => {
    const before = node.scrollTop;
    node.scrollTop += 16;
    return node.scrollTop - before;
  });
  expect(scrollDelta).toBeGreaterThan(8);
  await expect
    .poll(
      async () =>
        (
          await codeFrame
            .getByRole("region", { name: "Private code Q&A", exact: true })
            .boundingBox()
        ).y,
    )
    .toBeLessThan(yBefore - 8);
  await page.screenshot({ path: testInfo.outputPath("code-floating-questions.png") });
  await question.press("Escape");
  await expect(
    codeFrame.getByRole("region", { name: "Private code Q&A", exact: true }),
  ).toHaveCount(0);
  await expect(codeDialog).toBeVisible();
  await codeFrame.locator(".cm-content").press("Escape");
  await expect(codeDialog).toHaveCount(0);
  await codeLink.click();
  await codeFrame.getByRole("button", { name: "btw Q&A", exact: true }).click();
  await expect(codeFrame.getByRole("log")).not.toContainText("First private answer");
  await expect(codeFrame.getByRole("button", { name: "Send edit", exact: true })).toHaveCount(0);
  await codeFrame.getByRole("button", { name: "Collapse Q&A", exact: true }).click();
  const mouseLine = codeFrame.locator(".cm-line").filter({ hasText: "int evaluateExpression" });
  await mouseLine.scrollIntoViewIfNeeded();
  await dragCode(
    page,
    await codePoint(codeFrame, "int evaluateExpression", 5),
    await codePoint(codeFrame, "int evaluateExpression", 23),
  );
  await expect(codeFrame.locator(".cm-cited-line")).toHaveCount(11);
  await codeFrame.getByRole("button", { name: "btw Q&A", exact: true }).click();
  await expect(codeFrame.getByText("Line 784", { exact: true })).toBeVisible();
  const mouseRequest = page.waitForRequest(
    (request) => request.url().endsWith("/code-questions") && request.method() === "POST",
  );
  await question.fill("mouse-selection-question");
  await codeFrame.getByRole("button", { name: "Ask", exact: true }).click();
  expect((await mouseRequest).postDataJSON().selection).toEqual({
    line: 784,
    column: 5,
    endLine: 784,
    endColumn: 23,
  });
  await expect(question).toHaveValue("");
  await codeFrame.getByRole("button", { name: "Collapse Q&A", exact: true }).click();
  await mouseLine.scrollIntoViewIfNeeded();
  // Reverse drag through several lines keeps the normalized start/end range.
  await dragCode(
    page,
    await codePoint(codeFrame, "Preserve null semantics", 12),
    await codePoint(codeFrame, "int evaluateExpression", 5),
  );
  await codeFrame.getByRole("button", { name: "btw Q&A", exact: true }).click();
  await expect(codeFrame.getByText("Lines 784–786", { exact: true })).toBeVisible();
  const multiRequest = page.waitForRequest(
    (request) => request.url().endsWith("/code-questions") && request.method() === "POST",
  );
  await question.fill("multiline-mouse-question");
  await codeFrame.getByRole("button", { name: "Ask", exact: true }).click();
  expect((await multiRequest).postDataJSON().selection).toEqual({
    line: 784,
    column: 5,
    endLine: 786,
    endColumn: 12,
  });
  await expect(question).toHaveValue("");
  await page.screenshot({ path: testInfo.outputPath("code-mouse-selection.png") });
  await codeFrame.getByRole("button", { name: "Collapse Q&A", exact: true }).click();
  await mouseLine.scrollIntoViewIfNeeded();
  const clickedLine = await codePoint(codeFrame, "int evaluateExpression", 9);
  await page.mouse.click(clickedLine.x, clickedLine.y);
  await codeFrame.getByRole("button", { name: "btw Q&A", exact: true }).click();
  await expect(codeFrame.getByText("Line 784", { exact: true })).toBeVisible();
  const clickedRequest = page.waitForRequest(
    (request) => request.url().endsWith("/code-questions") && request.method() === "POST",
  );
  await question.fill("clicked-line-question");
  await codeFrame.getByRole("button", { name: "Ask", exact: true }).click();
  expect((await clickedRequest).postDataJSON().selection).toEqual({
    line: 784,
    column: 1,
    endLine: 784,
    endColumn: lines[783].length + 1,
  });
  await expect(question).toHaveValue("");
  await codeFrame.getByRole("button", { name: "Collapse Q&A", exact: true }).click();
  await codeFrame.locator(".cm-content").press("Escape");
  await setAccountPrefs(page.request, { themeMode: "dark" });
  await page.reload();
  await codeLink.click();
  await expect(codeFrame.locator("html")).toHaveClass(/dark/);
  await expect(codeFrame.locator(".cv-keyword").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("code-dark-highlighting.png") });
  await page.keyboard.press("Escape");
  await setAccountPrefs(page.request, { themeMode: "system" });
  // The development preview keeps one actual chat ready for the user.
  console.log(`Code preview demo: ${BASE}/chat/${sessionId}`);
});
