import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ServerResponse } from "node:http";
import type {
  AgentInput,
  HermesProfileInput,
  KanbanTaskStatus,
  Specialty,
  TaskPriority
} from "../src/shared/types.js";
import {
  createAgent,
  createCronJob,
  createHermesProfile,
  createMeeting,
  createProject,
  createTask,
  deleteAgent,
  deleteCronJob,
  deleteHermesProfile,
  deleteProject,
  deleteTask,
  getAgent,
  getCronJob,
  getHermesProfile,
  getMeeting,
  getTask,
  listAgents,
  listCronJobs,
  listCronRuns,
  listHermesProfiles,
  listMeetings,
  listProjects,
  listTaskRuns,
  listTasks,
  setHermesProfileValidation,
  updateAgent,
  updateCronJob,
  updateHermesProfile,
  updateMeeting,
  updateProject,
  updateTask
} from "./db.js";
import { opencodeStatus } from "./adapters/opencode.js";
import { bside, bsideStatus } from "./adapters/bside.js";
import { hermesStatus, validateHermesProfileConnection } from "./adapters/hermes.js";
import { executeAgentTask } from "./executor.js";
import { recommendExperts, SPECIALTY_CATALOG } from "./expert-system.js";
import {
  reloadCronSchedules,
  runCronJob,
  scheduleCronJob,
  scheduledCronCount,
  unscheduleCronJob,
  validateCronSchedule
} from "./scheduler.js";
import { dispatchTask, reviewTask, runMeetingTurn, summarizeMeeting } from "./workflows.js";

const port = Number(process.env.DESKOFFICE_PORT ?? 32180);
const host = process.env.DESKOFFICE_HOST ?? "0.0.0.0";
const dev = process.env.DESKOFFICE_DEV === "1";

const app = Fastify({ logger: true });
const eventClients = new Set<ServerResponse>();

function emit(type: string, payload: unknown) {
  const data = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of eventClients) client.write(data);
}

function errorStatus(message: string) {
  if (message.endsWith("_not_found")) return 404;
  if (
    message === "opencode_auth_required" ||
    message === "opencode_unavailable" ||
    message === "bside_unavailable" ||
    message === "hermes_profile_not_validated"
  ) {
    return 503;
  }
  if (message.includes("already") || message.includes("busy") || message.includes("in_meeting")) return 409;
  if (message.includes("required") || message.includes("invalid") || message.includes("limit")) return 400;
  return 502;
}

app.get("/api/events", async (_request, reply) => {
  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no"
  });
  reply.raw.write('event: ready\ndata: {"ok":true}\n\n');
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
  const hermesProfiles = listHermesProfiles();
  return {
    ok: true,
    service: "deskoffice",
    port,
    integrations: {
      opencode: openCode,
      bside: bsideInfo,
      hermes: {
        ...hermes,
        profiles: hermesProfiles.length,
        validProfiles: hermesProfiles.filter((profile) => profile.status === "valid").length
      }
    },
    runtime: {
      agents: listAgents().length,
      projects: listProjects().length,
      tasks: listTasks().length,
      meetings: listMeetings().filter((meeting) => meeting.status === "active").length,
      cronJobs: listCronJobs().length,
      scheduledCronJobs: scheduledCronCount()
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
  try {
    const agent = createAgent(request.body);
    emit("agents", { reason: "created", agentId: agent.id });
    return reply.code(201).send(agent);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("agents.hermes_profile_id")) {
      return reply.code(409).send({ error: "hermes_profile_in_use" });
    }
    throw error;
  }
});

app.patch<{
  Params: { id: string };
  Body: Partial<AgentInput>;
}>("/api/agents/:id", async (request, reply) => {
  try {
    const agent = updateAgent(request.params.id, request.body ?? {});
    if (!agent) return reply.code(404).send({ error: "agent_not_found" });
    emit("agents", { reason: "updated", agentId: agent.id });
    return agent;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("agents.hermes_profile_id")) {
      return reply.code(409).send({ error: "hermes_profile_in_use" });
    }
    throw error;
  }
});

app.delete<{ Params: { id: string } }>("/api/agents/:id", async (request, reply) => {
  if (!deleteAgent(request.params.id)) return reply.code(404).send({ error: "agent_not_found" });
  emit("agents", { reason: "deleted", agentId: request.params.id });
  return { ok: true };
});

