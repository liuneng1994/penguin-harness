/** Chat locations and the Files panel invoke one external-editor target, with reader-owned
 * connection settings. All themes and phone width use an isolated Workspace and intercept
 * only the final OS protocol handoff, leaving authentication and target resolution real.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

const BASE = process.env.BASE_URL,
  MOCK = process.env.MOCK_URL;
test.use({ actionTimeout: 10_000 });
test("chat file positions and Files actions open VS Code with the reader's connection", async ({
  page,
}, info) => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-editor-"));
  fs.writeFileSync(
    path.join(ws, "viewer.ts"),
    Array.from({ length: 60 }, (_, i) => `// line ${i + 1}`).join("\n"),
  );
  fs.writeFileSync(path.join(ws, "报告 #100%.ts"), "// Unicode file\n");
  for (let i = 0; i < 30; i++)
    fs.writeFileSync(
      path.join(ws, `z-reference-${String(i).padStart(2, "0")}.ts`),
      "// reference\n",
    );
  try {
    await provisionAndLogin(page.request, "editor_browser", "password123");
    const project = (await (await page.request.get(`${BASE}/api/projects`)).json()).projects[0]
      .projectId;
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
    const response = await page.request.post(
      `${BASE}/api/projects/${project}/agents/default_agent/sessions`,
      { data: { workspace: ws } },
    );
    expect(response.ok()).toBe(true);
    const sid = (await response.json()).session.sessionId;
    const animation = await page.context().newCDPSession(page);
    await animation.send("Animation.enable");
    await page.addInitScript(() => {
      window.editorTargets = [];
      document.addEventListener(
        "click",
        (event) => {
          const a =
            event.target instanceof Element ? event.target.closest('a[href^="vscode://"]') : null;
          if (a) {
            event.preventDefault();
            window.editorTargets.push(a.href);
          }
        },
        true,
      );
    });
    const expected = (name, line, column, alias = "") => {
      const file = fs
        .realpathSync(path.join(ws, name))
        .split("/")
        .map(encodeURIComponent)
        .join("/");
      return (
        (alias ? `vscode://vscode-remote/ssh-remote+${alias}` : "vscode://file") +
        `${file}:${line}:${column}`
      );
    };
    const lastTarget = async (uri, count) => {
      await expect.poll(() => page.evaluate(() => window.editorTargets.length)).toBe(count);
      expect(await page.evaluate(() => window.editorTargets.at(-1))).toBe(uri);
    };
    for (const themeId of ["github", "modern", "geek"]) {
      await setAccountPrefs(page.request, { lang: "en", themeId });
      await page.goto(`${BASE}/chat/${sid}`);
      await page.locator("textarea").first().waitFor();
      if (themeId === "github") {
        await page.locator("textarea").first().fill("editor file references test");
        await page.getByRole("button", { name: "Send", exact: true }).click();
      }
      const plain = page.locator('a[href="./viewer.ts#L42C7"]').first();
      await expect(plain).toBeVisible();
      let count = 0;
      await plain.click();
      await lastTarget(expected("viewer.ts", 42, 7), ++count);
      await page.locator('a[href="./viewer.ts#L9C1"]').first().click();
      await lastTarget(expected("viewer.ts", 9, 1), ++count);
      await page.locator('a[href="./viewer.ts#L12C3"]').first().click();
      await lastTarget(expected("viewer.ts", 12, 3), ++count);
      await page.locator('a[href*="100%25.ts#L15C2"]').first().click();
      await lastTarget(expected("报告 #100%.ts", 15, 2), ++count);
      const pick = page.getByTestId("dock-pick-workspace");
      const toggle = page.getByTestId("dock-toggle-right");
      if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
      const dock = page.getByTestId("dock");
      if (await pick.isVisible()) await pick.click();
      const row = dock.locator('[data-tree-path="viewer.ts"]');
      await expect(row).toBeVisible();
      await page.evaluate(async () => {
        const dock = document.querySelector('[data-testid="dock"]');
        await Promise.allSettled(
          document
            .getAnimations()
            .filter((a) => {
              const target = a.effect?.target;
              return (
                target instanceof Element &&
                dock?.contains(target) &&
                a.effect.getTiming().iterations !== Infinity
              );
            })
            .map((a) => a.finished),
        );
        // The last layout frame can queue scroll events after the transition's finished promise.
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      const dockScroll = await dock.evaluate((node) => ({
        left: node.scrollLeft,
        top: node.scrollTop,
      }));
      await row.click({ button: "right" });
      await expect(
        page.getByRole("menuitem", { name: "Open in VS Code", exact: true }),
      ).toBeVisible({ timeout: 5000 });
      const openedScroll = await dock.evaluate((node) => ({
        left: node.scrollLeft,
        top: node.scrollTop,
      }));
      // Chromium can normalize the dock's one-pixel border overflow when the row takes focus.
      expect(Math.abs(openedScroll.left - dockScroll.left)).toBeLessThanOrEqual(1);
      expect(openedScroll.top).toBe(dockScroll.top);
      const tree = dock.getByRole("tree", { name: "File tree", exact: true });
      await tree.evaluate((node) => {
        node.scrollTop += 48;
      });
      await expect(
        page.getByRole("menuitem", { name: "Open in VS Code", exact: true }),
      ).not.toBeVisible();
      await tree.evaluate((node) => {
        node.scrollTop = 0;
      });
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      await row.click({ button: "right" });
      await page.getByRole("menuitem", { name: "Open in VS Code", exact: true }).click();
      await lastTarget(expected("viewer.ts", 1, 1), ++count);
      await row.click({ button: "right" });
      await animation.send("Animation.setPlaybackRate", { playbackRate: 0.1 });
      await page
        .getByRole("menuitem", { name: "VS Code connection settings", exact: true })
        .click();
      const dialog = page.getByRole("dialog", { name: "VS Code connection settings", exact: true });
      await expect(dialog).toBeVisible();
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
      await dialog.evaluate((node) => {
        window.editorPausedAnimations = document.getAnimations().filter((a) => {
          const target = a.effect?.target;
          return target instanceof Element && (target.contains(node) || node.contains(target));
        });
        for (const animation of window.editorPausedAnimations) {
          const duration = animation.effect.getComputedTiming().activeDuration;
          if (Number.isFinite(duration) && duration > 0) {
            animation.pause();
            animation.currentTime = duration / 2;
          }
        }
      });
      await page.screenshot({
        path: info.outputPath(`${themeId}-editor-settings-opening.png`),
        animations: "allow",
      });
      await page.evaluate(() => {
        for (const animation of window.editorPausedAnimations) animation.play();
      });
      await animation.send("Animation.setPlaybackRate", { playbackRate: 1 });
      await dialog.getByRole("textbox").fill("ignored-change");
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("button", { name: "Discard changes", exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await row.click({ button: "right" });
      await page
        .getByRole("menuitem", { name: "VS Code connection settings", exact: true })
        .click();
      await expect(dialog.getByRole("textbox")).toHaveValue("");
      await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
      await dialog.getByRole("textbox").fill("bad/alias");
      await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
      await dialog.getByRole("textbox").fill("reader-dev");
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await row.dblclick();
      await dock.getByRole("button", { name: "Open in VS Code", exact: true }).click();
      await lastTarget(expected("viewer.ts", 1, 1, "reader-dev"), ++count);
      await row.click({ button: "right" });
      await page
        .getByRole("menuitem", { name: "VS Code connection settings", exact: true })
        .click();
      await expect(dialog.getByRole("textbox")).toHaveValue("reader-dev");
      await dialog.getByRole("textbox").fill("");
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await page.getByTestId("dock-toggle-right").click();
      await page.screenshot({
        path: info.outputPath(`${themeId}-editor-links.png`),
        animations: "allow",
      });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/chat/${sid}`);
    const plain = page.locator('a[href="./viewer.ts#L42C7"]').first();
    await plain.click();
    await lastTarget(expected("viewer.ts", 42, 7), 1);
    await page.screenshot({ path: info.outputPath("phone-editor-links.png"), animations: "allow" });
    expect(
      (
        await page.request.get(`${BASE}/api/sessions/${sid}/files/editor-target?path=missing.ts`)
      ).status(),
    ).toBe(404);
    expect(fs.readFileSync(path.join(ws, "报告 #100%.ts"), "utf8")).toBe("// Unicode file\n");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
