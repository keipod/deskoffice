import type { HermesProfile, HermesProfileStatus } from "../../src/shared/types.js";

type HermesRunResult = {
  text: string;
  runId: string;
};

function tokenFor(profile: Pick<HermesProfile, "tokenEnv">) {
  return process.env[profile.tokenEnv]?.trim() || process.env.HERMES_API_KEY?.trim() || "";
}

function urlFor(profile: Pick<HermesProfile, "baseUrl" | "profileName">, path: string) {
  const base = profile.baseUrl.replace(/\/$/, "");
  const prefix =
    profile.profileName && profile.profileName !== "default"
      ? `/p/${encodeURIComponent(profile.profileName)}`
      : "";
  return base + prefix + path;
}

function headersFor(profile: Pick<HermesProfile, "tokenEnv">, json = false) {
  const headers: Record<string, string> = { accept: "application/json, text/event-stream" };
  const token = tokenFor(profile);
  if (token) headers.authorization = `Bearer ${token}`;
  if (json) headers["content-type"] = "application/json";
  return headers;
}

async function request(
  profile: Pick<HermesProfile, "baseUrl" | "profileName" | "tokenEnv">,
  path: string,
  init?: RequestInit,
  timeoutMs = 15000
) {
  const response = await fetch(urlFor(profile, path), {
    ...init,
    headers: { ...headersFor(profile, Boolean(init?.body)), ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw Object.assign(new Error(text || `Hermes HTTP ${response.status}`), {
      status: response.status
    });
  }
  return response;
}

export async function hermesStatus() {
  const baseUrl = process.env.HERMES_API_URL?.replace(/\/$/, "");
  if (!baseUrl) {
    return { available: false, configured: false, detail: "HERMES_API_URL 미설정" };
  }

  const profile: Pick<HermesProfile, "baseUrl" | "profileName" | "tokenEnv"> = {
    baseUrl,
    profileName: "default",
    tokenEnv: "HERMES_API_KEY"
  };

  try {
    await request(profile, "/v1/capabilities", { method: "GET" }, 5000);
    return { available: true, configured: true, detail: "connected" };
  } catch (error) {
    return {
      available: false,
      configured: true,
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function validateHermesProfileConnection(profile: HermesProfile): Promise<{
  status: HermesProfileStatus;
  capabilities?: unknown;
  error?: string;
}> {
  try {
    const response = await request(profile, "/v1/capabilities", { method: "GET" }, 8000);
    return { status: "valid", capabilities: await response.json() };
  } catch (error) {
    const status = Number((error as { status?: number })?.status ?? 0);
    if (status === 401 || status === 403) {
      return {
        status: "unauthorized",
        error: error instanceof Error ? error.message : String(error)
      };
    }
    if (status === 404) {
      return {
        status: "error",
        error: "Hermes profile not found on the configured gateway"
      };
    }
    if (!status) {
      return {
        status: "unreachable",
        error: error instanceof Error ? error.message : String(error)
      };
    }
    return {
      status: "error",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function parseSseBlock(block: string) {
  let event = "message";
  const data: string[] = [];
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trim());
  }
  if (!data.length) return null;
  const text = data.join("\n");
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    payload = { content: text };
  }
  return { event, data: payload };
}

function isTerminal(event: string) {
  return [
    "run.completed",
    "run.failed",
    "assistant.completed",
    "message.completed",
    "done",
    "error"
  ].includes(event);
}

async function readHermesSse(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";
  let completed = "";
  let failure = "";

  outer: for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    for (;;) {
      const boundary = buffer.search(/\r?\n\r?\n/);
      if (boundary < 0) break;
      const block = buffer.slice(0, boundary);
      const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0] ?? "\n\n";
      buffer = buffer.slice(boundary + separator.length);
      const parsed = parseSseBlock(block);
      if (!parsed) continue;

      const delta = parsed.data.delta;
      const content = parsed.data.content;
      const output = parsed.data.output;
      const error = parsed.data.error;
      const message = parsed.data.message;

      if (
        (parsed.event === "assistant.delta" || parsed.event === "message.delta") &&
        typeof delta === "string"
      ) {
        accumulated += delta;
      }
      if (
        (parsed.event === "assistant.completed" || parsed.event === "message.completed") &&
        typeof content === "string"
      ) {
        completed = content;
      }
      if (
        parsed.event === "run.completed" &&
        typeof output === "string" &&
        output.trim()
      ) {
        completed = output;
      }
      if (parsed.event === "run.failed" || parsed.event === "error") {
        failure =
          typeof message === "string"
            ? message
            : typeof error === "string"
              ? error
              : "Hermes run failed";
      }

      if (isTerminal(parsed.event)) {
        void reader.cancel().catch(() => {});
        break outer;
      }
    }
  }

  if (failure) throw new Error(failure);
  return (completed || accumulated).trim();
}

export async function runHermesText(
  profile: HermesProfile,
  input: string,
  instructions?: string,
  sessionKey?: string
): Promise<HermesRunResult> {
  const body: Record<string, unknown> = { input };
  if (instructions) body.instructions = instructions;

  const runResponse = await request(
    profile,
    "/v1/runs",
    {
      method: "POST",
      headers: sessionKey ? { "X-Hermes-Session-Key": sessionKey } : undefined,
      body: JSON.stringify(body)
    },
    15000
  );
  const run = (await runResponse.json()) as { run_id?: string };
  if (!run.run_id) throw new Error("hermes_missing_run_id");

  const events = await request(
    profile,
    `/v1/runs/${encodeURIComponent(run.run_id)}/events`,
    {
      method: "GET",
      headers: sessionKey ? { "X-Hermes-Session-Key": sessionKey } : undefined
    },
    120000
  );

  return {
    text: await readHermesSse(events),
    runId: run.run_id
  };
}
