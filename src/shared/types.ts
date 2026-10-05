export type AgentStatus = "idle" | "working" | "meeting" | "blocked" | "offline";
export type ExecutorKind = "opencode" | "hermes" | "browser";
export type Specialty =
  | "executive"
  | "content-editor"
  | "researcher"
  | "marketer"
  | "browser-operator"
  | "developer";

export interface Agent {
  id: string;
  name: string;
  title: string;
  specialty: Specialty;
  managerId: string | null;
  executor: ExecutorKind;
  bsideProfileId: string | null;
  hermesProfile: string | null;
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
  specialty?: Specialty;
  managerId?: string | null;
  executor?: ExecutorKind;
  bsideProfileId?: string | null;
  hermesProfile?: string | null;
  workspaceSlug?: string;
  seatX?: number;
  seatZ?: number;
}

export interface Meeting {
  id: string;
  title: string;
  status: "planned" | "active" | "done";
  participantIds: string[];
  notes: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface IntegrationStatus {
  name: "opencode" | "bside" | "hermes";
  available: boolean;
  detail: string;
}
