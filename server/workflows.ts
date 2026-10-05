import { randomUUID } from "node:crypto";
import type { MeetingMessage } from "../src/shared/types.js";
import {
  appendMeetingMessage,
  createTaskRun,
  finishTaskRun,
  getMeeting,
  getTask,
  listAgents,
  updateMeeting,
  updateTask
} from "./db.js";
import { executeAgentTask, type RuntimeEventEmitter } from "./executor.js";
import { recommendExperts } from "./expert-system.js";

export async function dispatchTask(
  taskId: string,
  emit?: RuntimeEventEmitter,
  preferredAgentId?: string | null
) {
  const task = getTask(taskId);
  if (!task) throw new Error("task_not_found");
  if (task.status === "done") throw new Error("task_already_done");
  if (task.status === "in_progress") throw new Error("task_already_running");

  const agents = listAgents();
  let assignee = preferredAgentId
    ? agents.find((agent) => agent.id === preferredAgentId) ?? null
    : task.assigneeId
      ? agents.find((agent) => agent.id === task.assigneeId) ?? null
      : null;

  let recommendation = null;
  if (!assignee) {
    recommendation = recommendExperts(
      agents,
      task.requiredSpecialty,
      task.requiredExpertise,
      3
    );
    assignee = recommendation[0]?.agent ?? null;
  }
  if (!assignee) throw new Error("no_available_expert");

  let reviewerId = task.reviewerId;
  const needsReviewer = task.priority === "high" || task.priority === "urgent";
  if (reviewerId === assignee.id || (!reviewerId && needsReviewer)) {
    const manager =
      assignee.managerId
        ? agents.find(
            (agent) =>
              agent.id === assignee!.managerId &&
              agent.id !== assignee!.id &&
              agent.status !== "offline"
          )
        : null;
    const reviewer =
      manager ??
      recommendExperts(
        agents.filter((agent) => agent.id !== assignee!.id),
        task.requiredSpecialty,
        task.requiredExpertise,
        1
      )[0]?.agent;
    reviewerId = reviewer?.id ?? null;
  }

  updateTask(task.id, {
    assigneeId: assignee.id,
    reviewerId,
    status: "in_progress"
  });
  emit?.("kanban", {
    reason: "dispatched",
    taskId: task.id,
    agentId: assignee.id,
    recommendation: recommendation?.map((item) => ({
      agentId: item.agent.id,
      score: item.score,
      reasons: item.reasons
    }))
  });

  const run = createTaskRun(task.id, assignee);
  try {
    const projectContext = [
      `Kanban task: ${task.title}`,
      task.description ? `Description: ${task.description}` : "",
      task.requiredExpertise.length
        ? `Required expertise: ${task.requiredExpertise.join(", ")}`
        : "",
      task.dueAt ? `Due: ${task.dueAt}` : ""
    ]
      .filter(Boolean)
      .join("\n");

    const result = await executeAgentTask(
      assignee.id,
      task.description || task.title,
      {
        emit,
        context: projectContext
      }
    );

    const finishedRun = finishTaskRun(run.id, { result: result.text });
    const fresh = getTask(task.id);
    const nextStatus = fresh?.reviewerId ? "review" : "done";
    const updated = updateTask(task.id, {
      status: nextStatus,
      result: result.text
    });
    emit?.("kanban", {
      reason: nextStatus === "review" ? "awaiting_review" : "completed",
      taskId: task.id,
      agentId: assignee.id
    });
    return { task: updated, run: finishedRun, assignee };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    finishTaskRun(run.id, { error: message });
    updateTask(task.id, { status: "blocked", result: message });
    emit?.("kanban", { reason: "blocked", taskId: task.id, error: message });
    throw error;
  }
}

export function reviewTask(taskId: string, approved: boolean, note?: string) {
  const task = getTask(taskId);
  if (!task) throw new Error("task_not_found");
  if (task.status !== "review") throw new Error("task_not_in_review");
  return updateTask(taskId, {
    status: approved ? "done" : "blocked",
    result: [task.result, note?.trim()].filter(Boolean).join("\n\n")
  });
}

