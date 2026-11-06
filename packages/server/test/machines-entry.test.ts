/**
 * Remote commands against an installed bootstrap, in a real POSIX shell.
 *
 * - Given either profile installed under an ordinary home, when its status is asked for,
 *   then the bootstrap runs with that profile's data root and answers a stopped server.
 * - Given either profile installed under a symlinked home, when its status is asked for,
 *   then the existing bootstrap still runs and returns the same answer, never silent success.
 * - Given a symlinked home and existing Node options, when the CLI supervisor launches its
 *   service child, then that child runs through the same bootstrap and retains those options.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { remoteLayoutFor } from "../src/machines/layout.js";
import { parseProbe, readServerStateCommand } from "../src/machines/server-state.js";
import { remotePenguin } from "../src/machines/commands.js";

describe.skipIf(process.platform === "win32")("an installed bootstrap's status", () => {
  it.each([
    { profile: "dev", linked: false, supervised: false },
    { profile: "release", linked: false, supervised: false },
    { profile: "dev", linked: true, supervised: false },
    { profile: "release", linked: true, supervised: false },
    { profile: "dev", linked: true, supervised: true },
    { profile: "release", linked: true, supervised: true },
  ] as const)(
    "$profile answers with symlink=$linked and supervisor=$supervised",
    ({ profile, linked, supervised }) => {
      const work = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-remote-entry-"));
      try {
        const realHome = path.join(work, "real home");
        fs.mkdirSync(realHome);
        const home = linked ? path.join(work, "linked home") : realHome;
        if (linked) fs.symlinkSync(realHome, home, "dir");
        const layout = remoteLayoutFor(profile);
        const program = path.join(realHome, profile === "dev" ? ".penguin-dev" : ".penguin");
        fs.mkdirSync(path.join(program, "node", "bin"), { recursive: true });
        fs.mkdirSync(path.join(program, "lib", "dist"), { recursive: true });
        fs.symlinkSync(process.execPath, path.join(program, "node", "bin", "node"));
        fs.writeFileSync(path.join(program, "lib", "package.json"), '{"type":"module"}');
        // The main-entry guard of already shipped penguin-hmr bootstraps. The CLI at this
        // process boundary stands in for the pushed CLI, checking the request it receives.
        fs.writeFileSync(
          path.join(program, "lib", "dist", "penguin-hmr.js"),
          `import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === 'server' && process.argv[3] === undefined) {
    const child = spawn(process.execPath, [process.argv[1], 'server', 'status'], {
      env: process.env, stdio: 'inherit'
    });
    child.on('exit', code => { process.exitCode = code; });
  } else {
  const profile = process.env.PENGUIN_PROFILE;
  const dir = profile === 'dev' ? '.penguin-dev' : '.penguin';
  if (process.env.PENGUIN_HOME !== path.join(process.env.HOME, dir, 'data') ||
      process.argv.slice(2).join(' ') !== 'server status') {
    process.stderr.write('wrong profile, data root or command');
    process.exitCode = 1;
  } else {
    if (process.env.TEST_SUPERVISED === '1' && process.env.NODE_OPTIONS.indexOf('--stack-trace-limit=17') < 0) {
      throw new Error('existing Node options lost');
    }
    process.stdout.write(JSON.stringify({running: false, port: null, pid: null, machineId: null}));
  }
  }
}
`,
        );
        const command = supervised
          ? `${remotePenguin("linux", layout)} server`
          : readServerStateCommand("linux", layout);
        const done = spawnSync("sh", ["-c", command], {
          env: {
            ...process.env,
            HOME: home,
            NODE_OPTIONS: "--stack-trace-limit=17",
            TEST_SUPERVISED: supervised ? "1" : "0",
          },
          encoding: "utf8",
          timeout: 5000,
        });
        expect(done.status, done.stderr || done.stdout).toBe(0);
        expect(parseProbe(done.stdout).state).toEqual({ kind: "stopped" });
      } finally {
        fs.rmSync(work, { recursive: true, force: true });
      }
    },
  );
});
