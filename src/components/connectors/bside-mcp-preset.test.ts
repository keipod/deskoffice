import assert from "node:assert/strict";
import test from "node:test";

import {
  BSIDE_API_TOKEN_ENV,
  BSIDE_API_URL_ENV,
  BSIDE_MCP_COMMAND,
  buildBsideMcpConfig,
} from "./bside-mcp-preset";

test("builds the fixed untrusted Bside stdio connector without optional environment values", () => {
  const config = buildBsideMcpConfig({ profileId: "browser-profile-7" });

  assert.deepEqual(config, {
    input: {
      name: "bside",
      transport: "stdio",
      command: BSIDE_MCP_COMMAND,
      args: ["--profile", "browser-profile-7"],
      auth: "none",
      trust: "untrusted",
      confirmName: "bside",
    },
    secretValues: {},
  });
});

test("keeps Bside endpoint and token out of the create body and prepares them as secrets", () => {
  const config = buildBsideMcpConfig({
    profileId: "  maya-browser  ",
    apiUrl: " https://bside.internal.example ",
    apiToken: "token-value",
  });

  assert.deepEqual(config.input, {
    name: "bside",
    transport: "stdio",
    command: BSIDE_MCP_COMMAND,
    args: ["--profile", "maya-browser"],
    env: { [BSIDE_API_URL_ENV]: "", [BSIDE_API_TOKEN_ENV]: "" },
    auth: "env",
    trust: "untrusted",
    confirmName: "bside",
  });
  assert.deepEqual(config.secretValues, {
    [BSIDE_API_URL_ENV]: "https://bside.internal.example",
    [BSIDE_API_TOKEN_ENV]: "token-value",
  });
  assert.equal(JSON.stringify(config.input).includes("token-value"), false);
});

test("omits blank optional Bside values", () => {
  const config = buildBsideMcpConfig({ profileId: "p", apiUrl: "  ", apiToken: "  " });

  assert.equal("env" in config.input, false);
  assert.equal(config.input.auth, "none");
  assert.deepEqual(config.secretValues, {});
});
