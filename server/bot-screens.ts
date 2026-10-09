import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const binary = process.env.HERMES_BIN || `${process.env.HOME || ""}/.local/bin/hermes`;
export type ScreenState = "running" | "stopped" | "missing_packages" | "unavailable" | "unknown";
export interface ScreenStatus {
  ok: boolean;
  state: ScreenState;
  detail: string;
}

export function parseBotScreenStatus(output: string, succeeded = true): ScreenStatus {
  const text = output.trim().slice(0, 1000);
  if (/packages missing|not installed|missing packages/i.test(text)) {
    return { ok: false, state: "missing_packages", detail: text };
  }
  if (/not running|stopped|not started/i.test(text)) return { ok: true, state: "stopped", detail: text };
  if (/running|display.*:|socket:|control holder/i.test(text) && succeeded) {
    return { ok: true, state: "running", detail: text };
  }
  return { ok: false, state: succeeded ? "unknown" : "unavailable", detail: text || "no_status" };
}

function ensureProfile(profile: string): void {
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(profile)) throw new Error("invalid_hermes_profile_name");
}

async function hermesScreen(profile: string, operation: "status" | "start" | "stop") {
  ensureProfile(profile);
  try {
    const result = await exec(binary, ["-p", profile, "computer-use", "screen", operation], {
      timeout: operation === "status" ? 12000 : 45000,
      maxBuffer: 128 * 1024,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", TERM: "dumb" }
    });
    return { text: `${result.stdout}\n${result.stderr}`, success: true };
  } catch (error) {
    const err = error as Error & { stdout?: string; stderr?: string };
    return { text: [err.stdout, err.stderr, err.message].filter(Boolean).join("\n"), success: false };
  }
}

export async function getBotScreenStatus(profile: string): Promise<ScreenStatus> {
  const result = await hermesScreen(profile, "status");
  return parseBotScreenStatus(result.text, result.success);
}

export async function controlBotScreen(profile: string, action: "start" | "stop") {
  if (action === "start") {
    const status = await getBotScreenStatus(profile);
    if (status.state === "missing_packages") return status;
    if (status.state === "running") return status;
  }
  const result = await hermesScreen(profile, action);
  const current = await getBotScreenStatus(profile);
  return { ...current, ok: result.success && current.ok, commandDetail: result.text.slice(0, 450) };
}
