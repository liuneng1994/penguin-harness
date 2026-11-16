/**
 * - Given a continuing conversation, a template replaces the selected draft range and can be
 *   undone; cursor insertion, searching and management stay in that conversation without sending.
 * - Given a streaming reply, selecting a template prepares a draft while the reply continues.
 * - Given a long template list, the upward picker stays within desktop/mobile viewports in all
 *   themes and both languages, with XL text, and dismisses when the Session changes.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const words = {
  en: {
    open: "Templates",
    search: "Search template names or contents",
    manage: "Manage templates",
  },
  zh: { open: "模板", search: "搜索模板名称或内容", manage: "管理模板" },
};
const templates = [
  { id: "review", title: "Review", prompt: "Inspect the code" },
  { id: "summary", title: "Summary", prompt: "Summarize progress" },
];
const composer = (page) => page.locator('[data-slot="composer"] textarea');

async function setup(page, suffix, shortcuts = templates) {
  await provisionAndLogin(page.request, `templates${suffix}`, "penguin-2026");
  await setAccountPrefs(page.request, {
    lang: "en",
    themeId: "github",
    textSize: "md",
    credentialGuideSeen: true,
    draftShortcuts: shortcuts,
  });
  const projectId = (await (await page.request.get(`${BASE}/api/projects`)).json()).projects[0]
    .projectId;
  const model = await page.request.put(`${BASE}/api/projects/${projectId}/models`, {
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
  expect(model.ok()).toBe(true);
  const sessions = [];
  for (let i = 0; i < 2; i++) {
    const response = await page.request.post(
      `${BASE}/api/projects/${projectId}/agents/default_agent/sessions`,
      {
        data: { provider: "custom", modelId: "claude-4-8", approvalMode: "allow-all" },
      },
    );
    expect(response.ok()).toBe(true);
    sessions.push((await response.json()).session.sessionId);
  }
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto(`${BASE}/chat/${sessions[0]}`);
  await expect(composer(page)).toBeVisible();
  return sessions;
}
async function openPicker(page, lang = "en") {
  await page.getByRole("button", { name: words[lang].open, exact: true }).click();
  const panel = page.getByRole("dialog", { name: words[lang].open, exact: true });
  await expect(panel.getByRole("searchbox")).toBeFocused();
  return panel;
}
const messages = async (page, sid) =>
  await (await page.request.get(`${BASE}/api/sessions/${sid}/messages`)).json();

test("templates insert and undo within the current conversation, and management edits the same list", async ({
  page,
}) => {
  const [sid] = await setup(page, "edit");
  const before = await messages(page, sid);
  const input = composer(page);
  await input.fill("Before old after");
  await input.evaluate((el) => el.setSelectionRange(7, 10));
  let panel = await openPicker(page);
  await panel.getByRole("searchbox").fill("code");
  await panel.getByRole("button", { name: /^Review/ }).click();
  await expect(input).toHaveValue("Before Inspect the code after");
  await expect(input).toBeFocused();
  await input.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect(input).toHaveValue("Before old after");

  await input.evaluate((el) => el.setSelectionRange(7, 7));
  panel = await openPicker(page);
  await panel.getByRole("searchbox").fill("progress");
  await panel.getByRole("searchbox").press("Enter");
  await expect(input).toHaveValue("Before Summarize progressold after");
  expect(await messages(page, sid)).toEqual(before);
  await expect(page).toHaveURL(`${BASE}/chat/${sid}`);

  panel = await openPicker(page);
  await expect(panel.locator("button[aria-pressed]").first()).toContainText("Summary");
  await panel.getByRole("button", { name: words.en.manage, exact: true }).click();
  const manager = page.getByRole("dialog", { name: words.en.manage, exact: true });
  await manager.getByRole("button", { name: "Edit", exact: true }).first().click();
  const edit = page.getByRole("dialog", { name: "Edit shortcut", exact: true });
  await edit.getByLabel("Name").fill("Review renamed");
  await edit.getByRole("button", { name: "Save", exact: true }).click();
  await expect(edit).toHaveCount(0);
  const saved = (await (await page.request.get(`${BASE}/api/me/prefs`)).json()).prefs
    .draftShortcuts;
  expect(saved).toEqual([{ ...templates[0], title: "Review renamed" }, templates[1]]);
  await expect(input).toHaveValue("Before Summarize progressold after");
});

test("a template can be prepared while the reply continues streaming", async ({ page }, info) => {
  const [sid] = await setup(page, "running");
  const input = composer(page);
  await input.fill("slow text test");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "Stop", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: words.en.open, exact: true })).toBeEnabled();
  const panel = await openPicker(page);
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("templates-streaming.png"),
  });
  await panel.getByRole("button", { name: /^Review/ }).click();
  await expect(input).toHaveValue("Inspect the code");
  expect(JSON.stringify(await messages(page, sid))).not.toContain("Inspect the code");
  const session = (await (await page.request.get(`${BASE}/api/sessions/${sid}`)).json()).session;
  expect(session.status).toBe("running");
  await input.fill("");
  await page.getByRole("button", { name: "Stop", exact: true }).first().click();
});

test("the upward picker fits all themes and layouts and closes on a Session switch", async ({
  page,
}, info) => {
  const many = [
    ...templates,
    ...Array.from({ length: 48 }, (_, n) => ({
      id: `t-${n}`,
      title: `Template ${n}`,
      prompt: "Explain the selected code and summarize the next steps.",
    })),
  ];
  const [sid, other] = await setup(page, "layout", many);
  const motion = await page.context().newCDPSession(page);
  await motion.send("Animation.enable");
  for (const themeId of ["github", "modern", "geek"]) {
    for (const lang of ["en", "zh"]) {
      await setAccountPrefs(page.request, { themeId, lang, textSize: "xl" });
      for (const width of [1024, 390]) {
        await page.setViewportSize({ width, height: 860 });
        await page.goto(`${BASE}/chat/${sid}`);
        const captureMotion = lang === "en" && width === 1024;
        if (captureMotion) await motion.send("Animation.setPlaybackRate", { playbackRate: 0.1 });
        const panel = await openPicker(page, lang);
        if (captureMotion) {
          await panel.evaluate((node) => {
            for (const animation of node.parentElement.getAnimations({ subtree: true })) {
              const duration = Number(animation.effect.getTiming().duration);
              if (Number.isFinite(duration) && duration > 0) {
                animation.pause();
                animation.currentTime = duration / 2;
              }
            }
          });
          await page.screenshot({ path: info.outputPath(`templates-${themeId}-opening.png`) });
          await panel.evaluate((node) => {
            for (const animation of node.parentElement.getAnimations({ subtree: true }))
              animation.finish();
          });
          await motion.send("Animation.setPlaybackRate", { playbackRate: 1 });
        }
        await expect(panel.locator("button[aria-pressed]")).toHaveCount(50);
        const rect = await panel.boundingBox();
        const inputRect = await composer(page).boundingBox();
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(width);
        expect(rect.y + rect.height).toBeLessThan(inputRect.y + inputRect.height);
        await expect(panel.getByRole("button", { name: words[lang].manage })).toBeInViewport();
        await expect(panel.locator("..")).toHaveCSS("opacity", "1");
        await page.screenshot({
          animations: "disabled",
          path: info.outputPath(`templates-${themeId}-${lang}-${width}.png`),
        });
        await panel.getByRole("searchbox").fill("no matching template");
        await panel.getByRole("searchbox").press("Escape");
        await expect(panel).toHaveCount(0);
        await expect(composer(page)).toBeFocused();
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 860 });
  await openPicker(page, "zh");
  await page.locator(`[data-testid="session-row"][data-session-id="${other}"]`).click();
  await expect(page).toHaveURL(`${BASE}/chat/${other}`);
  await expect(page.getByRole("dialog", { name: words.zh.open, exact: true })).toHaveCount(0);
});
