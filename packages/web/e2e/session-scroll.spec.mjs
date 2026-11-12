/**
 * In every theme, switching through sidebar rows and browser history preserves a Session's
 * historical reading location even when it needs an older window. A second Session keeps its
 * own location. A reply streaming while the reader switches must not move that historical view;
 * leaving at the bottom instead follows the newer reply when the Session is reopened.
 * A direct scroll while restoration waits for an older window takes control of the view.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";
import { watchSocket } from "./api-socket.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const SCROLLER = '[data-find-region="conversation"]';
test.use({ viewport: { width: 1440, height: 860 } });

async function send(page, text, replies) {
  const input = page.getByPlaceholder(/输入消息/);
  await input.fill(text);
  await input.press("Enter");
  await expect
    .poll(() =>
      page
        .locator(SCROLLER)
        .innerText()
        .then((t) => t.split("Command finished").length - 1),
    )
    .toBe(replies);
  await expect(page.getByRole("button", { name: "停止", exact: true })).toHaveCount(0);
}
async function switchTo(page, sid) {
  await page.locator(`[data-testid="session-row"][data-session-id="${sid}"]`).click();
  await expect(page).toHaveURL(`${BASE}/chat/${sid}`);
  await page.locator(SCROLLER).waitFor();
}
async function placeAt(page, prompt, offset) {
  const anchor = page.locator(`${SCROLLER} [data-outline-anchor]`).filter({ hasText: prompt });
  await anchor.evaluate((node, offset) => {
    const el = node.closest('[data-find-region="conversation"]');
    el.scrollTop += node.getBoundingClientRect().top - el.getBoundingClientRect().top - offset;
  }, offset);
  await anchor.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  return anchor.evaluate(
    (node) =>
      node.getBoundingClientRect().top -
      node.closest('[data-find-region="conversation"]').getBoundingClientRect().top,
  );
}
async function expectPosition(page, prompt, offset) {
  const anchor = page.locator(`${SCROLLER} [data-outline-anchor]`).filter({ hasText: prompt });
  await expect
    .poll(async () => {
      if ((await anchor.count()) !== 1) return Infinity;
      return Math.abs(
        (await anchor.evaluate(
          (node) =>
            node.getBoundingClientRect().top -
            node.closest('[data-find-region="conversation"]').getBoundingClientRect().top,
        )) - offset,
      );
    })
    .toBeLessThanOrEqual(2);
}

test("Session switches preserve reading positions, pagination and stream-follow intent", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  await provisionAndLogin(page.request, "sessionreader", "penguin-2026");
  const { projects } = await (await page.request.get(`${BASE}/api/projects`)).json();
  const projectId = projects[0].projectId;
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
  expect(model.ok()).toBeTruthy();
  const socket = await watchSocket(page);
  const ids = [];
  for (const count of [25, 4]) {
    const { session } = await (
      await page.request.post(`${BASE}/api/projects/${projectId}/agents/default_agent/sessions`, {
        data: { approvalMode: "allow-all" },
      })
    ).json();
    ids.push(session.sessionId);
    await page.goto(`${BASE}/chat/${session.sessionId}`);
    for (let n = 1; n <= count; n++) await send(page, `Reading prompt ${n}.`, n);
  }
  const [a, b] = ids;
  for (const themeId of ["github", "modern", "geek"]) {
    await setAccountPrefs(page.request, { lang: "zh", themeId });
    await page.goto(`${BASE}/chat/${a}`);
    await page.locator(SCROLLER).waitFor();
    await expect(page.locator(`${SCROLLER} [data-outline-anchor]`)).toHaveCount(20);
    await page.locator(SCROLLER).evaluate((el) => {
      el.scrollTop = 0;
    });
    await expect(page.locator(`${SCROLLER} [data-outline-anchor]`)).toHaveCount(25);
    const aOffset = await placeAt(page, "Reading prompt 3.", -40);
    await switchTo(page, b);
    const bOffset = await placeAt(page, "Reading prompt 2.", -80);
    await switchTo(page, a);
    await expectPosition(page, "Reading prompt 3.", aOffset);
    // Capture the Session fade while its restored history is already on screen.
    await page.screenshot({ path: info.outputPath(`restored-${themeId}.png`) });
    await page.goBack();
    await expectPosition(page, "Reading prompt 2.", bOffset);
    await page.goForward();
    await expectPosition(page, "Reading prompt 3.", aOffset);
    console.log(`SESSION-SCROLL ${themeId}: historical offsets A=${aOffset}, B=${bOffset}`);
  }

  // The previous window is still coming over when the reader chooses a different position.
  const olderPath = socket.calls.findLast((c) =>
    c.path.startsWith(`/api/sessions/${a}/history?before=`),
  ).path;
  await switchTo(page, b);
  socket.hold(olderPath, 1000);
  const olderRequested = socket.nextCall((c) => c.path === olderPath);
  await switchTo(page, a);
  await olderRequested;
  const chosenOffset = await placeAt(page, "Reading prompt 20.", -40);
  await expect(page.locator(`${SCROLLER} [data-outline-anchor]`)).toHaveCount(25);
  await expectPosition(page, "Reading prompt 20.", chosenOffset);
  await switchTo(page, b);
  await switchTo(page, a);
  await expectPosition(page, "Reading prompt 20.", chosenOffset);
  await page.locator(SCROLLER).evaluate((el) => {
    el.scrollTop = 0;
  });
  await expect(page.locator(`${SCROLLER} [data-outline-anchor]`)).toHaveCount(25);

  // A background reply adds content while A's historical view is away and after it returns.
  const offset = await placeAt(page, "Reading prompt 3.", -40);
  const task = await page.request.post(`${BASE}/api/sessions/${a}/tasks`, {
    data: { input: [{ type: "text", text: "scroll bounce test" }] },
  });
  expect(task.ok()).toBeTruthy();
  await switchTo(page, b);
  await switchTo(page, a);
  await expectPosition(page, "Reading prompt 3.", offset);
  await expect(page.locator(SCROLLER)).toContainText("Paragraph 80.");
  await expectPosition(page, "Reading prompt 3.", offset);

  await page.getByRole("button", { name: "回到最新消息", exact: true }).click();
  const distance = () =>
    page.locator(SCROLLER).evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
  await expect.poll(distance).toBeLessThanOrEqual(1);
  await switchTo(page, b);
  const nextTask = await page.request.post(`${BASE}/api/sessions/${a}/tasks`, {
    data: { input: [{ type: "text", text: "One more reply" }] },
  });
  expect(nextTask.ok()).toBeTruthy();
  await switchTo(page, a);
  await expect(page.locator(SCROLLER)).toContainText("One more reply");
  await expect.poll(distance).toBeLessThanOrEqual(1);
  await expect(page.locator(`${SCROLLER} [data-btw-reply]`).last()).toContainText("Paragraph 80.");
  await expect.poll(distance).toBeLessThanOrEqual(1);
});
