/** Explicit Project-owned skill distribution; GET only previews, POST performs the copy. */
import fs from "node:fs/promises";
import { Hono } from "hono";
import {
  DEFAULT_AGENT_ID,
  agentsDir,
  isValidId,
  inspectAgentSkillSync,
  synchronizeAgentSkills,
} from "@prismshadow/penguin-core";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { AppEnv } from "../auth/middleware.js";
import type { Paths } from "../hmr/capabilities.js";
import type { Access, AgentIndex } from "../mechanisms/projects.js";
import type { SkillSynchronization } from "../mechanisms/skill-sync.js";
import type { SkillSyncResponse } from "../api/types.js";
import { requireValidId } from "../http/validate.js";

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "projects.skill-sync",
        prefix: "/api/projects/:projectId/skill-sync",
        auth: "user",
        order: 95,
      },
    ],
  },
})
export class SkillSyncService implements SkillSynchronization {
  @Use() private readonly paths!: Paths;
  @Use() private readonly agents!: AgentIndex;
  @Use() private readonly access!: Access;
  @Bind("projects.skill-sync") routes!: Hono<AppEnv>;

  setup(): void {
    const app = new Hono<AppEnv>();
    app.get("/", async (c) => {
      const projectId = requireValidId(c, "projectId");
      this.access.requireProjectAccess(c.var.user.userId, projectId);
      return c.json(await this.preview(projectId));
    });
    app.post("/", async (c) => {
      const projectId = requireValidId(c, "projectId");
      this.access.requireProjectOwner(c.var.user.userId, projectId);
      return c.json(await this.sync(projectId));
    });
    this.routes = app;
  }

  private async targets(projectId: string): Promise<string[]> {
    const ids = new Set(this.agents.list(projectId).map((agent) => agent.agentId));
    for (const entry of await fs.readdir(agentsDir(this.paths.root, projectId), {
      withFileTypes: true,
    })) {
      if (entry.isDirectory() && isValidId(entry.name)) ids.add(entry.name);
    }
    return [...ids].filter((id) => id !== DEFAULT_AGENT_ID).sort();
  }

  async preview(projectId: string): Promise<SkillSyncResponse> {
    const agentIds = await this.targets(projectId);
    return {
      sourceAgentId: DEFAULT_AGENT_ID,
      targets: agentIds.length,
      entries: await inspectAgentSkillSync(this.paths.root, projectId, agentIds),
    };
  }
  async sync(projectId: string): Promise<SkillSyncResponse> {
    const agentIds = await this.targets(projectId);
    return {
      sourceAgentId: DEFAULT_AGENT_ID,
      targets: agentIds.length,
      entries: await synchronizeAgentSkills(this.paths.root, projectId, agentIds),
    };
  }
}
