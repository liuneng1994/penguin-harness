/**
 * Makes the links in the Markdown below Workspace-aware: a link naming a file of `workspace` opens
 * it through `onOpenFile` (the Files panel) instead of a new tab — see lib/reply-link.ts for how an
 * href is sorted. With no `onOpenFile` the links keep the package's default, a new tab for every
 * link.
 *
 * Only a conversation provides it (MessageStream); every other surface — Memory, the handbook,
 * tickets — renders without it and keeps a new tab for every link. The resolver is memoized on its
 * two inputs: a context change re-renders every link in the transcript, memoized message bodies
 * included, so `onOpenFile` has to be a stable callback.
 */
import { useMemo } from "react";
import type { ReactNode } from "react";
import { ProseLinksProvider } from "@prismshadow/penguin-ui";
import type { ProseLinkResolver } from "@prismshadow/penguin-ui";
import { replyLinkBehavior } from "../../lib/reply-link";
import { fileLocation, fileLocationHref } from "../../lib/file-location";
import type { FileLocation } from "../../lib/file-location";
import { remarkFileLocations } from "./remark-file-locations";
import { S } from "../../lib/strings";
import type { ProseCodeResolver } from "@prismshadow/penguin-ui";
import type { Options } from "react-markdown";

export function WorkspaceLinksProvider({
  workspace,
  onOpenFile,
  onOpenEditor,
  children,
}: {
  workspace: string | null;
  onOpenFile: ((path: string) => void) | undefined;
  onOpenEditor?: (location: FileLocation) => void;
  children: ReactNode;
}) {
  const editorLabel = S.files.openInVSCode;
  const resolve = useMemo<ProseLinkResolver | null>(
    () =>
      onOpenFile === undefined
        ? null
        : (href) =>
            replyLinkBehavior(href, { workspace, openFile: onOpenFile, openEditor: onOpenEditor }),
    [workspace, onOpenFile, onOpenEditor],
  );
  const inlineCode = useMemo<ProseCodeResolver | undefined>(
    () =>
      onOpenEditor === undefined
        ? undefined
        : (text, source = "code") => {
            const location = fileLocation(text, workspace, source === "href");
            if (!location) return null;
            return {
              href: fileLocationHref(location),
              tooltip: editorLabel,
              onClick: (event) => {
                event.preventDefault();
                onOpenEditor(location);
              },
            };
          },
    [workspace, onOpenEditor, editorLabel],
  );
  const plugins = useMemo<NonNullable<Options["remarkPlugins"]> | undefined>(
    () =>
      inlineCode === undefined
        ? undefined
        : [
            [
              remarkFileLocations,
              {
                hrefFor: (text: string) => inlineCode(text)?.href ?? null,
              },
            ],
          ],
    [inlineCode],
  );
  return (
    <ProseLinksProvider resolve={resolve} inlineCode={inlineCode} plugins={plugins}>
      {children}
    </ProseLinksProvider>
  );
}
