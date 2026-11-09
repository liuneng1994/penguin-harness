/** Turn plain file:line references into links only when the conversation can resolve them. */
interface Node {
  type: string;
  value?: string;
  url?: string;
  children?: Node[];
  position?: unknown;
}

export function remarkFileLocations(opts: { hrefFor: (text: string) => string | null }) {
  return (tree: Node) => {
    const walk = (node: Node): void => {
      if (
        !node.children ||
        ["link", "linkReference", "code", "inlineCode", "html"].includes(node.type)
      )
        return;
      node.children = node.children.flatMap((child) => {
        if (child.type !== "text" || !child.value) {
          walk(child);
          return [child];
        }
        const value = child.value;
        const pattern =
          /[^\s`<>()[\]{}"'，。！？；：]+?(?::\d+(?::\d+)?|#L\d+(?:C\d+|-L\d+)?)(?![\w:]|\.\d)/g;
        const out: Node[] = [];
        let end = 0;
        for (const match of value.matchAll(pattern)) {
          const href = opts.hrefFor(match[0]);
          if (!href) continue;
          if (match.index! > end) out.push({ ...child, value: value.slice(end, match.index) });
          out.push({
            type: "link",
            url: href,
            position: child.position,
            children: [{ ...child, value: match[0] }],
          });
          end = match.index! + match[0].length;
        }
        if (!end) return [child];
        if (end < value.length) out.push({ ...child, value: value.slice(end) });
        return out;
      });
    };
    walk(tree);
  };
}
