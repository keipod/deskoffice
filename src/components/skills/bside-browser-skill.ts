/**
 * The local, profile-scoped playbook installed by the one-click Bside connect (or from the Skills
 * menu). It names the profile-pinned `deskoffice_bside_*` MCP tools Bside serves at
 * `/mcp/agent/<profile>`; this is not a dependency on Bside source code.
 */
export const BSIDE_BROWSER_SKILL_NAME = "deskoffice-bside-browser";

// Hermes rejects new skills whose description is over 60 chars: keep it one trigger-first sentence.
export const BSIDE_BROWSER_SKILL_DESCRIPTION =
  "Browse and manage SNS accounts in your own Bside browser.";

export function bsideBrowserSkillTemplate(): string {
  return `---
name: ${BSIDE_BROWSER_SKILL_NAME}
description: ${BSIDE_BROWSER_SKILL_DESCRIPTION}
version: 1.0.0
author: DeskOffice
license: MIT
metadata:
  hermes:
    tags: [browser, sns, youtube, instagram, threads, bside]
    related_skills: []
---

# DeskOffice Bside Personal Browser

## When to Use

Any task that needs a real, logged-in browser: checking or posting on YouTube, Instagram or Threads, reading comments and analytics, replying, researching pages, or anything a person would do by hand in a browser.

The \`bside\` MCP server is this employee's own PC/browser. It is pinned to one Bside profile: the logged-in accounts, cookies and history belong to this employee only. Other employees use other profiles, so several of you can work at the same time.

## Start

1. \`deskoffice_bside_health\` — confirm Bside is up.
2. \`deskoffice_bside_tabs\` — list this profile's tabs. Reuse a suitable tab; otherwise \`deskoffice_bside_open\` (opens in the background, so you never steal another employee's screen).
3. Keep the tab ID explicit in every call once more than one tab is open. Use \`deskoffice_bside_activate_tab\` only when something truly needs the foreground.
4. \`deskoffice_bside_memory_search\` for account context you saved earlier (handles, posting style, schedules, what was last checked).

## Reading pages

- \`deskoffice_bside_text\` — the readable text of the page. Use it to read posts, comments, captions, analytics numbers and studio tables. Cheapest way to understand content; pass \`maxChars\` for long pages.
- \`deskoffice_bside_snapshot\` — the accessibility tree with element refs. Use it before clicking or typing so you target a real ref, not a guess.
- \`deskoffice_bside_screenshot\` — a visual check (thumbnails, layout, whether a dialog is open, media previews). Use when text is not enough.
- \`deskoffice_bside_wait\` after navigation or any SPA action instead of guessing that the page changed.

## Browsing like a person

- \`deskoffice_bside_navigate\`, \`deskoffice_bside_back\`, \`deskoffice_bside_forward\`, \`deskoffice_bside_reload\` to move around.
- \`deskoffice_bside_scroll\` to move through feeds, comment threads and long analytics pages. Scroll in steps, read with \`text\` between steps, and stop when you have what you need; infinite feeds never end.
- \`deskoffice_bside_click\`, \`deskoffice_bside_type\` (human-like typing by default), \`deskoffice_bside_hover\` (reveal menus/tooltips), \`deskoffice_bside_select\` (dropdowns), \`deskoffice_bside_key\` (Enter, Escape, Tab, PageDown, ArrowDown…).
- \`deskoffice_bside_upload\` attaches media files (video, image) to the page's file input when posting.
- \`deskoffice_bside_evaluate\` runs a small read-only JavaScript expression when the page hides data the other tools cannot reach. Do not use it to bypass approvals.
- \`deskoffice_bside_history\` shows this profile's recent visits.

## SNS workflows

Bside has tested workflows for common SNS jobs. Prefer them over hand-driving the UI:

1. \`deskoffice_bside_workflows\` — list what is available.
2. \`deskoffice_bside_workflow_probe\` — check a workflow can run now (logged in, page reachable) before running it.
3. \`deskoffice_bside_workflow_run\`, then follow it with \`deskoffice_bside_workflow_runs\`.

Typical workflows: \`youtube.publish\`, \`youtube.analytics.inspect\`, \`youtube.comments.inspect\`, \`instagram.publish\`, \`threads.publish\`.

For a goal that needs many steps on its own, \`deskoffice_bside_agent_task\` hands it to Bside's built-in browser agent on this profile; check the result afterwards.

## Approval and boundaries

- Set \`sensitive: true\` on anything that publishes, posts, replies, sends, deletes, buys or changes account settings. Bside stops for a human approval; report that and check \`deskoffice_bside_approvals\` instead of retrying through another tool.
- Logins: use \`deskoffice_bside_vault_fill\` for saved credentials. Never type passwords from chat or write them to memory.
- Save durable account facts with \`deskoffice_bside_memory_remember\` (not secrets).
- Never assume an action worked. Confirm with \`text\`, \`snapshot\` or \`screenshot\`, then report the concrete result, the tab, and any approval still pending.
`;
}
