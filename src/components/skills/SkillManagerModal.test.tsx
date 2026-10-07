import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";

import SkillDetailPane from "./SkillDetailPane";
import SkillManagerModal from "./SkillManagerModal";
import { BSIDE_BROWSER_SKILL_NAME, bsideBrowserSkillTemplate } from "./bside-browser-skill";
import { createSkillsApi } from "./skills-api";
import {
  $,
  LIST,
  ROOT,
  cleanup,
  click,
  container,
  flush,
  holdFetch,
  mockFetch,
  render,
  row,
  text,
  type,
  waitFor,
} from "./skills-test-harness";

const listBody = (canManage = true) => ({
  skills: [row("weekly"), row("pdf", { source: "hub" })],
  canManage,
  capabilityReady: true,
  sharedChannelCount: 0,
});
const detail = (over: Record<string, unknown> = {}) => ({
  skill: {
    name: "weekly",
    source: "local",
    curatorManaged: false,
    pinned: false,
    frontmatter: { name: "weekly" },
    ...over,
  },
  files: [
    { path: "SKILL.md", size: 10, editable: true },
    { path: "scripts/run.py", size: 5, editable: false },
  ],
});
const file = (content: string, hash: string) => ({ path: "SKILL.md", content, hash });
const opened = () => ({
  [`GET ${ROOT}/weekly`]: detail(),
  [`GET ${ROOT}/weekly/file?path=SKILL.md`]: file("본문", "h1"),
});
// Auxiliary fetch the modal also makes (curator row) — kept as a default so tests don't have to add it each time.
const extras = {
  [`GET ${ROOT}/curator`]: {
    enabled: true,
    paused: false,
    intervalHours: 24,
    lastRunAt: null,
    minIdleHours: 2,
    staleAfterDays: 14,
    archiveAfterDays: 30,
  },
};

let closed = 0;
const modal = (onBsideSkillInstalled?: () => void) => (
  <SkillManagerModal
    channelId="ch-1"
    npcId="n-1"
    npcName="소피"
    onClose={() => {
      closed += 1;
    }}
    onBsideSkillInstalled={onBsideSkillInstalled}
  />
);

test.afterEach(cleanup);

test("header shows employee name; picking a skill shows file tree and editor, scripts locked", async () => {
  mockFetch({ ...extras, [LIST]: listBody(), ...opened() });
  await render(modal());
  assert.ok(text().includes("소피 · 스킬 관리"));
  await click('[data-skill="weekly"]');
  assert.ok(container.querySelector('[data-file="scripts/run.py"][data-locked="true"]'));
  assert.ok(container.querySelector('[data-file="SKILL.md"][data-locked="false"]'));
  assert.equal(($("textarea") as HTMLTextAreaElement).value, "본문");
});

test("save carries baseHash; on conflict shows reload without clearing content", async () => {
  const log = mockFetch({
    ...extras,
    [LIST]: listBody(),
    ...opened(),
    [`PUT ${ROOT}/weekly/file`]: { status: 409, json: { code: "skill_changed", message: "" } },
  });
  await render(modal());
  await click('[data-skill="weekly"]');
  await type("textarea", "내 변경");
  await click('[data-action="save"]');
  assert.deepEqual(log.bodies[`PUT ${ROOT}/weekly/file`], {
    path: "SKILL.md",
    content: "내 변경",
    baseHash: "h1",
  });
  assert.equal(($("textarea") as HTMLTextAreaElement).value, "내 변경");
  assert.ok(container.querySelector('[data-action="reload"]'));
});

test("a member sees a read-only editor with no change buttons or add tab", async () => {
  mockFetch({ ...extras, [LIST]: listBody(false), ...opened() });
  await render(modal());
  await click('[data-skill="weekly"]');
  assert.equal(($("textarea") as HTMLTextAreaElement).readOnly, true);
  for (const a of ["save", "pin", "archive", "disable-unused", "enable-all", "disable-all"]) {
    assert.ok(!container.querySelector(`[data-action="${a}"]`), a);
  }
  assert.ok(!container.querySelector('[data-tab="add"]'));
});

