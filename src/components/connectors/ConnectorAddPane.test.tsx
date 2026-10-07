import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";

import type { McpServerView } from "@/lib/hermes/plugin-client-types";

import ConnectorAddPane from "./ConnectorAddPane";
import { createConnectorsApi } from "./connectors-api";
import {
  $,
  cleanup,
  click,
  container,
  flush,
  mockFetch,
  render,
  text,
  type,
} from "../skills/skills-test-harness";

const ROOT = "/api/channels/ch-1/npcs/n-1/connectors";
const CATALOG = `GET ${ROOT}/catalog`;

const view = (name: string, over: Partial<McpServerView> = {}): McpServerView => ({
  name,
  kind: "custom",
  transport: "http",
  endpointSummary: "",
  enabled: true,
  trust: "full",
  auth: "none",
  secrets: [],
  oauthTokenPresent: false,
  tools: null,
  lastCheck: null,
  revision: "r1",
  ...over,
});

const catalog = {
  entries: [
    {
      name: "linear",
      description: "Linear issues",
      transport: "http",
      installed: false,
      requiredEnv: [
        { name: "LINEAR_API_KEY", prompt: "Linear API key", required: true, secret: true },
      ],
    },
    { name: "github", description: "GitHub", transport: "stdio", installed: true, requiredEnv: [] },
  ],
};

let added: string[] = [];
let cancelled = 0;
const pane = (npcName?: string) => (
  <ConnectorAddPane
    api={createConnectorsApi("ch-1", "n-1")}
    npcName={npcName}
    onAdded={(name) => {
      added.push(name);
    }}
    onCancel={() => {
      cancelled += 1;
    }}
  />
);

test.beforeEach(() => {
  added = [];
  cancelled = 0;
});
test.afterEach(cleanup);

test("opens on the catalog tab; an installed entry is disabled and marked installed", async () => {
  const log = mockFetch({ [CATALOG]: catalog });
  await render(pane());
  assert.ok(log.calls.includes(CATALOG));
  assert.equal(($('[data-entry="github"]') as HTMLButtonElement).disabled, true);
  assert.ok($('[data-entry="github"]').textContent?.includes("설치됨"));
  assert.equal(($('[data-entry="linear"]') as HTMLButtonElement).disabled, false);
});

test("installing a catalog entry sends the required env, clears it, and reports the name without starting a test (the manager runs it)", async () => {
  const log = mockFetch({
    [CATALOG]: catalog,
    [`POST ${ROOT}/catalog/linear/install`]: view("linear"),
    [`POST ${ROOT}/servers/linear/test`]: { jobId: "j1" },
  });
  await render(pane());
  await click('[data-entry="linear"]');
  const input = $('[name="env-LINEAR_API_KEY"]') as HTMLInputElement;
  assert.equal(input.type, "password");
  assert.equal(input.getAttribute("data-1p-ignore"), "true");
  assert.equal(input.getAttribute("data-lpignore"), "true");
  assert.equal(($('[data-action="catalog-install"]') as HTMLButtonElement).disabled, true);
  await type('[name="env-LINEAR_API_KEY"]', "lin");
  await click('[data-action="catalog-install"]');
  assert.deepEqual(log.bodies[`POST ${ROOT}/catalog/linear/install`], {
    env: { LINEAR_API_KEY: "lin" },
    enable: true,
  });
  assert.ok(!log.calls.some((c) => c.endsWith("/test")));
  assert.deepEqual(added, ["linear"]);
  assert.ok(!container.querySelector('[name="env-LINEAR_API_KEY"]') || input.value === "");
});

const BSIDE_URL = "http://host.docker.internal:27433";
const PROFILES = `GET ${ROOT}/bside/profiles`;
const CONNECT = `POST ${ROOT}/bside/connect`;
const connected = (
  profile: { id: string; name: string },
  skill: Record<string, unknown> = { ok: true },
) => ({
  profile,
  connector: view("bside", {
    endpointSummary: `host.docker.internal:27433/mcp/agent/${profile.id}`,
  }),
  mcpUrl: `${BSIDE_URL}/mcp/agent/${profile.id}`,
  alreadyConnected: false,
  skill,
});

async function choose(sel: string, value: string) {
  const el = $(sel) as HTMLSelectElement;
  // The DOM test window's own HTMLSelectElement is not a global here.
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
}

