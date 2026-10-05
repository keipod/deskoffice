import { useCallback, useEffect, useMemo, useState } from "react";
import type { Agent, AgentInput, Meeting, Specialty, ExecutorKind } from "../shared/types";
import { api, fetchAgents, fetchMeetings } from "./api";
import ThreeOffice from "./ThreeOffice";
import WorkspacePage from "./WorkspacePage";

type Health = {
  ok: boolean;
  integrations: {
    opencode: { available: boolean; authenticated?: boolean; version?: string | null; model?: string };
    bside: { available: boolean; baseUrl?: string };
    hermes: { available: boolean; configured?: boolean; detail?: string };
  };
};

type BsideProfile = { id: string; name?: string };

const specialties: Specialty[] = [
  "executive",
  "content-editor",
  "researcher",
  "marketer",
  "browser-operator",
  "developer"
];
const executors: ExecutorKind[] = ["opencode", "hermes", "browser"];

function statusLabel(status: Agent["status"]) {
  const labels = {
    idle: "대기",
    working: "작업중",
    meeting: "회의중",
    blocked: "막힘",
    offline: "오프라인"
  };
  return labels[status];
}

function OrgTree({
  agents,
  onSelect,
  selectedId
}: {
  agents: Agent[];
  onSelect: (id: string) => void;
  selectedId: string | null;
}) {
  const roots = agents.filter((agent) => !agent.managerId || !agents.some((candidate) => candidate.id === agent.managerId));

  const render = (agent: Agent, depth = 0): React.ReactNode => {
    const children = agents.filter((candidate) => candidate.managerId === agent.id);
    return (
      <div key={agent.id}>
        <button
          className={"org-row " + (selectedId === agent.id ? "selected" : "")}
          style={{ paddingLeft: 12 + depth * 18 }}
          onClick={() => onSelect(agent.id)}
        >
          <span className={"status-dot " + agent.status} />
          <span className="org-name">{agent.name}</span>
          <span className="org-role">{agent.title || agent.specialty}</span>
        </button>
        {children.map((child) => render(child, depth + 1))}
      </div>
    );
  };

  return <div className="org-tree">{roots.map((agent) => render(agent))}</div>;
}

