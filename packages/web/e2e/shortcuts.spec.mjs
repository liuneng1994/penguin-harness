/**
 * - Given three saved shortcuts, the fourth can be created in the editor, survives reload and
 *   fills the composer without sending. Editing and deletion preserve the other shortcuts.
 * - Given a long list, another shortcut can be added; every entry survives reload, the list
 *   scrolls locally, and New shortcut stays outside the scrolling content in all three themes
 *   and in English/Chinese desktop and phone layouts.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

const BASE = process.env.BASE_URL;
test.use({ actionTimeout: 10000 });
const copy = {
  en: { folder: "My shortcuts", create: "New shortcut" },
  zh: { folder: "我的快捷指令", create: "新建快捷指令" },
};
const shortcuts = (count) =>
  Array.from({ length: count }, (_, n) => ({
    id: `sc-${n}`,
    title: `Shortcut ${n + 1}`,
    prompt: `Prompt ${n + 1}`,
  }));

async function startPage(page, initial) {
  await provisionAndLogin(page.request, "shortcutreader", "penguin-2026");
  await setAccountPrefs(page.request, {
    lang: "en",
    themeId: "github",
    textSize: "md",
    credentialGuideSeen: true,
    draftShortcuts: initial,
  });
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto(`${BASE}/chat/new`);
}

async function saveName(page, name) {
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function openFolder(page, words = copy.en) {
  const folder = page.getByRole("button", { name: new RegExp(`^${words.folder}`) });
  await folder.click();
  return page.getByRole("list", { name: words.folder, exact: true });
}
const stored = async (page) =>
  (await (await page.request.get(`${BASE}/api/me/prefs`)).json()).prefs.draftShortcuts;

test("a fourth shortcut survives reload and editing without changing the others", async ({
  page,
}) => {
  const initial = shortcuts(3);
  await startPage(page, initial);
  const list = await openFolder(page);
  const input = page.getByPlaceholder(/Type a message/);
  await input.fill("Fourth saved prompt");
  await page.getByRole("button", { name: copy.en.create, exact: true }).click();
  await saveName(page, "Shortcut 4");
  await expect(list.getByRole("listitem")).toHaveCount(4);
  await expect
    .poll(() => stored(page))
    .toEqual([
      ...initial,
      expect.objectContaining({ title: "Shortcut 4", prompt: "Fourth saved prompt" }),
    ]);
  await page.reload();
  await openFolder(page);
  await input.fill("Other text");
  await list.getByRole("button", { name: "Shortcut 4", exact: true }).click();
  await expect(input).toHaveValue("Other text");
  await page.getByRole("button", { name: "Replace", exact: true }).click();
  await expect(input).toHaveValue("Fourth saved prompt");
  await expect(page).toHaveURL(`${BASE}/chat/new`);
  const fourth = list.getByRole("listitem").filter({ hasText: "Shortcut 4" });
  await fourth.getByRole("button", { name: "Edit", exact: true }).click();
  await saveName(page, "Shortcut 4 renamed");
  await expect.poll(() => stored(page).then((s) => s.slice(0, 3))).toEqual(initial);
  await expect(list.getByRole("button", { name: "Shortcut 4 renamed", exact: true })).toBeVisible();
  await list
    .getByRole("listitem")
    .filter({ hasText: "Shortcut 1" })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Delete shortcut", exact: true })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(list.getByRole("listitem")).toHaveCount(3);
  const kept = await stored(page);
  expect(kept.map((s) => s.title)).toEqual(["Shortcut 2", "Shortcut 3", "Shortcut 4 renamed"]);
});

test("long lists keep every shortcut and scroll independently in each theme", async ({
  page,
}, info) => {
  const many = shortcuts(40);
  await startPage(page, many);
  const list = await openFolder(page);
  const input = page.getByPlaceholder(/Type a message/);
  await expect(list.getByRole("listitem")).toHaveCount(40);
  await input.fill("One more saved prompt");
  await page.getByRole("button", { name: copy.en.create, exact: true }).click();
  await saveName(page, "Shortcut 41");
  const all = [
    ...many,
    expect.objectContaining({ title: "Shortcut 41", prompt: "One more saved prompt" }),
  ];
  await expect.poll(() => stored(page)).toEqual(all);

  for (const themeId of ["github", "modern", "geek"]) {
    for (const lang of ["en", "zh"]) {
      const words = copy[lang];
      await setAccountPrefs(page.request, { themeId, lang, textSize: lang === "zh" ? "xl" : "md" });
      await page.setViewportSize(
        lang === "zh" ? { width: 390, height: 844 } : { width: 1440, height: 860 },
      );
      await page.goto(`${BASE}/chat/new`);
      const list = await openFolder(page, words);
      await expect(list.getByRole("listitem")).toHaveCount(41);
      await expect(
        page.getByRole("button", { name: new RegExp(`^${words.folder}`) }),
      ).toContainText("41");
      await expect.poll(() => list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
      const create = page.getByRole("button", { name: words.create, exact: true });
      await create.scrollIntoViewIfNeeded();
      await list.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await expect(create).toBeInViewport();
      await expect(list.getByRole("button", { name: "Shortcut 41", exact: true })).toBeInViewport();
      await expect.poll(() => stored(page)).toEqual(all);
      await page.screenshot({ path: info.outputPath(`shortcuts-${themeId}-${lang}.png`) });
    }
  }
});
