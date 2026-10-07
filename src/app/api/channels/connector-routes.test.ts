import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { NextRequest } from "next/server";

import {
  authHeaders,
  seedChannel,
  seedGateway,
  seedHermesProfile,
  seedNpc,
  seedUser,
  setupThrowawaySqlite,
} from "@/test-setup/npc-seed";
import { bsideBrowserSkillTemplate } from "@/components/skills/bside-browser-skill";
import { effectiveEnabled } from "@/lib/hermes/fake-config-routes";
import { startFakePluginServer, type FakePluginServer } from "@/lib/hermes/fake-plugin-server";

// NPC MCP connector REST (`/api/channels/:id/npcs/:npcId/connectors/**`).
// Pins: the permission table (members read list/tools/catalog; everything else is gateway
// owner), 428 without the capability, OAuth paste parsing on the server, copy results per
// target, and that no response carries secret values or profile keys.
// Kept outside `[id]` — the node test runner reads `[id]` as a glob character class.
setupThrowawaySqlite("connector-routes-test");

const FULL_INFO = {
  capabilities: [
    "kanban",
    "cron",
    "events",
    "profile_skills",
    "profile_skill_admin",
    "profile_mcp_admin",
  ],
  version: "0.17.0",
};

let server: FakePluginServer;
let route: typeof import("./[id]/npcs/[npcId]/connectors/[[...path]]/route");

before(async () => {
  server = await startFakePluginServer({
    ownerToken: "gateway-owner-key-1234567890",
    profileTokens: { sophie: "profile-key-1234567890", max: "profile-key-1234567890" },
  });
  server.setInfo(FULL_INFO);
  route = await import("./[id]/npcs/[npcId]/connectors/[[...path]]/route");
});
after(async () => server.close());

async function seed() {
  const owner = await seedUser("conn-owner");
  const member = await seedUser("conn-member");
  const stranger = await seedUser("conn-stranger");
  const gateway = await seedGateway(owner.id, server.baseUrl);
  const channel = await seedChannel(owner.id, "Connector channel");
  const { bindGatewayToChannel } = await import("@/lib/gateway-resources");
  await bindGatewayToChannel({
    channelId: channel.id,
    gatewayId: gateway.id,
    boundByUserId: owner.id,
  });
  const { db, channelMembers } = await import("@/db");
  await db.insert(channelMembers).values({ channelId: channel.id, userId: member.id });
  const sophie = await seedHermesProfile(gateway.id, {
    profileName: "sophie",
    displayName: "Sophie",
  });
  const max = await seedHermesProfile(gateway.id, { profileName: "max", displayName: "Max" });
  const npc = await seedNpc({
    channelId: channel.id,
    hermesProfileId: sophie.id,
    positionX: 0,
    positionY: 0,
  });
  const npc2 = await seedNpc({
    channelId: channel.id,
    hermesProfileId: max.id,
    positionX: 1,
    positionY: 0,
  });
  return { owner, member, stranger, channel, npc, npc2 };
}

type Handler = (r: NextRequest, c: unknown) => Promise<Response>;

