import assert from "node:assert/strict";
import test from "node:test";
import { extractJson } from "../server/browser-agent.js";

test("browser agent parses plain JSON decisions", () => {
  assert.deepEqual(extractJson('{"action":"click","target":"a12"}'), {
    action: "click",
    target: "a12"
  });
});

test("browser agent parses fenced JSON decisions", () => {
  assert.deepEqual(
    extractJson('```json\n{"action":"finish","result":"완료"}\n```'),
    { action: "finish", result: "완료" }
  );
});