test("the Bside tab finds Bside, preselects the NPC's profile, and connects in one click", async () => {
  const log = mockFetch({
    [CATALOG]: catalog,
    [PROFILES]: {
      baseUrl: BSIDE_URL,
      profiles: [
        { id: "work", name: "Work" },
        { id: "aya", name: "Aya" },
      ],
    },
    [CONNECT]: connected({ id: "aya", name: "Aya" }),
  });
  await render(pane("Aya"));
  await click('[data-tab="bside"]');
  assert.ok(log.calls.includes(PROFILES));
  assert.equal(($('[name="bside-url"]') as HTMLInputElement).value, BSIDE_URL);
  assert.equal(($('[name="bside-profile"]') as HTMLSelectElement).value, "aya");
  assert.equal($("[data-bside-mcp-url]").textContent, `${BSIDE_URL}/mcp/agent/aya`);
  assert.ok(!container.querySelector('[name="bside-api-token"]'));
  await click('[data-action="bside-connect"]');
  assert.deepEqual(log.bodies[CONNECT], { baseUrl: BSIDE_URL, profileId: "aya" });
  assert.deepEqual(added, ["bside"]);
});

test("a new Bside profile defaults to the NPC's name", async () => {
  const log = mockFetch({
    [CATALOG]: catalog,
    [PROFILES]: { baseUrl: BSIDE_URL, profiles: [{ id: "work", name: "Work" }] },
    [CONNECT]: connected({ id: "maya", name: "Maya" }),
  });
  await render(pane("Maya"));
  await click('[data-tab="bside"]');
  assert.equal(($('[name="bside-profile"]') as HTMLSelectElement).value, "__new__");
  assert.equal(($('[name="bside-new-profile-name"]') as HTMLInputElement).value, "Maya");
  await choose('[name="bside-profile"]', "work");
  assert.ok(!container.querySelector('[name="bside-new-profile-name"]'));
  await choose('[name="bside-profile"]', "__new__");
  await click('[data-action="bside-connect"]');
  assert.deepEqual(log.bodies[CONNECT], { baseUrl: BSIDE_URL, createProfileName: "Maya" });
  assert.deepEqual(added, ["bside"]);
});

test("an unreachable Bside shows the error and retries with the edited URL", async () => {
  const routes: Record<string, Record<string, unknown>> = {
    [CATALOG]: catalog,
    [PROFILES]: { baseUrl: BSIDE_URL, error: "bside_unreachable", message: "ECONNREFUSED" },
    [`GET ${ROOT}/bside/profiles?baseUrl=${encodeURIComponent("http://192.168.0.5:27433")}`]: {
      baseUrl: "http://192.168.0.5:27433",
      profiles: [],
    },
  };
  const log = mockFetch(routes);
  await render(pane());
  await click('[data-tab="bside"]');
  assert.match($("[data-bside-unreachable]").textContent!, /host\.docker\.internal:27433/);
  assert.equal(($('[data-action="bside-connect"]') as HTMLButtonElement).disabled, true);
  await type('[name="bside-url"]', "http://192.168.0.5:27433");
  await click('[data-action="bside-retry-probe"]');
  assert.ok(!container.querySelector("[data-bside-unreachable]"));
  assert.equal(($('[name="bside-profile"]') as HTMLSelectElement).value, "__new__");
  // No NPC name and no typed name: nothing to create yet.
  assert.equal(($('[data-action="bside-connect"]') as HTMLButtonElement).disabled, true);
  assert.ok(!log.calls.includes(CONNECT));
});

test("a skill that failed to install is shown before moving on", async () => {
  mockFetch({
    [CATALOG]: catalog,
    [PROFILES]: { baseUrl: BSIDE_URL, profiles: [{ id: "aya", name: "Aya" }] },
    [CONNECT]: connected(
      { id: "aya", name: "Aya" },
      { ok: false, code: "skill_feature_unavailable" },
    ),
  });
  await render(pane("Aya"));
  await click('[data-tab="bside"]');
  await click('[data-action="bside-connect"]');
  assert.deepEqual(added, []);
  assert.match($("[data-bside-skill-warning]").textContent!, /skill_feature_unavailable/);
  assert.ok($("[data-bside-result]").textContent!.includes(`${BSIDE_URL}/mcp/agent/aya`));
  await click('[data-action="bside-continue"]');
  assert.deepEqual(added, ["bside"]);
});

