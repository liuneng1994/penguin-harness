/**
 * - Given code locations, resolve colon and GitHub-style positions inside the current Workspace.
 * - Given Windows, spaced, Unicode and percent-bearing names, preserve the actual file and position.
 * - Given foreign paths, URLs or invalid positions, do not offer an editor target.
 */
import { describe, expect, it } from "vitest";
import { fileLocation, fileLocationHref } from "../src/lib/file-location";
import { resolveReplyLink, replyLinkBehavior } from "../src/lib/reply-link";
import type { MouseEvent } from "react";

const WS = "/work/repo";
describe("file locations", () => {
  it.each(["src/a.ts:42:7", "src/a.ts#L42C7", "/work/repo/src/a.ts:42:7"])(
    "resolves %s to the same file and position",
    (text) => {
      expect(fileLocation(text, WS)).toEqual({ path: "src/a.ts", line: 42, column: 7 });
    },
  );
  it("uses the start of a line range and keeps file-only references usable", () => {
    expect(fileLocation("src/a.ts#L42-L50", WS)).toEqual({ path: "src/a.ts", line: 42, column: 1 });
    expect(fileLocation("src/a.ts", WS)).toEqual({ path: "src/a.ts" });
  });
  it("preserves literal percent and fragment characters through href encoding", () => {
    const location = fileLocation("src/报告 #100%.ts:12:3", WS)!;
    expect(location).toEqual({ path: "src/报告 #100%.ts", line: 12, column: 3 });
    expect(fileLocation(fileLocationHref(location), WS, true)).toEqual(location);
    expect(resolveReplyLink("./src/a.ts%3A42", WS)).toEqual({ kind: "file", path: "src/a.ts:42" });
    expect(fileLocation("./src/a.ts%3A42", WS, true)).toBeNull();
  });
  it("normalizes Windows separators and drive letters within the declared Workspace", () => {
    expect(fileLocation("C:\\repo\\src\\a.ts:9:2", "c:/repo")).toEqual({
      path: "src/a.ts",
      line: 9,
      column: 2,
    });
    expect(fileLocation("C%3A%5Crepo%5Csrc%5Ca.ts:9:2", "c:/repo", true)).toEqual({
      path: "src/a.ts",
      line: 9,
      column: 2,
    });
  });
  it.each([
    "../outside.ts:1",
    "C:/elsewhere/a.ts:1",
    "/elsewhere/a.ts:1",
    "https://example.com/a.ts:1",
    "javascript:a.ts:1",
    "src/a.ts:0",
    "src/a.ts:2:0",
    "src/a.ts:2147483648",
    "src/%ZZ.ts:1",
  ])("refuses an invalid or foreign target %s", (text) => {
    expect(fileLocation(text, WS, true)).toBeNull();
  });
  it("does not resolve an unknown Workspace and sends one editor action for a positioned link", () => {
    expect(fileLocation("src/a.ts:1", null)).toBeNull();
    const files: string[] = [],
      editors: unknown[] = [];
    const behavior = replyLinkBehavior("src/a.ts:12:3", {
      workspace: WS,
      openFile: (path) => files.push(path),
      openEditor: (location) => editors.push(location),
    });
    let prevented = false;
    behavior.onClick!({
      preventDefault: () => {
        prevented = true;
      },
    } as unknown as MouseEvent<HTMLAnchorElement>);
    expect(prevented).toBe(true);
    expect(files).toEqual([]);
    expect(editors).toEqual([{ kind: "file", path: "src/a.ts", line: 12, column: 3 }]);
  });
});
