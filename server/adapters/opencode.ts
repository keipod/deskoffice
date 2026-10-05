import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const binary = process.env.OPENCODE_BIN ?? "opencode";
const model = process.env.OPENCODE_MODEL ?? "opencode/muse-spark-1.3-contributor-free";
const agent = process.env.OPENCODE_AGENT ?? "deskoffice";
const timeoutMs = Number(process.env.OPENCODE_TIMEOUT_MS ?? 120000);

function clean(value: string) {
  return value.replace(/\u001b\[[0-?]*[ -\/]*[@-~]/g, "").trim();
}

export async function opencodeStatus() {
  try {
    const version = await execFileAsync(binary, ["--version"], {
      timeout: 5000,
      maxBuffer: 256 * 1024,
      encoding: "utf8"
    });
    const auth = await execFileAsync(binary, ["auth", "list"], {
      timeout: 5000,
      maxBuffer: 256 * 1024,
      encoding: "utf8"
    }).catch(() => ({ stdout: "", stderr: "" }));
    const authText = clean(String(auth.stdout || auth.stderr));
    const authenticated = !/No authenticated integrations/i.test(authText);
    return {
      available: true,
      version: clean(String(version.stdout || version.stderr)),
      authenticated,
      model
    };
  } catch (error) {
    return {
      available: false,
      version: null,
      authenticated: false,
      model,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function runOpenCode(prompt: string, role?: string) {
  if (!prompt.trim()) throw new Error("prompt_required");
  const status = await opencodeStatus();
  if (!status.available) throw new Error("opencode_unavailable");
  if (!status.authenticated && model.startsWith("opencode/")) throw new Error("opencode_auth_required");

  const finalPrompt = role
    ? `당신의 DeskOffice 담당 역할: ${role}\n해당 역할의 전문가로서 바로 사용할 수 있는 결과를 만들어라.\n\n${prompt}`
    : prompt;

  const result = await execFileAsync(
    binary,
    ["run", "-m", model, "--agent", agent, finalPrompt],
    {
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" }
    }
  );

  const text = clean(String(result.stdout));
  if (!text) throw new Error(clean(String(result.stderr)) || "opencode_empty_response");
  return { text, model, agent };
}
