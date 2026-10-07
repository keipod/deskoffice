import type { McpServerInput } from "@/lib/hermes/plugin-client-types";
import { bsideAgentMcpUrl } from "@/lib/bside-mcp";

export const BSIDE_MCP_SERVER_NAME = "bside";

export type BsideMcpPresetValues = {
  /** The Bside profile that is this NPC's personal PC/browser. */
  profileId: string;
  /** Bside's REST/MCP base URL as Hermes reaches it, e.g. `http://host.docker.internal:27433`. */
  baseUrl: string;
};

/**
 * Builds the HTTP MCP connector for an NPC's Bside browser: Bside's profile-pinned agent endpoint.
 * No secrets — Bside runs in a trusted single-user environment and needs no token.
 */
export function buildBsideMcpConfig(values: BsideMcpPresetValues): McpServerInput {
  return {
    name: BSIDE_MCP_SERVER_NAME,
    transport: "http",
    url: bsideAgentMcpUrl(values.baseUrl.trim(), values.profileId.trim()),
    auth: "none",
    trust: "full",
  };
}
