export interface UpstreamServer {
  id: string;
  name?: string;
  url: string;
  transport?: string;
  type?: string;
  enabled: boolean;
  status: 'healthy' | 'unreachable' | 'down' | 'disabled';
  toolsCount?: number;
  timeoutMs?: number;
  error?: string;
}

export interface AggregatedTool {
  namespacedName: string;
  originalName: string;
  serverId: string;
  description: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, any>;
    required?: string[];
  };
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  role: 'admin' | 'member';
  prefix: string;
  createdAt: string;
  revokedAt?: string | null;
  isRevoked: boolean;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  userId: string;
  userRole: string;
  action: string;
  toolName?: string;
  status: 'SUCCESS' | 'ERROR' | 'UNAUTHORIZED';
  durationMs: number;
  metadata?: Record<string, any>;
}

export interface GatewayHealth {
  status: string;
  service: string;
  version: string;
  timestamp: string;
  upstreams?: {
    total: number;
    enabled: number;
  };
  activeSseSessions?: number;
  activeStreamableSessions?: number;
}