function call(
  userId: string,
  method: string,
  channelId: string,
  npcId: string,
  path: string[],
  body?: unknown,
  query = "",
) {
  const url = `http://localhost/api/channels/${channelId}/npcs/${npcId}/connectors/${path.map(encodeURIComponent).join("/")}${query}`;
  const req = new NextRequest(url, {
    method,
    headers: new Headers(authHeaders(userId)),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const handler = (route as unknown as Record<string, Handler>)[method];
  return handler(req, { params: Promise.resolve({ id: channelId, npcId, path }) });
}

test("members read the list with canManage=false; strangers get 404/403", async () => {
  const s = await seed();
  server.mcp("sophie").seed("github");
  const res = await call(s.member.id, "GET", s.channel.id, s.npc.id, []);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.servers[0].name, "github");
  assert.equal(body.canManage, false);
  assert.equal(body.sharedChannelCount, 0);
  const own = await (await call(s.owner.id, "GET", s.channel.id, s.npc.id, [])).json();
  assert.equal(own.canManage, true);
  const stranger = await call(s.stranger.id, "GET", s.channel.id, s.npc.id, []);
  assert.ok([403, 404].includes(stranger.status));
});

test("members cannot mutate, test, authenticate, reload, or copy", async () => {
  const s = await seed();
  server.mcp("sophie").seed("github");
  for (const [method, path, body] of [
    ["POST", ["servers"], { name: "x", transport: "http", url: "https://x.example", auth: "none" }],
    ["POST", ["servers", "github", "test"], {}],
    ["POST", ["servers", "github", "oauth"], {}],
    ["GET", ["servers", "github"], undefined],
    ["POST", ["reload"], {}],
    ["POST", ["copy"], { targetNpcIds: [s.npc2.id], names: ["github"] }],
  ] as const) {
    const res = await call(s.member.id, method, s.channel.id, s.npc.id, [...path], body);
    assert.equal(res.status, 403, `${method} ${path.join("/")}`);
  }
});

test("owner creates a server and the actor header reaches the plugin", async () => {
  const s = await seed();
  const res = await call(s.owner.id, "POST", s.channel.id, s.npc.id, ["servers"], {
    name: "linear",
    transport: "http",
    url: "https://mcp.linear.app/sse",
    auth: "oauth",
  });
  assert.equal(res.status, 201);
  assert.equal(server.mcp("sophie").lastActor, s.owner.id);
});

test("plugin error codes and extra fields pass through", async () => {
  const s = await seed();
  const res = await call(s.owner.id, "POST", s.channel.id, s.npc.id, ["servers"], {
    name: "bad",
    transport: "stdio",
    command: "sh",
    args: ["-c", "curl evil.example"],
    auth: "none",
    confirmName: "bad",
  });
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.code, "mcp_security_rejected");
  assert.deepEqual(body.reasons, ["known malicious pattern"]);
});

test("428 without the capability, even for the list", async () => {
  // Binding a gateway to a channel caches the plugin info in the gateway row — switch to the old plugin before seeding.
  server.setInfo({
    capabilities: FULL_INFO.capabilities.filter((c) => c !== "profile_mcp_admin"),
    version: "0.16.0",
  });
  try {
    const s = await seed();
    const res = await call(s.owner.id, "GET", s.channel.id, s.npc.id, []);
    assert.equal(res.status, 428);
    const body = await res.json();
    assert.equal(body.code, "plugin_upgrade_required");
    assert.equal(body.minVersion, "0.17.0");
  } finally {
    server.setInfo(FULL_INFO);
  }
});

const OLD_INFO = {
  capabilities: FULL_INFO.capabilities.filter((c) => c !== "profile_mcp_admin"),
  version: "0.16.0",
};
const infoProbes = () => server.requests().filter((r) => r.path === "/deskrpg/info").length;

test("a gateway upgraded after the cached probe is served at once, not held at 428", async () => {
  // Binding caches the old plugin's info; the gateway is then upgraded in place.
  server.setInfo(OLD_INFO);
  let s;
  try {
    s = await seed();
  } finally {
    server.setInfo(FULL_INFO);
  }
  const res = await call(s.owner.id, "GET", s.channel.id, s.npc.id, []);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).canManage, true);
  // The re-probe refreshed the cache: the next request needs no probe.
  const before = infoProbes();
  assert.equal((await call(s.owner.id, "GET", s.channel.id, s.npc.id, [])).status, 200);
  assert.equal(infoProbes(), before);
});

test("an old gateway is re-probed at most once per throttle window", async () => {
  server.setInfo(OLD_INFO);
  try {
    const s = await seed();
    const start = infoProbes();
    assert.equal((await call(s.owner.id, "GET", s.channel.id, s.npc.id, [])).status, 428);
    assert.equal(infoProbes(), start + 1);
    assert.equal((await call(s.owner.id, "GET", s.channel.id, s.npc.id, [])).status, 428);
    assert.equal(infoProbes(), start + 1);
  } finally {
    server.setInfo(FULL_INFO);
  }
});

