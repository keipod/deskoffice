import assert from "node:assert/strict";
import test from "node:test";

import { buildBsideMcpConfig } from "./bside-mcp-preset";

test("builds the Bside agent HTTP connector pinned to one profile", () => {
  assert.deepEqual(
    buildBsideMcpConfig({
      profileId: "  maya browser ",
      baseUrl: " http://host.docker.internal:27433/ ",
    }),
    {
      name: "bside",
      transport: "http",
      url: "http://host.docker.internal:27433/mcp/agent/maya%20browser",
      auth: "none",
      trust: "full",
    },
  );
});

test("the preset carries no secrets or confirmation", () => {
  const input = buildBsideMcpConfig({ profileId: "p", baseUrl: "http://127.0.0.1:27433" });
  assert.equal("env" in input, false);
  assert.equal("headers" in input, false);
  assert.equal("confirmName" in input, false);
});