test("a late NPC name fills the new profile name until the user edits it", async () => {
  mockFetch({
    [CATALOG]: catalog,
    [PROFILES]: { baseUrl: BSIDE_URL, profiles: [] },
  });
  await render(pane());
  await click('[data-tab="bside"]');
  const nameInput = () => $('[name="bside-new-profile-name"]') as HTMLInputElement;
  assert.equal(nameInput().value, "");
  await render(pane("Maya"));
  assert.equal(nameInput().value, "Maya");
  await type('[name="bside-new-profile-name"]', "Desk");
  await render(pane("Mina"));
  assert.equal(nameInput().value, "Desk");
});

test("pasting mcpServers JSON on the custom tab fills name, command, and arguments", async () => {
  mockFetch({ [CATALOG]: catalog });
  await render(pane());
  await click('[data-tab="custom"]');
  await type(
    '[name="json-import"]',
    JSON.stringify({ mcpServers: { fs: { command: "npx", args: ["-y", "@x/fs"] } } }),
  );
  assert.equal(($('[name="name"]') as HTMLInputElement).value, "fs");
  assert.equal(($('[name="command"]') as HTMLInputElement).value, "npx");
  assert.equal(($('[name="args"]') as HTMLTextAreaElement).value, "-y\n@x/fs");
});

test("saving a stdio server shows the full command and waits for the typed name", async () => {
  const log = mockFetch({
    [CATALOG]: catalog,
    [`POST ${ROOT}/servers`]: view("fs", { transport: "stdio" }),
    [`POST ${ROOT}/servers/fs/test`]: { jobId: "j1" },
  });
  await render(pane());
  await click('[data-tab="custom"]');
  await type(
    '[name="json-import"]',
    JSON.stringify({ mcpServers: { fs: { command: "npx", args: ["-y", "@x/fs"] } } }),
  );
  await click('[data-action="save"]');
  assert.ok($('[data-dialog="stdio-confirm"]').textContent?.includes("npx -y @x/fs"));
  assert.ok(!log.calls.includes(`POST ${ROOT}/servers`));
  const submit = () => $('[data-action="confirm-save"]') as HTMLButtonElement;
  assert.equal(submit().disabled, true);
  await type('[name="confirm-name"]', "f");
  assert.equal(submit().disabled, true);
  await type('[name="confirm-name"]', "fs");
  assert.equal(submit().disabled, false);
  await click('[data-action="confirm-save"]');
  const body = log.bodies[`POST ${ROOT}/servers`] as Record<string, unknown>;
  assert.equal(body.confirmName, "fs");
  assert.equal(body.command, "npx");
  assert.deepEqual(body.args, ["-y", "@x/fs"]);
  assert.deepEqual(added, ["fs"]);
});

test("a security rejection shows the error and does not report an added server", async () => {
  mockFetch({
    [CATALOG]: catalog,
    [`POST ${ROOT}/servers`]: {
      status: 422,
      json: { code: "mcp_security_rejected", message: "bad", reasons: ["pipes to sh"] },
    },
  });
  await render(pane());
  await click('[data-tab="custom"]');
  await type('[name="name"]', "evil");
  await click('[data-transport="stdio"]');
  await type('[name="command"]', "sh");
  await click('[data-action="save"]');
  await type('[name="confirm-name"]', "evil");
  await click('[data-action="confirm-save"]');
  assert.ok(container.querySelector("[data-error]"));
  assert.deepEqual(added, []);
});

test("an http Bearer server stores the token under the key the server reports", async () => {
  const log = mockFetch({
    [CATALOG]: catalog,
    [`POST ${ROOT}/servers`]: view("notion", {
      auth: "bearer",
      secrets: [{ key: "MCP_NOTION_API_KEY", hasValue: false }],
    }),
    [`PUT ${ROOT}/servers/notion/secrets/MCP_NOTION_API_KEY`]: {
      key: "MCP_NOTION_API_KEY",
      hasValue: true,
    },
    [`POST ${ROOT}/servers/notion/test`]: { jobId: "j1" },
  });
  await render(pane());
  await click('[data-tab="custom"]');
  await type('[name="name"]', "notion");
  await type('[name="url"]', "https://mcp.notion.com/mcp");
  await click('[data-auth="bearer"]');
  const token = $('[name="token"]') as HTMLInputElement;
  assert.equal(token.type, "password");
  await type('[name="token"]', "ntn_fake");
  await click('[data-action="save"]');
  const body = log.bodies[`POST ${ROOT}/servers`] as Record<string, unknown>;
  assert.equal(body.auth, "bearer");
  assert.equal(JSON.stringify(body).includes("ntn_fake"), false);
  assert.deepEqual(log.bodies[`PUT ${ROOT}/servers/notion/secrets/MCP_NOTION_API_KEY`], {
    value: "ntn_fake",
  });
  assert.deepEqual(added, ["notion"]);
});

