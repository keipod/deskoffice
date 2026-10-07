/**
 * NPC MCP connector REST (`/api/channels/:id/npcs/:npcId/connectors/**`). One catch-all
 * route dispatches through this table, in the plugin's `routes.py` order (fixed segments
 * before a server name). Permission is decided here; the plugin only checks the profile key.
 * Some routes are DeskRPG's own: the OAuth callback (the pasted URL is parsed here so only
 * `code`/`state`/`iss` reach the plugin), copy (export from this NPC, create on targets), and the
 * one-click Bside browser connect (`bside/profiles`, `bside/connect`).
 */
import { NextResponse, type NextRequest } from "next/server";

import type { BsideConnectResult, CopyResult } from "@/components/connectors/connector-types";
import {
  BSIDE_BROWSER_SKILL_AUTHOR,
  BSIDE_BROWSER_SKILL_NAME,
  BSIDE_BROWSER_SKILL_VERSION,
  bsideBrowserSkillTemplate,
} from "@/components/skills/bside-browser-skill";
import {
  buildBsideMcpConfig,
  BSIDE_MCP_SERVER_NAME,
} from "@/components/connectors/bside-mcp-preset";
import {
  BsideError,
  createBsideProfile,
  isDeskOfficeBsideBridge,
  listBsideProfiles,
  resolveBsideBaseUrl,
  type BsideProfile,
} from "@/lib/bside-mcp";
import {
  resolveConnectorContext,
  requireMcpCapability,
  type ConnectorContext,
} from "@/lib/connector-access";
import { cronError, pluginFailureResponse, resolveNpcProfileClient } from "@/lib/cron-access";
import type { McpAdminApi, McpServerInput, PluginResponse } from "@/lib/hermes/plugin-client-types";
import { getUserId } from "@/lib/internal-rpc";
import { parseOAuthPaste } from "@/lib/mcp-oauth-paste";
import { requireOwner, sharedChannelCount } from "@/lib/skill-access";
import { noSkillManagement, skillFeaturesOf } from "@/lib/skill-features";

type Access = "member" | "owner";
type HandlerArgs = { args: string[]; body: Record<string, unknown>; sp: URLSearchParams };
type Handler = (
  ctx: ConnectorContext,
  a: HandlerArgs,
) => Promise<PluginResponse<unknown> | Response>;
type Row = {
  method: string;
  pattern: string[];
  access: Access;
  handler: Handler;
  okStatus?: number;
};

const str = (v: unknown) => (typeof v === "string" ? v : "");
const strList = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const FIXED = new Set(["servers", "jobs", "oauth", "catalog", "reload", "export", "copy", "bside"]);

async function oauthCallback(
  c: ConnectorContext,
  a: HandlerArgs,
): Promise<PluginResponse<unknown> | Response> {
  const parsed = parseOAuthPaste(str(a.body.redirectUrl));
  if (!parsed.ok) {
    return parsed.reason === "denied"
      ? cronError(400, "oauth_denied", parsed.error ?? "denied")
      : cronError(
          400,
          "oauth_callback_invalid",
          "Paste the full address from the browser after approving",
        );
  }
  const { code, state, iss } = parsed;
  return c.client.mcp.oauthCallback(
    a.args[0],
    iss ? { code, state, iss } : { code, state },
    c.userId,
  );
}

/** What copy carries from one exported server: the create body plus settings applied after create. */
type CopySource = {
  input: McpServerInput;
  toolFilter: { include?: string[]; exclude?: string[] } | null;
  disabled: boolean;
};

const BSIDE_PROFILE_NOT_COPYABLE = "bside_profile_not_copyable";

async function copy(c: ConnectorContext, a: HandlerArgs): Promise<Response> {
  const names = [...new Set(strList(a.body.names))];
  const targets = [...new Set(strList(a.body.targetNpcIds))].filter((id) => id !== c.npcId);
  const exported = new Map<string, CopySource | { code: string }>();
  for (const name of names) {
    const res = await c.client.mcp.exportServer(name);
    if (!res.ok) {
      exported.set(name, { code: res.failure.code });
      continue;
    }
    const entry = res.data.entry;
    exported.set(
      name,
      isDeskOfficeBsideBridge(entry.command, entry.args, entry.url)
        ? { code: BSIDE_PROFILE_NOT_COPYABLE }
        : toCopySource(name, entry),
    );
  }
  const results: CopyResult[] = [];
  for (const npcId of targets) {
    const target = await resolveNpcProfileClient(c.channel, npcId);
    for (const name of names) {
      if (!target.ok) {
        results.push({ npcId, name, ok: false, code: "npc_not_found" });
        continue;
      }
      const src = exported.get(name)!;
      if ("code" in src) {
        results.push({ npcId, name, ok: false, code: src.code });
        continue;
      }
      const code = await copyOne(target.value.client.mcp, name, src, c.userId);
      results.push(code ? { npcId, name, ok: false, code } : { npcId, name, ok: true });
    }
  }
  return NextResponse.json({ results });
}