test("a locked file is read-only even for the owner, with no save button", async () => {
  mockFetch({
    ...extras,
    [LIST]: listBody(),
    ...opened(),
    [`GET ${ROOT}/weekly/file?path=scripts%2Frun.py`]: {
      path: "scripts/run.py",
      content: "print(1)",
      hash: "h2",
    },
  });
  await render(modal());
  await click('[data-skill="weekly"]');
  await click('[data-file="scripts/run.py"]');
  assert.equal(($("textarea") as HTMLTextAreaElement).value, "print(1)");
  assert.equal(($("textarea") as HTMLTextAreaElement).readOnly, true);
  assert.ok(!container.querySelector('[data-action="save"]'));
});

test("archive goes through confirmation, POSTs …/archive, then clears the selection", async () => {
  const log = mockFetch({
    ...extras,
    [LIST]: listBody(),
    ...opened(),
    [`POST ${ROOT}/weekly/archive`]: { name: "weekly" },
  });
  await render(modal());
  await click('[data-skill="weekly"]');
  await click('[data-action="archive"]');
  assert.ok(!log.calls.includes(`POST ${ROOT}/weekly/archive`));
  await click('[data-action="confirm-archive"]');
  assert.ok(log.calls.includes(`POST ${ROOT}/weekly/archive`));
  assert.ok(!container.querySelector("textarea"));
});

test("pin PUTs …/pinned then re-reads the detail", async () => {
  const log = mockFetch({
    ...extras,
    [LIST]: listBody(),
    ...opened(),
    [`PUT ${ROOT}/weekly/pinned`]: { name: "weekly", pinned: true },
  });
  await render(modal());
  await click('[data-skill="weekly"]');
  await click('[data-action="pin"]');
  assert.deepEqual(log.bodies[`PUT ${ROOT}/weekly/pinned`], { pinned: true });
  assert.equal(log.calls.filter((c) => c === `GET ${ROOT}/weekly`).length, 2);
});

test("disable-unused shows the list, then bulk PUTs on confirm", async () => {
  const log = mockFetch({
    ...extras,
    [LIST]: listBody(),
    [`PUT ${ROOT}/enabled`]: { disabled: ["weekly", "pdf"] },
  });
  await render(modal());
  await click('[data-action="disable-unused"]');
  assert.ok(text().includes("다음 2개를 바꿉니다"));
  assert.ok(!log.calls.includes(`PUT ${ROOT}/enabled`));
  await click('[data-action="confirm-bulk"]');
  assert.deepEqual(log.bodies[`PUT ${ROOT}/enabled`], { enable: [], disable: ["weekly", "pdf"] });
});

test("create fills the template and POSTs; an invalid name disables the button", async () => {
  const log = mockFetch({
    ...extras,
    [LIST]: listBody(),
    [`POST ${ROOT}/`]: { name: "invoice" },
    [`GET ${ROOT}/invoice`]: detail({ name: "invoice" }),
    [`GET ${ROOT}/invoice/file?path=SKILL.md`]: file("x", "h9"),
  });
  await render(modal());
  await click('[data-tab="add"]');
  await click('[data-add="new"]');
  await type('[name="skill-name"]', "Invoice");
  await type('[name="skill-description"]', "청구서");
  assert.equal(($('[data-action="create"]') as HTMLButtonElement).disabled, true);
  await type('[name="skill-name"]', "invoice");
  await click('[data-action="create"]');
  const body = log.bodies[`POST ${ROOT}/`] as { name: string; content: string };
  assert.equal(body.name, "invoice");
  assert.ok(body.content.startsWith("---\nname: invoice\ndescription: 청구서\n---"));
});

test("Bside browser skill installs a scoped MCP work playbook from the Skills menu", async () => {
  const log = mockFetch({
    ...extras,
    [LIST]: listBody(),
    [`POST ${ROOT}/`]: { name: BSIDE_BROWSER_SKILL_NAME },
    [`GET ${ROOT}/${BSIDE_BROWSER_SKILL_NAME}`]: detail({ name: BSIDE_BROWSER_SKILL_NAME }),
    [`GET ${ROOT}/${BSIDE_BROWSER_SKILL_NAME}/file?path=SKILL.md`]: file(
      bsideBrowserSkillTemplate(),
      "bside-hash",
    ),
  });
  await render(modal());
  await click('[data-tab="add"]');
  await click('[data-add="bside"]');
  assert.ok(container.querySelector("[data-bside-skill]"));
  await click('[data-action="install-bside-skill"]');

  const body = log.bodies[`POST ${ROOT}/`] as {
    name: string;
    category: string;
    content: string;
  };
  assert.equal(body.name, BSIDE_BROWSER_SKILL_NAME);
  assert.equal(body.category, "browser");
  assert.equal(body.content, bsideBrowserSkillTemplate());
});

