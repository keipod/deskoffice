const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a client-supplied value is a canonical uuid. Row ids are uuids, and PostgreSQL throws
 * on a malformed one where SQLite just finds nothing — check before the value reaches a query.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Generate client request IDs on HTTPS, localhost, and LAN HTTP alike. */
export function createClientUuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();

  // getRandomValues is available on LAN HTTP, where randomUUID is not exposed.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
