import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Agent,
  AgentInput,
  AgentStatus,
  CronJob,
  CronRun,
  ExpertiseSkill,
  HermesProfile,
  HermesProfileInput,
  HermesProfileStatus,
  KanbanTask,
  KanbanTaskStatus,
  Meeting,
  MeetingMessage,
  Project,
  Seniority,
  Specialty,
  TaskPriority,
  TaskRun
} from "../src/shared/types.js";
import { defaultsForSpecialty } from "./expert-system.js";

const dbPath = resolve(process.env.DESKOFFICE_DB ?? "./data/deskoffice.db");
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function columns(table: string) {
  return new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name)
  );
}

function ensureColumn(table: string, name: string, definition: string) {
  if (!columns(table).has(name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}

function json<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function now() {
  return new Date().toISOString();
}

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

CREATE TABLE IF NOT EXISTS hermes_profiles (
  id TEXT PRIMARY KEY,
  profile_name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  token_env TEXT NOT NULL DEFAULT 'HERMES_API_KEY',
  status TEXT NOT NULL DEFAULT 'unknown',
  capabilities_json TEXT,
  last_error TEXT,
  last_validated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  lead_agent_id TEXT,
  color TEXT NOT NULL DEFAULT '#38bdf8',
  target_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (lead_agent_id) REFERENCES agents(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS kanban_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo',
  priority TEXT NOT NULL DEFAULT 'normal',
  assignee_id TEXT,
  reviewer_id TEXT,
  required_specialty TEXT,
  required_expertise_json TEXT NOT NULL DEFAULT '[]',
  due_at TEXT,
  result TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (assignee_id) REFERENCES agents(id) ON DELETE SET NULL,
  FOREIGN KEY (reviewer_id) REFERENCES agents(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS task_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  executor TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  result TEXT,
  error TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  FOREIGN KEY (task_id) REFERENCES kanban_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cron_jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  schedule TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Seoul',
  enabled INTEGER NOT NULL DEFAULT 1,
  agent_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  project_id TEXT,
  last_run_at TEXT,
  next_run_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS cron_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  result TEXT,
  error TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  FOREIGN KEY (job_id) REFERENCES cron_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON kanban_tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON kanban_tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_cron_jobs_enabled ON cron_jobs(enabled);
CREATE INDEX IF NOT EXISTS idx_task_runs_task ON task_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_cron_runs_job ON cron_runs(job_id);
`);

for (const [name, definition] of [
  ["department", "TEXT NOT NULL DEFAULT 'General'"],
  ["profession", "TEXT NOT NULL DEFAULT 'Generalist'"],
  ["seniority", "TEXT NOT NULL DEFAULT 'mid'"],
  ["hermes_profile_id", "TEXT"],
  ["expertise_json", "TEXT NOT NULL DEFAULT '[]'"],
  ["responsibilities_json", "TEXT NOT NULL DEFAULT '[]'"],
  ["instructions", "TEXT NOT NULL DEFAULT ''"]
] as const) {
  ensureColumn("agents", name, definition);
}

for (const [name, definition] of [
  ["agenda_json", "TEXT NOT NULL DEFAULT '[]'"],
  ["transcript_json", "TEXT NOT NULL DEFAULT '[]'"],
  ["decisions_json", "TEXT NOT NULL DEFAULT '[]'"],
  ["action_items_json", "TEXT NOT NULL DEFAULT '[]'"],
  ["current_speaker_index", "INTEGER NOT NULL DEFAULT 0"],
  ["turn_count", "INTEGER NOT NULL DEFAULT 0"],
  ["max_turns", "INTEGER NOT NULL DEFAULT 12"]
] as const) {
  ensureColumn("meetings", name, definition);
}

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_hermes_profile_unique
    ON agents(hermes_profile_id)
    WHERE hermes_profile_id IS NOT NULL
`);

if (columns("agents").has("hermes_profile")) {
  db.exec(`
    UPDATE agents
    SET hermes_profile_id = hermes_profile
    WHERE hermes_profile_id IS NULL
      AND hermes_profile IS NOT NULL
      AND hermes_profile <> ''
  `);
}

type AgentRow = {
  id: string;
  name: string;
  title: string;
  department: string;
  profession: string;
  specialty: Specialty;
  seniority: Seniority;
  manager_id: string | null;
  executor: Agent["executor"];
  bside_profile_id: string | null;
  hermes_profile_id: string | null;
  expertise_json: string;
  responsibilities_json: string;
  instructions: string;
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
    department: row.department,
    profession: row.profession,
    specialty: row.specialty,
    seniority: row.seniority,
    managerId: row.manager_id,
    executor: row.executor,
    bsideProfileId: row.bside_profile_id,
    hermesProfileId: row.hermes_profile_id,
    expertise: json<ExpertiseSkill[]>(row.expertise_json, []),
    responsibilities: json<string[]>(row.responsibilities_json, []),
    instructions: row.instructions,
    status: row.status,
    currentTask: row.current_task,
    workspaceSlug: row.workspace_slug,
    seatX: row.seat_x,
    seatZ: row.seat_z,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function listAgents(): Agent[] {
  return (db.prepare("SELECT * FROM agents ORDER BY created_at ASC").all() as AgentRow[]).map(toAgent);
}

export function getAgent(id: string): Agent | null {
  const row = db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | undefined;
  return row ? toAgent(row) : null;
}

export function createAgent(input: AgentInput): Agent {
  const createdAt = now();
  const id = randomUUID();
  const specialty = input.specialty ?? "researcher";
  const defaults = defaultsForSpecialty(specialty);
  const agent: Agent = {
    id,
    name: input.name.trim(),
    title: input.title?.trim() || defaults.profession,
    department: input.department?.trim() || defaults.department,
    profession: input.profession?.trim() || defaults.profession,
    specialty,
    seniority: input.seniority ?? "mid",
    managerId: input.managerId ?? null,
    executor: input.executor ?? (specialty === "browser-operator" ? "browser" : "opencode"),
    bsideProfileId: input.bsideProfileId ?? null,
    hermesProfileId: input.hermesProfileId ?? null,
    expertise: input.expertise?.length ? input.expertise : defaults.expertise,
    responsibilities: input.responsibilities?.length ? input.responsibilities : defaults.responsibilities,
    instructions: input.instructions?.trim() ?? "",
    status: "idle",
    currentTask: null,
    workspaceSlug: input.workspaceSlug ?? specialty,
    seatX: input.seatX ?? 0,
    seatZ: input.seatZ ?? 0,
    createdAt,
    updatedAt: createdAt
  };

  db.prepare(`
    INSERT INTO agents (
      id,name,title,department,profession,specialty,seniority,manager_id,executor,
      bside_profile_id,hermes_profile_id,expertise_json,responsibilities_json,instructions,
      status,current_task,workspace_slug,seat_x,seat_z,created_at,updated_at
    ) VALUES (
      @id,@name,@title,@department,@profession,@specialty,@seniority,@managerId,@executor,
      @bsideProfileId,@hermesProfileId,@expertiseJson,@responsibilitiesJson,@instructions,
      @status,@currentTask,@workspaceSlug,@seatX,@seatZ,@createdAt,@updatedAt
    )
  `).run({
    ...agent,
    expertiseJson: JSON.stringify(agent.expertise),
    responsibilitiesJson: JSON.stringify(agent.responsibilities)
  });
  return agent;
}

export function updateAgent(
  id: string,
  patch: Partial<AgentInput> & { status?: AgentStatus; currentTask?: string | null }
): Agent | null {
  const current = getAgent(id);
  if (!current) return null;
  const specialty = patch.specialty ?? current.specialty;
  const defaults = defaultsForSpecialty(specialty);
  const next: Agent = {
    ...current,
    name: patch.name?.trim() ?? current.name,
    title: patch.title?.trim() ?? current.title,
    department: patch.department?.trim() ?? current.department,
    profession: patch.profession?.trim() ?? current.profession,
    specialty,
    seniority: patch.seniority ?? current.seniority,
    managerId: patch.managerId === undefined ? current.managerId : patch.managerId,
    executor: patch.executor ?? current.executor,
    bsideProfileId: patch.bsideProfileId === undefined ? current.bsideProfileId : patch.bsideProfileId,
    hermesProfileId:
      patch.hermesProfileId === undefined ? current.hermesProfileId : patch.hermesProfileId,
    expertise:
      patch.expertise ??
      (patch.specialty && patch.specialty !== current.specialty ? defaults.expertise : current.expertise),
    responsibilities:
      patch.responsibilities ??
      (patch.specialty && patch.specialty !== current.specialty
        ? defaults.responsibilities
        : current.responsibilities),
    instructions: patch.instructions === undefined ? current.instructions : patch.instructions.trim(),
    status: patch.status ?? current.status,
    currentTask: patch.currentTask === undefined ? current.currentTask : patch.currentTask,
    workspaceSlug:
      patch.workspaceSlug ??
      (patch.specialty && patch.specialty !== current.specialty ? specialty : current.workspaceSlug),
    seatX: patch.seatX ?? current.seatX,
    seatZ: patch.seatZ ?? current.seatZ,
    updatedAt: now()
  };

  db.prepare(`
    UPDATE agents SET
      name=@name,title=@title,department=@department,profession=@profession,specialty=@specialty,
      seniority=@seniority,manager_id=@managerId,executor=@executor,bside_profile_id=@bsideProfileId,
      hermes_profile_id=@hermesProfileId,expertise_json=@expertiseJson,
      responsibilities_json=@responsibilitiesJson,instructions=@instructions,status=@status,
      current_task=@currentTask,workspace_slug=@workspaceSlug,seat_x=@seatX,seat_z=@seatZ,
      updated_at=@updatedAt
    WHERE id=@id
  `).run({
    ...next,
    expertiseJson: JSON.stringify(next.expertise),
    responsibilitiesJson: JSON.stringify(next.responsibilities)
  });
  return next;
}

export function deleteAgent(id: string): boolean {
  const tx = db.transaction(() => {
    db.prepare("UPDATE agents SET manager_id = NULL WHERE manager_id = ?").run(id);
    db.prepare("UPDATE projects SET lead_agent_id = NULL WHERE lead_agent_id = ?").run(id);
    db.prepare("UPDATE kanban_tasks SET assignee_id = NULL WHERE assignee_id = ?").run(id);
    db.prepare("UPDATE kanban_tasks SET reviewer_id = NULL WHERE reviewer_id = ?").run(id);
    return db.prepare("DELETE FROM agents WHERE id = ?").run(id).changes > 0;
  });
  return tx();
}

type HermesProfileRow = {
  id: string;
  profile_name: string;
  display_name: string;
  base_url: string;
  token_env: string;
  status: HermesProfileStatus;
  capabilities_json: string | null;
  last_error: string | null;
  last_validated_at: string | null;
  created_at: string;
  updated_at: string;
};

function toHermesProfile(row: HermesProfileRow): HermesProfile {
  const bound = db
    .prepare("SELECT id FROM agents WHERE hermes_profile_id = ? LIMIT 1")
    .get(row.id) as { id: string } | undefined;
  return {
    id: row.id,
    profileName: row.profile_name,
    displayName: row.display_name,
    baseUrl: row.base_url,
    tokenEnv: row.token_env,
    status: row.status,
    capabilities: json<unknown | null>(row.capabilities_json, null),
    lastError: row.last_error,
    lastValidatedAt: row.last_validated_at,
    boundAgentId: bound?.id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function listHermesProfiles() {
  return (db.prepare("SELECT * FROM hermes_profiles ORDER BY display_name").all() as HermesProfileRow[]).map(
    toHermesProfile
  );
}

export function getHermesProfile(id: string) {
  const row = db.prepare("SELECT * FROM hermes_profiles WHERE id = ?").get(id) as
    | HermesProfileRow
    | undefined;
  return row ? toHermesProfile(row) : null;
}

export function createHermesProfile(input: HermesProfileInput) {
  const createdAt = now();
  const profileName = input.profileName.trim();
  const profile: HermesProfile = {
    id: randomUUID(),
    profileName,
    displayName: input.displayName?.trim() || profileName,
    baseUrl: (input.baseUrl?.trim() || process.env.HERMES_API_URL || "http://127.0.0.1:8642").replace(
      /\/$/,
      ""
    ),
    tokenEnv: input.tokenEnv?.trim() || "HERMES_API_KEY",
    status: "unknown",
    capabilities: null,
    lastError: null,
    lastValidatedAt: null,
    boundAgentId: null,
    createdAt,
    updatedAt: createdAt
  };
  db.prepare(`
    INSERT INTO hermes_profiles (
      id,profile_name,display_name,base_url,token_env,status,capabilities_json,last_error,
      last_validated_at,created_at,updated_at
    ) VALUES (
      @id,@profileName,@displayName,@baseUrl,@tokenEnv,@status,@capabilitiesJson,@lastError,
      @lastValidatedAt,@createdAt,@updatedAt
    )
  `).run({ ...profile, capabilitiesJson: null });
  return profile;
}

export function updateHermesProfile(id: string, patch: Partial<HermesProfileInput>) {
  const current = getHermesProfile(id);
  if (!current) return null;
  const next = {
    ...current,
    displayName: patch.displayName?.trim() ?? current.displayName,
    baseUrl: patch.baseUrl?.trim().replace(/\/$/, "") ?? current.baseUrl,
    tokenEnv: patch.tokenEnv?.trim() ?? current.tokenEnv,
    updatedAt: now()
  };
  db.prepare(`
    UPDATE hermes_profiles SET display_name=@displayName,base_url=@baseUrl,token_env=@tokenEnv,
      status='unknown',capabilities_json=NULL,last_error=NULL,last_validated_at=NULL,updated_at=@updatedAt
    WHERE id=@id
  `).run(next);
  return getHermesProfile(id);
}

export function setHermesProfileValidation(
  id: string,
  input: {
    status: HermesProfileStatus;
    capabilities?: unknown | null;
    error?: string | null;
  }
) {
  db.prepare(`
    UPDATE hermes_profiles SET status=?,capabilities_json=?,last_error=?,last_validated_at=?,updated_at=?
    WHERE id=?
  `).run(
    input.status,
    input.capabilities == null ? null : JSON.stringify(input.capabilities),
    input.error ?? null,
    now(),
    now(),
    id
  );
  return getHermesProfile(id);
}

export function deleteHermesProfile(id: string) {
  const tx = db.transaction(() => {
    db.prepare("UPDATE agents SET hermes_profile_id = NULL WHERE hermes_profile_id = ?").run(id);
    return db.prepare("DELETE FROM hermes_profiles WHERE id = ?").run(id).changes > 0;
  });
  return tx();
}

type MeetingRow = {
  id: string;
  title: string;
  status: Meeting["status"];
  participant_ids: string;
  agenda_json: string;
  transcript_json: string;
  decisions_json: string;
  action_items_json: string;
  notes: string;
  current_speaker_index: number;
  turn_count: number;
  max_turns: number;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
};

function toMeeting(row: MeetingRow): Meeting {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    participantIds: json<string[]>(row.participant_ids, []),
    agenda: json<string[]>(row.agenda_json, []),
    transcript: json<MeetingMessage[]>(row.transcript_json, []),
    decisions: json<string[]>(row.decisions_json, []),
    actionItems: json<string[]>(row.action_items_json, []),
    notes: row.notes,
    currentSpeakerIndex: row.current_speaker_index,
    turnCount: row.turn_count,
    maxTurns: row.max_turns,
    createdAt: row.created_at,
    startedAt: row.started_at,
    endedAt: row.ended_at
  };
}

export function listMeetings(): Meeting[] {
  return (db.prepare("SELECT * FROM meetings ORDER BY created_at DESC").all() as MeetingRow[]).map(
    toMeeting
  );
}

export function getMeeting(id: string): Meeting | null {
  const row = db.prepare("SELECT * FROM meetings WHERE id = ?").get(id) as MeetingRow | undefined;
  return row ? toMeeting(row) : null;
}

export function createMeeting(
  title: string,
  participantIds: string[],
  options?: { agenda?: string[]; maxTurns?: number }
): Meeting {
  const createdAt = now();
  const meeting: Meeting = {
    id: randomUUID(),
    title: title.trim(),
    status: "planned",
    participantIds,
    agenda: options?.agenda ?? [],
    transcript: [],
    decisions: [],
    actionItems: [],
    notes: "",
    currentSpeakerIndex: 0,
    turnCount: 0,
    maxTurns: Math.max(1, options?.maxTurns ?? 12),
    createdAt,
    startedAt: null,
    endedAt: null
  };
  db.prepare(`
    INSERT INTO meetings (
      id,title,status,participant_ids,agenda_json,transcript_json,decisions_json,
      action_items_json,notes,current_speaker_index,turn_count,max_turns,created_at,started_at,ended_at
    ) VALUES (
      @id,@title,@status,@participantIds,@agendaJson,@transcriptJson,@decisionsJson,
      @actionItemsJson,@notes,@currentSpeakerIndex,@turnCount,@maxTurns,@createdAt,@startedAt,@endedAt
    )
  `).run({
    ...meeting,
    participantIds: JSON.stringify(meeting.participantIds),
    agendaJson: JSON.stringify(meeting.agenda),
    transcriptJson: JSON.stringify(meeting.transcript),
    decisionsJson: JSON.stringify(meeting.decisions),
    actionItemsJson: JSON.stringify(meeting.actionItems)
  });
  return meeting;
}

export function updateMeeting(
  id: string,
  patch: Partial<
    Pick<
      Meeting,
      | "title"
      | "status"
      | "participantIds"
      | "agenda"
      | "transcript"
      | "decisions"
      | "actionItems"
      | "notes"
      | "currentSpeakerIndex"
      | "turnCount"
      | "maxTurns"
    >
  >
): Meeting | null {
  const current = getMeeting(id);
  if (!current) return null;
  const timestamp = now();
  const next: Meeting = {
    ...current,
    ...patch,
    startedAt: patch.status === "active" && !current.startedAt ? timestamp : current.startedAt,
    endedAt: patch.status === "done" && !current.endedAt ? timestamp : current.endedAt
  };
  db.prepare(`
    UPDATE meetings SET title=@title,status=@status,participant_ids=@participantIds,
      agenda_json=@agendaJson,transcript_json=@transcriptJson,decisions_json=@decisionsJson,
      action_items_json=@actionItemsJson,notes=@notes,current_speaker_index=@currentSpeakerIndex,
      turn_count=@turnCount,max_turns=@maxTurns,started_at=@startedAt,ended_at=@endedAt
    WHERE id=@id
  `).run({
    ...next,
    participantIds: JSON.stringify(next.participantIds),
    agendaJson: JSON.stringify(next.agenda),
    transcriptJson: JSON.stringify(next.transcript),
    decisionsJson: JSON.stringify(next.decisions),
    actionItemsJson: JSON.stringify(next.actionItems)
  });

  if (patch.status === "active") {
    for (const agentId of next.participantIds) {
      updateAgent(agentId, { status: "meeting", currentTask: next.title });
    }
  }
  if (patch.status === "done") {
    for (const agentId of next.participantIds) {
      const agent = getAgent(agentId);
      if (agent?.status === "meeting") updateAgent(agentId, { status: "idle", currentTask: null });
    }
  }
  return getMeeting(id);
}

export function appendMeetingMessage(id: string, message: MeetingMessage) {
  const meeting = getMeeting(id);
  if (!meeting) return null;
  return updateMeeting(id, {
    transcript: [...meeting.transcript, message],
    turnCount: meeting.turnCount + 1,
    currentSpeakerIndex:
      meeting.participantIds.length > 0
        ? (meeting.currentSpeakerIndex + 1) % meeting.participantIds.length
        : 0
  });
}

type ProjectRow = {
  id: string;
  name: string;
  description: string;
  status: Project["status"];
  lead_agent_id: string | null;
  color: string;
  target_date: string | null;
  created_at: string;
  updated_at: string;
};

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    leadAgentId: row.lead_agent_id,
    color: row.color,
    targetDate: row.target_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function listProjects() {
  return (db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all() as ProjectRow[]).map(
    toProject
  );
}

export function getProject(id: string) {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
  return row ? toProject(row) : null;
}

export function createProject(input: {
  name: string;
  description?: string;
  leadAgentId?: string | null;
  color?: string;
  targetDate?: string | null;
}) {
  const timestamp = now();
  const project: Project = {
    id: randomUUID(),
    name: input.name.trim(),
    description: input.description?.trim() ?? "",
    status: "active",
    leadAgentId: input.leadAgentId ?? null,
    color: input.color ?? "#38bdf8",
    targetDate: input.targetDate ?? null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  db.prepare(`
    INSERT INTO projects (id,name,description,status,lead_agent_id,color,target_date,created_at,updated_at)
    VALUES (@id,@name,@description,@status,@leadAgentId,@color,@targetDate,@createdAt,@updatedAt)
  `).run(project);
  return project;
}

export function updateProject(id: string, patch: Partial<Omit<Project, "id" | "createdAt" | "updatedAt">>) {
  const current = getProject(id);
  if (!current) return null;
  const next = { ...current, ...patch, updatedAt: now() };
  db.prepare(`
    UPDATE projects SET name=@name,description=@description,status=@status,lead_agent_id=@leadAgentId,
      color=@color,target_date=@targetDate,updated_at=@updatedAt WHERE id=@id
  `).run(next);
  return next;
}

export function deleteProject(id: string) {
  return db.prepare("DELETE FROM projects WHERE id = ?").run(id).changes > 0;
}

type TaskRow = {
  id: string;
  project_id: string | null;
  title: string;
  description: string;
  status: KanbanTaskStatus;
  priority: TaskPriority;
  assignee_id: string | null;
  reviewer_id: string | null;
  required_specialty: Specialty | null;
  required_expertise_json: string;
  due_at: string | null;
  result: string | null;
  created_at: string;
  updated_at: string;
};

function toTask(row: TaskRow): KanbanTask {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    assigneeId: row.assignee_id,
    reviewerId: row.reviewer_id,
    requiredSpecialty: row.required_specialty,
    requiredExpertise: json<string[]>(row.required_expertise_json, []),
    dueAt: row.due_at,
    result: row.result,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function listTasks(filters?: { projectId?: string | null; assigneeId?: string; status?: string }) {
  let sql = "SELECT * FROM kanban_tasks WHERE 1=1";
  const params: unknown[] = [];
  if (filters?.projectId) {
    sql += " AND project_id = ?";
    params.push(filters.projectId);
  }
  if (filters?.assigneeId) {
    sql += " AND assignee_id = ?";
    params.push(filters.assigneeId);
  }
  if (filters?.status) {
    sql += " AND status = ?";
    params.push(filters.status);
  }
  sql += " ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, created_at DESC";
  return (db.prepare(sql).all(...params) as TaskRow[]).map(toTask);
}

export function getTask(id: string) {
  const row = db.prepare("SELECT * FROM kanban_tasks WHERE id = ?").get(id) as TaskRow | undefined;
  return row ? toTask(row) : null;
}

export function createTask(input: {
  projectId?: string | null;
  title: string;
  description?: string;
  status?: KanbanTaskStatus;
  priority?: TaskPriority;
  assigneeId?: string | null;
  reviewerId?: string | null;
  requiredSpecialty?: Specialty | null;
  requiredExpertise?: string[];
  dueAt?: string | null;
}) {
  const timestamp = now();
  const task: KanbanTask = {
    id: randomUUID(),
    projectId: input.projectId ?? null,
    title: input.title.trim(),
    description: input.description?.trim() ?? "",
    status: input.status ?? "todo",
    priority: input.priority ?? "normal",
    assigneeId: input.assigneeId ?? null,
    reviewerId: input.reviewerId ?? null,
    requiredSpecialty: input.requiredSpecialty ?? null,
    requiredExpertise: input.requiredExpertise ?? [],
    dueAt: input.dueAt ?? null,
    result: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  db.prepare(`
    INSERT INTO kanban_tasks (
      id,project_id,title,description,status,priority,assignee_id,reviewer_id,
      required_specialty,required_expertise_json,due_at,result,created_at,updated_at
    ) VALUES (
      @id,@projectId,@title,@description,@status,@priority,@assigneeId,@reviewerId,
      @requiredSpecialty,@requiredExpertiseJson,@dueAt,@result,@createdAt,@updatedAt
    )
  `).run({ ...task, requiredExpertiseJson: JSON.stringify(task.requiredExpertise) });
  return task;
}

export function updateTask(
  id: string,
  patch: Partial<Omit<KanbanTask, "id" | "createdAt" | "updatedAt">>
) {
  const current = getTask(id);
  if (!current) return null;
  const next = { ...current, ...patch, updatedAt: now() };
  db.prepare(`
    UPDATE kanban_tasks SET project_id=@projectId,title=@title,description=@description,status=@status,
      priority=@priority,assignee_id=@assigneeId,reviewer_id=@reviewerId,
      required_specialty=@requiredSpecialty,required_expertise_json=@requiredExpertiseJson,
      due_at=@dueAt,result=@result,updated_at=@updatedAt WHERE id=@id
  `).run({ ...next, requiredExpertiseJson: JSON.stringify(next.requiredExpertise) });
  return next;
}

export function deleteTask(id: string) {
  return db.prepare("DELETE FROM kanban_tasks WHERE id = ?").run(id).changes > 0;
}

type TaskRunRow = {
  id: string;
  task_id: string;
  agent_id: string;
  executor: TaskRun["executor"];
  status: TaskRun["status"];
  result: string | null;
  error: string | null;
  started_at: string;
  ended_at: string | null;
};

function toTaskRun(row: TaskRunRow): TaskRun {
  return {
    id: row.id,
    taskId: row.task_id,
    agentId: row.agent_id,
    executor: row.executor,
    status: row.status,
    result: row.result,
    error: row.error,
    startedAt: row.started_at,
    endedAt: row.ended_at
  };
}

export function listTaskRuns(taskId: string) {
  return (db
    .prepare("SELECT * FROM task_runs WHERE task_id = ? ORDER BY started_at DESC")
    .all(taskId) as TaskRunRow[]).map(toTaskRun);
}

export function createTaskRun(taskId: string, agent: Agent) {
  const run: TaskRun = {
    id: randomUUID(),
    taskId,
    agentId: agent.id,
    executor: agent.executor,
    status: "running",
    result: null,
    error: null,
    startedAt: now(),
    endedAt: null
  };
  db.prepare(`
    INSERT INTO task_runs (id,task_id,agent_id,executor,status,result,error,started_at,ended_at)
    VALUES (@id,@taskId,@agentId,@executor,@status,@result,@error,@startedAt,@endedAt)
  `).run(run);
  return run;
}

export function finishTaskRun(id: string, input: { result?: string | null; error?: string | null }) {
  const status: TaskRun["status"] = input.error ? "failed" : "succeeded";
  db.prepare("UPDATE task_runs SET status=?,result=?,error=?,ended_at=? WHERE id=?").run(
    status,
    input.result ?? null,
    input.error ?? null,
    now(),
    id
  );
  const row = db.prepare("SELECT * FROM task_runs WHERE id = ?").get(id) as TaskRunRow | undefined;
  return row ? toTaskRun(row) : null;
}

type CronJobRow = {
  id: string;
  name: string;
  schedule: string;
  timezone: string;
  enabled: number;
  agent_id: string;
  prompt: string;
  project_id: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
};

function toCronJob(row: CronJobRow): CronJob {
  return {
    id: row.id,
    name: row.name,
    schedule: row.schedule,
    timezone: row.timezone,
    enabled: Boolean(row.enabled),
    agentId: row.agent_id,
    prompt: row.prompt,
    projectId: row.project_id,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function listCronJobs() {
  return (db.prepare("SELECT * FROM cron_jobs ORDER BY created_at DESC").all() as CronJobRow[]).map(
    toCronJob
  );
}

export function getCronJob(id: string) {
  const row = db.prepare("SELECT * FROM cron_jobs WHERE id = ?").get(id) as CronJobRow | undefined;
  return row ? toCronJob(row) : null;
}

export function createCronJob(input: {
  name: string;
  schedule: string;
  timezone?: string;
  enabled?: boolean;
  agentId: string;
  prompt: string;
  projectId?: string | null;
}) {
  const timestamp = now();
  const job: CronJob = {
    id: randomUUID(),
    name: input.name.trim(),
    schedule: input.schedule.trim(),
    timezone: input.timezone?.trim() || "Asia/Seoul",
    enabled: input.enabled ?? true,
    agentId: input.agentId,
    prompt: input.prompt.trim(),
    projectId: input.projectId ?? null,
    lastRunAt: null,
    nextRunAt: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  db.prepare(`
    INSERT INTO cron_jobs (
      id,name,schedule,timezone,enabled,agent_id,prompt,project_id,last_run_at,next_run_at,created_at,updated_at
    ) VALUES (
      @id,@name,@schedule,@timezone,@enabled,@agentId,@prompt,@projectId,@lastRunAt,@nextRunAt,@createdAt,@updatedAt
    )
  `).run({ ...job, enabled: job.enabled ? 1 : 0 });
  return job;
}

export function updateCronJob(
  id: string,
  patch: Partial<Omit<CronJob, "id" | "createdAt" | "updatedAt">>
) {
  const current = getCronJob(id);
  if (!current) return null;
  const next = { ...current, ...patch, updatedAt: now() };
  db.prepare(`
    UPDATE cron_jobs SET name=@name,schedule=@schedule,timezone=@timezone,enabled=@enabled,
      agent_id=@agentId,prompt=@prompt,project_id=@projectId,last_run_at=@lastRunAt,
      next_run_at=@nextRunAt,updated_at=@updatedAt WHERE id=@id
  `).run({ ...next, enabled: next.enabled ? 1 : 0 });
  return getCronJob(id);
}

export function deleteCronJob(id: string) {
  return db.prepare("DELETE FROM cron_jobs WHERE id = ?").run(id).changes > 0;
}

type CronRunRow = {
  id: string;
  job_id: string;
  agent_id: string;
  status: CronRun["status"];
  result: string | null;
  error: string | null;
  started_at: string;
  ended_at: string | null;
};

function toCronRun(row: CronRunRow): CronRun {
  return {
    id: row.id,
    jobId: row.job_id,
    agentId: row.agent_id,
    status: row.status,
    result: row.result,
    error: row.error,
    startedAt: row.started_at,
    endedAt: row.ended_at
  };
}

export function listCronRuns(jobId: string, limit = 30) {
  return (db
    .prepare("SELECT * FROM cron_runs WHERE job_id = ? ORDER BY started_at DESC LIMIT ?")
    .all(jobId, limit) as CronRunRow[]).map(toCronRun);
}

export function createCronRun(job: CronJob) {
  const run: CronRun = {
    id: randomUUID(),
    jobId: job.id,
    agentId: job.agentId,
    status: "running",
    result: null,
    error: null,
    startedAt: now(),
    endedAt: null
  };
  db.prepare(`
    INSERT INTO cron_runs (id,job_id,agent_id,status,result,error,started_at,ended_at)
    VALUES (@id,@jobId,@agentId,@status,@result,@error,@startedAt,@endedAt)
  `).run(run);
  updateCronJob(job.id, { lastRunAt: run.startedAt });
  return run;
}

export function finishCronRun(id: string, input: { result?: string | null; error?: string | null }) {
  const status: CronRun["status"] = input.error ? "failed" : "succeeded";
  db.prepare("UPDATE cron_runs SET status=?,result=?,error=?,ended_at=? WHERE id=?").run(
    status,
    input.result ?? null,
    input.error ?? null,
    now(),
    id
  );
  const row = db.prepare("SELECT * FROM cron_runs WHERE id = ?").get(id) as CronRunRow | undefined;
  return row ? toCronRun(row) : null;
}

export function seedAgents() {
  const count = Number((db.prepare("SELECT COUNT(*) AS n FROM agents").get() as { n: number }).n);
  if (count > 0) {
    // Backfill richer expert metadata on the first migration without changing user-customized values later.
    for (const agent of listAgents()) {
      if (!agent.expertise.length || agent.profession === "Generalist" || agent.department === "General") {
        const defaults = defaultsForSpecialty(agent.specialty);
        updateAgent(agent.id, {
          department: agent.department === "General" ? defaults.department : agent.department,
          profession: agent.profession === "Generalist" ? defaults.profession : agent.profession,
          expertise: agent.expertise.length ? agent.expertise : defaults.expertise,
          responsibilities: agent.responsibilities.length
            ? agent.responsibilities
            : defaults.responsibilities
        });
      }
    }
    return;
  }

  const chief = createAgent({
    name: "Chief",
    title: "운영 리드",
    specialty: "executive",
    seniority: "lead",
    executor: "opencode",
    seatX: 0,
    seatZ: -4
  });
  createAgent({
    name: "Mina",
    title: "콘텐츠 에디터",
    specialty: "content-editor",
    seniority: "senior",
    managerId: chief.id,
    executor: "opencode",
    seatX: -4,
    seatZ: 0
  });
  createAgent({
    name: "Rin",
    title: "트렌드 리서처",
    specialty: "researcher",
    seniority: "senior",
    managerId: chief.id,
    executor: "opencode",
    seatX: 0,
    seatZ: 0
  });
  createAgent({
    name: "Bora",
    title: "브라우저 오퍼레이터",
    specialty: "browser-operator",
    seniority: "mid",
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
    seniority: "senior",
    managerId: chief.id,
    executor: "opencode",
    seatX: 4,
    seatZ: 4
  });
}

seedAgents();
