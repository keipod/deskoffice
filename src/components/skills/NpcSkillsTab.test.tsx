import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";

import NpcSkillsTab from "./NpcSkillsTab";
import { BSIDE_BROWSER_SKILL_NAME } from "./bside-browser-skill";
import {
  LIST,
  ROOT,
  cleanup,
  container,
  flush,
  mockFetch,
  render,
  row,
  text,
} from "./skills-test-harness";

const view = (over: Record<string, unknown> = {}) => ({
  skills: [row("weekly")],
  canManage: false,
  capabilityReady: true,
  sharedChannelCount: 0,
  ...over,
});

const tab = (npcId = "n-1") => (
  <NpcSkillsTab key={npcId} channelId="ch-1" npcId={npcId} onOpenManager={() => {}} />
);

test.afterEach(cleanup);

test("members see an on/off label only, owners get a switch", async () => {
  mockFetch({ [LIST]: view() });
  await render(tab());
  assert.equal(container.querySelectorAll('[role="switch"]').length, 0);
  assert.ok(text().includes("켜짐"));
  await cleanup();
  mockFetch({ [LIST]: view({ canManage: true }) });
  await render(tab());
  assert.equal(container.querySelectorAll('[role="switch"]').length, 1);
});

test("shared-channel warning and a disabled switch for an essential skill", async () => {
  mockFetch({
    [LIST]: view({
      skills: [row("hermes-agent", { essential: true })],
      canManage: true,
      sharedChannelCount: 2,
    }),
  });
  await render(tab());
  assert.ok(text().includes("다른 채널 2곳"));
  assert.equal((container.querySelector('[role="switch"]') as HTMLButtonElement).disabled, true);
});

test("toggling the switch sends PUT …/enabled then reloads", async () => {
  const log = mockFetch({
    [LIST]: view({ canManage: true }),
    [`PUT ${ROOT}/weekly/enabled`]: { name: "weekly", enabled: false },
  });
  await render(tab());
  await act(async () => (container.querySelector('[role="switch"]') as HTMLButtonElement).click());
  await flush();
  assert.deepEqual(log.calls, [LIST, `PUT ${ROOT}/weekly/enabled`, LIST]);
  assert.deepEqual(log.bodies[`PUT ${ROOT}/weekly/enabled`], { enabled: false });
});

test("without the capability, shows an upgrade notice and no manage button", async () => {
  mockFetch({ [LIST]: view({ capabilityReady: false }) });
  await render(tab());
  assert.ok(text().includes("0.15.0"));
  assert.ok(!container.querySelector('[data-testid="open-skill-manager"]'));
});

test("group headers, use/view counts, and description on row click", async () => {
  mockFetch({
    [LIST]: view({
      skills: [
        row("weekly", { useCount: 3, viewCount: 1, description: "주간 보고" }),
        row("pdf", { source: "hub" }),
      ],
    }),
  });
  await render(tab());
  assert.ok(text().includes("로컬"));
  assert.ok(text().includes("Hub"));
  assert.ok(text().includes("사용 3 · 조회 1"));
  assert.ok(!text().includes("주간 보고"));
  await act(async () =>
    (container.querySelector('[data-skill-row="weekly"]') as HTMLElement).click(),
  );
  await flush();
  assert.ok(text().includes("주간 보고"));
});

test("when the gateway is disconnected (409), shows a reconnect notice instead of the list", async () => {
  mockFetch({ [LIST]: { status: 409, json: { code: "gateway_disconnected", message: "" } } });
  await render(tab());
  assert.ok(text().includes("게이트웨이 연결이 끊겼습니다"));
});

test("an expanded row's [Edit] opens the manager modal with that skill's name", async () => {
  mockFetch({ [LIST]: view({ canManage: true }) });
  const opened: (string | undefined)[] = [];
  await render(
    <NpcSkillsTab channelId="ch-1" npcId="n-1" onOpenManager={(name) => opened.push(name)} />,
  );
  await act(async () =>
    (container.querySelector('[data-skill-row="weekly"]') as HTMLElement).click(),
  );
  await flush();
  await act(async () =>
    (container.querySelector('[data-action="edit-in-manager"]') as HTMLElement).click(),
  );
  await act(async () =>
    (container.querySelector('[data-testid="open-skill-manager"]') as HTMLElement).click(),
  );
  assert.deepEqual(opened, ["weekly", undefined]);
});

test("[Use] appears on enabled rows only and passes the skill name", async () => {
  mockFetch({
    [LIST]: view({
      skills: [row("research"), row("weekly", { disabled: true })],
      skillInvocation: true,
    }),
  });
  const used: string[] = [];
  await render(
    <NpcSkillsTab
      channelId="ch-1"
      npcId="n-1"
      onOpenManager={() => {}}
      onUseSkill={(name) => used.push(name)}
    />,
  );
  const buttons = container.querySelectorAll<HTMLButtonElement>("[data-use-skill]");
  assert.deepEqual(
    [...buttons].map((b) => b.dataset.useSkill),
    ["research"],
  );
  assert.equal(buttons[0].textContent, "사용");
  await act(async () => buttons[0].click());
  assert.deepEqual(used, ["research"]);
});

test("[Use] is hidden without the skill_invocation capability or a handler", async () => {
  mockFetch({ [LIST]: view({ skills: [row("research")] }) });
  await render(
    <NpcSkillsTab channelId="ch-1" npcId="n-1" onOpenManager={() => {}} onUseSkill={() => {}} />,
  );
  assert.equal(container.querySelectorAll("[data-use-skill]").length, 0);
  await cleanup();
  mockFetch({ [LIST]: view({ skills: [row("research")], skillInvocation: true }) });
  await render(tab());
  assert.equal(container.querySelectorAll("[data-use-skill]").length, 0);
});

test("a skill-manager refresh tick rereads the Skills menu and exposes a newly installed Bside skill", async () => {
  const routes = { [LIST]: view({ skillInvocation: true }) };
  const log = mockFetch(routes);
  const use = () => {};
  await render(
    <NpcSkillsTab
      channelId="ch-1"
      npcId="n-1"
      onOpenManager={() => {}}
      onUseSkill={use}
      refreshTick={0}
    />,
  );
  assert.ok(!container.querySelector(`[data-skill-row="${BSIDE_BROWSER_SKILL_NAME}"]`));

  routes[LIST] = view({
    skills: [row("weekly"), row(BSIDE_BROWSER_SKILL_NAME)],
    skillInvocation: true,
  });
  await render(
    <NpcSkillsTab
      channelId="ch-1"
      npcId="n-1"
      onOpenManager={() => {}}
      onUseSkill={use}
      refreshTick={1}
    />,
  );

  assert.ok(container.querySelector(`[data-skill-row="${BSIDE_BROWSER_SKILL_NAME}"]`));
  assert.ok(container.querySelector(`[data-use-skill="${BSIDE_BROWSER_SKILL_NAME}"]`));
  assert.equal(log.calls.filter((call) => call === LIST).length, 2);
});
