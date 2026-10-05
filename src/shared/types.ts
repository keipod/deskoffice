export type AgentStatus = "idle" | "working" | "meeting" | "blocked" | "offline";
export type ExecutorKind = "opencode" | "hermes" | "browser";
export type Specialty =
  | "executive"
  | "content-editor"
  | "researcher"
  | "marketer"
  | "browser-operator"
  | "developer"
  | "analyst"
  | "sales"
  | "operations";
export type Seniority = "lead" | "senior" | "mid" | "junior";

export interface ExpertiseSkill {
  skill: string;
  level: number;
}

export interface Agent {
  id: string;
  name: string;
  title: string;
  department: string;
  profession: string;
  specialty: Specialty;
  seniority: Seniority;
  managerId: string | null;
  executor: ExecutorKind;
  bsideProfileId: string | null;
  hermesProfileId: string | null;
  expertise: ExpertiseSkill[];
  responsibilities: string[];
  instructions: string;
  status: AgentStatus;
  currentTask: string | null;
  workspaceSlug: string;
  seatX: number;
  seatZ: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentInput {
  name: string;
  title?: string;
  department?: string;
  profession?: string;
  specialty?: Specialty;
  seniority?: Seniority;
  managerId?: string | null;
  executor?: ExecutorKind;
  bsideProfileId?: string | null;
  hermesProfileId?: string | null;
  expertise?: ExpertiseSkill[];
  responsibilities?: string[];
  instructions?: string;
  workspaceSlug?: string;
  seatX?: number;
  seatZ?: number;
}

export type HermesProfileStatus =
  | "unknown"
  | "valid"
  | "unauthorized"
  | "unreachable"
  | "error";

export interface HermesProfile {
  id: string;
  profileName: string;
  displayName: string;
  baseUrl: string;
  tokenEnv: string;
  status: HermesProfileStatus;
  capabilities: unknown | null;
  lastError: string | null;
  lastValidatedAt: string | null;
  boundAgentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HermesProfileInput {
  profileName: string;
  displayName?: string;
  baseUrl?: string;
  tokenEnv?: string;
}

export interface MeetingMessage {
  id: string;
  agentId: string | null;
  speakerName: string;
  content: string;
  createdAt: string;
}

export interface Meeting {
  id: string;
  title: string;
  status: "planned" | "active" | "done";
  participantIds: string[];
  agenda: string[];
  transcript: MeetingMessage[];
  decisions: string[];
  actionItems: string[];
  notes: string;
  currentSpeakerIndex: number;
  turnCount: number;
  maxTurns: number;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  status: "active" | "paused" | "done";
  leadAgentId: string | null;
  color: string;
  targetDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export type KanbanTaskStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "review"
  | "done"
  | "blocked";
export type TaskPriority = "low" | "normal" | "high" | "urgent";

export interface KanbanTask {
  id: string;
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
  createdAt: string;
  updatedAt: string;
}

export interface TaskRun {
  id: string;
  taskId: string;
  agentId: string;
  executor: ExecutorKind;
  status: "running" | "succeeded" | "failed";
  result: string | null;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  timezone: string;
  enabled: boolean;
  agentId: string;
  prompt: string;
  projectId: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CronRun {
  id: string;
  jobId: string;
  agentId: string;
  status: "running" | "succeeded" | "failed";
  result: string | null;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface IntegrationStatus {
  name: "opencode" | "bside" | "hermes";
  available: boolean;
  detail: string;
}

export interface ExpertRecommendation {
  agent: Agent;
  score: number;
  reasons: string[];
}
