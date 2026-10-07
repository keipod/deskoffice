/**
 * Public protocol identifiers for a separately deployed Bside browser, plus the small server-side
 * client DeskOffice uses to list/create Bside profiles. DeskOffice never imports or installs Bside.
 */
export const BSIDE_MCP_COMMAND = "deskoffice-bside-mcp";

/** Bside runs on the host; from the DeskOffice container Docker Desktop reaches it here. */
export const BSIDE_DEFAULT_URL = "http://host.docker.internal:27433";

const AGENT_MCP_PATH = "/mcp/agent/";
const BSIDE_TIMEOUT_MS = 5000;

/**
 * Picks the Bside base URL: an explicit override, then `BSIDE_URL`, then the default. The trailing
 * slash is removed. Returns null when the chosen value is not an http(s) URL.
 */
export function resolveBsideBaseUrl(override?: string | null): string | null {
  const chosen = override?.trim() || process.env.BSIDE_URL?.trim() || BSIDE_DEFAULT_URL;
  let url: URL;
  try {
    url = new URL(chosen);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return chosen.replace(/\/+$/, "");
}

/** The profile-pinned Streamable HTTP MCP endpoint Bside serves for one agent. */
export function bsideAgentMcpUrl(baseUrl: string, profileId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${AGENT_MCP_PATH}${encodeURIComponent(profileId)}`;
}

/**
 * Recognizes a Bside personal browser connector: the HTTP agent endpoint (`…/mcp/agent/<profile>`)
 * and, for entries made before it existed, the stdio bridge binary or its bundled entry.
 * A Bside browser is deliberately not copyable: its profile is one NPC's personal browser
 * workspace and must be chosen again for each NPC.
 */
export function isDeskOfficeBsideBridge(command: unknown, args: unknown, url?: unknown): boolean {
  if (typeof url === "string" && url) {
    try {
      if (new URL(url).pathname.includes(AGENT_MCP_PATH)) return true;
    } catch {
      /* not a URL; fall through to the stdio check */
    }
  }
  const pieces = [command, ...(Array.isArray(args) ? args : [])];
  return pieces.some((piece) => {
    if (typeof piece !== "string") return false;
    const normalized = piece.trim().replaceAll("\\", "/").toLowerCase();
    return (
      normalized === BSIDE_MCP_COMMAND ||
      normalized.endsWith("/deskoffice-bside-mcp") ||
      normalized.endsWith("/deskoffice-mcp.js")
    );
  });
}

export type BsideProfile = { id: string; name: string };

/** `bside_unreachable`: no answer (Bside not running, wrong URL, timeout). `bside_error`: Bside answered with an error. */
export class BsideError extends Error {
  readonly code: "bside_unreachable" | "bside_error";
  readonly status: number | null;
  constructor(code: BsideError["code"], message: string, status: number | null = null) {
    super(message);
    this.name = "BsideError";
    this.code = code;
    this.status = status;
  }
}

async function bsideRequest(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl.replace(/\/+$/, "")}${path}`, {
      ...init,
      signal: AbortSignal.timeout(BSIDE_TIMEOUT_MS),
    });
  } catch (e) {
    throw new BsideError("bside_unreachable", e instanceof Error ? e.message : String(e));
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const fields = body && typeof body === "object" ? (body as { message?: unknown; error?: unknown }) : {};
    const message =
      typeof fields.message === "string"
        ? fields.message
        : typeof fields.error === "string"
          ? fields.error
          : `HTTP ${res.status}`;
    throw new BsideError("bside_error", message, res.status);
  }
  return body;
}

const toProfile = (raw: unknown): BsideProfile | null => {
  if (!raw || typeof raw !== "object") return null;
  const { id, name } = raw as { id?: unknown; name?: unknown };
  if (typeof id !== "string" || !id) return null;
  return { id, name: typeof name === "string" && name ? name : id };
};

export async function listBsideProfiles(baseUrl: string): Promise<BsideProfile[]> {
  const body = await bsideRequest(baseUrl, "/profiles");
  if (!Array.isArray(body)) throw new BsideError("bside_error", "Unexpected /profiles response");
  return body.map(toProfile).filter((p): p is BsideProfile => p !== null);
}

export async function createBsideProfile(baseUrl: string, name: string): Promise<BsideProfile> {
  const body = await bsideRequest(baseUrl, "/profiles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const profile = toProfile(body);
  if (!profile) throw new BsideError("bside_error", "Unexpected POST /profiles response");
  return profile;
}
