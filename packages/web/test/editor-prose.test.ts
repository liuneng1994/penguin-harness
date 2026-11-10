/**
 * - Given conversation code locations, plain text, inline code and Markdown links expose one clickable target.
 * - Given code inside an existing link, retain a single anchor; fenced blocks never become file links.
 * - Given URLs, outside paths or a non-conversation surface, retain normal Markdown behavior.
 * - Given uncommon extensions or extensionless files, positioned citations still open the file.
 * - Given ranged citations, retain their whole label and open the starting location.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Md } from "@prismshadow/penguin-ui";
import { WorkspaceLinksProvider } from "../src/features/chat/workspace-links";

const render = (text: string, streaming = false) =>
  renderToStaticMarkup(
    createElement(WorkspaceLinksProvider, {
      workspace: "/work/repo",
      onOpenFile: () => {},
      onOpenEditor: () => {},
      children: createElement(Md, { text, streaming }),
    }),
  );
const anchors = (html: string) => [...html.matchAll(/<a\b[^>]*>/g)].map((match) => match[0]);
describe("editor references in prose", () => {
  it.each([false, true])(
    "links whole ranges in text, inline code and Markdown while streaming=%s",
    (streaming) => {
      const html = render(
        "Read Expr.cpp:785-795, `src/Expr.h:108–120` and [range](/work/repo/src/Range.kt:3:2—5:7).",
        streaming,
      );
      expect(anchors(html)).toHaveLength(3);
      expect(html).toContain('href="./Expr.cpp#L785C1"');
      expect(html).toContain('href="./src/Expr.h#L108C1"');
      expect(html).toContain('href="./src/Range.kt#L3C2"');
      expect(html).toContain(">Expr.cpp:785-795</a>");
    },
  );
  it("keeps malformed and reversed ranges as text instead of linking a prefix", () => {
    expect(
      anchors(
        render(
          "src/a.ts:5-4, src/b.ts:5-0, src/c.ts:5-2147483648, src/d.ts:5-, src/e.ts:5-6-7, src/f.ts:5-6.2 and `src/g.ts#L5-L0`.",
        ),
      ),
    ).toHaveLength(0);
  });
  it("links positioned code and config files without requiring a fixed extension list", () => {
    const html = render(
      "Read src/App.vue:8, `Dockerfile:3` and [config](settings:4). status:200, v1.2:3, src/ignored.ts:4.5 and `12:30` are not file references.",
    );
    expect(anchors(html)).toHaveLength(3);
    expect(html).toContain('href="./src/App.vue#L8C1"');
    expect(html).toContain('href="./Dockerfile#L3C1"');
    expect(html).toContain('href="./settings#L4C1"');
  });
  it.each([false, true])("exposes positioned references while streaming=%s", (streaming) => {
    const html = render(
      "Read src/a.ts:12:3, then `src/b.ts:9` and [definition](/work/repo/src/c.ts:5:2).",
      streaming,
    );
    expect(anchors(html)).toHaveLength(3);
    expect(html).toContain('href="./src/a.ts#L12C3"');
    expect(html).toContain('href="./src/b.ts#L9C1"');
    expect(html).toContain('href="./src/c.ts#L5C2"');
  });
  it("keeps one anchor for an inline-code link label and preserves percent filenames", () => {
    const html = render("[`src/100%done.ts`](src/100%25done.ts:12)");
    expect(anchors(html)).toHaveLength(1);
    expect(html).toContain('href="./src/100%25done.ts#L12C1"');
    expect(render("`src/100%done.ts:12`")).toContain('href="./src/100%25done.ts#L12C1"');
  });
  it("does not turn fenced code, outside paths or an ordinary prose surface into editor links", () => {
    expect(anchors(render("```ts\nsrc/a.ts:12\n```"))).toHaveLength(0);
    expect(anchors(render("../outside.ts:12 and `../outside.ts:12`"))).toHaveLength(0);
    expect(
      anchors(renderToStaticMarkup(createElement(Md, { text: "src/a.ts:12 and `src/a.ts:12`" }))),
    ).toHaveLength(0);
    expect(anchors(render("https://example.com/src/a.ts:12"))[0]).toContain('target="_blank"');
  });
});
