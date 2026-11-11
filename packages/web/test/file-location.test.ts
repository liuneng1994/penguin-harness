/**
 * - Given code locations, resolve colon and GitHub-style positions inside the current Workspace.
 * - Given Windows, spaced, Unicode and percent-bearing names, preserve the actual file and position.
 * - Given foreign paths, URLs or invalid positions, do not offer an editor target.
 * - Given root or trailing-slash Workspaces, absolute citations still resolve inside them.
 * - Given line and column ranges, preserve endpoints and reject invalid or reversed endpoints.
 */
import { describe, expect, it } from "vitest";
import { fileLocation, fileLocationHref } from "../src/lib/file-location";
import { resolveReplyLink, replyLinkBehavior } from "../src/lib/reply-link";
import type { MouseEvent } from "react";

const WS = "/work/repo";
describe("file locations", () => {
  it.each(["Expr.cpp:785-795", "Expr.cpp:785–795", "Expr.cpp:785—795"])(
    "opens the first line of %s",
    (text) => {
      expect(fileLocation(text, WS)).toEqual({
        path: "Expr.cpp",
        line: 785,
        column: 1,
        endLine: 795,
      });
    },
  );
  it.each(["src/a.ts:42:3-50:7", "src/a.ts#L42C3-L50C7"])(
    "opens the first position of %s",
    (text) => {
      expect(fileLocation(text, WS)).toEqual({
        path: "src/a.ts",
        line: 42,
        column: 3,
        endLine: 50,
        endColumn: 7,
      });
    },
  );
  it("preserves ranges in explicit links and Windows paths", () => {
    expect(fileLocation("./src/报告%20%23100%25.ts:12-15", WS, true)).toEqual({
      path: "src/报告 #100%.ts",
      line: 12,
      column: 1,
      endLine: 15,
    });
    expect(fileLocation("C:\\repo\\src\\a.ts:9-12", "c:/repo")).toEqual({
      path: "src/a.ts",
      line: 9,
      column: 1,
      endLine: 12,
    });
    expect(fileLocation("./src/a.ts:42:3%E2%80%9450:7", WS, true)).toEqual({
      path: "src/a.ts",
      line: 42,
      column: 3,
      endLine: 50,
      endColumn: 7,
    });
  });
  it.each([
    ["/src/a.ts:12", "/", "src/a.ts"],
    ["C:/src/a.ts:12", "C:\\", "src/a.ts"],
    ["/work/repo/src/a.ts:12", "/work/repo/", "src/a.ts"],
  ])("resolves %s inside Workspace %s", (text, workspace, path) => {
    expect(fileLocation(text, workspace)).toEqual({ path, line: 12, column: 1 });
  });
  it.each(["src/a.ts:42:7", "src/a.ts#L42C7", "/work/repo/src/a.ts:42:7"])(
    "resolves %s to the same file and position",
    (text) => {
      expect(fileLocation(text, WS)).toEqual({ path: "src/a.ts", line: 42, column: 7 });
    },
  );
  it("uses the start of a line range and keeps file-only references usable", () => {
    expect(fileLocation("src/a.ts#L42-L50", WS)).toEqual({
      path: "src/a.ts",
      line: 42,
      column: 1,
      endLine: 50,
    });
    expect(fileLocation("src/a.ts", WS)).toEqual({ path: "src/a.ts" });
  });
  it("keeps range endpoints through Markdown hrefs and into the click action", () => {
    const location = fileLocation("Expr.cpp:785:3-795:7", WS)!;
    const href = fileLocationHref(location);
    expect(fileLocation(href, WS, true)).toEqual(location);
    const opened: unknown[] = [];
    replyLinkBehavior(href, {
      workspace: WS,
      openFile: () => {
        throw new Error("unexpected file panel");
      },
      openEditor: (target) => opened.push(target),
    }).onClick!({ preventDefault() {} } as unknown as MouseEvent<HTMLAnchorElement>);
    expect(opened).toEqual([{ kind: "file", ...location }]);
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
    "src/a.ts:5-0",
    "src/a.ts:5-4",
    "src/a.ts:5-2147483648",
    "src/a.ts:5:7-5:6",
    "src/a.ts#L5-L0",
    "src/a.ts#L5-L4",
    "src/a.ts#L5C7-L5C6",
    "src/a.ts:4:5:6",
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