const bsideFailure = (e: unknown) =>
  e instanceof BsideError
    ? cronError(502, e.code, e.message)
    : cronError(502, "bside_error", e instanceof Error ? e.message : String(e));

const invalidBsideUrl = () =>
  cronError(400, "bside_url_invalid", "Bside URL must be an http(s) address");

/** Bside's profiles as DeskRPG's server reaches them. Unreachable is a normal answer, not an error. */
async function bsideProfiles(_c: ConnectorContext, a: HandlerArgs): Promise<Response> {
  const baseUrl = resolveBsideBaseUrl(a.sp.get("baseUrl"));
  if (!baseUrl) return invalidBsideUrl();
  try {
    return NextResponse.json({ baseUrl, profiles: await listBsideProfiles(baseUrl) });
  } catch (e) {
    const code = e instanceof BsideError ? e.code : "bside_error";
    return NextResponse.json({
      baseUrl,
      error: code,
      message: e instanceof Error ? e.message : "",
    });
  }
}

/**
 * One click: resolve (or create) the Bside profile, point this NPC's `bside` connector at that
 * profile's agent MCP endpoint, install the browser skill, and turn off the NPC's built-in headless
 * browser toolset so browser work goes through Bside. Safe to repeat: an existing profile
 * with the requested name is reused, an existing Bside connector is updated in place, and an
 * installed skill is rewritten only when DeskOffice authored it at a lower version than the
 * current template (a user's own edits are left alone).
 */
async function bsideConnect(c: ConnectorContext, a: HandlerArgs): Promise<Response> {
  const baseUrl = resolveBsideBaseUrl(str(a.body.baseUrl));
  if (!baseUrl) return invalidBsideUrl();
  const profileId = str(a.body.profileId).trim();
  const createName = str(a.body.createProfileName).trim();
  if (!profileId && !createName)
    return cronError(400, "bside_profile_required", "Pick a Bside profile or name a new one");

  let profile: BsideProfile;
  try {
    const profiles = await listBsideProfiles(baseUrl);
    const found = profileId
      ? profiles.find((p) => p.id === profileId)
      : profiles.find((p) => p.name.trim().toLowerCase() === createName.toLowerCase());
    if (found) profile = found;
    else if (profileId)
      return cronError(404, "bside_profile_not_found", `No Bside profile ${profileId}`);
    else profile = await createBsideProfile(baseUrl, createName);
  } catch (e) {
    return bsideFailure(e);
  }

  const input = buildBsideMcpConfig({ profileId: profile.id, baseUrl });
  let connector = await c.client.mcp.create(input, c.userId);
  let alreadyConnected = false;
  if (!connector.ok && connector.failure.code === "name_taken") {
    const existing = await c.client.mcp.detail(BSIDE_MCP_SERVER_NAME);
    if (!existing.ok) return pluginFailureResponse(existing);
    const d = existing.data;
    // Never overwrite an unrelated server someone happened to name `bside`.
    if (!isDeskOfficeBsideBridge(d.command, d.args, d.url)) return pluginFailureResponse(connector);
    if (d.url === input.url) {
      connector = { ok: true, data: d };
      alreadyConnected = true;
    } else {
      connector = await c.client.mcp.update(
        BSIDE_MCP_SERVER_NAME,
        { ...input, baseRevision: d.revision },
        c.userId,
      );
    }
  }
  if (!connector.ok) return pluginFailureResponse(connector);

  return NextResponse.json({
    profile,
    connector: connector.data,
    mcpUrl: input.url,
    alreadyConnected,
    skill: await installBsideSkill(c),
    builtinBrowser: await disableBuiltinBrowser(c),
  });
}

const BUILTIN_BROWSER_TOOLSET = "browser";

