/**
 * - Given conversation code locations, plain text, inline code and Markdown links expose one clickable target.
 * - Given code inside an existing link, retain a single anchor; fenced blocks never become file links.
 * - Given URLs, outside paths or a non-conversation surface, retain normal Markdown behavior.
 * - Given uncommon extensions or extensionless files, positioned citations still open the file.
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
