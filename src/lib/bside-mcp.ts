/**
 * Public protocol identifiers for the separately deployed Bside DeskOffice bridge.
 * These strings describe MCP wiring only; DeskOffice never imports or installs Bside.
 */
export const BSIDE_MCP_COMMAND = "deskoffice-bside-mcp";

/**
 * Recognizes both the installed bridge binary and the documented bundled-entry fallback.
 * A Bside browser is deliberately not copyable: its `--profile` capability represents one
 * NPC's personal browser workspace and must be chosen again for each NPC.
 */
export function isDeskOfficeBsideBridge(command: unknown, args: unknown): boolean {
  const pieces = [command, ...(Array.isArray(args) ? args : [])];
  return pieces.some((piece) => {
    if (typeof piece !== "string") return false;
    const normalized = piece.trim().replaceAll("\\", "/").toLowerCase();
    return (
      normalized === BSIDE_MCP_COMMAND ||
      normalized.endsWith("/deskoffice-bside-mcp") ||
      normalized.endsWith("/deskoffice-mcp.js")
    );
  });
}