/**
 * An NPC with a Bside browser must do its browser work in its own logged-in Bside profile, which
 * Hermes' headless `browser` toolset would bypass. Turns that toolset off and keeps every other
 * toolset that is on right now. The list is built from the plugin's toolset rows (their effective
 * `enabled` flags, as the settings picker does), never from the stored list: Hermes switches on
 * plugin toolsets such as `deskrpg` that are absent from it, and saving the stored list would
 * turn them off. It goes in as `enabledToolsets` — the key the plugin applies to
 * `platform_toolsets` (`toolsets` only sets a legacy key nothing reads). A failure is reported,
 * not fatal.
 */
async function disableBuiltinBrowser(
  c: ConnectorContext,
): Promise<BsideConnectResult["builtinBrowser"]> {
  const rows = await c.client.config.toolsets();
  if (!rows.ok) return { disabled: false, code: rows.failure.code };
  if (!Array.isArray(rows.data.toolsets)) return { disabled: false, code: "malformed_response" };
  const enabled = rows.data.toolsets.filter((t) => t.enabled).map((t) => t.name);
  if (!enabled.includes(BUILTIN_BROWSER_TOOLSET)) return { disabled: true, alreadyDisabled: true };
  const put = await c.client.config.put({
    enabledToolsets: enabled.filter((n) => n !== BUILTIN_BROWSER_TOOLSET),
  });
  if (!put.ok) return { disabled: false, code: put.failure.code };
  return put.data.restartMayBeRequired === true
    ? { disabled: true, restartMayBeRequired: true }
    : { disabled: true };
}

/** The skill is a convenience on top of the connector — a failure here is reported, not fatal. */
async function installBsideSkill(c: ConnectorContext): Promise<BsideConnectResult["skill"]> {
  const features = skillFeaturesOf(c.channel.info.capabilities);
  if (!features.edit)
    return {
      ok: false,
      code: noSkillManagement(features) ? "plugin_upgrade_required" : "skill_feature_unavailable",
    };
  const list = await c.client.skills.list();
  if (list.ok && list.data.skills.some((s) => s.name === BSIDE_BROWSER_SKILL_NAME))
    return refreshBsideSkill(c);
  const created = await c.client.skills.create(
    { name: BSIDE_BROWSER_SKILL_NAME, category: "browser", content: bsideBrowserSkillTemplate() },
    c.userId,
  );
  return created.ok ? { ok: true } : { ok: false, code: created.failure.code };
}

