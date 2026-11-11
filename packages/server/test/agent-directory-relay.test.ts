/**
 * A connected Project member carries reverse directory queries over its existing API socket
 * and posts replies through the held HTTP agent. The local reader sends only Project-scoped
 * requests; outside-Project or disconnected nodes cause no request. Closing releases the stream.
 */
import http from "node:http";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { MachineSockets } from "../src/machines/machine-sockets.js";
import { MachineAgentDirectoryRelay } from "../src/machines/agent-directory-relay.js";
import type { MachineInfo } from "../src/api/types.js";

let server: http.Server,
  wss: WebSocketServer,
  relay: MachineAgentDirectoryRelay,
  sockets: MachineSockets;
let port: number;
let connected = true;
let refuseHandshake = false;
const requests: Array<{ method?: string; url?: string; cookie?: string; body: unknown }> = [];
const frames: Array<{ id: number; call?: { path: string }; cancel?: boolean }> = [];
const connections: WebSocket[] = [];
let answered!: () => void, cancelled!: () => void, rpcAnswered: (() => void) | undefined;
const responsePosted = new Promise<void>((resolve) => {
  answered = resolve;
});
const streamCancelled = new Promise<void>((resolve) => {
  cancelled = resolve;
});
const catalog = {
  projectId: "shared",
  currentNodeId: "peer",
  unavailableNodes: [],
  agents: [
    {
      nodeId: "peer",
      nodeName: "peer",
      agentId: "writer",
      name: "Writer",
      description: "Writes",
      local: true,
      canDelegate: true,
      skills: ["enabled"],
    },
  ],
};
beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    requests.push({
      method: req.method,
      url: req.url,
      cookie: req.headers.cookie,
      body: body ? JSON.parse(body) : null,
    });
    if (req.method === "POST") {
      res.writeHead(204).end();
      answered();
      if (JSON.parse(body).rpc) rpcAnswered?.();
    } else res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(catalog));
  });
  wss = new WebSocketServer({ server, verifyClient: () => !refuseHandshake });
  wss.on("connection", (ws) => {
    connections.push(ws);
    ws.on("message", (bytes) => {
      const frame = JSON.parse(bytes.toString());
      frames.push(frame);
      if (frame.cancel) {
        cancelled();
        return;
      }
      if (!frame.call) return;
      ws.send(JSON.stringify({ id: frame.id, status: 200, stream: true, headers: {} }));
      ws.send(
        JSON.stringify({
          id: frame.id,
          event: "agent_discovery_query",
          eventId: null,
          data: JSON.stringify({
            requestId: "request",
            leaseId: "lease",
            nodeId: "peer",
            agentId: "writer",
          }),
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
  sockets = new MachineSockets(() => {});
  relay = new MachineAgentDirectoryRelay(
    {
      list: (projectId) =>
        [
          { id: "local", machineId: "hub", alias: "hub", local: true },
          {
            id: "ssh:peer",
            machineId: "peer",
            alias: "peer",
            local: false,
            member: projectId === "shared",
          },
        ] as MachineInfo[],
      proxyTarget: async () =>
        connected
          ? {
              agent: new http.Agent(),
              port,
              cookie: "penguin_session=private",
              session: 1,
              adoptedAt: null,
            }
          : null,
    },
    sockets,
    () => ["shared"],
  );
});
afterAll(async () => {
  relay.close();
  sockets.close();
  for (const socket of connections) socket.terminate();
  await new Promise<void>((resolve) => wss.close(() => server.close(() => resolve())));
});

it("carries a peer's reverse query and answer on the Project-scoped connection", async () => {
  const calls: unknown[] = [];
  relay.respond(async (projectId, target) => {
    calls.push({ projectId, target });
    return { ...catalog, currentNodeId: "hub" };
  });
  await responsePosted;
  expect(calls).toEqual([{ projectId: "shared", target: { nodeId: "peer", agentId: "writer" } }]);
  expect(frames[0]!.call!.path).toBe(
    "/api/projects/shared/agent-discovery/relay?controller_id=hub",
  );
  expect(requests[0]).toMatchObject({
    method: "POST",
    url: "/api/projects/shared/agent-discovery/relay/lease/request",
    cookie: "penguin_session=private",
  });
  expect((requests[0]!.body as { currentNodeId: string }).currentNodeId).toBe("hub");
  const read = await relay.read("peer", "shared", "writer");
  expect(read.agents[0]!.skills).toEqual(["enabled"]);
  expect(requests.at(-1)!.url).toBe("/api/projects/shared/agent-discovery/local?agent_id=writer");
});

it("carries reverse delegation over the already held Project socket", async () => {
  const observed: unknown[] = [];
  relay.respondDelegation(async (projectId, rpc) => {
    observed.push({ projectId, rpc });
    return { accepted: true };
  });
  const request = {
    operation: "abort",
    owner: { projectId: "shared", agentId: "writer", nodeId: "peer", sessionId: "parent" },
    requestId: "control",
    sessionId: "child",
    capability: "private-child-capability",
  };
  const posted = new Promise<void>((resolve) => {
    rpcAnswered = resolve;
  });
  connections[0]!.send(
    JSON.stringify({
      id: frames[0]!.id,
      event: "agent_discovery_query",
      eventId: null,
      data: JSON.stringify({
        leaseId: "lease",
        requestId: "delegation",
        rpc: { nodeId: "hub", request },
      }),
    }),
  );
  await posted;
  expect(observed).toEqual([{ projectId: "shared", rpc: { nodeId: "hub", request } }]);
  expect(requests.at(-1)).toMatchObject({
    method: "POST",
    url: "/api/projects/shared/agent-discovery/relay/lease/delegation",
    body: { rpc: true, controllerId: "hub", result: { accepted: true } },
  });
  expect(frames.filter((frame) => frame.call)).toHaveLength(1);
  relay.respondDelegation(null);
});

it("refuses disconnected and outside-Project nodes without reading their APIs", async () => {
  const count = requests.length;
  await expect(relay.read("peer", "private")).rejects.toThrow("outside this Project");
  connected = false;
  await expect(relay.read("peer", "shared")).rejects.toThrow("not connected");
  expect(requests.length).toBe(count);
});

it("cancels its stream when the controller stops serving discovery", async () => {
  relay.respond(null);
  await streamCancelled;
  expect(frames.some((frame) => frame.cancel)).toBe(true);
});

it("reports a refused directory socket without repairing or upgrading the node", async () => {
  let repairs = 0;
  refuseHandshake = true;
  const passive = new MachineSockets(() => {}, {
    settle: () => {
      repairs++;
      return { kind: "upgrading", detail: "must not repair" };
    },
  });
  const directory = new MachineAgentDirectoryRelay(
    {
      list: () =>
        [
          { id: "local", machineId: "hub", alias: "hub", local: true },
          { id: "ssh:peer", machineId: "peer", alias: "peer", local: false, member: true },
        ] as MachineInfo[],
      proxyTarget: async () => ({
        agent: new http.Agent(),
        port,
        cookie: "penguin_session=private",
        session: 2,
        adoptedAt: null,
      }),
    },
    passive,
    () => ["shared"],
  );
  try {
    directory.respond(async () => catalog);
    await vi.waitFor(() => expect(passive.fact("peer")?.state).toBe("refused"));
    expect(repairs).toBe(0);
  } finally {
    directory.close();
    passive.close();
    refuseHandshake = false;
  }
});
