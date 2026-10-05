import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if ([".git", "node_modules", "dist", "data"].includes(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

test("standalone main does not import or reference DeskRPG implementation", () => {
  const files = walk(root);
  const offenders: string[] = [];
  for (const file of files) {
    if (!/\.(ts|tsx|js|jsx|json|md|css|html)$/.test(file)) continue;
    const text = readFileSync(file, "utf8");
    if (/from\s+["'][^"']*deskrpg|dandacompany\/deskrpg|src\/game\/|src\/lib\/hermes\/setup/i.test(text)) {
      offenders.push(relative(root, file));
    }
  }
  assert.deepEqual(offenders, []);
});

test("standalone source stays intentionally small", () => {
  const sourceFiles = walk(join(root, "src")).filter((file) => /\.(ts|tsx|css)$/.test(file));
  const serverFiles = walk(join(root, "server")).filter((file) => /\.ts$/.test(file));
  assert.ok(sourceFiles.length + serverFiles.length < 40, "DeskOffice should remain a small standalone codebase");
});