/** `author` and `version` from a SKILL.md's frontmatter, if it has any. */
function skillFrontmatter(content: string): { author?: string; version?: string } {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1] ?? "";
  const field = (key: string) => new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*$`, "m").exec(block)?.[1];
  return { author: field("author"), version: field("version") };
}

/** True only when both are plain `x.y.z` versions and `a` is lower than `b`. */
function semverLower(a: string | undefined, b: string): boolean {
  const parse = (v: string | undefined) =>
    v && /^\d+\.\d+\.\d+$/.test(v) ? v.split(".").map(Number) : null;
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i];
  return false;
}

/**
 * Reconnecting brings an installed DeskOffice playbook up to the current tool set, so template fixes
 * reach every NPC. Only a copy authored by DeskOffice with a lower version is rewritten; a user's
 * own edits (same or newer version, another author) are left alone.
 */
async function refreshBsideSkill(
  c: ConnectorContext,
): Promise<{ ok: boolean; code?: string; alreadyInstalled: true; updated?: true }> {
  const file = await c.client.skills.readFile(BSIDE_BROWSER_SKILL_NAME, "SKILL.md");
  if (!file.ok) return { ok: false, code: file.failure.code, alreadyInstalled: true };
  const installed = skillFrontmatter(file.data.content);
  if (
    installed.author !== BSIDE_BROWSER_SKILL_AUTHOR ||
    !semverLower(installed.version, BSIDE_BROWSER_SKILL_VERSION)
  )
    return { ok: true, alreadyInstalled: true };
  const written = await c.client.skills.writeFile(
    BSIDE_BROWSER_SKILL_NAME,
    { path: "SKILL.md", content: bsideBrowserSkillTemplate(), baseHash: file.data.hash },
    c.userId,
  );
  return written.ok
    ? { ok: true, alreadyInstalled: true, updated: true }
    : { ok: false, code: written.failure.code, alreadyInstalled: true };
}

/** Creates one server on the target, then its tool filter and disabled state. Returns the failure code, if any. */
async function copyOne(
  mcp: McpAdminApi,
  name: string,
  src: CopySource,
  actor: string,
): Promise<string | null> {
  const created = await mcp.create(src.input, actor);
  if (!created.ok) return created.failure.code;
  if (src.toolFilter) {
    const res = await mcp.setTools(
      name,
      { ...src.toolFilter, baseRevision: created.data.revision },
      actor,
    );
    if (!res.ok) return res.failure.code;
  }
  if (src.disabled) {
    const res = await mcp.setEnabled(name, false, actor);
    if (!res.ok) return res.failure.code;
  }
  return null;
}

/** A header value that is only an env reference, optionally after a scheme word (`Bearer ${KEY}`). */
const HEADER_REF = /^(?:[A-Za-z][\w-]* )?\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;

/**
 * Converts an exported Hermes entry to what copy sends. Settings travel; secret values and
 * OAuth tokens do not: env goes as keys only (the plugin stores `${KEY}` references), headers go
 * only when their value is a `${KEY}` reference, and a bearer header is rebuilt by the plugin from
 * the server name. The target must be re-authenticated.
 */
function toCopySource(name: string, e: Record<string, unknown>): CopySource {
  const http = typeof e.url === "string";
  const rawHeaders = (e.headers ?? {}) as Record<string, unknown>;
  const headers = Object.fromEntries(
    Object.entries(rawHeaders).filter(
      (kv): kv is [string, string] => typeof kv[1] === "string" && HEADER_REF.test(kv[1]),
    ),
  );
  const bearer =
    typeof rawHeaders.Authorization === "string" &&
    rawHeaders.Authorization.startsWith("Bearer ${");
  const env = e.env && typeof e.env === "object" ? (e.env as Record<string, string>) : null;
  const tools = (e.tools ?? {}) as Record<string, unknown>;
  const filter = {
    ...(Array.isArray(tools.include) ? { include: strList(tools.include) } : {}),
    ...(Array.isArray(tools.exclude) ? { exclude: strList(tools.exclude) } : {}),
  };
  return {
    input: {
      name,
      transport: http ? "http" : "stdio",
      ...(http
        ? { url: String(e.url), ...(Object.keys(headers).length ? { headers } : {}) }
        : {
            command: str(e.command),
            args: strList(e.args),
            ...(e.cwd ? { cwd: str(e.cwd) } : {}),
          }),
      ...(env ? { env } : {}),
      auth: e.auth === "oauth" ? "oauth" : bearer ? "bearer" : env ? "env" : "none",
      ...(e.trust === "full" || e.trust === "untrusted" ? { trust: e.trust } : {}),
      // Already confirmed on the source NPC.
      confirmName: name,
    },
    toolFilter: Object.keys(filter).length ? filter : null,
    disabled: e.enabled === false,
  };
}

// Table order is match order.
const ROWS: Row[] = [
  { method: "GET", pattern: ["servers"], access: "member", handler: (c) => c.client.mcp.list() },
  {
    method: "POST",
    pattern: ["servers"],
    access: "owner",
    okStatus: 201,
    handler: (c, a) => c.client.mcp.create(a.body as McpServerInput, c.userId),
  },
  {
    method: "GET",
    pattern: ["jobs", "*"],
    access: "owner",
    handler: (c, a) => c.client.mcp.job(a.args[0]),
  },
  { method: "POST", pattern: ["oauth", "*", "callback"], access: "owner", handler: oauthCallback },
  {
    method: "GET",
    pattern: ["oauth", "*"],
    access: "owner",
    handler: (c, a) => c.client.mcp.oauthPoll(a.args[0]),
  },
  {
    method: "DELETE",
    pattern: ["oauth", "*"],
    access: "owner",
    handler: (c, a) => c.client.mcp.oauthCancel(a.args[0], c.userId),
  },
  { method: "GET", pattern: ["catalog"], access: "member", handler: (c) => c.client.mcp.catalog() },
  {
    method: "POST",
    pattern: ["catalog", "*", "install"],
    access: "owner",
    okStatus: 201,
    handler: (c, a) =>
      c.client.mcp.catalogInstall(
        a.args[0],
        { env: (a.body.env ?? {}) as Record<string, string>, enable: a.body.enable !== false },
        c.userId,
      ),
  },
  {
    method: "POST",
    pattern: ["reload"],
    access: "owner",
    handler: (c) => c.client.mcp.reload(c.userId),
  },
  { method: "POST", pattern: ["copy"], access: "owner", handler: copy },
  { method: "GET", pattern: ["bside", "profiles"], access: "owner", handler: bsideProfiles },
  { method: "POST", pattern: ["bside", "connect"], access: "owner", handler: bsideConnect },
  {
    method: "GET",
    pattern: ["servers", "*"],
    access: "owner",
    handler: (c, a) => c.client.mcp.detail(a.args[0]),
  },
  {
    method: "PUT",
    pattern: ["servers", "*"],
    access: "owner",
    handler: (c, a) => c.client.mcp.update(a.args[0], a.body as McpServerInput, c.userId),
  },
  {
    method: "DELETE",
    pattern: ["servers", "*"],
    access: "owner",
    handler: (c, a) => c.client.mcp.remove(a.args[0], c.userId),
  },
  {
    method: "PUT",
    pattern: ["servers", "*", "enabled"],
    access: "owner",
    handler: (c, a) => c.client.mcp.setEnabled(a.args[0], a.body.enabled === true, c.userId),
  },
  {
    method: "PUT",
    pattern: ["servers", "*", "trust"],
    access: "owner",
    handler: (c, a) =>
      c.client.mcp.setTrust(
        a.args[0],
        a.body.trust === "untrusted" ? "untrusted" : "full",
        c.userId,
      ),
  },
  {
    method: "GET",
    pattern: ["servers", "*", "tools"],
    access: "member",
    handler: (c, a) => c.client.mcp.tools(a.args[0]),
  },
  {
    method: "PUT",
    pattern: ["servers", "*", "tools"],
    access: "owner",
    handler: (c, a) =>
      c.client.mcp.setTools(
        a.args[0],
        {
          ...(Array.isArray(a.body.include) ? { include: strList(a.body.include) } : {}),
          ...(Array.isArray(a.body.exclude) ? { exclude: strList(a.body.exclude) } : {}),
          baseRevision: str(a.body.baseRevision),
        },
        c.userId,
      ),
  },
  {
    method: "PUT",
    pattern: ["servers", "*", "secrets", "*"],
    access: "owner",
    handler: (c, a) => c.client.mcp.putSecret(a.args[0], a.args[1], str(a.body.value), c.userId),
  },
  {
    method: "DELETE",
    pattern: ["servers", "*", "secrets", "*"],
    access: "owner",
    handler: (c, a) => c.client.mcp.deleteSecret(a.args[0], a.args[1], c.userId),
  },
  {
    method: "POST",
    pattern: ["servers", "*", "test"],
    access: "owner",
    okStatus: 202,
    handler: (c, a) => c.client.mcp.test(a.args[0], c.userId),
  },
  {
    method: "POST",
    pattern: ["servers", "*", "oauth"],
    access: "owner",
    handler: (c, a) =>
      c.client.mcp.oauthStart(a.args[0], c.userId, { restart: a.body.restart === true }),
  },
];

function match(method: string, path: string[]): { row: Row; args: string[] } | null {
  for (const row of ROWS) {
    if (row.method !== method || row.pattern.length !== path.length) continue;
    const args: string[] = [];
    const ok = row.pattern.every((p, i) => {
      if (p !== "*") return p === path[i];
      args.push(path[i]);
      return true;
    });
    if (ok && FIXED.has(path[0])) return { row, args };
  }
  return null;
}

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  if (req.method === "GET") return {};
  try {
    const parsed: unknown = await req.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function relay(res: PluginResponse<unknown> | Response, okStatus: number): Response {
  if (res instanceof Response) return res;
  if (!res.ok) return pluginFailureResponse(res);
  return NextResponse.json(res.data, { status: okStatus });
}

export async function handleConnectorRoute(
  req: NextRequest,
  params: { id: string; npcId: string; path?: string[] },
): Promise<Response> {
  const resolved = await resolveConnectorContext({
    userId: getUserId(req),
    channelId: params.id,
    npcId: params.npcId,
  });
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const gate = requireMcpCapability(ctx);
  if (gate) return gate;
  const path = params.path ?? [];

  if (req.method === "GET" && path.length === 0) {
    const res = await ctx.client.mcp.list();
    if (!res.ok) return pluginFailureResponse(res);
    return NextResponse.json({
      servers: res.data.servers,
      canManage: ctx.isGatewayOwner,
      capabilityReady: true,
      sharedChannelCount: await sharedChannelCount(ctx),
    });
  }

  const found = match(req.method, path);
  if (!found) return cronError(404, "not_found", "Unknown connector route");
  const owner = found.row.access === "owner" ? requireOwner(ctx) : null;
  if (owner) return owner;
  const out = await found.row.handler(ctx, {
    args: found.args,
    body: await readBody(req),
    sp: req.nextUrl.searchParams,
  });
  return relay(out, found.row.okStatus ?? 200);
}
