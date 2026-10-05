import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ServerResponse } from "node:http";
import {
  createAgent,
  createMeeting,
  deleteAgent,
  getAgent,
  listAgents,
  listMeetings,
  updateAgent,
  updateMeeting
} from "./db.js";
import { opencodeStatus, runOpenCode } from "./adapters/opencode.js";
import { bside, bsideStatus } from "./adapters/bside.js";
import { hermesStatus, runHermes } from "./adapters/hermes.js";
import { runBrowserAgent } from "./browser-agent.js";
import type { AgentInput } from "../src/shared/types.js";

const port = Number(process.env.DESKOFFICE_PORT ?? 32180);
const host = process.env.DESKOFFICE_HOST ?? "0.0.0.0";
const dev = process.env.DESKOFFICE_DEV === "1";

const app = Fastify({ logger: true });
const eventClients = new Set<ServerResponse>();

function emit(type: string, payload: unknown) {
  const data = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of eventClients) client.write(data);
}

app.get("/api/events", async (_request, reply) => {
  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no"
  });
  reply.raw.write(`event: ready\ndata: {"ok":true}\n\n`);
  eventClients.add(reply.raw);
  const heartbeat = setInterval(() => reply.raw.write(": ping\n\n"), 15000);
  reply.raw.on("close", () => {
    clearInterval(heartbeat);
    eventClients.delete(reply.raw);
  });
});

app.get("/api/health", async () => {
  const [openCode, bsideInfo, hermes] = await Promise.all([
    opencodeStatus(),
    bsideStatus(),
    hermesStatus()
  ]);
  return {
    ok: true,
    service: "deskoffice",
    port,
    integrations: {
      opencode: openCode,
      bside: bsideInfo,
      hermes
    }
  };
});

app.get("/api/agents", async () => ({ agents: listAgents() }));

app.get<{ Params: { id: string } }>("/api/agents/:id", async (request, reply) => {
  const agent = getAgent(request.params.id);
  if (!agent) return reply.code(404).send({ error: "agent_not_found" });
  return agent;
});

app.post<{ Body: AgentInput }>("/api/agents", async (request, reply) => {
  if (!request.body?.name?.trim()) return reply.code(400).send({ error: "name_required" });
  const agent = createAgent(request.body);
  emit("agents", { reason: "created", agentId: agent.id });
  return reply.code(201).send(agent);
});

app.patch<{
  Params: { id: string };
  Body: Partial<AgentInput>;
}>("/api/agents/:id", async (request, reply) => {
  const agent = updateAgent(request.params.id, request.body ?? {});
  if (!agent) return reply.code(404).send({ error: "agent_not_found" });
  emit("agents", { reason: "updated", agentId: agent.id });
  return agent;
});

app.delete<{ Params: { id: string } }>("/api/agents/:id", async (request, reply) => {
  if (!deleteAgent(request.params.id)) return reply.code(404).send({ error: "agent_not_found" });
  emit("agents", { reason: "deleted", agentId: request.params.id });
  return { ok: true };
});

async function executeAgent(agentId: string, prompt: string, forceBrowser = false) {
  const agent = getAgent(agentId);
  if (!agent) throw new Error("agent_not_found");
  if (agent.status === "working") throw new Error("agent_busy");
  if (!prompt.trim()) throw new Error("prompt_required");

  updateAgent(agentId, { status: "working", currentTask: prompt.slice(0, 180) });
  emit("agents", { reason: "working", agentId });

  try {
    let result: unknown;
    if (forceBrowser || agent.executor === "browser") {
      if (!agent.bsideProfileId) throw new Error("bside_profile_required");
      result = await runBrowserAgent(prompt, agent.bsideProfileId);
    } else if (agent.executor === "hermes") {
      result = await runHermes(prompt, `DeskOffice role: ${agent.title || agent.specialty}`);
    } else {
      result = await runOpenCode(prompt, agent.title || agent.specialty);
    }

    updateAgent(agentId, { status: "idle", currentTask: null });
    emit("agents", { reason: "completed", agentId });
    return result;
  } catch (error) {
    updateAgent(agentId, {
      status: "blocked",
      currentTask: error instanceof Error ? error.message : String(error)
    });
    emit("agents", { reason: "blocked", agentId });
    throw error;
  }
}

app.post<{
  Params: { id: string };
  Body: { prompt?: string };
}>("/api/agents/:id/run", async (request, reply) => {
  try {
    return { ok: true, result: await executeAgent(request.params.id, request.body?.prompt ?? "") };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = message === "agent_not_found" ? 404 : message === "agent_busy" ? 409 : 502;
    return reply.code(code).send({ ok: false, error: message });
  }
});

app.post<{
  Params: { id: string };
  Body: { task?: string };
}>("/api/agents/:id/browser", async (request, reply) => {
  try {
    return { ok: true, result: await executeAgent(request.params.id, request.body?.task ?? "", true) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return reply.code(message === "agent_not_found" ? 404 : 502).send({ ok: false, error: message });
  }
});

app.get("/api/bside/profiles", async (_request, reply) => {
  try {
    return { ok: true, profiles: await bside.profiles() };
  } catch (error) {
    return reply.code(502).send({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get("/api/meetings", async () => ({ meetings: listMeetings() }));

app.post<{
  Body: { title?: string; participantIds?: string[] };
}>("/api/meetings", async (request, reply) => {
  const title = request.body?.title?.trim();
  if (!title) return reply.code(400).send({ error: "title_required" });
  const meeting = createMeeting(title, request.body?.participantIds ?? []);
  emit("meetings", { reason: "created", meetingId: meeting.id });
  return reply.code(201).send(meeting);
});

app.patch<{
  Params: { id: string };
  Body: {
    title?: string;
    status?: "planned" | "active" | "done";
    participantIds?: string[];
    notes?: string;
  };
}>("/api/meetings/:id", async (request, reply) => {
  const meeting = updateMeeting(request.params.id, request.body ?? {});
  if (!meeting) return reply.code(404).send({ error: "meeting_not_found" });
  emit("meetings", { reason: "updated", meetingId: meeting.id });
  emit("agents", { reason: "meeting_status", meetingId: meeting.id });
  return meeting;
});

async function main() {
  const dist = resolve("dist");
  if (!dev && existsSync(dist)) {
    await app.register(fastifyStatic, {
      root: dist,
      prefix: "/",
      wildcard: false
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.code(404).send({ error: "not_found" });
      }
      return reply.sendFile("index.html");
    });
  }

  await app.listen({ host, port });
  app.log.info(`DeskOffice listening on http://${host}:${port}`);
}

main().catch((error) => {
  app.log.error(error);
  process.exit(1);
});
