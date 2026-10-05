"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  Agent,
  KanbanTask,
  KanbanTaskStatus,
  Project,
  Specialty,
  TaskPriority
} from "../shared/types";
import { api } from "./api";

const columns: Array<{ status: KanbanTaskStatus; label: string }> = [
  { status: "backlog", label: "BACKLOG" },
  { status: "todo", label: "TODO" },
  { status: "in_progress", label: "DOING" },
  { status: "review", label: "REVIEW" },
  { status: "done", label: "DONE" },
  { status: "blocked", label: "BLOCKED" }
];

export default function KanbanPage({ agents }: { agents: Agent[] }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [projectName, setProjectName] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [requiredSpecialty, setRequiredSpecialty] = useState<Specialty | "">("");
  const [requiredExpertise, setRequiredExpertise] = useState("");
  const [busyTask, setBusyTask] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [projectData, taskData] = await Promise.all([
      api<{ projects: Project[] }>("/api/projects"),
      api<{ tasks: KanbanTask[] }>("/api/tasks")
    ]);
    setProjects(projectData.projects);
    setTasks(taskData.tasks);
    setProjectId((current) => current || projectData.projects[0]?.id || "");
  }, []);

  useEffect(() => {
    void refresh();
    const stream = new EventSource("/api/events");
    stream.addEventListener("kanban", () => void refresh());
    return () => stream.close();
  }, [refresh]);

  const visibleTasks = useMemo(
    () => (projectId ? tasks.filter((task) => task.projectId === projectId) : tasks),
    [tasks, projectId]
  );

  async function createProjectNow() {
    if (!projectName.trim()) return;
    const project = await api<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: projectName })
    });
    setProjectName("");
    setProjectId(project.id);
    await refresh();
  }

  async function createTaskNow() {
    if (!title.trim()) return;
    await api("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        projectId: projectId || null,
        title,
        description,
        priority,
        requiredSpecialty: requiredSpecialty || null,
        requiredExpertise: requiredExpertise
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      })
    });
    setTitle("");
    setDescription("");
    setRequiredExpertise("");
    await refresh();
  }

  async function patchTask(taskId: string, patch: Record<string, unknown>) {
    await api(`/api/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify(patch)
    });
    await refresh();
  }

  async function dispatch(task: KanbanTask) {
    setBusyTask(task.id);
    try {
      await api(`/api/tasks/${task.id}/dispatch`, {
        method: "POST",
        body: JSON.stringify({})
      });
    } finally {
      setBusyTask(null);
      await refresh();
    }
  }

  async function review(task: KanbanTask, approved: boolean) {
    await api(`/api/tasks/${task.id}/review`, {
      method: "POST",
      body: JSON.stringify({ approved })
    });
    await refresh();
  }

  return (
    <section className="work-page">
      <div className="work-page-head">
        <div>
          <span className="eyebrow">HERMES-STYLE WORK BOARD</span>
          <h1>Kanban</h1>
          <p>카드가 업무의 단위입니다. 전문성으로 자동배정하고 실행 이력과 리뷰 상태를 남깁니다.</p>
        </div>
        <div className="inline-form">
          <input
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            placeholder="새 프로젝트"
          />
          <button className="secondary-button" onClick={() => void createProjectNow()}>
            프로젝트 +
          </button>
        </div>
      </div>

      <div className="project-strip">
        <button className={!projectId ? "active" : ""} onClick={() => setProjectId("")}>
          전체
        </button>
        {projects.map((project) => (
          <button
            key={project.id}
            className={projectId === project.id ? "active" : ""}
            onClick={() => setProjectId(project.id)}
          >
            <i style={{ background: project.color }} />
            {project.name}
          </button>
        ))}
      </div>

      <div className="task-create-grid">
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="업무 제목" />
        <select value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)}>
          <option value="low">낮음</option>
          <option value="normal">보통</option>
          <option value="high">높음</option>
          <option value="urgent">긴급</option>
        </select>
        <select
          value={requiredSpecialty}
          onChange={(event) => setRequiredSpecialty(event.target.value as Specialty | "")}
        >
          <option value="">전문분야 자동</option>
          <option value="executive">executive</option>
          <option value="content-editor">content-editor</option>
          <option value="researcher">researcher</option>
          <option value="marketer">marketer</option>
          <option value="browser-operator">browser-operator</option>
          <option value="developer">developer</option>
          <option value="analyst">analyst</option>
          <option value="sales">sales</option>
          <option value="operations">operations</option>
        </select>
        <input
          value={requiredExpertise}
          onChange={(event) => setRequiredExpertise(event.target.value)}
          placeholder="필요 기술: research, analytics"
        />
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="완료 기준과 필요한 산출물을 적으세요."
        />
        <button className="primary-button" disabled={!title.trim()} onClick={() => void createTaskNow()}>
          카드 추가
        </button>
      </div>

      <div className="kanban-board">
        {columns.map((column) => {
          const items = visibleTasks.filter((task) => task.status === column.status);
          return (
            <div className={"kanban-column column-" + column.status} key={column.status}>
              <div className="kanban-column-head">
                <strong>{column.label}</strong>
                <span>{items.length}</span>
              </div>
              <div className="kanban-cards">
                {items.map((task) => {
                  const assignee = agents.find((agent) => agent.id === task.assigneeId);
                  const reviewer = agents.find((agent) => agent.id === task.reviewerId);
                  return (
                    <article className="task-card" key={task.id}>
                      <div className="task-card-top">
                        <span className={"priority priority-" + task.priority}>{task.priority}</span>
                        <select
                          value={task.status}
                          onChange={(event) =>
                            void patchTask(task.id, {
                              status: event.target.value as KanbanTaskStatus
                            })
                          }
                        >
                          {columns.map((candidate) => (
                            <option key={candidate.status} value={candidate.status}>
                              {candidate.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <h3>{task.title}</h3>
                      {task.description && <p>{task.description}</p>}
                      <div className="task-tags">
                        {task.requiredSpecialty && <span>{task.requiredSpecialty}</span>}
                        {task.requiredExpertise.map((skill) => <span key={skill}>{skill}</span>)}
                      </div>
                      <div className="task-assignment">
                        <span>담당</span>
                        <strong>{assignee?.name ?? "자동배정"}</strong>
                        {reviewer && <small>리뷰 {reviewer.name}</small>}
                      </div>
                      {task.result && <div className="task-result">{task.result.slice(0, 220)}</div>}
                      <div className="task-actions">
                        {["backlog", "todo", "blocked"].includes(task.status) && (
                          <button
                            className="secondary-button"
                            disabled={busyTask === task.id}
                            onClick={() => void dispatch(task)}
                          >
                            {busyTask === task.id ? "실행중…" : "전문가 배정 · 실행"}
                          </button>
                        )}
                        {task.status === "review" && (
                          <>
                            <button className="primary-button" onClick={() => void review(task, true)}>승인</button>
                            <button className="danger-button" onClick={() => void review(task, false)}>반려</button>
                          </>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
