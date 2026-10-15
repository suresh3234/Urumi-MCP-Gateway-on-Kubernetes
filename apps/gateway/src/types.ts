export type UserRole = 'admin' | 'member';

export interface UpstreamServerConfig {
  id: string;
  name: string;
  url: string;
  transport: 'streamable-http' | 'sse' | 'stdio';
  enabled: boolean;
  timeoutMs: number;
  metadata?: Record<string, any>;
  status?: 'healthy' | 'unreachable' | 'disabled';
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  keyHash: string;
  prefix: string;
  role: UserRole;
  createdAt: string;
  lastUsedAt?: string;
  status: 'active' | 'revoked';
}

export interface AuthenticatedUser {
  keyId: string;
  name: string;
  role: UserRole;
}

export type AuditStatus = 'SUCCESS' | 'ERROR' | 'UNAUTHORIZED' | 'TIMEOUT';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  userId: string;
  userRole: UserRole;
  action: 'TOOL_INVOCATION' | 'SERVER_REGISTRATION' | 'SERVER_TOGGLE' | 'SERVER_UPDATE' | 'SERVER_REMOVAL' | 'AUTH_FAILURE' | 'TOOL_DISCOVERY' | 'KEY_REVOCATION' | 'KEY_CREATION';
  toolName?: string;
  upstreamId?: string;
  durationMs: number;
  status: AuditStatus;
  error?: string;
  sanitizedDetails?: Record<string, any>;
}

export interface AggregatedTool {
  namespacedName: string;
  originalName: string;
  serverId: string;
  serverName: string;
  description: string;
  inputSchema: Record<string, any>;
}

export interface ToolExecutionRequest {
  tool: string;
  arguments?: Record<string, any>;
}

export interface ToolExecutionResponse {
  content: Array<{ type: string; text?: string; [key: string]: any }>;
  isError?: boolean;
  meta?: {
    upstreamId: string;
    durationMs: number;
  };
}
