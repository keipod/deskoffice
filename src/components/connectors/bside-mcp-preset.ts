import type { McpServerInput } from "@/lib/hermes/plugin-client-types";
import { BSIDE_MCP_COMMAND } from "@/lib/bside-mcp";

/**
 * The bridge is an executable supplied by Bside's separate deployment. DeskOffice deliberately
 * does not import or install Bside: Hermes starts this command on its own gateway host over MCP.
 */
export { BSIDE_MCP_COMMAND } from "@/lib/bside-mcp";
export const BSIDE_MCP_SERVER_NAME = "bside";
export const BSIDE_API_URL_ENV = "BSIDE_API_URL";
export const BSIDE_API_TOKEN_ENV = "BSIDE_API_TOKEN";

export type BsideMcpPresetValues = {
  /** The Bside profile that is this NPC's personal PC/browser. */
  profileId: string;
  /** Optional Bside endpoint, stored as an MCP environment secret when supplied. */
  apiUrl?: string;
  /** Optional Bside access token, stored as an MCP environment secret when supplied. */
  apiToken?: string;
  /** Kept configurable for callers that need more than one Bside connector on a profile. */
  name?: string;
};

export type BsideMcpConfig = {
  /** Safe to send to the connector create route: environment values are intentionally blank. */
  input: McpServerInput;
  /** Send these after creation, and only under keys the Hermes plugin reports. */
  secretValues: Record<string, string>;
};

/**
 * Builds the fixed, least-trusted stdio MCP configuration for an NPC's Bside browser.
 *
 * `BSIDE_API_URL` and `BSIDE_API_TOKEN` are omitted when blank so the bridge may use its own
 * deployment defaults. Values never enter `input`; callers store them through the secret route.
 */
export function buildBsideMcpConfig(values: BsideMcpPresetValues): BsideMcpConfig {
  const name = values.name?.trim() || BSIDE_MCP_SERVER_NAME;
  const profileId = values.profileId.trim();
  const apiUrl = values.apiUrl?.trim();
  const apiToken = values.apiToken ?? "";
  const secretValues = {
    ...(apiUrl ? { [BSIDE_API_URL_ENV]: apiUrl } : {}),
    ...(apiToken.trim() ? { [BSIDE_API_TOKEN_ENV]: apiToken } : {}),
  };
  const envKeys = Object.keys(secretValues);

  return {
    input: {
      name,
      transport: "stdio",
      command: BSIDE_MCP_COMMAND,
      args: ["--profile", profileId],
      ...(envKeys.length ? { env: Object.fromEntries(envKeys.map((key) => [key, ""])) } : {}),
      auth: envKeys.length ? "env" : "none",
      // A browser can act externally; require per-tool confirmation for write-capable tools.
      trust: "untrusted",
      // The preset's command is fixed and the explicit Add button is the confirmation.
      confirmName: name,
    },
    secretValues,
  };
}