test("an OAuth server is reported so the manager can open sign-in", async () => {
  const log = mockFetch({
    [CATALOG]: catalog,
    [`POST ${ROOT}/servers`]: view("canva", { auth: "oauth" }),
  });
  await render(pane());
  await click('[data-tab="custom"]');
  await type('[name="name"]', "canva");
  await type('[name="url"]', "https://mcp.canva.com/mcp");
  await click('[data-auth="oauth"]');
  await click('[data-action="save"]');
  assert.equal((log.bodies[`POST ${ROOT}/servers`] as Record<string, unknown>).auth, "oauth");
  assert.ok(!log.calls.some((c) => c.endsWith("/test")));
  assert.deepEqual(added, ["canva"]);
});

test("cancel reports back", async () => {
  mockFetch({ [CATALOG]: catalog });
  await render(pane());
  await click('[data-action="add-cancel"]');
  assert.equal(cancelled, 1);
  assert.ok(text().length > 0);
});

test("stdio env values are sent only as secrets for keys the server reports", async () => {
  const log = mockFetch({
    [CATALOG]: catalog,
    [`POST ${ROOT}/servers`]: view("fs", {
      transport: "stdio",
      auth: "env",
      secrets: [{ key: "FS_TOKEN", hasValue: false }],
    }),
    [`PUT ${ROOT}/servers/fs/secrets/FS_TOKEN`]: { key: "FS_TOKEN", hasValue: true },
    [`POST ${ROOT}/servers/fs/test`]: { jobId: "j1" },
  });
  await render(pane());
  await click('[data-tab="custom"]');
  await type('[name="name"]', "fs");
  await click('[data-transport="stdio"]');
  await type('[name="command"]', "npx");
  await click('[data-action="add-env"]');
  await type('[name="env-key-0"]', "FS_TOKEN");
  assert.equal(($('[name="env-value-0"]') as HTMLInputElement).type, "password");
  await type('[name="env-value-0"]', "ghp_abc");
  await click('[data-action="save"]');
  await type('[name="confirm-name"]', "fs");
  await click('[data-action="confirm-save"]');
  const body = log.bodies[`POST ${ROOT}/servers`] as Record<string, unknown>;
  assert.deepEqual(body.env, { FS_TOKEN: "" });
  assert.equal(JSON.stringify(body).includes("ghp_abc"), false);
  assert.deepEqual(log.bodies[`PUT ${ROOT}/servers/fs/secrets/FS_TOKEN`], { value: "ghp_abc" });
  assert.deepEqual(added, ["fs"]);
});

test("a typed URL with a secret in its query warns but still saves", async () => {
  const log = mockFetch({
    [CATALOG]: catalog,
    [`POST ${ROOT}/servers`]: view("zap"),
    [`POST ${ROOT}/servers/zap/test`]: { jobId: "j1" },
  });
  await render(pane());
  await click('[data-tab="custom"]');
  await type('[name="name"]', "zap");
  await type('[name="url"]', "https://mcp.example.com/mcp?page=2");
  assert.ok(!container.querySelector("[data-url-secret-warning]"));
  await type('[name="url"]', "https://mcp.example.com/mcp?api_key=fake");
  assert.ok($("[data-url-secret-warning]").textContent?.includes("Hermes 로그에 그대로 남으니"));
  assert.equal(($('[data-action="save"]') as HTMLButtonElement).disabled, false);
  await click('[data-action="save"]');
  assert.ok(log.calls.includes(`POST ${ROOT}/servers`));
  assert.deepEqual(added, ["zap"]);
});

test("a URL filled from pasted JSON gets the same warning", async () => {
  mockFetch({ [CATALOG]: catalog });
  await render(pane());
  await click('[data-tab="custom"]');
  await type(
    '[name="json-import"]',
    JSON.stringify({ zap: { url: "https://mcp.example.com/mcp?Token=fake" } }),
  );
  assert.ok($("[data-url-secret-warning]"));
});
