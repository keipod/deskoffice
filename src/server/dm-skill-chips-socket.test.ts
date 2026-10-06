import assert from "node:assert/strict";
import test from "node:test";
import { SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { setupThrowawaySqlite, seedChannelWithProfiles } from "@/test-setup/npc-seed";
setupThrowawaySqlite("dm-skill-chips-socket");
import { db, characters, npcs } from "@/db";
import { DEV_JWT_SECRET } from "@/lib/dev-constants";
import type { ChatResponse } from "@/lib/chat-response";
import type { AdapterExecuteOptions } from "@/lib/adapters/types";
import { adapterRegistry, channelParticipationAccess, setupSocketHandlers } from "./socket-handlers";
import { skillExpansion, type SkillExpansionInput } from "./skill-expansion";

test("a DM with skill chips stores the chip line and sends Hermes the expanded message; a failed expansion never reaches Hermes", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  t.mock.method(console, "error", () => {});
  const seed = await seedChannelWithProfiles({ placedActive: 1, displayName: "Sophie" });
  const [character] = await db
    .insert(characters)
    .values({ userId: seed.userId, name: "Dante", appearance: "{}" })
    .returning();
  const npcId = seed.npcIds[0];
  await db.update(npcs).set({ adapterType: "skill-chips-dm" }).where(eq(npcs.id, npcId));
  const prompts: string[] = [];
  adapterRegistry.register({
    type: "skill-chips-dm",
    testConnection: async () => ({ status: "ok" }),
    execute: async (options: AdapterExecuteOptions) => {
      prompts.push(options.prompt);
      return { response: "done", session: { sessionRef: options.sessionKey } };
    },
  });
  const expandCalls: SkillExpansionInput[] = [];
  let expansion: Awaited<ReturnType<typeof skillExpansion.expand>> = { ok: true, message: "" };
  t.mock.method(skillExpansion, "expand", async (input: SkillExpansionInput) => {
    expandCalls.push(input);
    return expansion.ok
      ? { ok: true as const, message: `EXPANDED(${input.skills.join("+")}): ${input.instruction}` }
      : expansion;
  });

  const events: [string, unknown][] = [];
  const handlers = new Map<string, (payload: unknown) => Promise<void>>();
  const token = await new SignJWT({ userId: seed.userId, nickname: "Dante" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.JWT_SECRET || DEV_JWT_SECRET));
  const socket = {
    data: {} as Record<string, unknown>,
    use: () => {},
    id: "dm-skill-chips-socket",
    handshake: { headers: { cookie: `token=${token}` } },
    on: (event: string, handler: (payload: unknown) => Promise<void>) => {
      handlers.set(event, handler);
    },
    emit: (event: string, payload: unknown) => {
      events.push([event, payload]);
    },
    join: () => {},
    leave: () => {},
    disconnect: () => {},
  };
  let connect!: (socket: unknown) => Promise<void>;
  const io = {
    on: (_event: string, handler: typeof connect) => {
      connect = handler;
    },
    to: () => ({ emit: socket.emit }),
    sockets: { sockets: new Map([[socket.id, socket]]) },
  };
  setupSocketHandlers(io as never);
  await connect(socket);
  socket.data.myCharacterId = character.id;

  const send = async (payload: Record<string, unknown>) => {
    // Reset the cooldown without waiting: the handler owns this socket's entry and clears it on disconnect.
    await handlers.get("disconnect")!(undefined);
    events.length = 0;
    await handlers.get("npc:chat")!({ npcId, characterId: character.id, ...payload });
  };
  const finalState = () =>
    events
      .filter(([name]) => name === "npc:response-state")
      .map(([, p]) => (p as { response: ChatResponse }).response)
      .at(-1);
  const history = async () => {
    events.length = 0;
    await handlers.get("npc:history")!({ npcId });
    return (
      events
        .filter(([name]) => name === "npc:history")
        .map(([, p]) => (p as { messages: { role: string; content: string }[] }).messages)
        .at(-1) ?? []
    )
      .filter((m) => m.role === "player")
      .map((m) => m.content);
  };

  // (a) chips + instruction: the stored line is the chip line, Hermes gets the expansion.
  await send({ sourceMessageId: "s1", message: "go", skills: ["research"] });
  assert.equal(finalState()?.status, "complete");
  assert.deepEqual(expandCalls, [
    { channelId: seed.channelId, npcId, skills: ["research"], instruction: "go" },
  ]);
  assert.match(prompts.at(-1)!, /EXPANDED\(research\): go/);
  assert.doesNotMatch(prompts.at(-1)!, /\/research/);
  assert.deepEqual(await history(), ["/research go"]);

  // (b) chips alone are a message: the stored line is just the chips.
  await send({ sourceMessageId: "s2", message: "", skills: ["research", "/write-report"] });
  assert.equal(finalState()?.status, "complete");
  assert.deepEqual(expandCalls.at(-1), {
    channelId: seed.channelId,
    npcId,
    skills: ["research", "write-report"],
    instruction: "",
  });
  assert.deepEqual(await history(), ["/research go", "/research /write-report"]);

  // (c) a failed expansion: Hermes is not called, the user gets the code, the stored line is marked failed.
  expansion = { ok: false, errorCode: "skill_disabled" };
  const before = prompts.length;
  await send({ sourceMessageId: "s3", message: "again", skills: ["research"] });
  assert.equal(prompts.length, before);
  const system = events
    .filter(([name]) => name === "npc:response")
    .map(([, p]) => p as { messageCode?: string; done: boolean })
    .find((p) => p.done && p.messageCode);
  assert.equal(system?.messageCode, "skill_disabled");
  assert.equal(finalState()?.status, "failed");
  assert.equal(finalState()?.error, "skill_disabled");
  assert.deepEqual(await history(), ["/research go", "/research /write-report", "/research again"]);
  expansion = { ok: true, message: "" };

  // (d) the 500-character limit applies to the instruction, not to the chips.
  const long = "x".repeat(600);
  await send({ sourceMessageId: "s4", message: long, skills: ["research"] });
  assert.equal(expandCalls.at(-1)?.instruction, "x".repeat(500));
  assert.equal((await history()).at(-1), "/research " + "x".repeat(500));

  // Malformed chips are refused before anything is stored.
  await send({ sourceMessageId: "s5", message: "go", skills: ["bad name"] });
  assert.equal(
    (events.find(([name]) => name === "npc:response")?.[1] as { messageCode?: string })
      ?.messageCode,
    "skill_not_found",
  );
  assert.equal((await history()).length, 4);
  await send({
    sourceMessageId: "s6",
    message: "go",
    skills: ["a1", "a2", "a3", "a4", "a5", "a6"],
  });
  assert.equal(
    (events.find(([name]) => name === "npc:response")?.[1] as { messageCode?: string })
      ?.messageCode,
    "too_many_skills",
  );
  assert.equal((await history()).length, 4);

  // (e) without chips nothing changes: no expansion, the message goes to Hermes as typed.
  const calls = expandCalls.length;
  await send({ sourceMessageId: "s7", message: "hi" });
  assert.equal(finalState()?.status, "complete");
  assert.equal(expandCalls.length, calls);
  assert.match(prompts.at(-1)!, /hi/);
  assert.equal((await history()).at(-1), "hi");
  // An empty message without chips is dropped as before.
  await send({ sourceMessageId: "s8", message: "" });
  assert.equal((await history()).length, 5);
});