test("installing the Bside browser skill refreshes the underlying Skills tab", async () => {
  let refreshed = 0;
  mockFetch({
    ...extras,
    [LIST]: listBody(),
    [`POST ${ROOT}/`]: { name: BSIDE_BROWSER_SKILL_NAME },
    [`GET ${ROOT}/${BSIDE_BROWSER_SKILL_NAME}`]: detail({ name: BSIDE_BROWSER_SKILL_NAME }),
    [`GET ${ROOT}/${BSIDE_BROWSER_SKILL_NAME}/file?path=SKILL.md`]: file(
      bsideBrowserSkillTemplate(),
      "bside-hash",
    ),
  });
  await render(
    modal(() => {
      refreshed += 1;
    }),
  );
  await click('[data-tab="add"]');
  await click('[data-add="bside"]');
  await click('[data-action="install-bside-skill"]');
  assert.equal(refreshed, 1);
});

test("Esc closes, but not when a higher layer already handled it (defaultPrevented)", async () => {
  mockFetch({ ...extras, [LIST]: listBody() });
  closed = 0;
  await render(modal());
  const prevented = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
  prevented.preventDefault();
  await act(async () => {
    window.dispatchEvent(prevented);
  });
  assert.equal(closed, 0);
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
  });
  await flush();
  assert.equal(closed, 1);
});

test("opening with initialSkill shows that skill's detail immediately, and a count on the archive tab", async () => {
  mockFetch({
    ...extras,
    [LIST]: listBody(),
    ...opened(),
    [`GET ${ROOT}/archive`]: { archived: [{ name: "old", archivedAt: null }] },
  });
  await render(
    <SkillManagerModal
      channelId="ch-1"
      npcId="n-1"
      npcName="소피"
      initialSkill="weekly"
      onClose={() => {}}
    />,
  );
  assert.equal(($("textarea") as HTMLTextAreaElement).value, "본문");
  assert.equal($('[data-badge="archive"]').textContent, "1");
});

test("Hub skill [delete] confirms, polls the job to completion, then clears the selection", async () => {
  const log = mockFetch({
    [`GET ${ROOT}/pdf`]: { ...detail({ name: "pdf", source: "hub" }), files: [] },
    [`GET ${ROOT}/pdf/file?path=SKILL.md`]: file("hub", "h3"),
    [`POST ${ROOT}/hub/uninstall`]: { jobId: "u1" },
    [`GET ${ROOT}/hub/installs/u1`]: {
      jobId: "u1",
      kind: "hub_uninstall",
      state: "succeeded",
      exitCode: 0,
      outputTail: "",
    },
  });
  let removed = 0;
  await render(
    <SkillDetailPane
      api={createSkillsApi("ch-1", "n-1")}
      name="pdf"
      canManage
      onChanged={() => {}}
      onRemoved={() => {
        removed += 1;
      }}
      pollIntervalMs={1}
    />,
  );
  assert.ok(!container.querySelector('[data-action="pin"]'));
  await click('[data-action="uninstall"]');
  await click('[data-action="confirm-uninstall"]');
  await flush();
  assert.deepEqual(log.bodies[`POST ${ROOT}/hub/uninstall`], { name: "pdf" });
  assert.ok(log.calls.includes(`GET ${ROOT}/hub/installs/u1`));
  assert.equal(removed, 1);
});

test("a pinned local skill has [archive] disabled and shows an unpin hint", async () => {
  mockFetch({
    [`GET ${ROOT}/weekly`]: detail({ pinned: true }),
    [`GET ${ROOT}/weekly/file?path=SKILL.md`]: file("본문", "h1"),
  });
  await render(
    <SkillDetailPane
      api={createSkillsApi("ch-1", "n-1")}
      name="weekly"
      canManage
      onChanged={() => {}}
    />,
  );
  assert.equal(($('[data-action="archive"]') as HTMLButtonElement).disabled, true);
  assert.ok(text().includes("먼저 고정을 해제하세요"));
  assert.ok(text().includes("고정 해제"));
});

