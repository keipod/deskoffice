"use client";

import { useCallback, useEffect, useState } from "react";
import type { Agent, CronJob, CronRun, Project } from "../shared/types";
import { api } from "./api";

export default function CronPage({ agents }: { agents: Agent[] }) {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [runs, setRuns] = useState<Record<string, CronRun[]>>({});
  const [name, setName] = useState("");
  const [schedule, setSchedule] = useState("0 9 * * *");
  const [timezone, setTimezone] = useState("Asia/Seoul");
  const [agentId, setAgentId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [jobData, projectData] = await Promise.all([
      api<{ jobs: CronJob[] }>("/api/cron/jobs"),
      api<{ projects: Project[] }>("/api/projects")
    ]);
    setJobs(jobData.jobs);
    setProjects(projectData.projects);
    setAgentId((current) => current || agents[0]?.id || "");
  }, [agents]);

  useEffect(() => {
    void refresh();
    const stream = new EventSource("/api/events");
    stream.addEventListener("cron", () => void refresh());
    return () => stream.close();
  }, [refresh]);

  async function createJob() {
    if (!name.trim() || !schedule.trim() || !agentId || !prompt.trim()) return;
    await api("/api/cron/jobs", {
      method: "POST",
      body: JSON.stringify({
        name,
        schedule,
        timezone,
        agentId,
        prompt,
        projectId: projectId || null
      })
    });
    setName("");
    setPrompt("");
    await refresh();
  }

  async function action(job: CronJob, kind: "run" | "pause" | "resume" | "delete") {
    setBusy(job.id);
    try {
      await api(`/api/cron/jobs/${job.id}${kind === "delete" ? "" : "/" + kind}`, {
        method: kind === "delete" ? "DELETE" : "POST"
      });
      if (kind === "run") await loadRuns(job.id);
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  async function loadRuns(jobId: string) {
    const data = await api<{ runs: CronRun[] }>(`/api/cron/jobs/${jobId}/runs?limit=12`);
    setRuns((current) => ({ ...current, [jobId]: data.runs }));
  }

  return (
    <section className="work-page">
      <div className="work-page-head">
        <div>
          <span className="eyebrow">AUTOMATION</span>
          <h1>Cron Jobs</h1>
          <p>정기 업무는 특정 직원에게 귀속됩니다. 실행 이력과 실패 원인을 남기고 즉시 수동 실행도 가능합니다.</p>
        </div>
      </div>

      <div className="cron-layout">
        <div className="work-card">
          <span className="eyebrow">NEW JOB</span>
          <div className="form-stack">
            <label>이름<input value={name} onChange={(e) => setName(e.target.value)} placeholder="아침 트렌드 브리프" /></label>
            <label>CRON<input value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="0 9 * * *" /></label>
            <label>Timezone<input value={timezone} onChange={(e) => setTimezone(e.target.value)} /></label>
            <label>담당 직원
              <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                <option value="">선택</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.name} · {agent.profession}</option>
                ))}
              </select>
            </label>
            <label>프로젝트
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">없음</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
            <label>업무 지시<textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="매일 오전 최근 트렌드를 정리하고..." /></label>
            <button className="primary-button" onClick={() => void createJob()}>Cron 등록</button>
          </div>
        </div>

        <div className="cron-jobs">
          {jobs.map((job) => {
            const agent = agents.find((candidate) => candidate.id === job.agentId);
            const history = runs[job.id] ?? [];
            return (
              <article className="cron-card" key={job.id}>
                <div className="cron-card-head">
                  <div>
                    <strong>{job.name}</strong>
                    <span>{job.schedule} · {job.timezone}</span>
                  </div>
                  <span className={"job-state " + (job.enabled ? "enabled" : "paused")}>
                    {job.enabled ? "ACTIVE" : "PAUSED"}
                  </span>
                </div>
                <p>{job.prompt}</p>
                <div className="cron-meta">
                  <span>담당 <b>{agent?.name ?? "unknown"}</b></span>
                  <span>다음 <b>{job.nextRunAt ? new Date(job.nextRunAt).toLocaleString() : "-"}</b></span>
                  <span>최근 <b>{job.lastRunAt ? new Date(job.lastRunAt).toLocaleString() : "-"}</b></span>
                </div>
                <div className="task-actions">
                  <button className="secondary-button" disabled={busy === job.id} onClick={() => void action(job, "run")}>지금 실행</button>
                  <button className="ghost-button" onClick={() => void action(job, job.enabled ? "pause" : "resume")}>
                    {job.enabled ? "일시정지" : "재개"}
                  </button>
                  <button className="ghost-button" onClick={() => void loadRuns(job.id)}>이력</button>
                  <button className="danger-button" onClick={() => void action(job, "delete")}>삭제</button>
                </div>
                {history.length > 0 && (
                  <div className="run-history">
                    {history.map((run) => (
                      <div key={run.id}>
                        <span className={"run-status " + run.status}>{run.status}</span>
                        <small>{new Date(run.startedAt).toLocaleString()}</small>
                        <p>{run.error ?? run.result ?? "실행 중"}</p>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
          {jobs.length === 0 && <div className="empty-state">등록된 Cron job이 없습니다.</div>}
        </div>
      </div>
    </section>
  );
}
