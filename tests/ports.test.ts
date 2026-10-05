import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("DeskOffice owns a single distinctive service port", () => {
  const env = readFileSync(".env.example", "utf8");
  assert.match(env, /DESKOFFICE_PORT=32180/);
  assert.doesNotMatch(env, /3000|3001|3102|3103/);
});

test("Bside uses its current dedicated local API port", () => {
  const source = readFileSync("server/adapters/bside.ts", "utf8");
  assert.match(source, /127\.0\.0\.1:27433/);
});