test("oauth callback parses the pasted URL on the server and forwards only code/state", async () => {
  const s = await seed();
  server
    .mcp("sophie")
    .seed("canva", { auth: "oauth", entry: { url: "https://mcp.canva.com/mcp", auth: "oauth" } });
  const start = await (
    await call(s.owner.id, "POST", s.channel.id, s.npc.id, ["servers", "canva", "oauth"], {})
  ).json();
  const bad = await call(
    s.owner.id,
    "POST",
    s.channel.id,
    s.npc.id,
    ["oauth", start.sessionId, "callback"],
    {
      redirectUrl: "https://evil.example/callback?code=a&state=b",
    },
  );
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).code, "oauth_callback_invalid");
  const denied = await call(
    s.owner.id,
    "POST",
    s.channel.id,
    s.npc.id,
    ["oauth", start.sessionId, "callback"],
    {
      redirectUrl: "http://127.0.0.1:8412/callback?error=access_denied&state=x",
    },
  );
  assert.equal((await denied.json()).code, "oauth_denied");
  const good = await call(
    s.owner.id,
    "POST",
    s.channel.id,
    s.npc.id,
    ["oauth", start.sessionId, "callback"],
    {
      redirectUrl: ` http://127.0.0.1:8412/callback?code=abc&state=st-${start.sessionId}\n`,
    },
  );
  assert.equal(good.status, 200);
  const poll = await (
    await call(s.owner.id, "GET", s.channel.id, s.npc.id, ["oauth", start.sessionId])
  ).json();
  assert.equal(poll.status, "approved");
});

test("copy carries settings but no secret values and reports per-target results", async () => {
  const s = await seed();
  server.mcp("sophie").seed("github", {
    entry: {
      url: "https://gh.example/mcp",
      headers: {
        Authorization: "Bearer ${MCP_GITHUB_API_KEY}",
        "X-Team": "${MCP_GITHUB_TEAM}",
        "X-Literal": "ghp_abc_literal_value",
      },
      tools: { include: ["read_*"], exclude: ["read_secret"] },
      enabled: false,
    },
  });
  server.mcp("sophie").seed("notion");
  server.mcp("max").seed("notion");
  const res = await call(s.owner.id, "POST", s.channel.id, s.npc.id, ["copy"], {
    targetNpcIds: [s.npc2.id, "no-such-npc"],
    // github last, so its create body is the one the fake records.
    names: ["notion", "github"],
  });
  assert.equal(res.status, 200);
  const { results } = await res.json();
  assert.deepEqual(
    results.map((r: { npcId: string; name: string; ok: boolean; code?: string }) => [
      r.npcId === s.npc2.id ? "max" : r.npcId,
      r.name,
      r.ok,
      r.code ?? null,
    ]),
    [
      ["max", "notion", false, "name_taken"],
      ["max", "github", true, null],
      ["no-such-npc", "notion", false, "npc_not_found"],
      ["no-such-npc", "github", false, "npc_not_found"],
    ],
  );
  const copied = server.mcp("max").servers.get("github");
  assert.ok(copied);
  // The create body carries only `${KEY}` references — a literal header value never travels.
  const created = server.mcp("max").lastCreateBody!;
  assert.equal(created.name, "github");
  assert.deepEqual(created.headers, {
    Authorization: "Bearer ${MCP_GITHUB_API_KEY}",
    "X-Team": "${MCP_GITHUB_TEAM}",
  });
  assert.equal(created.auth, "bearer");
  assert.ok(!JSON.stringify(created).includes("ghp_abc_literal_value"));
  // Settings follow: the tool filter and the disabled state.
  assert.deepEqual(copied.entry.tools, { include: ["read_*"], exclude: ["read_secret"] });
  assert.equal(copied.view.enabled, false);
});

test("copy refuses a Bside personal browser so each NPC keeps its own profile", async () => {
  const s = await seed();
  const targetMcp = server.mcp("max");
  targetMcp.lastCreateBody = null;
  server.mcp("sophie").seed("bside", {
    entry: {
      command: "deskoffice-bside-mcp",
      args: ["--profile", "sophie-browser"],
      trust: "untrusted",
    },
  });
  const res = await call(s.owner.id, "POST", s.channel.id, s.npc.id, ["copy"], {
    targetNpcIds: [s.npc2.id],
    names: ["bside"],
  });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).results, [
    { npcId: s.npc2.id, name: "bside", ok: false, code: "bside_profile_not_copyable" },
  ]);
  assert.equal(targetMcp.servers.has("bside"), false);
  assert.equal(targetMcp.lastCreateBody, null);
});

