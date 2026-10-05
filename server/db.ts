import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Agent, AgentInput, AgentStatus, Meeting } from "../src/shared/types.js";

const dbPath = resolve(process.env.DESKOFFICE_DB ?? "./data/deskoffice.db");
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  specialty TEXT NOT NULL DEFAULT 'researcher',
  manager_id TEXT,
  executor TEXT NOT NULL DEFAULT 'opencode',
  bside_profile_id TEXT,
  hermes_profile TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  current_task TEXT,
  workspace_slug TEXT NOT NULL DEFAULT 'researcher',
  seat_x REAL NOT NULL DEFAULT 0,
  seat_z REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  participant_ids TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT
);
`);

type AgentRow = {
  id: string;
  name: string;
  title: string;
  specialty: Agent["specialty"];
  manager_id: string | null;
  executor: Agent["executor"];
  bside_profile_id: string | null;
  hermes_profile: string | null;
  status: AgentStatus;
  current_task: string | null;
  workspace_slug: string;
  seat_x: number;
  seat_z: number;
  created_at: string;
  updated_at: string;
};

function toAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    specialty: row.specialty,
    managerId: row.manager_id,
    executor: row.executor,
    bsideProfileId: row.bside_profile_id,
    hermesProfile: row.hermes_profile,
    status: row.status,
    currentTask: row.current_task,
    workspaceSlug: row.workspace_slug,
    seatX: row.seat_x,
    seatZ: row.seat_z,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function workspaceFor(specialty: Agent["specialty"]) {
  return specialty;
}

export function listAgents(): Agent[] {
  return (db.prepare("SELECT * FROM agents ORDER BY created_at ASC").all() as AgentRow[]).map(toAgent);
}

export function getAgent(id: string): Agent | null {
  const row = db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | undefined;
  return row ? toAgent(row) : null;
}

export function createAgent(input: AgentInput): Agent {
  const now = new Date().toISOString();
  const id = randomUUID();
  const specialty = input.specialty ?? "researcher";
  const agent: Agent = {
    id,
    name: input.name.trim(),
    title: input.title?.trim() ?? "",
    specialty,
    managerId: input.managerId ?? null,
    executor: input.executor ?? (specialty === "browser-operator" ? "browser" : "opencode"),
    bsideProfileId: input.bsideProfileId ?? null,
    hermesProfile: input.hermesProfile ?? null,
    status: "idle",
    currentTask: null,
    workspaceSlug: input.workspaceSlug ?? workspaceFor(specialty),
    seatX: input.seatX ?? 0,
    seatZ: input.seatZ ?? 0,
    createdAt: now,
    updatedAt: now
  };
  db.prepare(`
    INSERT INTO agents (
      id,name,title,specialty,manager_id,executor,bside_profile_id,hermes_profile,
      status,current_task,workspace_slug,seat_x,seat_z,created_at,updated_at
    ) VALUES (
      @id,@name,@title,@specialty,@managerId,@executor,@bsideProfileId,@hermesProfile,
      @status,@currentTask,@workspaceSlug,@seatX,@seatZ,@createdAt,@updatedAt
    )
  `).run(agent);
  return agent;
}

export function updateAgent(id: string, patch: Partial<AgentInput> & { status?: AgentStatus; currentTask?: string | null }): Agent | null {
  const current = getAgent(id);
  if (!current) return null;
  const specialty = patch.specialty ?? current.specialty;
  const next: Agent = {
    ...current,
    name: patch.name?.trim() ?? current.name,
    title: patch.title?.trim() ?? current.title,
    specialty,
    managerId: patch.managerId === undefined ? current.managerId : patch.managerId,
    executor: patch.executor ?? current.executor,
    bsideProfileId: patch.bsideProfileId === undefined ? current.bsideProfileId : patch.bsideProfileId,
    hermesProfile: patch.hermesProfile === undefined ? current.hermesProfile : patch.hermesProfile,
    status: patch.status ?? current.status,
    currentTask: patch.currentTask === undefined ? current.currentTask : patch.currentTask,
    workspaceSlug:
      patch.workspaceSlug ??
      (patch.specialty && patch.specialty !== current.specialty ? workspaceFor(specialty) : current.workspaceSlug),
    seatX: patch.seatX ?? current.seatX,
    seatZ: patch.seatZ ?? current.seatZ,
    updatedAt: new Date().toISOString()
  };
  db.prepare(`
    UPDATE agents SET
      name=@name,title=@title,specialty=@specialty,manager_id=@managerId,executor=@executor,
      bside_profile_id=@bsideProfileId,hermes_profile=@hermesProfile,status=@status,current_task=@currentTask,
      workspace_slug=@workspaceSlug,seat_x=@seatX,seat_z=@seatZ,updated_at=@updatedAt
    WHERE id=@id
  `).run(next);
  return next;
}

export function deleteAgent(id: string): boolean {
  db.prepare("UPDATE agents SET manager_id = NULL WHERE manager_id = ?").run(id);
  return db.prepare("DELETE FROM agents WHERE id = ?").run(id).changes > 0;
}

type MeetingRow = {
  id: string;
  title: string;
  status: Meeting["status"];
  participant_ids: string;
  notes: string;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
};

function toMeeting(row: MeetingRow): Meeting {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    participantIds: JSON.parse(row.participant_ids),
    notes: row.notes,
    createdAt: row.created_at,
    startedAt: row.started_at,
    endedAt: row.ended_at
  };
}

export function listMeetings(): Meeting[] {
  return (db.prepare("SELECT * FROM meetings ORDER BY created_at DESC").all() as MeetingRow[]).map(toMeeting);
}

export function createMeeting(title: string, participantIds: string[]): Meeting {
  const now = new Date().toISOString();
  const meeting: Meeting = {
    id: randomUUID(),
    title: title.trim(),
    status: "planned",
    participantIds,
    notes: "",
    createdAt: now,
    startedAt: null,
    endedAt: null
  };
  db.prepare(`
    INSERT INTO meetings (id,title,status,participant_ids,notes,created_at,started_at,ended_at)
    VALUES (@id,@title,@status,@participantIds,@notes,@createdAt,@startedAt,@endedAt)
  `).run({ ...meeting, participantIds: JSON.stringify(participantIds) });
  return meeting;
}

export function updateMeeting(id: string, patch: Partial<Pick<Meeting, "title" | "status" | "participantIds" | "notes">>): Meeting | null {
  const row = db.prepare("SELECT * FROM meetings WHERE id = ?").get(id) as MeetingRow | undefined;
  if (!row) return null;
  const current = toMeeting(row);
  const now = new Date().toISOString();
  const next: Meeting = {
    ...current,
    ...patch,
    startedAt: patch.status === "active" && !current.startedAt ? now : current.startedAt,
    endedAt: patch.status === "done" && !current.endedAt ? now : current.endedAt
  };
  db.prepare(`
    UPDATE meetings SET title=@title,status=@status,participant_ids=@participantIds,notes=@notes,
      started_at=@startedAt,ended_at=@endedAt WHERE id=@id
  `).run({ ...next, participantIds: JSON.stringify(next.participantIds) });

  if (patch.status === "active") {
    const ids = next.participantIds;
    for (const agentId of ids) updateAgent(agentId, { status: "meeting", currentTask: next.title });
  }
  if (patch.status === "done") {
    for (const agentId of next.participantIds) updateAgent(agentId, { status: "idle", currentTask: null });
  }
  return next;
}

export function seedAgents() {
  const count = Number((db.prepare("SELECT COUNT(*) AS n FROM agents").get() as { n: number }).n);
  if (count > 0) return;

  const chief = createAgent({
    name: "Chief",
    title: "운영 리드",
    specialty: "executive",
    executor: "opencode",
    seatX: 0,
    seatZ: -4
  });
  createAgent({
    name: "Mina",
    title: "콘텐츠 에디터",
    specialty: "content-editor",
    managerId: chief.id,
    executor: "opencode",
    seatX: -4,
    seatZ: 0
  });
  createAgent({
    name: "Rin",
    title: "트렌드 리서처",
    specialty: "researcher",
    managerId: chief.id,
    executor: "opencode",
    seatX: 0,
    seatZ: 0
  });
  createAgent({
    name: "Bora",
    title: "브라우저 오퍼레이터",
    specialty: "browser-operator",
    managerId: chief.id,
    executor: "browser",
    bsideProfileId: "default",
    seatX: 4,
    seatZ: 0
  });
  createAgent({
    name: "Jay",
    title: "퍼포먼스 마케터",
    specialty: "marketer",
    managerId: chief.id,
    executor: "opencode",
    seatX: 4,
    seatZ: 4
  });
}

seedAgents();
