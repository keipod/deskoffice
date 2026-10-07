import assert from "node:assert/strict";
import test from "node:test";

import { isDeskOfficeBsideBridge } from "./bside-mcp";

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
