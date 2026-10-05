"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Agent, HermesProfile, Specialty } from "../shared/types";
import { api } from "./api";

export default function PeoplePage({
  agents,
  onEdit,
  onNew,
  onRefresh
}: {
  agents: Agent[];
  onEdit: (agent: Agent) => void;
  onNew: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [profiles, setProfiles] = useState<HermesProfile[]>([]);
  const [profileName, setProfileName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:8642");
  const [tokenEnv, setTokenEnv] = useState("HERMES_API_KEY");
  const [requiredSpecialty, setRequiredSpecialty] = useState<Specialty | "">("");
  const [requiredSkills, setRequiredSkills] = useState("");
  const [recommendations, setRecommendations] = useState<
    Array<{ agentId: string; name: string; score: number; reasons: string[] }>
  >([]);

  const refreshProfiles = useCallback(async () => {
    const data = await api<{ profiles: HermesProfile[] }>("/api/hermes/profiles");
    setProfiles(data.profiles);
  }, []);

  useEffect(() => {
    void refreshProfiles();
    const stream = new EventSource("/api/events");
    stream.addEventListener("hermes", () => void refreshProfiles());
    return () => stream.close();
  }, [refreshProfiles]);

  const departments = useMemo(() => {
    const map = new Map<string, Agent[]>();
    for (const agent of agents) {
      const bucket = map.get(agent.department) ?? [];
      bucket.push(agent);
      map.set(agent.department, bucket);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [agents]);

  async function createProfile() {
    if (!profileName.trim()) return;
    await api("/api/hermes/profiles", {
      method: "POST",
      body: JSON.stringify({
        profileName,
        displayName,
        baseUrl,
        tokenEnv
      })
    });
    setProfileName("");
    setDisplayName("");
    await refreshProfiles();
  }

  async function validate(profile: HermesProfile) {
    await api(`/api/hermes/profiles/${profile.id}/validate`, { method: "POST" });
    await refreshProfiles();
  }

  async function removeProfile(profile: HermesProfile) {
    if (!confirm(`${profile.displayName} Hermes profile을 삭제할까요?`)) return;
    await api(`/api/hermes/profiles/${profile.id}`, { method: "DELETE" });
    await Promise.all([refreshProfiles(), onRefresh()]);
  }

  async function recommend() {
    const data = await api<{
      recommendations: Array<{ agentId: string; name: string; score: number; reasons: string[] }>;
    }>("/api/expertise/recommend", {
      method: "POST",
      body: JSON.stringify({
        requiredSpecialty: requiredSpecialty || null,
        requiredExpertise: requiredSkills
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      })
    });
    setRecommendations(data.recommendations);
  }

  return (
    <section className="work-page">
      <div className="work-page-head">
        <div>
          <span className="eyebrow">ORGANIZATION & EXPERT SYSTEM</span>
          <h1>People</h1>
          <p>직원은 단순 persona가 아니라 조직 위치, 직종, 전문기술, 책임, 실행기와 Hermes identity를 가진 업무 주체입니다.</p>
        </div>
        <button className="primary-button" onClick={onNew}>+ 직원 채용</button>
      </div>

      <div className="people-layout">
        <div className="people-main">
          {departments.map(([department, members]) => (
            <section className="department-card" key={department}>
              <div className="department-head">
                <div>
                  <span className="eyebrow">DEPARTMENT</span>
                  <h2>{department}</h2>
                </div>
                <span className="count-badge">{members.length}</span>
              </div>
              <div className="employee-grid">
                {members.map((agent) => {
                  const manager = agents.find((candidate) => candidate.id === agent.managerId);
                  const hermes = profiles.find((profile) => profile.id === agent.hermesProfileId);
                  return (
                    <article className="employee-card" key={agent.id}>
                      <div className="employee-card-head">
                        <div className={"avatar status-" + agent.status}>{agent.name.slice(0, 1)}</div>
                        <div>
                          <strong>{agent.name}</strong>
                          <span>{agent.title}</span>
                          <small>{agent.profession} · {agent.seniority}</small>
                        </div>
                      </div>
                      <div className="employee-line">
                        <span>상사</span>
                        <b>{manager?.name ?? "CEO / root"}</b>
                      </div>
                      <div className="employee-line">
                        <span>실행기</span>
                        <b>{agent.executor}</b>
                      </div>
                      {hermes && (
                        <div className="employee-line">
                          <span>Hermes</span>
                          <b className={"hermes-state " + hermes.status}>{hermes.displayName} · {hermes.status}</b>
                        </div>
                      )}
                      <div className="expertise-bars">
                        {agent.expertise.slice(0, 5).map((item) => (
                          <div key={item.skill}>
                            <span>{item.skill}</span>
                            <i><em style={{ width: `${Math.max(10, item.level * 20)}%` }} /></i>
                            <b>L{item.level}</b>
                          </div>
                        ))}
                      </div>
                      <div className="responsibility-tags">
                        {agent.responsibilities.slice(0, 4).map((item) => <span key={item}>{item}</span>)}
                      </div>
                      <button className="secondary-button full" onClick={() => onEdit(agent)}>직원 상세 / 편집</button>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <aside className="people-side">
          <div className="work-card">
            <span className="eyebrow">EXPERT FINDER</span>
            <h3>업무에 맞는 전문가 찾기</h3>
            <div className="form-stack">
              <select value={requiredSpecialty} onChange={(e) => setRequiredSpecialty(e.target.value as Specialty | "")}>
                <option value="">전문분야 제한 없음</option>
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
              <input value={requiredSkills} onChange={(e) => setRequiredSkills(e.target.value)} placeholder="research, analytics" />
              <button className="secondary-button" onClick={() => void recommend()}>추천</button>
            </div>
            <div className="recommendations">
              {recommendations.map((item, index) => (
                <div key={item.agentId}>
                  <span>#{index + 1}</span>
                  <strong>{item.name}</strong>
                  <b>{item.score}</b>
                  <small>{item.reasons.join(" · ")}</small>
                </div>
              ))}
            </div>
          </div>

          <div className="work-card">
            <span className="eyebrow">HERMES AGENT PROFILES</span>
            <h3>Hermes identity registry</h3>
            <p className="muted-copy">
              DeskRPG 방식처럼 Hermes profile을 직원 정체성으로 1:1 바인딩합니다. 토큰은 DB에 저장하지 않고 환경변수 이름만 저장합니다.
            </p>
            <div className="form-stack">
              <input value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="profile name (예: researcher)" />
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="표시 이름" />
              <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://127.0.0.1:8642" />
              <input value={tokenEnv} onChange={(e) => setTokenEnv(e.target.value)} placeholder="HERMES_API_KEY" />
              <button className="primary-button" disabled={!profileName.trim()} onClick={() => void createProfile()}>Profile 등록</button>
            </div>
            <div className="hermes-profile-list">
              {profiles.map((profile) => {
                const bound = agents.find((agent) => agent.id === profile.boundAgentId);
                return (
                  <div key={profile.id}>
                    <div>
                      <strong>{profile.displayName}</strong>
                      <span>/p/{profile.profileName} · {profile.tokenEnv}</span>
                      <small>{bound ? `→ ${bound.name}` : "미배정"}</small>
                    </div>
                    <span className={"hermes-state " + profile.status}>{profile.status}</span>
                    <div className="mini-actions">
                      <button onClick={() => void validate(profile)}>검증</button>
                      <button onClick={() => void removeProfile(profile)}>삭제</button>
                    </div>
                  </div>
                );
              })}
              {profiles.length === 0 && <div className="empty-state">등록된 Hermes profile이 없습니다.</div>}
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
