import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "deskoffice-work-os-"));
process.env.DESKOFFICE_DB = join(root, "test.db");

const store = await import("../server/db.js");
const scheduler = await import("../server/scheduler.js");

test("Hermes profile is a one-to-one employee identity", () => {
  const profile = store.createHermesProfile({
    profileName: "researcher",
    displayName: "Research Hermes",
    baseUrl: "http://127.0.0.1:8642",
    tokenEnv: "HERMES_RESEARCH_TOKEN"
  });

  const [first, second] = store.listAgents();
  assert.ok(first && second);

  store.updateAgent(first.id, { executor: "hermes", hermesProfileId: profile.id });
  assert.throws(
    () => store.updateAgent(second.id, { executor: "hermes", hermesProfileId: profile.id }),
    /UNIQUE constraint failed: agents\.hermes_profile_id/
  );

  const rebound = store.getHermesProfile(profile.id);
  assert.equal(rebound?.boundAgentId, first.id);
});

test("project, kanban task, cron job and meeting have independent persistent records", () => {
  const agents = store.listAgents();
  const chief = agents[0]!;
  const project = store.createProject({
    name: "Launch",
    description: "Ship the campaign",
    leadAgentId: chief.id
  });
  const task = store.createTask({
    projectId: project.id,
    title: "Research competitors",
    requiredSpecialty: "researcher",
    requiredExpertise: ["research"],
    priority: "high"
  });
  const job = store.createCronJob({
    name: "Morning brief",
    schedule: "0 9 * * *",
    timezone: "Asia/Seoul",
    enabled: false,
    agentId: chief.id,
    prompt: "Prepare a morning brief",
    projectId: project.id
  });
  const meeting = store.createMeeting("Launch review", [chief.id], {
    agenda: ["risks", "next actions"],
    maxTurns: 6
  });

  assert.equal(store.getProject(project.id)?.name, "Launch");
  assert.equal(store.getTask(task.id)?.requiredExpertise[0], "research");
  assert.equal(store.getCronJob(job.id)?.enabled, false);
  assert.equal(store.getMeeting(meeting.id)?.agenda.length, 2);
});

test("meeting mode moves participants into and out of meeting state", () => {
  const agent = store.listAgents()[0]!;
  const meeting = store.createMeeting("State transition", [agent.id]);

  store.updateMeeting(meeting.id, { status: "active" });
  assert.equal(store.getAgent(agent.id)?.status, "meeting");

  store.updateMeeting(meeting.id, { status: "done" });
  assert.equal(store.getAgent(agent.id)?.status, "idle");
});

test("cron schedule validation honors timezone and rejects invalid expressions", () => {
  const good = scheduler.validateCronSchedule("0 9 * * *", "Asia/Seoul");
  const bad = scheduler.validateCronSchedule("this is not cron", "Asia/Seoul");
  assert.equal(good.ok, true);
  assert.equal(bad.ok, false);
});

test.after(() => {
  store.db.close();
  rmSync(root, { recursive: true, force: true });
});