function AgentEditor({
  initial,
  agents,
  profiles,
  onClose,
  onSaved
}: {
  initial: Agent | null;
  agents: Agent[];
  profiles: BsideProfile[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<AgentInput>(() => ({
    name: initial?.name ?? "",
    title: initial?.title ?? "",
    specialty: initial?.specialty ?? "researcher",
    managerId: initial?.managerId ?? null,
    executor: initial?.executor ?? "opencode",
    bsideProfileId: initial?.bsideProfileId ?? null,
    hermesProfile: initial?.hermesProfile ?? null,
    workspaceSlug: initial?.workspaceSlug ?? "researcher",
    seatX: initial?.seatX ?? 0,
    seatZ: initial?.seatZ ?? 0
  }));
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!draft.name?.trim()) return;
    setSaving(true);
    try {
      await api(initial ? `/api/agents/${initial.id}` : "/api/agents", {
        method: initial ? "PATCH" : "POST",
        body: JSON.stringify(draft)
      });
      await onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal-card" onMouseDown={(event) => event.stopPropagation()}>
        <div className="panel-heading">
          <div>
            <span className="eyebrow">{initial ? "EDIT EMPLOYEE" : "NEW EMPLOYEE"}</span>
            <h2>{initial ? initial.name : "직원 추가"}</h2>
          </div>
          <button className="icon-button" onClick={onClose}>×</button>
        </div>

        <div className="form-grid">
          <label>이름<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
          <label>직책<input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
          <label>전문분야
            <select value={draft.specialty} onChange={(e) => {
              const specialty = e.target.value as Specialty;
              setDraft({
                ...draft,
                specialty,
                executor: specialty === "browser-operator" ? "browser" : draft.executor,
                workspaceSlug: specialty
              });
            }}>
              {specialties.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>실행기
            <select value={draft.executor} onChange={(e) => setDraft({ ...draft, executor: e.target.value as ExecutorKind })}>
              {executors.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>상사
            <select
              value={draft.managerId ?? ""}
              onChange={(e) => setDraft({ ...draft, managerId: e.target.value || null })}
            >
              <option value="">없음</option>
              {agents.filter((agent) => agent.id !== initial?.id).map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>
          </label>
          <label>전문 Workspace<input value={draft.workspaceSlug ?? ""} onChange={(e) => setDraft({ ...draft, workspaceSlug: e.target.value })} /></label>
          <label>좌석 X<input type="number" step="0.5" value={draft.seatX ?? 0} onChange={(e) => setDraft({ ...draft, seatX: Number(e.target.value) })} /></label>
          <label>좌석 Z<input type="number" step="0.5" value={draft.seatZ ?? 0} onChange={(e) => setDraft({ ...draft, seatZ: Number(e.target.value) })} /></label>

          {(draft.executor === "browser" || draft.specialty === "browser-operator") && (
            <label className="full">Bside Profile
              <select
                value={draft.bsideProfileId ?? ""}
                onChange={(e) => setDraft({ ...draft, bsideProfileId: e.target.value || null })}
              >
                <option value="">미지정</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.name ?? profile.id} · {profile.id}</option>
                ))}
              </select>
            </label>
          )}

          {draft.executor === "hermes" && (
            <label className="full">Hermes Profile<input value={draft.hermesProfile ?? ""} onChange={(e) => setDraft({ ...draft, hermesProfile: e.target.value || null })} /></label>
          )}
        </div>

        <div className="modal-actions">
          <button className="ghost-button" onClick={onClose}>취소</button>
          <button className="primary-button" disabled={saving || !draft.name?.trim()} onClick={() => void save()}>
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [profiles, setProfiles] = useState<BsideProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<Agent | "new" | null>(null);
  const [task, setTask] = useState("");
  const [taskResult, setTaskResult] = useState("");
  const [running, setRunning] = useState(false);
  const [meetingTitle, setMeetingTitle] = useState("");
  const [meetingPeople, setMeetingPeople] = useState<string[]>([]);
  const [path, setPath] = useState(window.location.pathname);

  const refresh = useCallback(async () => {
    const [nextAgents, nextMeetings, nextHealth] = await Promise.all([
      fetchAgents(),
      fetchMeetings(),
      api<Health>("/api/health")
    ]);
    setAgents(nextAgents);
    setMeetings(nextMeetings);
    setHealth(nextHealth);
    setSelectedId((current) => current ?? nextAgents[0]?.id ?? null);

    if (nextHealth.integrations.bside.available) {
      api<{ profiles: BsideProfile[] }>("/api/bside/profiles")
        .then((value) => setProfiles(Array.isArray(value.profiles) ? value.profiles : []))
        .catch(() => setProfiles([]));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const stream = new EventSource("/api/events");
    stream.addEventListener("agents", () => void refresh());
    stream.addEventListener("meetings", () => void refresh());
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => {
      stream.close();
      window.removeEventListener("popstate", onPop);
    };
  }, [refresh]);

  const selected = useMemo(
    () => agents.find((agent) => agent.id === selectedId) ?? null,
    [agents, selectedId]
  );

  const workspaceMatch = path.match(/^\/workspace\/([^/]+)$/);
  if (workspaceMatch) {
    const agent = agents.find((candidate) => candidate.id === workspaceMatch[1]);
    if (agent) {
      return (
        <WorkspacePage
          agent={agent}
          onBack={() => {
            history.pushState({}, "", "/");
            setPath("/");
          }}
        />
      );
    }
  }

  async function runSelected(browser = false) {
    if (!selected || !task.trim() || running) return;
    setRunning(true);
    setTaskResult("");
    try {
      const endpoint = browser ? `/api/agents/${selected.id}/browser` : `/api/agents/${selected.id}/run`;
      const key = browser ? "task" : "prompt";
      const response = await api<{ result: unknown }>(endpoint, {
        method: "POST",
        body: JSON.stringify({ [key]: task })
      });
      setTaskResult(JSON.stringify(response.result, null, 2));
    } catch (error) {
      setTaskResult(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
      void refresh();
    }
  }

  async function removeSelected() {
    if (!selected || !confirm(`${selected.name} 직원을 삭제할까요?`)) return;
    await api(`/api/agents/${selected.id}`, { method: "DELETE" });
    setSelectedId(null);
    await refresh();
  }

  async function createMeetingNow() {
    if (!meetingTitle.trim() || meetingPeople.length === 0) return;
    const meeting = await api<Meeting>("/api/meetings", {
      method: "POST",
      body: JSON.stringify({ title: meetingTitle, participantIds: meetingPeople })
    });
    await api(`/api/meetings/${meeting.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "active" })
    });
    setMeetingTitle("");
    setMeetingPeople([]);
    await refresh();
  }

  async function finishMeeting(meeting: Meeting) {
    await api(`/api/meetings/${meeting.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "done" })
    });
    await refresh();
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">DO</div>
          <div>
            <strong>DeskOffice</strong>
            <span>AI WORKFORCE CONTROL PLANE</span>
          </div>
        </div>

        <div className="integration-strip">
          <span className={"integration " + (health?.integrations.opencode.available ? "online" : "offline")}>
            OpenCode {health?.integrations.opencode.authenticated === false ? "AUTH" : ""}
          </span>
          <span className={"integration " + (health?.integrations.bside.available ? "online" : "offline")}>
            Bside
          </span>
          <span className={"integration " + (health?.integrations.hermes.available ? "online" : "offline")}>
            Hermes
          </span>
        </div>

        <button className="primary-button small" onClick={() => setEditor("new")}>+ 직원</button>
      </header>

      <div className="main-grid">
        <aside className="left-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">ORGANIZATION</span>
              <h2>직원 조직</h2>
            </div>
            <span className="count-badge">{agents.length}</span>
          </div>
          <OrgTree agents={agents} onSelect={setSelectedId} selectedId={selectedId} />

          <div className="section-divider" />
          <span className="eyebrow">MEETING ROOM</span>
          <input
            className="compact-input"
            value={meetingTitle}
            onChange={(e) => setMeetingTitle(e.target.value)}
            placeholder="회의 주제"
          />
          <div className="meeting-people">
            {agents.map((agent) => (
              <label key={agent.id}>
                <input
                  type="checkbox"
                  checked={meetingPeople.includes(agent.id)}
                  onChange={(event) => {
                    setMeetingPeople((current) =>
                      event.target.checked
                        ? [...current, agent.id]
                        : current.filter((id) => id !== agent.id)
                    );
                  }}
                />
                {agent.name}
              </label>
            ))}
          </div>
          <button
            className="secondary-button full"
            disabled={!meetingTitle.trim() || meetingPeople.length === 0}
            onClick={() => void createMeetingNow()}
          >
            회의 시작
          </button>

          {meetings.filter((meeting) => meeting.status === "active").map((meeting) => (
            <div className="active-meeting" key={meeting.id}>
              <strong>{meeting.title}</strong>
              <span>{meeting.participantIds.length}명 참여중</span>
              <button onClick={() => void finishMeeting(meeting)}>종료</button>
            </div>
          ))}
        </aside>

        <main className="office-stage">
          <div className="stage-title">
            <div>
              <span className="eyebrow">LIVE QUARTER VIEW</span>
              <h1>운영 오피스</h1>
            </div>
            <div className="legend">
              {["idle", "working", "meeting", "blocked"].map((status) => (
                <span key={status}><i className={"status-dot " + status} />{statusLabel(status as Agent["status"])}</span>
              ))}
            </div>
          </div>
          <ThreeOffice agents={agents} selectedId={selectedId} onSelect={setSelectedId} />
        </main>

        <aside className="right-panel">
          {selected ? (
            <>
              <div className="agent-hero">
                <div className={"avatar status-" + selected.status}>{selected.name.slice(0, 1)}</div>
                <div>
                  <span className="eyebrow">{selected.specialty}</span>
                  <h2>{selected.name}</h2>
                  <p>{selected.title || selected.specialty}</p>
                </div>
              </div>

              <div className="agent-meta">
                <div><span>상태</span><strong>{statusLabel(selected.status)}</strong></div>
                <div><span>실행기</span><strong>{selected.executor}</strong></div>
                <div><span>상사</span><strong>{agents.find((agent) => agent.id === selected.managerId)?.name ?? "없음"}</strong></div>
                <div><span>현재 업무</span><strong>{selected.currentTask ?? "없음"}</strong></div>
                {selected.bsideProfileId && <div><span>Bside</span><strong>{selected.bsideProfileId}</strong></div>}
              </div>

              <textarea
                className="task-box"
                value={task}
                onChange={(e) => setTask(e.target.value)}
                placeholder="이 직원에게 실제 업무를 지시하세요."
              />
              <div className="button-row">
                <button className="primary-button" disabled={running || !task.trim()} onClick={() => void runSelected(false)}>
                  {running ? "실행 중…" : "업무 실행"}
                </button>
                {selected.specialty === "browser-operator" && (
                  <button className="secondary-button" disabled={running || !task.trim()} onClick={() => void runSelected(true)}>
                    Bside 실행
                  </button>
                )}
              </div>

              {taskResult && <pre className="result-box compact">{taskResult}</pre>}

              <div className="section-divider" />
              <div className="button-stack">
                <button
                  className="secondary-button"
                  onClick={() => {
                    history.pushState({}, "", `/workspace/${selected.id}`);
                    setPath(`/workspace/${selected.id}`);
                  }}
                >
                  전문 작업실 열기
                </button>
                <button className="ghost-button" onClick={() => setEditor(selected)}>직원 설정</button>
                <button className="danger-button" onClick={() => void removeSelected()}>직원 삭제</button>
              </div>
            </>
          ) : (
            <div className="empty-state">직원을 선택하세요.</div>
          )}
        </aside>
      </div>

      {editor && (
        <AgentEditor
          initial={editor === "new" ? null : editor}
          agents={agents}
          profiles={profiles}
          onClose={() => setEditor(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