test("responses never contain the profile key", async () => {
  const s = await seed();
  server.mcp("sophie").seed("github");
  const text = await (
    await call(s.owner.id, "GET", s.channel.id, s.npc.id, ["servers", "github"])
  ).text();
  assert.ok(!text.includes("profile-key-1234567890"));
});

/** A stand-in for Bside's REST: `GET/POST /profiles`, recording whether an Origin header arrived. */
async function startFakeBside() {
  const profiles: { id: string; name: string; storagePath: string }[] = [
    { id: "sophie", name: "Sophie", storagePath: "/data/sophie" },
  ];
  const origins: (string | undefined)[] = [];
  let creates = 0;
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      origins.push(req.headers.origin);
      res.setHeader("content-type", "application/json");
      if (req.url === "/profiles" && req.method === "GET") return res.end(JSON.stringify(profiles));
      if (req.url === "/profiles" && req.method === "POST") {
        creates += 1;
        const name = String(JSON.parse(raw).name);
        const p = { id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name, storagePath: "/x" };
        profiles.push(p);
        return res.end(JSON.stringify(p));
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ message: "not found" }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, origins, creates: () => creates, close: () => server.close() };
}

test("bside/profiles lists Bside profiles, or reports Bside unreachable", async () => {
  const s = await seed();
  const bside = await startFakeBside();
  try {
    const q = `?baseUrl=${encodeURIComponent(bside.url + "/")}`;
    const res = await call(
      s.owner.id,
      "GET",
      s.channel.id,
      s.npc.id,
      ["bside", "profiles"],
      undefined,
      q,
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      baseUrl: bside.url,
      profiles: [{ id: "sophie", name: "Sophie" }],
    });
    assert.ok(bside.origins.every((o) => o === undefined));
  } finally {
    bside.close();
  }
  const down = await call(
    s.owner.id,
    "GET",
    s.channel.id,
    s.npc.id,
    ["bside", "profiles"],
    undefined,
    "?baseUrl=http%3A%2F%2F127.0.0.1%3A1",
  );
  assert.equal(down.status, 200);
  const body = await down.json();
  assert.equal(body.error, "bside_unreachable");
  assert.equal(body.baseUrl, "http://127.0.0.1:1");
  const bad = await call(
    s.owner.id,
    "GET",
    s.channel.id,
    s.npc.id,
    ["bside", "profiles"],
    undefined,
    "?baseUrl=ftp%3A%2F%2Fx",
  );
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).code, "bside_url_invalid");
});

test("bside routes are gateway-owner only", async () => {
  const s = await seed();
  for (const [method, path, body] of [
    ["GET", ["bside", "profiles"], undefined],
    ["POST", ["bside", "connect"], {}],
  ] as const) {
    const res = await call(s.member.id, method, s.channel.id, s.npc.id, [...path], body);
    assert.equal(res.status, 403, `${method} ${path.join("/")}`);
  }
});

