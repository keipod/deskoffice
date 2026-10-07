/**
 * The local, profile-scoped playbook installed from DeskOffice's Skills menu.
 * It deliberately names only the capability-limited MCP tools published by
 * `deskoffice-bside-mcp`; this is not a dependency on Bside source code.
 */
export const BSIDE_BROWSER_SKILL_NAME = "deskoffice-bside-browser";

export const BSIDE_BROWSER_SKILL_DESCRIPTION =
  "Use this agent's assigned Bside personal browser through its scoped DeskOffice MCP tools.";

export function bsideBrowserSkillTemplate(): string {
  return `---
name: ${BSIDE_BROWSER_SKILL_NAME}
description: ${BSIDE_BROWSER_SKILL_DESCRIPTION}
---

# DeskOffice Bside Personal Browser

Use this skill for browser work assigned to this employee. The Bside MCP server is this employee's personal PC/browser capability and is pinned to one Bside profile.

## Start safely

1. Call \`deskoffice_bside_health\`, then \`deskoffice_bside_tabs\`.
2. Work only with the listed tab IDs. If there is no suitable tab, call \`deskoffice_bside_open\` to create one in this profile.
3. Before changing a page, call \`deskoffice_bside_snapshot\`; use the returned accessibility reference or an explicit scoped tab ID.

## Work loop

1. Navigate with \`deskoffice_bside_navigate\` or inspect with \`deskoffice_bside_snapshot\`.
2. Use \`deskoffice_bside_wait\` after navigation or an SPA action instead of repeatedly guessing page state.
3. Use \`deskoffice_bside_click\` and \`deskoffice_bside_type\` for normal page interaction. Keep the tab ID explicit when more than one tab is open.
4. Use \`deskoffice_bside_history\` only for the assigned profile's redacted visit history.

## Approval and boundaries

- Set \`sensitive: true\` for publish, send, delete, purchase, account, or other irreversible actions. Bside will stop for a human approval; report that state and do not try to bypass or repeat it through another tool.
- Do not request another Bside profile, generic \`bside_*\` administration tools, raw CDP, credentials, files, or system settings. This skill is browser work only.
- Do not infer that a page action succeeded. Snapshot or wait for the resulting state and report the concrete outcome, tab, and any approval still needed.
`;
}
