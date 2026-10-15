/**
 * MCP Gateway Client for Chat Agent
 * Connects exclusively through the Urumi MCP Gateway using a dedicated member API key.
 * Never accesses upstream servers or databases directly.
 */

export interface AggregatedTool {
  namespacedName: string;
  originalName: string;
  serverId: string;
  serverName: string;
  description: string;
  inputSchema: Record<string, any>;
}

export interface ToolExecutionResult {
  toolName: string;
  arguments: Record<string, any>;
  content: Array<{ type: string; text?: string; [key: string]: any }>;
  isError: boolean;
  upstreamId?: string;
  durationMs: number;
  errorMessage?: string;
}

export class GatewayMcpClient {
  private gatewayUrl: string;
  private apiKey: string;
  private cachedTools: AggregatedTool[] = [];
  private lastFetchTime: number = 0;
  private cacheTtlMs: number = 15000;

  constructor(gatewayUrl: string, apiKey: string, cacheTtlMs: number = 15000) {
    this.gatewayUrl = gatewayUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.cacheTtlMs = cacheTtlMs;
  }

  public setApiKey(newKey: string): void {
    this.apiKey = newKey;
    this.cachedTools = [];
    this.lastFetchTime = 0;
  }

  public getGatewayUrl(): string {
    return this.gatewayUrl;
  }

  /**
   * Dynamically discover tools from Gateway
   */
  public async discoverTools(forceRefresh: boolean = false, userApiKey?: string): Promise<AggregatedTool[]> {
    const effectiveKey = userApiKey || this.apiKey;
    const now = Date.now();
    if (!forceRefresh && this.cachedTools.length > 0 && now - this.lastFetchTime < this.cacheTtlMs) {
      return this.cachedTools;
    }

    try {
      const res = await fetch(`${this.gatewayUrl}/api/tools?refresh=${forceRefresh}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${effectiveKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (res.status === 401) {
        throw new Error('UNAUTHORIZED: Invalid or revoked API key.');
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error((errJson as any).message || `Gateway returned HTTP ${res.status}`);
      }

      const data = (await res.json()) as { count: number; tools: AggregatedTool[] };
      this.cachedTools = data.tools || [];
      this.lastFetchTime = now;
      return this.cachedTools;
    } catch (err: any) {
      console.error(`[McpClient] Tool discovery failed: ${err.message}`);
      throw err;
    }
  }

  /**
   * Execute a tool through the Gateway
   */
  public async executeTool(toolName: string, args: Record<string, any>, userApiKey?: string): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const effectiveKey = userApiKey || this.apiKey;

    try {
      const res = await fetch(`${this.gatewayUrl}/api/tools/execute`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${effectiveKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tool: toolName,
          arguments: args,
        }),
      });

      const durationMs = Date.now() - startTime;

      if (res.status === 401) {
        return {
          toolName,
          arguments: args,
          content: [{ type: 'text', text: 'Authentication failed. API key is invalid or revoked.' }],
          isError: true,
          durationMs,
          errorMessage: 'UNAUTHORIZED: API key invalid or revoked.',
        };
      }

      if (res.status === 403) {
        // RBAC denial: member tried to execute a mutating tool
        return {
          toolName,
          arguments: args,
          content: [
            {
              type: 'text',
              text: `Permission Denied: Your role does not allow executing mutating tool '${toolName}'. Admin approval required.`,
            },
          ],
          isError: true,
          durationMs,
          errorMessage: 'FORBIDDEN_TOOL: Insufficient role permissions.',
        };
      }

      const data = (await res.json()) as any;

      if (!res.ok) {
        return {
          toolName,
          arguments: args,
          content: [{ type: 'text', text: data.message || `Execution failed with HTTP ${res.status}` }],
          isError: true,
          durationMs,
          errorMessage: data.message || `HTTP ${res.status}`,
        };
      }

      return {
        toolName,
        arguments: args,
        content: data.content || [{ type: 'text', text: JSON.stringify(data) }],
        isError: data.isError || false,
        upstreamId: data.meta?.upstreamId,
        durationMs,
      };
    } catch (err: any) {
      return {
        toolName,
        arguments: args,
        content: [{ type: 'text', text: `Gateway communication error: ${err.message}` }],
        isError: true,
        durationMs: Date.now() - startTime,
        errorMessage: err.message,
      };
    }
  }

  /**
   * Check connection and identify authenticated user
   */
  public async verifyIdentity(userApiKey?: string): Promise<{ authenticated: boolean; user?: any; error?: string }> {
    const effectiveKey = userApiKey || this.apiKey;
    try {
      const res = await fetch(`${this.gatewayUrl}/api/auth/me`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${effectiveKey}`,
        },
      });

      if (!res.ok) {
        return { authenticated: false, error: `HTTP ${res.status}` };
      }

      const data = (await res.json()) as any;
      return { authenticated: data.authenticated, user: data.user };
    } catch (err: any) {
      return { authenticated: false, error: err.message };
    }
  }
}