test("npc:chat whose channel-access lookup throws degrades to npc_not_found instead of crashing", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  t.mock.method(console, "error", () => {});
  t.mock.method(channelParticipationAccess, "get", async () => {
    throw new Error("boom: simulated transient DB failure");
  });
  const seed = await seedChannelWithProfiles({ placedActive: 1, displayName: "Sophie" });
  const [character] = await db
    .insert(characters)
    .values({ userId: seed.userId, name: "Dante", appearance: "{}" })
    .returning();
  const npcId = seed.npcIds[0];

  const events: [string, unknown][] = [];
  const handlers = new Map<string, (payload: unknown) => Promise<void>>();
  const token = await new SignJWT({ userId: seed.userId, nickname: "Dante" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.JWT_SECRET || DEV_JWT_SECRET));
  const socket = {
    data: {} as Record<string, unknown>,
    use: () => {},
    id: "dm-skill-chips-throw-socket",
    handshake: { headers: { cookie: `token=${token}` } },
    on: (event: string, handler: (payload: unknown) => Promise<void>) => {
      handlers.set(event, handler);
    },
    emit: (event: string, payload: unknown) => {
      events.push([event, payload]);
    },
    join: () => {},
    leave: () => {},
    disconnect: () => {},
  };
  let connect!: (socket: unknown) => Promise<void>;
  const io = {
    on: (_event: string, handler: typeof connect) => {
      connect = handler;
    },
    to: () => ({ emit: socket.emit }),
    sockets: { sockets: new Map([[socket.id, socket]]) },
  };
  setupSocketHandlers(io as never);
  await connect(socket);
  socket.data.myCharacterId = character.id;

  await handlers.get("npc:chat")!({
    npcId,
    characterId: character.id,
    sourceMessageId: "s1",
    message: "go",
  });

  const system = events
    .filter(([name]) => name === "npc:response")
    .map(([, p]) => p as { messageCode?: string; done: boolean })
    .find((p) => p.done && p.messageCode);
  assert.equal(system?.messageCode, "npc_not_found");
  // Reaching this line at all is the proof: an unguarded throw here would have surfaced as an
  // unhandled rejection and aborted the whole test process, not just this one assertion.
});
