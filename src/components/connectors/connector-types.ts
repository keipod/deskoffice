import type { McpServerView } from "@/lib/hermes/plugin-client-types";

/** The list response of `GET /api/channels/:id/npcs/:npcId/connectors`. */
export type ConnectorListView = {
  servers: McpServerView[];
  canManage: boolean;
  capabilityReady: boolean;
  /** Other channels that hired the same profile — MCP settings are per profile. */
  sharedChannelCount: number;
};

/** One row of `POST …/connectors/copy`. */
export type CopyResult = { npcId: string; name: string; ok: boolean; code?: string };

/** `GET …/connectors/bside/profiles`: Bside's profiles, or why Bside could not be reached. */
export type BsideProfilesView = {
  baseUrl: string;
  profiles?: { id: string; name: string }[];
  error?: string;
  message?: string;
};

/** `POST …/connectors/bside/connect`. */
export type BsideConnectResult = {
  profile: { id: string; name: string };
  connector: McpServerView;
  mcpUrl: string;
  alreadyConnected: boolean;
  skill: { ok: boolean; code?: string; alreadyInstalled?: boolean };
};

/** Server/plugin error codes that have their own on-screen message (`connectors.error.<code>`). */
export const CONNECTOR_ERROR_CODES = [
  "plugin_upgrade_required",
  "forbidden",
  "revision_conflict",
  "name_taken",
  "plugin_owned",
  "mcp_security_rejected",
  "confirmation_required",
  "tools_unknown",
  "oauth_callback_invalid",
  "oauth_denied",
  "oauth_not_configured",
  "oauth_start_failed",
  "oauth_in_progress",
  "oauth_busy",
  "reload_failed",
  "job_busy",
  "missing_env",
  "unknown_env_key",
  "catalog_install_failed",
  "secret_key_not_referenced",
  "bside_profile_not_copyable",
  "bside_unreachable",
  "bside_error",
  "bside_url_invalid",
  "bside_profile_required",
  "bside_profile_not_found",
  "invalid_name",
  "timeout",
  "unreachable",
] as const;