test("bside/connect creates the profile, the HTTP connector, and the skill; repeating is a no-op", async () => {
  const s = await seed();
  const bside = await startFakeBside();
  const mcp = server.mcp("sophie");
  try {
    const res = await call(s.owner.id, "POST", s.channel.id, s.npc.id, ["bside", "connect"], {
      baseUrl: bside.url,
      createProfileName: "Sophie Desk",
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    const mcpUrl = `${bside.url}/mcp/agent/sophie-desk`;
    assert.deepEqual(body.profile, { id: "sophie-desk", name: "Sophie Desk" });
    assert.equal(body.mcpUrl, mcpUrl);
    assert.equal(body.alreadyConnected, false);
    assert.equal(body.connector.name, "bside");
    assert.deepEqual(body.skill, { ok: true });
    assert.deepEqual(mcp.lastCreateBody, {
      name: "bside",
      transport: "http",
      url: mcpUrl,
      auth: "none",
      trust: "full",
    });
    assert.ok(server.skills("sophie").skills.has("deskoffice-bside-browser"));

    const again = await (
      await call(s.owner.id, "POST", s.channel.id, s.npc.id, ["bside", "connect"], {
        baseUrl: bside.url,
        createProfileName: "sophie desk",
      })
    ).json();
    assert.equal(bside.creates(), 1);
    assert.equal(again.alreadyConnected, true);
    assert.deepEqual(again.skill, { ok: true, alreadyInstalled: true });
    assert.ok(bside.origins.every((o) => o === undefined));
  } finally {
    bside.close();
  }
});

const SKILL = "deskoffice-bside-browser";
const olderPlaybook = () => bsideBrowserSkillTemplate().replace(/^version: .*$/m, "version: 1.0.0");

async function connectWithInstalledSkill(
  s: Awaited<ReturnType<typeof seed>>,
  bsideUrl: string,
  skillMd: string | null,
) {
  const skills = server.skills("sophie");
  skills.seed(SKILL);
  if (skillMd === null) skills.skills.get(SKILL)!.files.delete("SKILL.md");
  else skills.skills.get(SKILL)!.files.set("SKILL.md", skillMd);
  try {
    const { body } = await connectBside(s, bsideUrl);
    return { skill: body.skill, file: skills.skills.get(SKILL)!.files.get("SKILL.md") };
  } finally {
    skills.skills.delete(SKILL);
  }
}

test("bside/connect updates an installed DeskOffice playbook with a lower version", async () => {
  const s = await seed();
  const bside = await startFakeBside();
  try {
    const out = await connectWithInstalledSkill(s, bside.url, olderPlaybook());
    assert.deepEqual(out.skill, { ok: true, alreadyInstalled: true, updated: true });
    assert.equal(out.file, bsideBrowserSkillTemplate());
  } finally {
    bside.close();
  }
});

test("bside/connect leaves an installed playbook alone when the version is current, newer, or not DeskOffice's", async () => {
  const s = await seed();
  const bside = await startFakeBside();
  try {
    const edited = `${bsideBrowserSkillTemplate()}\nMy own rule.\n`;
    const newer = bsideBrowserSkillTemplate().replace(/^version: .*$/m, "version: 1.10.0");
    const foreign = olderPlaybook().replace(/^author: .*$/m, "author: someone");
    const unversioned = olderPlaybook().replace(/^version: .*\n/m, "");
    for (const md of [edited, newer, foreign, unversioned]) {
      const out = await connectWithInstalledSkill(s, bside.url, md);
      assert.deepEqual(out.skill, { ok: true, alreadyInstalled: true });
      assert.equal(out.file, md);
    }
  } finally {
    bside.close();
  }
});

test("bside/connect reports a playbook that changed during the refresh, and one it cannot read", async () => {
  const s = await seed();
  const bside = await startFakeBside();
  try {
    server.skills("sophie").racingWrite = "---\nauthor: DeskOffice\nversion: 1.0.1\n---\nedited\n";
    const raced = await connectWithInstalledSkill(s, bside.url, olderPlaybook());
    assert.deepEqual(raced.skill, { ok: false, code: "skill_changed", alreadyInstalled: true });
    assert.equal(raced.file, "---\nauthor: DeskOffice\nversion: 1.0.1\n---\nedited\n");

    const unreadable = await connectWithInstalledSkill(s, bside.url, null);
    assert.deepEqual(unreadable.skill, {
      ok: false,
      code: "file_not_found",
      alreadyInstalled: true,
    });
  } finally {
    bside.close();
  }
});

test("bside/connect repoints an older Bside connector and refuses an unrelated `bside` server", async () => {
  const s = await seed();
  const bside = await startFakeBside();
  try {
    server.mcp("sophie").seed("bside", {
      entry: { url: "http://old-host:27433/mcp/agent/old" },
    });
    const res = await call(s.owner.id, "POST", s.channel.id, s.npc.id, ["bside", "connect"], {
      baseUrl: bside.url,
      profileId: "sophie",
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).alreadyConnected, false);
    assert.equal(
      server.mcp("sophie").servers.get("bside")!.entry.url,
      `${bside.url}/mcp/agent/sophie`,
    );

    server.mcp("max").seed("bside", { entry: { url: "https://unrelated.example/mcp" } });
    const taken = await call(s.owner.id, "POST", s.channel.id, s.npc2.id, ["bside", "connect"], {
      baseUrl: bside.url,
      profileId: "sophie",
    });
    assert.equal(taken.status, 409);
    assert.equal((await taken.json()).code, "name_taken");
    assert.equal(
      server.mcp("max").servers.get("bside")!.entry.url,
      "https://unrelated.example/mcp",
    );

    const missing = await call(s.owner.id, "POST", s.channel.id, s.npc.id, ["bside", "connect"], {
      baseUrl: bside.url,
      profileId: "nobody",
    });
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).code, "bside_profile_not_found");
  } finally {
    bside.close();
  }
  const down = await call(s.owner.id, "POST", s.channel.id, s.npc.id, ["bside", "connect"], {
    baseUrl: "http://127.0.0.1:1",
    profileId: "sophie",
  });
  assert.equal(down.status, 502);
  assert.equal((await down.json()).code, "bside_unreachable");
});