function meetingContext(meetingId: string) {
  const meeting = getMeeting(meetingId);
  if (!meeting) return "";
  const recent = meeting.transcript.slice(-10);
  return [
    `Meeting: ${meeting.title}`,
    meeting.agenda.length ? `Agenda: ${meeting.agenda.join(" / ")}` : "",
    recent.length
      ? [
          "Recent transcript:",
          ...recent.map((message) => `[${message.speakerName}] ${message.content}`)
        ].join("\n")
      : "No one has spoken yet.",
    meeting.decisions.length ? `Current decisions: ${meeting.decisions.join("; ")}` : "",
    "Meeting mode rules: read previous speakers, do not repeat them, address disagreements directly, be concise, and move toward a decision."
  ]
    .filter(Boolean)
    .join("\n");
}

export async function runMeetingTurn(meetingId: string, emit?: RuntimeEventEmitter) {
  const meeting = getMeeting(meetingId);
  if (!meeting) throw new Error("meeting_not_found");
  if (meeting.status !== "active") throw new Error("meeting_not_active");
  if (!meeting.participantIds.length) throw new Error("meeting_has_no_participants");
  if (meeting.turnCount >= meeting.maxTurns) throw new Error("meeting_turn_limit_reached");

  const agentId = meeting.participantIds[meeting.currentSpeakerIndex % meeting.participantIds.length];
  const agent = listAgents().find((candidate) => candidate.id === agentId);
  if (!agent) throw new Error("meeting_participant_not_found");

  const result = await executeAgentTask(
    agent.id,
    `회의 주제 "${meeting.title}"에 대해 지금 당신이 해야 할 핵심 발언을 하세요. 2~5문장으로 말하고, 필요한 경우 다른 참석자의 이름을 직접 언급하세요.`,
    {
      emit,
      context: meetingContext(meeting.id),
      sessionKey: `deskoffice-meeting-${meeting.id}`,
      keepMeetingState: true
    }
  );

  const message: MeetingMessage = {
    id: randomUUID(),
    agentId: agent.id,
    speakerName: agent.name,
    content: result.text,
    createdAt: new Date().toISOString()
  };
  const updated = appendMeetingMessage(meeting.id, message);
  emit?.("meetings", {
    reason: "turn",
    meetingId: meeting.id,
    agentId: agent.id,
    turnCount: updated?.turnCount
  });

  if (updated && updated.turnCount >= updated.maxTurns) {
    updateMeeting(meeting.id, { status: "done" });
    emit?.("meetings", { reason: "turn_limit_done", meetingId: meeting.id });
  }

  return { meeting: getMeeting(meeting.id), message };
}

export async function summarizeMeeting(meetingId: string, emit?: RuntimeEventEmitter) {
  const meeting = getMeeting(meetingId);
  if (!meeting) throw new Error("meeting_not_found");
  if (!meeting.transcript.length) throw new Error("meeting_has_no_transcript");

  const agents = listAgents();
  const facilitator =
    agents.find(
      (agent) => meeting.participantIds.includes(agent.id) && agent.specialty === "executive"
    ) ??
    agents.find((agent) => meeting.participantIds.includes(agent.id));

  if (!facilitator) throw new Error("meeting_facilitator_not_found");

  const transcript = meeting.transcript
    .map((message) => `[${message.speakerName}] ${message.content}`)
    .join("\n");

  const result = await executeAgentTask(
    facilitator.id,
    [
      "아래 회의를 정리하세요.",
      "형식은 정확히 다음 3개 섹션으로 작성합니다:",
      "DECISIONS:",
      "- 결정사항",
      "ACTIONS:",
      "- 액션아이템",
      "SUMMARY:",
      "- 한 문단 요약",
      "",
      transcript
    ].join("\n"),
    {
      emit,
      context: `Meeting: ${meeting.title}`,
      keepMeetingState: meeting.status === "active"
    }
  );

  const decisions = extractBullets(result.text, "DECISIONS:", "ACTIONS:");
  const actions = extractBullets(result.text, "ACTIONS:", "SUMMARY:");
  const updated = updateMeeting(meeting.id, {
    decisions,
    actionItems: actions,
    notes: result.text
  });
  emit?.("meetings", { reason: "summarized", meetingId: meeting.id });
  return updated;
}

function extractBullets(text: string, start: string, end: string) {
  const startIndex = text.indexOf(start);
  if (startIndex < 0) return [];
  const after = text.slice(startIndex + start.length);
  const endIndex = after.indexOf(end);
  const block = endIndex >= 0 ? after.slice(0, endIndex) : after;
  return block
    .split("\n")
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean);
}
