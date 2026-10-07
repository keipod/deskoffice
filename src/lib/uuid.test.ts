import assert from "node:assert/strict";
import test from "node:test";

import { createClientUuid, isUuid } from "./uuid";

test("client UUIDs work on LAN HTTP where randomUUID is unavailable", (t) => {
  const fill = t.mock.fn((bytes: Uint8Array) => bytes.fill(255));
  t.mock.method(globalThis, "crypto", () => ({ getRandomValues: fill }), { getter: true });

  const id = createClientUuid();

  assert.equal(id, "ffffffff-ffff-4fff-bfff-ffffffffffff");
  assert.equal(isUuid(id), true);
  assert.equal(fill.mock.callCount(), 1);
});

test("client UUIDs use native randomUUID when available", (t) => {
  const expected = "0192f3a4-5b6c-4d8e-9f01-23456789abcd";
  const native = t.mock.method(crypto, "randomUUID", () => expected);

  assert.equal(createClientUuid(), expected);
  assert.equal(native.mock.callCount(), 1);
});

test("isUuid accepts the canonical form in either case", () => {
  assert.equal(isUuid("0192f3a4-5b6c-7d8e-9f01-23456789abcd"), true);
  assert.equal(isUuid(crypto.randomUUID()), true);
  assert.equal(isUuid("0192F3A4-5B6C-7D8E-9F01-23456789ABCD"), true);
});

test("isUuid rejects anything a uuid column would fail to parse", () => {
  for (const value of [
    "not-a-uuid",
    "",
    "0192f3a45b6c7d8e9f0123456789abcd",
    " 0192f3a4-5b6c-7d8e-9f01-23456789abcd",
    42,
    null,
    undefined,
    {},
  ]) {
    assert.equal(isUuid(value), false, String(value));
  }
});
