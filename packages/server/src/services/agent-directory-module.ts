/** The host's read-only discovery extension, scoped to the Session's Project. */
import { Bind, Module, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import { Hono } from "hono";
import type { AppEnv } from "../auth/middleware.js";
import { Paths } from "../hmr/capabilities.js";
import { Access } from "../mechanisms/projects.js";
import { Auth } from "../mechanisms/identity.js";
import { LiveStreams } from "../auth/live-streams.js";
import { AgentDirectoryTransport } from "../machines/agent-directory-relay.js";
import { AgentDirectoryService } from "./agent-directory.js";
import { AgentDelegationClient } from "./agent-delegation-client.js";
import { readDelegationRequest } from "./agent-delegation-protocol.js";
import { AgentDelegationBinding, AgentDirectoryBinding } from "./agent-directory-registry.js";
import { sseEndpoint, streamRevocation } from "../http/sse.js";
import { HttpError } from "../http/errors.js";
import { readJson, badRequest } from "../http/validate.js";

@Module({
  contributes: {
    "HttpModule.routes": [
      {
        id: "AgentDirectoryModule.routes",
        prefix: "/api/projects/:projectId/agent-discovery",
        auth: "user",
        order: 49,
      },
    ],
  },
})
export class AgentDirectoryModule {
  @Use() private readonly paths!: Paths;
  @Use() private readonly binding!: AgentDirectoryBinding;
  @Use() private readonly delegation!: AgentDelegationBinding;
  @Use() private readonly transport!: AgentDirectoryTransport;
  @Use() private readonly access!: Access;
  @Use() private readonly auth!: Auth;
  @Use() private readonly liveStreams!: LiveStreams;
  @Bind("AgentDirectoryModule.routes") routes!: Hono<AppEnv>;
  setup({ effect }: ClassCtx) {
    const service = new AgentDirectoryService(this.paths.root, this.transport);
    const client = new AgentDelegationClient(
      this.paths.root,
      service,
      () => this.transport.local().nodeId,
      (projectId, request) => this.delegation.execute(projectId, request),
    );
    this.delegation.bindClient(client);
    this.binding.bind((projectId, agentId, target) => service.forAgent(projectId, agentId, target));
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      this.access.requireProjectAccess(c.var.user.userId, c.req.param("projectId")!);
      await next();
    });
    app.post("/delegate", async (c) => {
      if (!c.var.user.isAdmin)
        throw new HttpError(
          403,
          "admin_required",
          "Only an admin can delegate through a node connection.",
        );
      const projectId = c.req.param("projectId")!;
      let request;
      try {
        request = readDelegationRequest(await readJson(c), projectId);
      } catch (error) {
        throw badRequest(error instanceof Error ? error.message : "Invalid delegation request.");
      }
      try {
        return c.json(await this.delegation.execute(projectId, request));
      } catch (error) {
        throw new HttpError(
          409,
          "remote_delegation_failed",
          error instanceof Error ? error.message : "Remote delegation failed.",
        );
      }
    });
    app.get("/local", (c) =>
      service
        .local(c.req.param("projectId")!, c.req.query("agent_id"))
        .then((value) => c.json(value)),
    );
    app.get("/", (c) =>
      service
        .discover(c.req.param("projectId")!, {
          nodeId: c.req.query("node_id"),
          agentId: c.req.query("agent_id"),
        })
        .then((value) => c.json(value)),
    );
    app.get("/relay", (c) => {
      if (!c.var.user.isAdmin)
        throw new HttpError(
          403,
          "admin_required",
          "Only an admin can connect a directory controller.",
        );
      const controllerId = c.req.query("controller_id");
      if (!controllerId || !/^[A-Za-z0-9_-]{1,128}$/.test(controllerId))
        throw new HttpError(400, "invalid_controller", "Invalid controller id.");
      return sseEndpoint(c, service.relay(c.req.param("projectId")!, controllerId), {
        revocation: streamRevocation(c, c.var.user, {
          auth: this.auth,
          liveStreams: this.liveStreams,
        }),
      });
    });
    app.post("/relay/:leaseId/:requestId", async (c) => {
      if (!c.var.user.isAdmin)
        throw new HttpError(403, "admin_required", "Only an admin can answer a directory query.");
      const body = await readJson(c);
      let ok: boolean;
      try {
        ok = service.answer(
          c.req.param("projectId")!,
          c.req.param("leaseId"),
          c.req.param("requestId"),
          body,
        );
      } catch (error) {
        throw badRequest(error instanceof Error ? error.message : "Invalid directory reply.");
      }
      if (!ok)
        throw new HttpError(
          404,
          "directory_query_expired",
          "The directory query is no longer active.",
        );
      return c.body(null, 204);
    });
    this.routes = app;
    this.transport.respond((projectId, target) => service.aggregate(projectId, target));
    this.transport.respondDelegation(async (projectId, rpc) => {
      if (!rpc || typeof rpc.nodeId !== "string") throw new Error("Invalid delegation node.");
      const request = readDelegationRequest(rpc.request, projectId);
      if (rpc.nodeId === this.transport.local().nodeId)
        return this.delegation.execute(projectId, request);
      return this.transport.call(rpc.nodeId, projectId, request);
    });
    effect(() => {
      this.delegation.bindClient(null);
      this.transport.respondDelegation(null);
      this.binding.bind(null);
      this.transport.respond(null);
      service.close();
    });
  }
}