test("when archive is rejected with 409 skill_pinned, it shows the same hint", async () => {
  mockFetch({
    ...opened(),
    [`POST ${ROOT}/weekly/archive`]: { status: 409, json: { code: "skill_pinned", message: "" } },
  });
  await render(
    <SkillDetailPane
      api={createSkillsApi("ch-1", "n-1")}
      name="weekly"
      canManage
      onChanged={() => {}}
    />,
  );
  await click('[data-action="archive"]');
  await click('[data-action="confirm-archive"]');
  assert.ok(text().includes("먼저 고정을 해제하세요"));
});

test("before picking a skill, the right pane shows a prompt to pick one", async () => {
  mockFetch({ ...extras, [LIST]: listBody() });
  await render(modal());
  assert.ok(text().includes("왼쪽에서 스킬을 고르세요"));
  mockFetch({ ...extras, [LIST]: listBody(), ...opened() });
  await click('[data-skill="weekly"]');
  assert.ok(!text().includes("왼쪽에서 스킬을 고르세요"));
});

test("a reference file is read-only even when the plugin marks it editable, and points to the chat", async () => {
  const asked: string[] = [];
  mockFetch({
    ...extras,
    [LIST]: listBody(),
    [`GET ${ROOT}/weekly`]: {
      ...detail(),
      files: [
        { path: "SKILL.md", size: 10, editable: true },
        { path: "references/guide.md", size: 5, editable: true },
      ],
    },
    [`GET ${ROOT}/weekly/file?path=SKILL.md`]: file("본문", "h1"),
    [`GET ${ROOT}/weekly/file?path=references%2Fguide.md`]: {
      path: "references/guide.md",
      content: "guide",
      hash: "h5",
    },
  });
  await render(
    <SkillManagerModal
      channelId="ch-1"
      npcId="n-1"
      npcName="소피"
      onClose={() => {}}
      onAskInChat={() => asked.push("chat")}
    />,
  );
  await click('[data-skill="weekly"]');
  assert.ok($('[data-action="save"]'), "SKILL.md still saves");
  await click('[data-file="references/guide.md"]');
  assert.equal(($("textarea") as HTMLTextAreaElement).readOnly, true);
  assert.ok(!container.querySelector('[data-action="save"]'));
  assert.match($("[data-reference-hint]").textContent ?? "", /대화로 수정을 요청/);
  await click('[data-action="ask-in-chat"]');
  assert.deepEqual(asked, ["chat"]);
});

test("screens whose feature is off are hidden while the rest keep working", async () => {
  mockFetch({
    ...extras,
    [LIST]: {
      ...listBody(),
      features: { read: true, edit: true, hub: false, curator: false, graph: false },
      profileName: "sophie",
    },
    ...opened(),
  });
  await render(modal());
  assert.ok(!container.querySelector("[data-curator-bar]"), "no curator bar");
  assert.ok(!container.querySelector('[data-tab="graph"]'), "no graph tab");
  assert.ok($('[data-tab="archive"]'));
  await click('[data-tab="add"]');
  assert.ok(!container.querySelector('[data-add="hub"]'), "no hub install");
  assert.ok($('[data-add="new"]'), "new skill still offered");
});

const hubDetail = () => ({
  [`GET ${ROOT}/pdf`]: { ...detail({ name: "pdf", source: "hub" }), files: [] },
  [`GET ${ROOT}/pdf/file?path=SKILL.md`]: file("hub", "h3"),
});
const updateState = () =>
  container.querySelector("[data-update-state]")?.getAttribute("data-update-state") ?? null;
const outcome = () =>
  container.querySelector("[data-update-state]")?.getAttribute("data-update-outcome") ?? null;
const updateJob = (outputTail: string, state = "succeeded") => ({
  jobId: "up1",
  kind: "hub_update",
  state,
  exitCode: state === "succeeded" ? 0 : 1,
  outputTail,
});

