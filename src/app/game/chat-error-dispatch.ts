import { ERROR_MESSAGE_KEYS } from "@/lib/i18n/error-codes";
import { getNpcResponseMessageKey, isNpcResponseMessageCode } from "@/lib/npc-response-messages";

/** The 8 room error codes with their own `game.room.error.*` wording (`RoomErrorCode` in `src/server/room-socket.ts`). */
const ROOM_ERROR_CODES = [
  "forbidden",
  "not_found",
  "not_open",
  "empty",
  "cooldown",
  "not_joined",
  "invalid",
  "send_failed",
] as const;
type RoomErrorCode = (typeof ROOM_ERROR_CODES)[number];

export type ChatErrorDecision = {
  toastKey: string;
  /** A socket rejoin is needed — the server considers this socket not in the room. */
  rejoin: boolean;
  /** This room can no longer be seen (gone or no permission) — go back to the list and fetch fresh. */
  backToList: boolean;
};

function isRoomErrorCode(code: unknown): code is RoomErrorCode {
  return ROOM_ERROR_CODES.includes(code as RoomErrorCode);
}

/**
 * A skill-chip refusal (`skill_requires_single_mention`, `skill_not_found`, `plugin_update_required`…)
 * reuses the wording the REST layer and the DM already have for the same code, so the toast says what
 * went wrong instead of a generic failure. The screen does not move for any of them.
 */
function sharedMessageKey(code: unknown): string | null {
  if (typeof code !== "string") return null;
  if (Object.prototype.hasOwnProperty.call(ERROR_MESSAGE_KEYS, code))
    return ERROR_MESSAGE_KEYS[code as keyof typeof ERROR_MESSAGE_KEYS];
  if (isNpcResponseMessageCode(code)) return getNpcResponseMessageKey(code);
  return null;
}

/** Translate the server's `room:error` into UI actions. It knows neither React nor socket, so node:test can cover it. */
export function decideChatError(payload: unknown): ChatErrorDecision {
  const code = (payload as { code?: unknown } | null)?.code;
  if (!isRoomErrorCode(code)) {
    const shared = sharedMessageKey(code);
    return { toastKey: shared ?? "game.channelChatFailed", rejoin: false, backToList: false };
  }
  return {
    toastKey: `game.room.error.${code}`,
    rejoin: code === "not_joined",
    backToList: code === "not_found" || code === "forbidden",
  };
}
