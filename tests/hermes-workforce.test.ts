import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeBinding, isAuthorized, originMatchesHost } from "../server/security.js";
import { parseBotScreenStatus, getBotScreenStatus } from "../server/bot-screens.js";

test("server defaults to local-only unless authenticated", () => {
  assert.doesNotThrow(() => assertSafeBinding("127.0.0.1"));
  assert.throws(() => assertSafeBinding("0.0.0.0"), /DESKOFFICE_BASIC_PASSWORD/);
  assert.doesNotThrow(() => assertSafeBinding("0.0.0.0", "strong-pass"));
});

test("Basic auth checks the complete secret", () => {
  const pass = "demo-test-password";
  const header = "Basic " + Buffer.from("admin:" + pass).toString("base64");
  assert.equal(isAuthorized(header, pass), true);
  assert.equal(isAuthorized(header, "wrong"), false);
  assert.equal(isAuthorized(undefined, pass), false);
  assert.equal(isAuthorized("Bearer " + pass, pass), false);
  assert.equal(isAuthorized("Basic too:bad", pass), false);
});

test("cross origin writes are rejected", () => {
  assert.equal(originMatchesHost("http://127.0.0.1:32184", "127.0.0.1:32184"), true);
  assert.equal(originMatchesHost("https://evil.example", "127.0.0.1:32184"), false);
  assert.equal(originMatchesHost(undefined, "127.0.0.1:32184"), true);
});

test("screen parser does not confuse missing packages with running desktop", () => {
  assert.equal(parseBotScreenStatus("Bot Desktop: packages missing → Xvnc, xfwm4").state, "missing_packages");
  assert.equal(parseBotScreenStatus("Bot Screen: not running").state, "stopped");
  assert.equal(parseBotScreenStatus("Bot Screen: running (display: :12)").state, "running");
  assert.equal(parseBotScreenStatus("permission denied", false).state, "unavailable");
});

test("installed Hermes CLI reports an actual screen state", async () => {
  const result = await getBotScreenStatus("chief");
  assert.ok(["running", "stopped", "missing_packages", "unavailable", "unknown"].includes(result.state));
  assert.ok(result.detail);
});
