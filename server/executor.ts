import { bsideStatus } from "./adapters/bside.js";
import { runHermesText } from "./adapters/hermes.js";
import { runOpenCode } from "./adapters/opencode.js";
import { runBrowserAgent } from "./browser-agent.js";
import { getAgent, getHermesProfile, updateAgent } from "./db.js";
import { buildExpertInstructions } from "./expert-system.js";

export type RuntimeEventEmitter = (type: string, payload: unknown) => void;

function textFromResult(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "text" in value && typeof value.text === "string") {
    return value.text;
  }
  return JSON.stringify(value, null, 2);
}

export async function executeAgentTask(
  agentId: string,
  task: string,
  options?: {
    forceBrowser?: boolean;
    context?: string;
    sessionKey?: string;
    emit?: RuntimeEventEmitter;
    keepMeetingState?: boolean;
  }
) {
  const agent = getAgent(agentId);
  if (!agent) throw new Error("agent_not_found");
  if (!task.trim()) throw new Error("prompt_required");
  if (agent.status === "offline") throw new Error("agent_offline");
  if (agent.status === "working") throw new Error("agent_busy");
  if (agent.status === "meeting" && !options?.keepMeetingState) {
    throw new Error("agent_in_meeting");
  }

  const previousStatus = agent.status;
  updateAgent(agent.id, { status: "working", currentTask: task.slice(0, 220) });
  options?.emit?.("agents", { reason: "working", agentId: agent.id });

  try {
    const expertPrompt = buildExpertInstructions(agent, task, options?.context);
    let result: unknown;

    if (options?.forceBrowser || agent.executor === "browser") {
      if (!agent.bsideProfileId) throw new Error("bside_profile_required");
      const bside = await bsideStatus();
      if (!bside.available) throw new Error("bside_unavailable");
      result = await runBrowserAgent(expertPrompt, agent.bsideProfileId);
    } else if (agent.executor === "hermes") {
      if (!agent.hermesProfileId) throw new Error("hermes_profile_required");
      const profile = getHermesProfile(agent.hermesProfileId);
      if (!profile) throw new Error("hermes_profile_not_found");
      if (profile.status !== "valid") throw new Error("hermes_profile_not_validated");
      result = await runHermesText(
        profile,
        task,
        buildExpertInstructions(agent, "Follow the assigned task using your specialist role.", options?.context),
        options?.sessionKey
      );
    } else {
      result = await runOpenCode(expertPrompt, agent.profession || agent.title || agent.specialty);
    }

    const nextStatus = options?.keepMeetingState && previousStatus === "meeting" ? "meeting" : "idle";
    updateAgent(agent.id, {
      status: nextStatus,
      currentTask: nextStatus === "meeting" ? agent.currentTask : null
    });
    options?.emit?.("agents", { reason: "completed", agentId: agent.id });
    return {
      agentId: agent.id,
      executor: agent.executor,
      text: textFromResult(result),
      raw: result
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateAgent(agent.id, { status: "blocked", currentTask: message });
    options?.emit?.("agents", { reason: "blocked", agentId: agent.id, error: message });
    throw error;
  }
}
