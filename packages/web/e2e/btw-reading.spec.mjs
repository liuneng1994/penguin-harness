/**
 * Selection and whole-reply questions use temporary floating conversations. Answers and follow-ups
 * never enter the main transcript; scrolling keeps the panel and reading location, closing or
 * changing Session clears it, and desktop themes plus the phone bottom sheet remain usable.
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";
const BASE = process.env.BASE_URL,
  MOCK = process.env.MOCK_URL;
let workspace;
test.afterAll(async () => {
  if (workspace && !process.env.BTW_DEMO_ROOT)
    await fs.rm(workspace, { recursive: true, force: true });
});
test("temporary reading questions across themes and phone layouts", async ({ page }, info) => {
  workspace =
    process.env.BTW_DEMO_ROOT || (await fs.mkdtemp(path.join(os.tmpdir(), "penguin-btw-")));
  await fs.mkdir(workspace, { recursive: true });
  await provisionAndLogin(page.request, "btwreader", "penguin-2026");
  const { projects } = await (await page.request.get(`${BASE}/api/projects`)).json();
  const projectId = projects[0].projectId;
  await page.request.put(`${BASE}/api/projects/${projectId}/models`, {
    data: {
      defaultModel: { provider: "custom", modelId: "claude-4-8" },
      models: [
        {
          provider: "custom",
          modelId: "claude-4-8",
          apiKey: "sk-mock",
          baseUrl: MOCK,
          contextWindow: 1000000,
        },
      ],
    },
  });
  const { session } = await (
    await page.request.post(`${BASE}/api/projects/${projectId}/agents/default_agent/sessions`, {
      data: { workspace, approvalMode: "allow-all" },
    })
  ).json();
  const sid = session.sessionId;
  await page.request.post(`${BASE}/api/sessions/${sid}/tasks`, {
    data: { input: [{ type: "text", text: "btw reading test" }] },
  });
  for (const themeId of ["github", "modern", "geek"]) {
    await setAccountPrefs(page.request, { lang: "en", themeId, textSize: "md" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${BASE}/chat/${sid}`);
    const reply = page.locator("[data-btw-reply]").first(),
      body = reply.locator("[data-btw-body]");
    await expect(reply.getByRole("button", { name: "btw Ask", exact: true })).toBeVisible();
    const paragraph = body.locator("p").filter({ hasText: "This is a false positive" }).first();
    await paragraph.scrollIntoViewIfNeeded();
    // Let the scroll's event finish before the mouse starts a selection.
    await paragraph.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const bounds = await paragraph.boundingBox();
    await page.mouse.move(bounds.x + 2, bounds.y + 9);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width - 2, bounds.y + bounds.height - 9, { steps: 12 });
    await page.mouse.up();
    await page.locator(".btw-selection-trigger").click();
    const panel = page.getByRole("region", { name: "Temporary Q&A", exact: true });
    await expect(panel).toBeVisible();
    // Inspect the opening surface midway through its theme-defined motion.
    await panel.evaluate((node) => {
      for (const animation of node.parentElement.getAnimations()) {
        const duration = animation.effect.getTiming().duration;
        if (typeof duration === "number" && duration > 0) {
          animation.pause();
          animation.currentTime = duration / 2;
        }
      }
    });
    await page.screenshot({ path: info.outputPath(`${themeId}-btw-opening.png`) });
    await panel.evaluate((node) => {
      for (const animation of node.parentElement.getAnimations()) animation.finish();
    });
    const original = await body.innerText();
    const before = await (await page.request.get(`${BASE}/api/sessions/${sid}/messages`)).json();
    const input = panel.getByRole("textbox", { name: "Temporary Q&A", exact: true });
    await input.fill("Explain this false positive, btw private question.");
    await panel.getByRole("button", { name: "Send", exact: true }).click();
    await expect(panel.getByText("A false positive means", { exact: false })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
    expect(await body.innerText()).toBe(original);
    expect(await page.evaluate(() => CSS.highlights.has("penguin-btw-reading"))).toBe(true);
    const after = await (await page.request.get(`${BASE}/api/sessions/${sid}/messages`)).json();
    expect(after.messages).toEqual(before.messages);
    await input.fill("btw follow-up: give me an example");
    await panel.getByRole("button", { name: "Send", exact: true }).click();
    await expect(panel.getByText("A concrete example:", { exact: false })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Restore popup", exact: true })).toBeVisible();
    const smallWidth = await panel.evaluate((node) => node.clientWidth);
    await input.fill("Unsent follow-up");
    await panel.getByRole("button", { name: "Restore popup", exact: true }).click();
    await expect(input).toHaveValue("Unsent follow-up");
    await expect.poll(() => panel.evaluate((node) => node.clientWidth)).toBeLessThan(smallWidth);
    await panel.getByRole("button", { name: "Expand reading", exact: true }).click();
    await panel.evaluate((node) => {
      for (const animation of node.parentElement.getAnimations()) {
        const duration = animation.effect.getTiming().duration;
        if (typeof duration === "number" && duration > 0) {
          animation.pause();
          animation.currentTime = duration / 2;
        }
      }
    });
    await page.screenshot({ path: info.outputPath(`${themeId}-reading-resize.png`) });
    await panel.evaluate((node) => {
      for (const animation of node.parentElement.getAnimations()) animation.finish();
    });
    await expect(input).toHaveValue("Unsent follow-up");
    await expect(panel.getByText("A concrete example:", { exact: false })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`${themeId}-btw.png`), animations: "disabled" });
    const scroll = page.locator("[data-btw-reply]").evaluate((node) => {
      const parent = node.closest("[data-find-region]");
      const el = parent?.parentElement;
      if (el) el.scrollTop += 120;
    });
    await scroll;
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Close temporary Q&A", exact: true }).click();
    await expect(panel).toHaveCount(0);
    expect(await page.evaluate(() => CSS.highlights.has("penguin-btw-reading"))).toBe(false);
    await reply.getByRole("button", { name: "btw Ask", exact: true }).click();
    await expect(panel.getByText("A concrete example:", { exact: false })).toHaveCount(0);
    await expect(
      panel.getByRole("button", { name: "About this reply", exact: true }),
    ).toBeVisible();
    if (themeId === "github") {
      await input.fill("long-reading-answer: explain in detail");
      await panel.getByRole("button", { name: "Send", exact: true }).click();
      await expect(panel.getByRole("button", { name: "Restore popup", exact: true })).toBeVisible();
      const log = panel.locator(".temporary-conversation-log");
      await log.evaluate((node) => {
        node.scrollTop = 0;
      });
      await page.screenshot({
        path: info.outputPath("long-answer-expanded.png"),
        animations: "disabled",
      });
      await expect(log).toContainText("Reading step 6");
    }
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  }
  await setAccountPrefs(page.request, { lang: "zh", themeId: "github", textSize: "md" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/chat/${sid}`);
  await page
    .locator("[data-btw-reply]")
    .first()
    .getByRole("button", { name: "btw 提问", exact: true })
    .click();
  const phone = page.getByRole("region", { name: "临时问答", exact: true });
  await expect(phone).toBeVisible();
  await phone.getByRole("textbox", { name: "临时问答", exact: true }).fill("举个例子");
  await phone.getByRole("button", { name: "发送", exact: true }).click();
  await expect(phone.getByText("A false positive means", { exact: false })).toBeVisible();
  const box = await phone.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: info.outputPath("phone-btw.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  for (const lang of ["zh", "en"]) {
    for (const width of [390, 1024]) {
      await setAccountPrefs(page.request, { lang, themeId: "github", textSize: "xl" });
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`${BASE}/chat/${sid}`);
      await page
        .locator("[data-btw-reply]")
        .first()
        .getByRole("button", { name: lang === "zh" ? "btw 提问" : "btw Ask", exact: true })
        .click();
      const reading = page.locator(".temporary-conversation-panel");
      await expect(reading).toBeVisible();
      await reading.evaluate(async (node) => {
        await Promise.all(
          node.parentElement
            .getAnimations()
            .filter((animation) => animation.effect.getComputedTiming().endTime !== Infinity)
            .map((animation) => animation.finished.catch(() => {})),
        );
      });
      const bounds = await reading.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
      expect(await reading.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      await reading.getByRole("textbox").fill("A temporary question");
      const primary = reading.locator('button[type="submit"]');
      const buttonBounds = await primary.boundingBox();
      expect(buttonBounds.x).toBeGreaterThanOrEqual(bounds.x);
      expect(buttonBounds.x + buttonBounds.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      await page.screenshot({
        path: info.outputPath(`${lang}-${width}-xl-btw.png`),
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
    }
  }
  await page.goto(`${BASE}/chat`);
  await expect(phone).toHaveCount(0);
  console.log(`btw reading demo: ${BASE}/chat/${sid}`);
});
