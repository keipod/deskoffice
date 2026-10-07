import assert from "node:assert/strict";
import test from "node:test";

import {
  BSIDE_BROWSER_SKILL_DESCRIPTION,
  BSIDE_BROWSER_SKILL_NAME,
  bsideBrowserSkillTemplate,
} from "./bside-browser-skill";

test("Bside browser skill is a scoped MCP work playbook", () => {
  const skill = bsideBrowserSkillTemplate();

  assert.ok(
    skill.startsWith(
      `---\nname: ${BSIDE_BROWSER_SKILL_NAME}\ndescription: ${BSIDE_BROWSER_SKILL_DESCRIPTION}\n---`,
    ),
  );
  for (const tool of [
    "deskoffice_bside_health",
    "deskoffice_bside_tabs",
    "deskoffice_bside_open",
    "deskoffice_bside_snapshot",
    "deskoffice_bside_wait",
    "deskoffice_bside_click",
    "deskoffice_bside_type",
    "deskoffice_bside_history",
  ]) {
    assert.match(skill, new RegExp(`\\\`${tool}\\\``));
  }
  assert.match(skill, /sensitive: true/);
  assert.match(skill, /human approval/);
  assert.match(skill, /Do not request another Bside profile/);
});
