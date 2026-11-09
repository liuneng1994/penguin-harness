/** The desktop window opens a validated file target on its own machine, including Remote-SSH.
 * Ordinary browser requests only obtain targets; they never launch programs on the server.
 */
import { Hono } from "hono";
import open from "open";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import { Desktop } from "../../hmr/capabilities.js";
import type { AppEnv } from "../../auth/middleware.js";
import { vscodeUri } from "../../editor.js";
import { badRequest, readJson, requireString } from "../validate.js";
import { HttpError } from "../errors.js";

export function desktopEditorRoutes(deps: {
  enabled: boolean;
  openUri: (uri: string) => Promise<unknown>;
}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.post("/open", async (c) => {
    if (!deps.enabled) throw new HttpError(404, "not_found", "Desktop mode is not enabled.");
    if (c.var.sessionVia !== "desktop")
      throw new HttpError(
        403,
        "desktop_shell_only",
        "Open the editor from the desktop app's own window.",
      );
    const body = await readJson(c);
    const file = requireString(body, "path");
    const sshAlias = body.sshAlias === undefined ? "" : requireString(body, "sshAlias");
    let uri: string;
    try {
      uri = vscodeUri(
        {
          path: file,
          line: body.line,
          column: body.column,
        },
        sshAlias,
      );
    } catch (error) {
      throw badRequest((error as Error).message);
    }
    try {
      await deps.openUri(uri);
    } catch (error) {
      throw new HttpError(502, "editor_open_failed", (error as Error).message);
    }
    return c.body(null, 204);
  });
  return app;
}

@Component({
  contributes: {
    "HttpModule.routes": [
      { id: "DesktopEditorRoutes.routes", prefix: "/api/desktop/editor", auth: "user", order: 10 },
    ],
  },
})
export class DesktopEditorRoutes {
  @Use() private readonly desktop!: Desktop;
  @Bind("DesktopEditorRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    this.routes = desktopEditorRoutes({
      enabled: this.desktop.current() !== null,
      openUri: (uri) => open(uri),
    });
  }
}
