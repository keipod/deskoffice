/**
 * The fake plugin server's profile config routes (`/deskrpg/config`, `/deskrpg/toolsets`) —
 * **test only**. Mirrors the real plugin: GET reports the enabled list as `enabledToolsets`
 * (config `platform_toolsets.api_server`, which can also hold MCP server names); PUT's
 * `enabledToolsets` replaces the built-in names (400 on an unknown one) and keeps the other
 * entries, while PUT's `toolsets` only sets the legacy top-level key that no runtime reads.
 *
 * Plugin toolsets (`deskrpg`) are on while absent from the stored list, until a PUT records them
 * as known — after that only the stored list counts. So the `/toolsets` rows (effective state)
 * can differ from the stored list, and saving the stored list would turn the plugin toolset off.
 */
import type { ToolsetRow } from "./plugin-client-types";

export type FakeConfigState = {
  /** Built-in toolset names the picker knows about. */
  known: string[];
  /** Plugin toolset names: on by default until a PUT records them as known. */
  plugin: string[];
  /** Set by the first `enabledToolsets` PUT (`known_plugin_toolsets`). */
  pluginsRecorded: boolean;
  /** `platform_toolsets.api_server`: enabled built-ins plus any MCP server names. */
  enabled: string[];
  /** The legacy top-level `toolsets` key (null = unset). */
  legacyToolsets: string[] | null;
  /** Every PUT body received, in order. */
  puts: Record<string, unknown>[];
  /** When set, PUT answers 409 `config_unreadable` without applying anything. */
  rejectPuts: boolean;
};

type Req = { method: string; pathname: string; json: unknown };
type Reply = { status: number; body: unknown };

export function createFakeConfigState(): FakeConfigState {
  const known = [
    "a2a",
    "browser",
    "code_execution",
    "computer_use",
    "connections",
    "context_engine",
    "cronjob",
    "delegation",
    "file",
    "image_gen",
    "kanban",
    "memory",
    "session_search",
    "skills",
    "terminal",
    "todo",
    "video",
    "vision",
    "web",
  ];
  return {
    known,
    plugin: ["deskrpg"],
    pluginsRecorded: false,
    enabled: [...known],
    legacyToolsets: null,
    puts: [],
    rejectPuts: false,
  };
}

/** The toolsets that are really on, in `/toolsets` row order. */
export function effectiveEnabled(state: FakeConfigState): string[] {
  return [
    ...state.known.filter((n) => state.enabled.includes(n)),
    ...state.plugin.filter((n) => state.enabled.includes(n) || !state.pluginsRecorded),
  ];
}

const isStringList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

export function routeConfig(state: FakeConfigState, req: Req): Reply | null {
  if (req.pathname === "/deskrpg/toolsets" && req.method === "GET") {
    const on = new Set(effectiveEnabled(state));
    const toolsets: ToolsetRow[] = [...state.known, ...state.plugin].map((name) => ({
      name,
      label: name,
      description: "",
      enabled: on.has(name),
      configured: null,
    }));
    return { status: 200, body: { platform: "api_server", toolsets } };
  }
  if (req.pathname !== "/deskrpg/config") return null;
  if (req.method === "GET") {
    return {
      status: 200,
      body: {
        model: "gemma",
        provider: "custom",
        baseUrl: null,
        toolsets: state.legacyToolsets,
        reasoning_effort: null,
        enabledToolsets: [...state.enabled],
        disabledSkills: [],
      },
    };
  }
  if (req.method !== "PUT") return { status: 405, body: { error: "method_not_allowed" } };
  const body = (req.json ?? {}) as Record<string, unknown>;
  state.puts.push(body);
  if (state.rejectPuts)
    return { status: 409, body: { error: "config_unreadable", reason: "config.yaml is invalid" } };
  if ("toolsets" in body) {
    if (!isStringList(body.toolsets))
      return { status: 400, body: { error: "toolsets must be a list of strings" } };
    state.legacyToolsets = body.toolsets;
  }
  if ("enabledToolsets" in body) {
    if (!isStringList(body.enabledToolsets))
      return { status: 400, body: { error: "enabledToolsets must be a list of strings" } };
    const names = [...state.known, ...state.plugin];
    const unknown = body.enabledToolsets.filter((n) => !names.includes(n));
    if (unknown.length > 0)
      return { status: 400, body: { error: `unknown toolsets: ${unknown.sort().join(", ")}` } };
    const preserved = state.enabled.filter((n) => !names.includes(n));
    state.pluginsRecorded = true;
    state.enabled = [...new Set([...body.enabledToolsets, ...preserved])].sort();
  }
  return { status: 200, body: { applied: Object.keys(body).sort(), restartMayBeRequired: true } };
}