test("copy refuses a Bside agent HTTP connector too", async () => {
  const s = await seed();
  server.mcp("sophie").seed("bside-http", {
    entry: { url: "http://host.docker.internal:27433/mcp/agent/sophie" },
  });
  const res = await call(s.owner.id, "POST", s.channel.id, s.npc.id, ["copy"], {
    targetNpcIds: [s.npc2.id],
    names: ["bside-http"],
  });
  assert.deepEqual((await res.json()).results, [
    { npcId: s.npc2.id, name: "bside-http", ok: false, code: "bside_profile_not_copyable" },
  ]);
});

test("bside/connect still creates the connector when the gateway cannot edit skills", async () => {
  const withoutSkillAdmin = FULL_INFO.capabilities.filter((c) => c !== "profile_skill_admin");
  for (const [capabilities, code] of [
    [withoutSkillAdmin, "plugin_upgrade_required"],
    [[...withoutSkillAdmin, "profile_skill_read"], "skill_feature_unavailable"],
  ] as const) {
    // Binding caches the plugin info, so the reduced capabilities must be in place before seeding.
    server.setInfo({ ...FULL_INFO, capabilities: [...capabilities] });
    let s;
    try {
      s = await seed();
    } finally {
      server.setInfo(FULL_INFO);
    }
    const bside = await startFakeBside();
    try {
      server.mcp("sophie").servers.delete("bside");
      const res = await call(s.owner.id, "POST", s.channel.id, s.npc.id, ["bside", "connect"], {
        baseUrl: bside.url,
        profileId: "sophie",
      });
      assert.equal(res.status, 200, code);
      const body = await res.json();
      assert.deepEqual(body.skill, { ok: false, code });
      assert.equal(body.connector.name, "bside");
      assert.equal(
        server.mcp("sophie").servers.get("bside")!.entry.url,
        `${bside.url}/mcp/agent/sophie`,
      );
    } finally {
      bside.close();
    }
  }
});

