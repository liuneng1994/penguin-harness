import { build } from "esbuild";
import fs from "node:fs/promises";
const outdir = "workbenches/code-viewer/ui/editor";
await fs.rm(outdir, { recursive: true, force: true });
const result = await build({
  entryPoints: ["src/editor.ts"],
  outdir,
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  metafile: true,
  chunkNames: "chunks/[name]-[hash]",
  legalComments: "linked",
});
await fs.copyFile("workbenches/code-viewer/ui/editor-api.d.ts", `${outdir}/editor.d.ts`);

// Bundled development dependencies still travel with the plugin and require their licenses.
import path from "node:path";
const packages = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  if (!input.includes("node_modules/")) continue;
  let dir = path.dirname(path.resolve(input));
  while (dir !== path.dirname(dir)) {
    try {
      await fs.access(path.join(dir, "package.json"));
      packages.add(dir);
      break;
    } catch {
      dir = path.dirname(dir);
    }
  }
}
const notices = [];
for (const dir of [...packages].sort()) {
  const pkg = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8"));
  const licenses = (await fs.readdir(dir)).filter((name) => /^licen[cs]e(?:\.|$)/i.test(name));
  if (!licenses.length) throw new Error(`Missing license for ${pkg.name}`);
  for (const license of licenses)
    notices.push(
      `${pkg.name}@${pkg.version}\n\n${await fs.readFile(path.join(dir, license), "utf8")}`,
    );
}
await fs.writeFile(`${outdir}/THIRD_PARTY_NOTICES.txt`, notices.join("\n\n---\n\n"));