app.post<{
  Params: { id: string };
  Body: { prompt?: string };
}>("/api/agents/:id/run", async (request, reply) => {
  try {
    return {
      ok: true,
      result: await executeAgentTask(request.params.id, request.body?.prompt ?? "", { emit })
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return reply.code(errorStatus(message)).send({ ok: false, error: message });
  }
});

app.post<{
  Params: { id: string };
  Body: { task?: string };
}>("/api/agents/:id/browser", async (request, reply) => {
  try {
    return {
      ok: true,
      result: await executeAgentTask(request.params.id, request.body?.task ?? "", {
        forceBrowser: true,
        emit
      })
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return reply.code(errorStatus(message)).send({ ok: false, error: message });
  }
});

app.get("/api/expertise/catalog", async () => ({ specialties: SPECIALTY_CATALOG }));

app.post<{
  Body: { requiredSpecialty?: Specialty | null; requiredExpertise?: string[]; limit?: number };
}>("/api/expertise/recommend", async (request) => ({
  recommendations: recommendExperts(
    listAgents(),
    request.body?.requiredSpecialty ?? null,
    request.body?.requiredExpertise ?? [],
    Math.min(10, Math.max(1, request.body?.limit ?? 5))
  ).map((item) => ({
    agentId: item.agent.id,
    name: item.agent.name,
    title: item.agent.title,
    specialty: item.agent.specialty,
    profession: item.agent.profession,
    score: item.score,
    reasons: item.reasons
  }))
}));

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

// Hermes profile registry: one managed Hermes identity can be bound to at most one DeskOffice employee.
app.get("/api/hermes/profiles", async () => ({ profiles: listHermesProfiles() }));

app.post<{ Body: HermesProfileInput }>("/api/hermes/profiles", async (request, reply) => {
  if (!request.body?.profileName?.trim()) {
    return reply.code(400).send({ error: "profile_name_required" });
  }
  try {
    const profile = createHermesProfile(request.body);
    emit("hermes", { reason: "profile_created", profileId: profile.id });
    return reply.code(201).send(profile);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return reply.code(message.includes("UNIQUE") ? 409 : 400).send({ error: message });
  }
});

app.patch<{
  Params: { id: string };
  Body: Partial<HermesProfileInput>;
}>("/api/hermes/profiles/:id", async (request, reply) => {
  const profile = updateHermesProfile(request.params.id, request.body ?? {});
  if (!profile) return reply.code(404).send({ error: "hermes_profile_not_found" });
  emit("hermes", { reason: "profile_updated", profileId: profile.id });
  return profile;
});

app.delete<{ Params: { id: string } }>("/api/hermes/profiles/:id", async (request, reply) => {
  if (!deleteHermesProfile(request.params.id)) {
    return reply.code(404).send({ error: "hermes_profile_not_found" });
  }
  emit("hermes", { reason: "profile_deleted", profileId: request.params.id });
  emit("agents", { reason: "hermes_profile_unbound" });
  return { ok: true };
});

app.post<{ Params: { id: string } }>(
  "/api/hermes/profiles/:id/validate",
  async (request, reply) => {
    const profile = getHermesProfile(request.params.id);
    if (!profile) return reply.code(404).send({ error: "hermes_profile_not_found" });
    const validation = await validateHermesProfileConnection(profile);
    const updated = setHermesProfileValidation(profile.id, {
      status: validation.status,
      capabilities: validation.capabilities ?? null,
      error: validation.error ?? null
    });
    emit("hermes", {
      reason: "profile_validated",
      profileId: profile.id,
      status: validation.status
    });
    return { profile: updated, validation };
  }
);

app.get("/api/projects", async () => ({ projects: listProjects() }));

app.post<{
  Body: {
    name?: string;
    description?: string;
    leadAgentId?: string | null;
    color?: string;
    targetDate?: string | null;
  };
}>("/api/projects", async (request, reply) => {
  if (!request.body?.name?.trim()) return reply.code(400).send({ error: "name_required" });
  const project = createProject({
    name: request.body.name,
    description: request.body.description,
    leadAgentId: request.body.leadAgentId,
    color: request.body.color,
    targetDate: request.body.targetDate
  });
  emit("kanban", { reason: "project_created", projectId: project.id });
  return reply.code(201).send(project);
});

app.patch<{
  Params: { id: string };
  Body: {
    name?: string;
    description?: string;
    status?: "active" | "paused" | "done";
    leadAgentId?: string | null;
    color?: string;
    targetDate?: string | null;
  };
}>("/api/projects/:id", async (request, reply) => {
  const project = updateProject(request.params.id, request.body ?? {});
  if (!project) return reply.code(404).send({ error: "project_not_found" });
  emit("kanban", { reason: "project_updated", projectId: project.id });
  return project;
});

app.delete<{ Params: { id: string } }>("/api/projects/:id", async (request, reply) => {
  if (!deleteProject(request.params.id)) {
    return reply.code(404).send({ error: "project_not_found" });
  }
  emit("kanban", { reason: "project_deleted", projectId: request.params.id });
  return { ok: true };
});

app.get<{
  Querystring: { projectId?: string; assigneeId?: string; status?: string };
}>("/api/tasks", async (request) => ({
  tasks: listTasks({
    projectId: request.query.projectId,
    assigneeId: request.query.assigneeId,
    status: request.query.status
  })
}));

app.post<{
  Body: {
    projectId?: string | null;
    title?: string;
    description?: string;
    status?: KanbanTaskStatus;
    priority?: TaskPriority;
    assigneeId?: string | null;
    reviewerId?: string | null;
    requiredSpecialty?: Specialty | null;
    requiredExpertise?: string[];
    dueAt?: string | null;
  };
}>("/api/tasks", async (request, reply) => {
  if (!request.body?.title?.trim()) return reply.code(400).send({ error: "title_required" });
  const task = createTask({
    ...request.body,
    title: request.body.title
  });
  emit("kanban", { reason: "task_created", taskId: task.id });
  return reply.code(201).send(task);
});

app.patch<{
  Params: { id: string };
  Body: Partial<{
    projectId: string | null;
    title: string;
    description: string;
    status: KanbanTaskStatus;
    priority: TaskPriority;
    assigneeId: string | null;
    reviewerId: string | null;
    requiredSpecialty: Specialty | null;
    requiredExpertise: string[];
    dueAt: string | null;
    result: string | null;
  }>;
}>("/api/tasks/:id", async (request, reply) => {
  const task = updateTask(request.params.id, request.body ?? {});
  if (!task) return reply.code(404).send({ error: "task_not_found" });
  emit("kanban", { reason: "task_updated", taskId: task.id });
  return task;
});

app.delete<{ Params: { id: string } }>("/api/tasks/:id", async (request, reply) => {
  if (!deleteTask(request.params.id)) return reply.code(404).send({ error: "task_not_found" });
  emit("kanban", { reason: "task_deleted", taskId: request.params.id });
  return { ok: true };
});

app.post<{
  Params: { id: string };
  Body: { agentId?: string | null };
}>("/api/tasks/:id/dispatch", async (request, reply) => {
  try {
    return {
      ok: true,
      result: await dispatchTask(request.params.id, emit, request.body?.agentId ?? null)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return reply.code(errorStatus(message)).send({ ok: false, error: message });
  }
});

app.post<{
  Params: { id: string };
  Body: { approved?: boolean; note?: string };
}>("/api/tasks/:id/review", async (request, reply) => {
  try {
    const task = reviewTask(request.params.id, request.body?.approved !== false, request.body?.note);
    emit("kanban", { reason: "reviewed", taskId: request.params.id, approved: request.body?.approved !== false });
    return task;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return reply.code(errorStatus(message)).send({ error: message });
  }
});

app.get<{ Params: { id: string } }>("/api/tasks/:id/runs", async (request) => ({
  runs: listTaskRuns(request.params.id)
}));

app.get("/api/meetings", async () => ({ meetings: listMeetings() }));

app.post<{
  Body: { title?: string; participantIds?: string[]; agenda?: string[]; maxTurns?: number };
}>("/api/meetings", async (request, reply) => {
  const title = request.body?.title?.trim();
  if (!title) return reply.code(400).send({ error: "title_required" });
  const meeting = createMeeting(title, request.body?.participantIds ?? [], {
    agenda: request.body?.agenda ?? [],
    maxTurns: request.body?.maxTurns
  });
  emit("meetings", { reason: "created", meetingId: meeting.id });
  return reply.code(201).send(meeting);
});

app.patch<{
  Params: { id: string };
  Body: Partial<{
    title: string;
    status: "planned" | "active" | "done";
    participantIds: string[];
    agenda: string[];
    decisions: string[];
    actionItems: string[];
    notes: string;
    maxTurns: number;
  }>;
}>("/api/meetings/:id", async (request, reply) => {
  const meeting = updateMeeting(request.params.id, request.body ?? {});
  if (!meeting) return reply.code(404).send({ error: "meeting_not_found" });
  emit("meetings", { reason: "updated", meetingId: meeting.id });
  emit("agents", { reason: "meeting_status", meetingId: meeting.id });
  return meeting;
});

app.post<{ Params: { id: string } }>("/api/meetings/:id/step", async (request, reply) => {
  try {
    return { ok: true, result: await runMeetingTurn(request.params.id, emit) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return reply.code(errorStatus(message)).send({ ok: false, error: message });
  }
});

app.post<{ Params: { id: string } }>(
  "/api/meetings/:id/summarize",
  async (request, reply) => {
    try {
      return { ok: true, meeting: await summarizeMeeting(request.params.id, emit) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(errorStatus(message)).send({ ok: false, error: message });
    }
  }
);

app.get("/api/cron/jobs", async () => ({ jobs: listCronJobs() }));

app.post<{
  Body: {
    name?: string;
    schedule?: string;
    timezone?: string;
    enabled?: boolean;
    agentId?: string;
    prompt?: string;
    projectId?: string | null;
  };
}>("/api/cron/jobs", async (request, reply) => {
  const body = request.body ?? {};
  if (!body.name?.trim() || !body.schedule?.trim() || !body.agentId || !body.prompt?.trim()) {
    return reply.code(400).send({ error: "name_schedule_agent_prompt_required" });
  }

  const timezone = body.timezone?.trim() || "Asia/Seoul";
  const validation = validateCronSchedule(body.schedule, timezone);
  if (!validation.ok) return reply.code(400).send({ error: validation.error });

  const job = createCronJob({
    name: body.name,
    schedule: body.schedule,
    timezone,
    enabled: body.enabled,
    agentId: body.agentId,
    prompt: body.prompt,
    projectId: body.projectId
  });
  if (job.enabled) scheduleCronJob(job.id, emit);
  emit("cron", { reason: "job_created", jobId: job.id });
  return reply.code(201).send(getCronJob(job.id));
});

app.patch<{
  Params: { id: string };
  Body: Partial<{
    name: string;
    schedule: string;
    timezone: string;
    enabled: boolean;
    agentId: string;
    prompt: string;
    projectId: string | null;
  }>;
}>("/api/cron/jobs/:id", async (request, reply) => {
  const current = getCronJob(request.params.id);
  if (!current) return reply.code(404).send({ error: "cron_job_not_found" });

  const schedule = request.body?.schedule ?? current.schedule;
  const timezone = request.body?.timezone ?? current.timezone;
  const validation = validateCronSchedule(schedule, timezone);
  if (!validation.ok) return reply.code(400).send({ error: validation.error });

  const job = updateCronJob(request.params.id, request.body ?? {});
  if (!job) return reply.code(404).send({ error: "cron_job_not_found" });
  if (job.enabled) scheduleCronJob(job.id, emit);
  else unscheduleCronJob(job.id);
  emit("cron", { reason: "job_updated", jobId: job.id });
  return getCronJob(job.id);
});

app.delete<{ Params: { id: string } }>("/api/cron/jobs/:id", async (request, reply) => {
  unscheduleCronJob(request.params.id);
  if (!deleteCronJob(request.params.id)) {
    return reply.code(404).send({ error: "cron_job_not_found" });
  }
  emit("cron", { reason: "job_deleted", jobId: request.params.id });
  return { ok: true };
});

app.post<{ Params: { id: string } }>("/api/cron/jobs/:id/run", async (request, reply) => {
  try {
    return { ok: true, run: await runCronJob(request.params.id, emit) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return reply.code(errorStatus(message)).send({ ok: false, error: message });
  }
});

app.post<{ Params: { id: string } }>("/api/cron/jobs/:id/pause", async (request, reply) => {
  const job = updateCronJob(request.params.id, { enabled: false, nextRunAt: null });
  if (!job) return reply.code(404).send({ error: "cron_job_not_found" });
  unscheduleCronJob(job.id);
  emit("cron", { reason: "paused", jobId: job.id });
  return job;
});

app.post<{ Params: { id: string } }>("/api/cron/jobs/:id/resume", async (request, reply) => {
  const job = updateCronJob(request.params.id, { enabled: true });
  if (!job) return reply.code(404).send({ error: "cron_job_not_found" });
  try {
    scheduleCronJob(job.id, emit);
  } catch (error) {
    updateCronJob(job.id, { enabled: false, nextRunAt: null });
    return reply.code(400).send({
      error: error instanceof Error ? error.message : String(error)
    });
  }
  emit("cron", { reason: "resumed", jobId: job.id });
  return getCronJob(job.id);
});

app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
  "/api/cron/jobs/:id/runs",
  async (request) => ({
    runs: listCronRuns(request.params.id, Math.min(100, Math.max(1, Number(request.query.limit ?? 30))))
  })
);

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
  reloadCronSchedules(emit);
  app.log.info(`DeskOffice listening on http://${host}:${port}`);
}

main().catch((error) => {
  app.log.error(error);
  process.exit(1);
});
