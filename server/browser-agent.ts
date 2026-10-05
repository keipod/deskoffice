import { bside } from "./adapters/bside.js";
import { runOpenCode } from "./adapters/opencode.js";

type Decision =
  | { action: "navigate"; url: string }
  | { action: "click"; target: string }
  | { action: "type"; target: string; text: string }
  | { action: "key"; keyCode: string }
  | { action: "finish"; result: string };

function extractJson(text: string): Decision {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const source = fenced ?? text.trim();
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("browser_agent_invalid_decision");
  return JSON.parse(source.slice(start, end + 1)) as Decision;
}

function findUrl(task: string) {
  return task.match(/https?:\/\/[^\s)\]}>"']+/i)?.[0] ?? null;
}

export async function runBrowserAgent(task: string, profileId: string, maxSteps = 8) {
  await bside.activateProfile(profileId);
  const state = (await bside.state()) as {
    activeTabId?: string;
    tabs?: Array<{ id: string; profileId: string; url?: string; title?: string }>;
  };

  let tabId =
    state.tabs?.find((tab) => tab.profileId === profileId && tab.id === state.activeTabId)?.id ??
    state.tabs?.find((tab) => tab.profileId === profileId)?.id;

  const directUrl = findUrl(task);
  if (!tabId) {
    const tab = (await bside.createTab(profileId, directUrl ?? "about:blank")) as { id: string };
    tabId = tab.id;
  } else if (directUrl) {
    await bside.navigate(tabId, directUrl);
  }

  for (let step = 0; step < maxSteps; step++) {
    const snapshot = await bside.snapshot(tabId);
    const snapshotText = JSON.stringify(snapshot).slice(0, 18000);

    const decisionText = await runOpenCode(
      [
        "You control a browser through Bside accessibility references.",
        "Return ONLY one JSON object. Allowed actions:",
        '{"action":"navigate","url":"https://..."}',
        '{"action":"click","target":"a1"}',
        '{"action":"type","target":"a2","text":"..."}',
        '{"action":"key","keyCode":"ENTER"}',
        '{"action":"finish","result":"..."}',
        "Never invent a target that does not exist in the snapshot.",
        "If the task is complete, finish.",
        "",
        `TASK: ${task}`,
        "",
        `SNAPSHOT: ${snapshotText}`
      ].join("\n"),
      "브라우저 오퍼레이터"
    );

    const decision = extractJson(decisionText.text);

    if (decision.action === "finish") {
      return { ok: true, result: decision.result, steps: step + 1, tabId };
    }
    if (decision.action === "navigate") await bside.navigate(tabId, decision.url);
    if (decision.action === "click") {
      const result = await bside.click(tabId, decision.target);
      if ((result as { status?: string })?.status === "pending_approval") {
        return { ok: false, status: "pending_approval", result, steps: step + 1, tabId };
      }
    }
    if (decision.action === "type") {
      const result = await bside.type(tabId, decision.target, decision.text);
      if ((result as { status?: string })?.status === "pending_approval") {
        return { ok: false, status: "pending_approval", result, steps: step + 1, tabId };
      }
    }
    if (decision.action === "key") await bside.key(tabId, decision.keyCode);
  }

  return { ok: false, status: "max_steps", steps: maxSteps, tabId };
}

export { extractJson };
