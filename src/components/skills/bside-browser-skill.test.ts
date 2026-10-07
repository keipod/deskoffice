import assert from "node:assert/strict";
import test from "node:test";

import {
  BSIDE_BROWSER_SKILL_DESCRIPTION,
  BSIDE_BROWSER_SKILL_NAME,
  bsideBrowserSkillTemplate,
} from "./bside-browser-skill";

const TOOLS = [
  "health",
  "tabs",
  "open",
  "activate_tab",
  "back",
  "forward",
  "reload",
  "navigate",
  "snapshot",
  "text",
  "wait",
  "click",
  "type",
  "hover",
  "select",
  "scroll",
  "key",
  "upload",
  "evaluate",
  "screenshot",
  "history",
  "workflows",
  "workflow_probe",
  "workflow_run",
  "workflow_runs",
  "agent_task",
  "memory_search",
  "memory_remember",
  "vault_fill",
  "approvals",
];

test("Bside browser skill is a profile-pinned SNS browsing playbook", () => {
  const skill = bsideBrowserSkillTemplate();

  assert.equal(BSIDE_BROWSER_SKILL_NAME, "deskoffice-bside-browser");
  assert.ok(
    skill.startsWith(
      `---\nname: ${BSIDE_BROWSER_SKILL_NAME}\ndescription: ${BSIDE_BROWSER_SKILL_DESCRIPTION}\n---`,
    ),
  );
  for (const tool of TOOLS) {
    assert.match(skill, new RegExp(`\`deskoffice_bside_${tool}\``), tool);
  }
  for (const workflow of [
    "youtube.publish",
    "youtube.analytics.inspect",
    "youtube.comments.inspect",
    "instagram.publish",
    "threads.publish",
  ]) {
    assert.ok(skill.includes(`\`${workflow}\``), workflow);
  }
  assert.match(skill, /sensitive: true/);
  assert.match(skill, /human approval/);
});
