/**
 * Given an installed optional viewer, a chat range opens actual C++ code with real line numbers,
 * context, copy, search, read-only behavior and Escape back to the same chat in all three themes.
 * Missing and ambiguous references stay in the preview with a useful error. Phone layouts fit.
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
      data: { provider: "custom", modelId: "claude-4-8", workspace },
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
    await setAccountPrefs(page.request, { lang: "en", themeId });
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
    await frame.getByRole("button", { name: "Show full file", exact: true }).click();
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
  // The development preview keeps one actual chat ready for the user.
  console.log(`Code preview demo: ${BASE}/chat/${sessionId}`);
});