test("bside/connect reports the plugin's skill create failure code", async () => {
  const s = await seed();
  const bside = await startFakeBside();
  const skills = server.skills("sophie");
  try {
    server.mcp("sophie").servers.delete("bside");
    // The skill exists but the list call fails, so the create runs and the plugin rejects it.
    skills.seed("deskoffice-bside-browser");
    server.failNext("/p/sophie/deskrpg/skills", 1);
    const res = await call(s.owner.id, "POST", s.channel.id, s.npc.id, ["bside", "connect"], {
      baseUrl: bside.url,
      profileId: "sophie",
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.skill, { ok: false, code: "skill_write_rejected" });
    assert.equal(body.connector.name, "bside");
  } finally {
    skills.skills.delete("deskoffice-bside-browser");
    bside.close();
  }
});

test("bside/connect needs a profile id or a new profile name", async () => {
  const s = await seed();
  const bside = await startFakeBside();
  try {
    const res = await call(s.owner.id, "POST", s.channel.id, s.npc.id, ["bside", "connect"], {
      baseUrl: bside.url,
      profileId: "  ",
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, "bside_profile_required");
    assert.equal(bside.origins.length, 0);
  } finally {
    bside.close();
  }
});

async function connectBside(s: Awaited<ReturnType<typeof seed>>, bsideUrl: string) {
  const res = await call(s.owner.id, "POST", s.channel.id, s.npc.id, ["bside", "connect"], {
    baseUrl: bsideUrl,
    profileId: "sophie",
  });
  return { res, body: await res.json() };
}

test("bside/connect turns off only the built-in browser toolset", async () => {
  const s = await seed();
  const bside = await startFakeBside();
  const cfg = server.config("sophie");
  try {
    server.mcp("sophie").servers.delete("bside");
    Object.assign(cfg, { enabled: [...cfg.known, "my-mcp"], pluginsRecorded: false, puts: [] });
    const { res, body } = await connectBside(s, bside.url);
    assert.equal(res.status, 200);
    assert.deepEqual(body.builtinBrowser, { disabled: true, restartMayBeRequired: true });
    assert.equal(cfg.puts.length, 1);
    assert.deepEqual(cfg.puts[0], {
      enabledToolsets: [...cfg.known.filter((n) => n !== "browser"), "deskrpg"],
    });
    assert.ok(!cfg.enabled.includes("browser"));
    assert.ok(cfg.enabled.includes("computer_use"));
    assert.ok(cfg.enabled.includes("my-mcp"), "MCP entries are kept");
  } finally {
    bside.close();
  }
});

test("bside/connect keeps a plugin toolset that is on by default but not in the stored list", async () => {
  const s = await seed();
  const bside = await startFakeBside();
  const cfg = server.config("sophie");
  try {
    server.mcp("sophie").servers.delete("bside");
    Object.assign(cfg, { enabled: [...cfg.known], pluginsRecorded: false, puts: [] });
    assert.ok(!cfg.enabled.includes("deskrpg"));
    assert.ok(effectiveEnabled(cfg).includes("deskrpg"));
    await connectBside(s, bside.url);
    assert.deepEqual(
      effectiveEnabled(cfg),
      [...cfg.known.filter((n) => n !== "browser"), "deskrpg"],
      "only the browser went off",
    );
  } finally {
    bside.close();
  }
});

test("bside/connect leaves a profile whose browser is already off alone, on a repeat too", async () => {
  const s = await seed();
  const bside = await startFakeBside();
  const cfg = server.config("sophie");
  try {
    server.mcp("sophie").servers.delete("bside");
    Object.assign(cfg, {
      enabled: cfg.known.filter((n) => n !== "browser"),
      pluginsRecorded: true,
      puts: [],
    });
    const first = await connectBside(s, bside.url);
    assert.equal(first.body.alreadyConnected, false);
    assert.deepEqual(first.body.builtinBrowser, { disabled: true, alreadyDisabled: true });
    const again = await connectBside(s, bside.url);
    assert.equal(again.body.alreadyConnected, true);
    assert.deepEqual(again.body.builtinBrowser, { disabled: true, alreadyDisabled: true });
    assert.equal(cfg.puts.length, 0);
  } finally {
    bside.close();
  }
});

test("bside/connect still connects when the toolsets cannot be read or written", async () => {
  const s = await seed();
  const bside = await startFakeBside();
  const cfg = server.config("sophie");
  try {
    server.mcp("sophie").servers.delete("bside");
    Object.assign(cfg, {
      enabled: [...cfg.known],
      pluginsRecorded: false,
      puts: [],
      rejectPuts: false,
    });
    server.failNext("/p/sophie/deskrpg/toolsets", 1);
    const read = await connectBside(s, bside.url);
    assert.equal(read.res.status, 200);
    assert.equal(read.body.connector.name, "bside");
    assert.deepEqual(read.body.builtinBrowser, { disabled: false, code: "service_unavailable" });
    assert.ok(cfg.enabled.includes("browser"));

    cfg.rejectPuts = true;
    const write = await connectBside(s, bside.url);
    assert.equal(write.res.status, 200);
    assert.deepEqual(write.body.builtinBrowser, { disabled: false, code: "config_unreadable" });
    assert.ok(cfg.enabled.includes("browser"));
  } finally {
    cfg.rejectPuts = false;
    bside.close();
  }
});
