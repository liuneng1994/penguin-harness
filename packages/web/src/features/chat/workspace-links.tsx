/**
 * Conversations resolve file links in their Workspace and open positioned references in the
 * editor. Memoized resolvers keep transcript links stable while messages arrive.
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
