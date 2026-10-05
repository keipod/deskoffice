import assert from "node:assert/strict";
import test from "node:test";
import type { Agent } from "../src/shared/types";
import { recommendExperts, scoreAgentForTask } from "../server/expert-system.js";

function agent(overrides: Partial<Agent>): Agent {
  return {
    id: "a",
    name: "A",
    title: "Researcher",
    department: "Research",
    profession: "Research Analyst",
    specialty: "researcher",
    seniority: "mid",
    managerId: null,
    executor: "opencode",
    bsideProfileId: null,
    hermesProfileId: null,
    expertise: [{ skill: "research", level: 5 }],
    responsibilities: [],
    instructions: "",
    status: "idle",
    currentTask: null,
    workspaceSlug: "researcher",
    seatX: 0,
    seatZ: 0,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...overrides
  };
}

test("expert scoring strongly prefers matching specialty and skills", () => {
  const strong = scoreAgentForTask(
    agent({ id: "strong", seniority: "senior" }),
    "researcher",
    ["research"]
  );
  const weak = scoreAgentForTask(
    agent({
      id: "weak",
      specialty: "marketer",
      expertise: [{ skill: "marketing", level: 5 }]
    }),
    "researcher",
    ["research"]
  );
  assert.ok(strong.score > weak.score + 100);
});

test("expert recommendation penalizes busy people and excludes offline people", () => {
  const recommendations = recommendExperts(
    [
      agent({ id: "idle", name: "Idle", status: "idle" }),
      agent({ id: "working", name: "Working", status: "working" }),
      agent({ id: "offline", name: "Offline", status: "offline", seniority: "lead" })
    ],
    "researcher",
    ["research"]
  );
  assert.equal(recommendations[0]?.agent.id, "idle");
  assert.equal(recommendations.some((item) => item.agent.id === "offline"), false);
});