test("Hub skill [update] shows progress, then 'no update' when Hermes had nothing newer", async () => {
  const log = mockFetch({
    ...hubDetail(),
    [`POST ${ROOT}/hub/update`]: { jobId: "up1" },
    [`GET ${ROOT}/hub/installs/up1`]: updateJob("No updates available.\n"),
  });
  const post = holdFetch(`POST ${ROOT}/hub/update`);
  let changed = 0;
  await render(
    <SkillDetailPane
      api={createSkillsApi("ch-1", "n-1")}
      name="pdf"
      canManage
      onChanged={() => {
        changed += 1;
      }}
      pollIntervalMs={1}
    />,
  );
  await click('[data-action="hub-update"]');
  assert.equal($("[data-update-state]").getAttribute("data-update-state"), "running");
  assert.equal(($('[data-action="hub-update"]') as HTMLButtonElement).disabled, true);
  post.release();
  await waitFor(() => outcome() !== null, "the update outcome");
  assert.deepEqual(log.bodies[`POST ${ROOT}/hub/update`], { name: "pdf" });
  assert.equal($("[data-update-state]").getAttribute("data-update-outcome"), "none");
  assert.ok(text().includes("업데이트 없음"));
  assert.equal(changed, 0, "nothing changed, so the list is not reloaded");
});

test("Hub skill [update] that installed a newer version reloads the skill and the list", async () => {
  const log = mockFetch({
    ...hubDetail(),
    [`POST ${ROOT}/hub/update`]: { jobId: "up1" },
    [`GET ${ROOT}/hub/installs/up1`]: updateJob("Updating: pdf\nUpdated 1 skill(s).\n"),
  });
  let changed = 0;
  await render(
    <SkillDetailPane
      api={createSkillsApi("ch-1", "n-1")}
      name="pdf"
      canManage
      onChanged={() => {
        changed += 1;
      }}
      pollIntervalMs={1}
    />,
  );
  const detailReads = () => log.calls.filter((c) => c === `GET ${ROOT}/pdf`).length;
  const before = detailReads();
  await click('[data-action="hub-update"]');
  await waitFor(() => updateState() !== "running", "the update job to finish");
  assert.equal($("[data-update-state]").getAttribute("data-update-outcome"), "updated");
  assert.equal(detailReads(), before + 1);
  assert.equal(changed, 1);
});

test("Hub skill [update] reports local edits it kept, and a failure shows the output", async () => {
  mockFetch({
    ...hubDetail(),
    [`POST ${ROOT}/hub/update`]: { jobId: "up1" },
    [`GET ${ROOT}/hub/installs/up1`]: updateJob(
      "Skipping: pdf — you have local edits (update would overwrite them).\n",
    ),
  });
  await render(
    <SkillDetailPane
      api={createSkillsApi("ch-1", "n-1")}
      name="pdf"
      canManage
      onChanged={() => {}}
      pollIntervalMs={1}
    />,
  );
  await click('[data-action="hub-update"]');
  await waitFor(() => updateState() !== "running", "the update job to finish");
  assert.equal($("[data-update-state]").getAttribute("data-update-outcome"), "kept_local");

  mockFetch({
    ...hubDetail(),
    [`POST ${ROOT}/hub/update`]: { jobId: "up1" },
    [`GET ${ROOT}/hub/installs/up1`]: updateJob("network down", "failed"),
  });
  await render(
    <SkillDetailPane
      key="second"
      api={createSkillsApi("ch-1", "n-1")}
      name="pdf"
      canManage
      onChanged={() => {}}
      pollIntervalMs={1}
    />,
  );
  await click('[data-action="hub-update"]');
  await waitFor(() => updateState() !== "running", "the update job to finish");
  assert.equal($("[data-update-state]").getAttribute("data-update-state"), "failed");
  assert.ok(text().includes("network down"));
});

test("[update] is only offered for Hub skills, and not when Hub is off or the viewer can't manage", async () => {
  mockFetch({ ...hubDetail(), ...opened() });
  const pane = (key: string, over: Partial<React.ComponentProps<typeof SkillDetailPane>>) => (
    <SkillDetailPane
      key={key}
      api={createSkillsApi("ch-1", "n-1")}
      name="pdf"
      canManage
      onChanged={() => {}}
      {...over}
    />
  );
  await render(pane("p0", { name: "weekly" }));
  await flush();
  assert.equal(Boolean(container.querySelector('[data-action="hub-update"]')), false);
  await render(pane("p1", { hubEnabled: false }));
  await flush();
  assert.equal(Boolean(container.querySelector('[data-action="hub-update"]')), false);
  await render(pane("p2", { canManage: false }));
  await flush();
  assert.equal(Boolean(container.querySelector('[data-action="hub-update"]')), false);
  await render(pane("p3", {}));
  await flush();
  assert.equal(Boolean(container.querySelector('[data-action="hub-update"]')), true);
});
