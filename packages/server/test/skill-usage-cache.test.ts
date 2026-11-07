/**
 * - Given more sessions than the usage cache retains, a repeated query reuses retained content
 *   instead of evicting every upcoming hit, while totals still cover all retained Traces.
 * - Given a cached session grows, the next query reads its changed content and refreshes totals.
 */
import fs from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { buildSkillsMessage, userText } from "@prismshadow/penguin-core";
import { SkillUsageReader } from "../src/services/skill-usage.js";
import { makeTempRoot, makeTraceHarness, writeTraceFile } from "./helpers.js";

let root: string;
let harness: ReturnType<typeof makeTraceHarness>;
afterEach(async () => {
  harness?.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

describe("skill usage cache", () => {
  it("reuses retained content beyond the cache limit and refreshes an appended session", async () => {
    root = await makeTempRoot();
    harness = makeTraceHarness(root);
    const files = await Promise.all(
      Array.from({ length: 129 }, (_, index) =>
        writeTraceFile(root, "p", "a", "2026-11-07", `s${String(index).padStart(3, "0")}`, 1, [
          userText(buildSkillsMessage(["demo"], "Task")),
        ]),
      ),
    );
    const reads: string[] = [];
    const reader = new SkillUsageReader(root, harness.traceIndex, harness.traceIndex.repo, {
      observeRead: (file) => reads.push(file),
    });
    expect((await reader.read("p", "a")).get("demo")!.invocations).toBe(129);
    expect(reads).toHaveLength(files.length);
    reads.length = 0;
    expect((await reader.read("p", "a")).get("demo")!.invocations).toBe(129);
    expect(reads).toEqual([files[128]]);
    await fs.appendFile(
      files[0]!,
      `${JSON.stringify(userText(buildSkillsMessage(["demo"], "Next task")))}\n`,
    );
    reads.length = 0;
    const refreshed = (await reader.read("p", "a")).get("demo")!;
    expect(refreshed.invocations).toBe(130);
    expect(refreshed.sessions).toBe(129);
    expect(reads).toEqual([files[128], files[0]]);
  });
});
