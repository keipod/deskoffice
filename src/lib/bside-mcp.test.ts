import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import {
  BSIDE_DEFAULT_URL,
  BsideError,
  bsideAgentMcpUrl,
  createBsideProfile,
  isDeskOfficeBsideBridge,
  listBsideProfiles,
  resolveBsideBaseUrl,
} from "./bside-mcp";

test("recognizes installed and bundled DeskOffice Bside bridges", () => {
  assert.equal(isDeskOfficeBsideBridge("deskoffice-bside-mcp", ["--profile", "maya"]), true);
  assert.equal(
    isDeskOfficeBsideBridge("node", [
      "/srv/bside/out/tools/deskoffice-mcp.js",
      "--profile",
      "maya",
    ]),
    true,
  );
  assert.equal(isDeskOfficeBsideBridge("npx", ["-y", "@example/mcp"]), false);
});

test("recognizes the Bside agent HTTP endpoint", () => {
  assert.equal(
    isDeskOfficeBsideBridge(null, [], "http://host.docker.internal:27433/mcp/agent/maya"),
    true,
  );
  assert.equal(isDeskOfficeBsideBridge(null, [], "https://mcp.linear.app/sse"), false);
  assert.equal(isDeskOfficeBsideBridge(null, [], "not a url"), false);
});

test("resolves the base URL: override, then BSIDE_URL, then the default", () => {
  const saved = process.env.BSIDE_URL;
  try {
    delete process.env.BSIDE_URL;
    assert.equal(resolveBsideBaseUrl(), BSIDE_DEFAULT_URL);
    process.env.BSIDE_URL = "http://bside.lan:27433/";
    assert.equal(resolveBsideBaseUrl(), "http://bside.lan:27433");
    assert.equal(resolveBsideBaseUrl("  http://127.0.0.1:27433// "), "http://127.0.0.1:27433");
    assert.equal(resolveBsideBaseUrl("ftp://x"), null);
    assert.equal(resolveBsideBaseUrl("nope"), null);
  } finally {
    if (saved === undefined) delete process.env.BSIDE_URL;
    else process.env.BSIDE_URL = saved;
  }
});

test("builds the agent MCP URL with an encoded profile id", () => {
  assert.equal(bsideAgentMcpUrl("http://h:1/", "a b"), "http://h:1/mcp/agent/a%20b");
});

async function serve(
  handler: Parameters<typeof createServer>[1],
): Promise<{ url: string; server: Server }> {
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

test("lists and creates Bside profiles without an Origin header", async () => {
  const seen: { method?: string; origin?: string; body: string }[] = [];
  const { url, server } = await serve((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method, origin: req.headers.origin, body });
      res.setHeader("content-type", "application/json");
      if (req.method === "GET")
        res.end(JSON.stringify([{ id: "maya", name: "Maya", storagePath: "/x" }, { bad: true }]));
      else res.end(JSON.stringify({ id: "new-one", name: JSON.parse(body).name }));
    });
  });
  try {
    assert.deepEqual(await listBsideProfiles(url), [{ id: "maya", name: "Maya" }]);
    assert.deepEqual(await createBsideProfile(url, "New One"), { id: "new-one", name: "New One" });
    assert.equal(seen[1].body, JSON.stringify({ name: "New One" }));
    assert.ok(seen.every((s) => s.origin === undefined));
  } finally {
    server.close();
  }
});

test("maps failures to bside_unreachable and bside_error", async () => {
  const { url, server } = await serve((_req, res) => {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ message: "boom" }));
  });
  try {
    await assert.rejects(
      listBsideProfiles(url),
      (e) => e instanceof BsideError && e.code === "bside_error" && e.message === "boom",
    );
  } finally {
    server.close();
  }
  await assert.rejects(
    listBsideProfiles("http://127.0.0.1:1"),
    (e) => e instanceof BsideError && e.code === "bside_unreachable",
  );
});
