import dotenv from 'dotenv';
import { UpstreamServerConfig } from './types';

dotenv.config();

export interface GatewayConfig {
  port: number;
  apiKeySalt: string;
  initialAdminKey?: string;
  initialMemberKey?: string;
  defaultUpstreams: UpstreamServerConfig[];
  discoveryCacheTtlMs: number;
  dataDir?: string;
}

export function loadConfig(): GatewayConfig {
  const port = parseInt(process.env.PORT || '8080', 10);
  const apiKeySalt = process.env.API_KEY_SALT || 'urumi-gateway-salt-secure-default-2026';
  const initialAdminKey = process.env.INITIAL_ADMIN_KEY || undefined;
  const initialMemberKey = process.env.INITIAL_MEMBER_KEY || undefined;
  const discoveryCacheTtlMs = parseInt(process.env.DISCOVERY_CACHE_TTL_MS || '30000', 10);
  const dataDir = process.env.DATA_DIR || undefined;

  let defaultUpstreams: UpstreamServerConfig[] = [
    {
      id: 'woo-mcp',
      name: 'WooCommerce MCP Server',
      url: process.env.WOO_MCP_URL || 'http://woo-mcp:4001/sse',
      transport: 'sse',
      enabled: true,
      timeoutMs: parseInt(process.env.WOO_MCP_TIMEOUT_MS || '10000', 10),
    },
    {
      id: 'utils-mcp',
      name: 'Utilities MCP Server',
      url: process.env.UTILS_MCP_URL || 'http://utils-mcp:4002/sse',
      transport: 'sse',
      enabled: true,
      timeoutMs: parseInt(process.env.UTILS_MCP_TIMEOUT_MS || '10000', 10),
    },
    {
      id: 'notes-mcp',
      name: 'Order Notes MCP Server',
      url: process.env.NOTES_MCP_URL || 'http://notes-mcp:4003/sse',
      transport: 'sse',
      enabled: true,
      timeoutMs: parseInt(process.env.NOTES_MCP_TIMEOUT_MS || '10000', 10),
    },
  ];

  if (process.env.UPSTREAM_SERVERS_JSON) {
    try {
      const parsed = JSON.parse(process.env.UPSTREAM_SERVERS_JSON);
      if (Array.isArray(parsed) && parsed.length > 0) {
        defaultUpstreams = parsed;
      }
    } catch (err) {
      console.warn('[Config] Failed to parse UPSTREAM_SERVERS_JSON, using defaults', err);
    }
  }

  return {
    port,
    apiKeySalt,
    initialAdminKey,
    initialMemberKey,
    defaultUpstreams,
    discoveryCacheTtlMs,
    dataDir,
  };
}
