"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Agent, Meeting } from "../shared/types";
import { api } from "./api";

export default function MeetingsPage({ agents }: { agents: Agent[] }) {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [title, setTitle] = useState("");
  const [agenda, setAgenda] = useState("");
  const [participants, setParticipants] = useState<string[]>([]);
  const [maxTurns, setMaxTurns] = useState(10);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const data = await api<{ meetings: Meeting[] }>("/api/meetings");
    setMeetings(data.meetings);
  }, []);

  useEffect(() => {
    void refresh();
    const stream = new EventSource("/api/events");
    stream.addEventListener("meetings", () => void refresh());
    stream.addEventListener("agents", () => void refresh());
    return () => stream.close();
  }, [refresh]);

  const active = useMemo(
    () => meetings.filter((meeting) => meeting.status === "active"),
    [meetings]
  );

  async function createAndStart() {
    if (!title.trim() || participants.length === 0) return;
    const meeting = await api<Meeting>("/api/meetings", {
      method: "POST",
      body: JSON.stringify({
        title,
        participantIds: participants,
        agenda: agenda
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean),
        maxTurns
      })
    });
    await api(`/api/meetings/${meeting.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "active" })
    });
    setTitle("");
    setAgenda("");
    setParticipants([]);
    await refresh();
  }

  async function action(meeting: Meeting, kind: "step" | "summarize" | "done") {
    setBusy(meeting.id);
    try {
      if (kind === "done") {
        await api(`/api/meetings/${meeting.id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "done" })
        });
      } else {
        await api(`/api/meetings/${meeting.id}/${kind}`, { method: "POST" });
      }
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  return (
    <section className="work-page">
      <div className="work-page-head">
        <div>
          <span className="eyebrow">MEETING MODE</span>
          <h1>Meetings</h1>
          <p>참석자는 일반 채팅이 아니라 회의 모드로 발언합니다. 최근 발언을 읽고 중복을 피하면서 결론으로 수렴합니다.</p>
        </div>
      </div>

      <div className="meeting-page-grid">
        <div className="work-card meeting-create-card">
          <span className="eyebrow">NEW MEETING</span>
          <div className="form-stack">
            <label>주제<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="이번 주 콘텐츠 배포 전략" /></label>
            <label>Agenda<textarea value={agenda} onChange={(e) => setAgenda(e.target.value)} placeholder={"한 줄에 하나\n예: 성과 리뷰\n예: 다음 액션"} /></label>
            <label>최대 발언 수<input type="number" min={1} max={50} value={maxTurns} onChange={(e) => setMaxTurns(Number(e.target.value))} /></label>
            <div className="participant-picker">
              {agents.map((agent) => (
                <label key={agent.id}>
                  <input
                    type="checkbox"
                    checked={participants.includes(agent.id)}
                    onChange={(event) =>
                      setParticipants((current) =>
                        event.target.checked
                          ? [...current, agent.id]
                          : current.filter((id) => id !== agent.id)
                      )
                    }
                  />
                  <span>
                    <strong>{agent.name}</strong>
                    <small>{agent.profession} · {agent.specialty}</small>
                  </span>
                </label>
              ))}
            </div>
            <button className="primary-button" disabled={!title.trim() || participants.length === 0} onClick={() => void createAndStart()}>
              회의 시작
            </button>
          </div>
        </div>

        <div className="meeting-list">
          {active.map((meeting) => {
            const nextAgent =
              meeting.participantIds.length > 0
                ? agents.find(
                    (agent) =>
                      agent.id ===
                      meeting.participantIds[meeting.currentSpeakerIndex % meeting.participantIds.length]
                  )
                : null;
            return (
              <article className="meeting-session-card active" key={meeting.id}>
                <div className="meeting-session-head">
                  <div>
                    <span className="eyebrow">LIVE SESSION</span>
                    <h2>{meeting.title}</h2>
                  </div>
                  <span className="turn-counter">{meeting.turnCount}/{meeting.maxTurns}</span>
                </div>

                {meeting.agenda.length > 0 && (
                  <div className="agenda-list">
                    {meeting.agenda.map((item, index) => <span key={index}>{index + 1}. {item}</span>)}
                  </div>
                )}

                <div className="meeting-next">
                  다음 발언 <strong>{nextAgent?.name ?? "-"}</strong>
                  {nextAgent && <small>{nextAgent.profession}</small>}
                </div>

                <div className="meeting-transcript">
                  {meeting.transcript.map((message) => (
                    <div key={message.id}>
                      <strong>{message.speakerName}</strong>
                      <p>{message.content}</p>
                    </div>
                  ))}
                  {meeting.transcript.length === 0 && <div className="empty-state">아직 발언이 없습니다.</div>}
                </div>

                {(meeting.decisions.length > 0 || meeting.actionItems.length > 0) && (
                  <div className="meeting-outcome">
                    <div>
                      <strong>Decisions</strong>
                      {meeting.decisions.map((item, index) => <span key={index}>• {item}</span>)}
                    </div>
                    <div>
                      <strong>Actions</strong>
                      {meeting.actionItems.map((item, index) => <span key={index}>• {item}</span>)}
                    </div>
                  </div>
                )}

                <div className="task-actions">
                  <button className="primary-button" disabled={busy === meeting.id} onClick={() => void action(meeting, "step")}>
                    다음 발언
                  </button>
                  <button className="secondary-button" disabled={busy === meeting.id || meeting.transcript.length === 0} onClick={() => void action(meeting, "summarize")}>
                    회의록 정리
                  </button>
                  <button className="danger-button" onClick={() => void action(meeting, "done")}>회의 종료</button>
                </div>
              </article>
            );
          })}

          {meetings.filter((meeting) => meeting.status === "done").slice(0, 8).map((meeting) => (
            <article className="meeting-session-card" key={meeting.id}>
              <div className="meeting-session-head">
                <div>
                  <span className="eyebrow">ARCHIVE</span>
                  <h3>{meeting.title}</h3>
                </div>
                <small>{meeting.transcript.length} turns</small>
              </div>
              {meeting.notes && <p className="meeting-notes">{meeting.notes}</p>}
            </article>
          ))}

          {meetings.length === 0 && <div className="empty-state">회의 이력이 없습니다.</div>}
        </div>
      </div>
    </section>
  );
}
