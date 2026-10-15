import { UpstreamManager } from './upstream-manager';
import { AggregatedTool, ToolExecutionResponse } from './types';

export class ToolAggregator {
  private upstreamManager: UpstreamManager;
  private cacheTtlMs: number;
  private cachedTools: AggregatedTool[] = [];
  private toolRoutingMap: Map<string, { serverId: string; originalName: string }> = new Map();
  private lastRefreshedAt: number = 0;

  constructor(upstreamManager: UpstreamManager, cacheTtlMs: number = 30000) {
    this.upstreamManager = upstreamManager;
    this.cacheTtlMs = cacheTtlMs;
  }

  public async getTools(forceRefresh: boolean = false): Promise<AggregatedTool[]> {
    const now = Date.now();
    if (!forceRefresh && this.cachedTools.length > 0 && now - this.lastRefreshedAt < this.cacheTtlMs) {
      return this.cachedTools;
    }

    return await this.refreshTools();
  }

  public async refreshTools(): Promise<AggregatedTool[]> {
    const servers = this.upstreamManager.listServers().filter((s) => s.enabled);
    const aggregated: AggregatedTool[] = [];
    const newRoutingMap = new Map<string, { serverId: string; originalName: string }>();
    const nameOccurrences = new Map<string, string[]>(); // toolName -> serverIds[]

    for (const server of servers) {
      try {
        const client = await this.upstreamManager.getClient(server.id);
        const toolsResult = await client.listTools();
        this.upstreamManager.setServerHealth(server.id, 'healthy');

        for (const tool of toolsResult.tools) {
          const namespacedName = `${server.id}__${tool.name}`;
          const item: AggregatedTool = {
            namespacedName,
            originalName: tool.name,
            serverId: server.id,
            serverName: server.name,
            description: tool.description || `Tool provided by ${server.name}`,
            inputSchema: (tool.inputSchema as Record<string, any>) || { type: 'object', properties: {} },
          };

          aggregated.push(item);
          newRoutingMap.set(namespacedName, { serverId: server.id, originalName: tool.name });

          const existingServers = nameOccurrences.get(tool.name) || [];
          existingServers.push(server.id);
          nameOccurrences.set(tool.name, existingServers);
        }
      } catch (err: any) {
        console.warn(`[Aggregator] Failed to discover tools from upstream '${server.id}': ${err.message}`);
        this.upstreamManager.setServerHealth(server.id, 'unreachable');
        // Failure isolation: healthy servers still proceed
      }
    }

    // Add un-namespaced aliases for non-colliding tools
    for (const [toolName, serverIds] of nameOccurrences.entries()) {
      if (serverIds.length === 1) {
        const serverId = serverIds[0];
        newRoutingMap.set(toolName, { serverId, originalName: toolName });
      } else {
        console.warn(
          `[Aggregator] Collision detected for tool '${toolName}' across servers [${serverIds.join(
            ', '
          )}]. Direct alias disabled; use namespaced names.`
        );
      }
    }

    this.cachedTools = aggregated;
    this.toolRoutingMap = newRoutingMap;
    this.lastRefreshedAt = Date.now();
    return aggregated;
  }

  public async executeTool(toolName: string, args: Record<string, any> = {}): Promise<ToolExecutionResponse> {
    const route = this.toolRoutingMap.get(toolName);
    if (!route) {
      throw new Error(`Tool '${toolName}' not found in unified tool catalogue. Check available tools via /api/tools.`);
    }

    const server = this.upstreamManager.getServer(route.serverId);
    if (!server || !server.enabled) {
      throw new Error(`Upstream server '${route.serverId}' for tool '${toolName}' is disabled or unavailable.`);
    }

    const startTime = Date.now();
    const client = await this.upstreamManager.getClient(route.serverId);

    // Enforce execution timeout
    const callPromise = client.callTool({
      name: route.originalName,
      arguments: args,
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Tool execution timed out after ${server.timeoutMs}ms on upstream '${route.serverId}'`)), server.timeoutMs)
    );

    try {
      const result: any = await Promise.race([callPromise, timeoutPromise]);
      const durationMs = Date.now() - startTime;

      return {
        content: result.content || [{ type: 'text', text: JSON.stringify(result) }],
        isError: Boolean(result.isError),
        meta: {
          upstreamId: route.serverId,
          durationMs,
        },
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: true,
              context: `gateway_execution (${toolName})`,
              message: err.message || 'Upstream execution failed',
            }),
          },
        ],
        isError: true,
        meta: {
          upstreamId: route.serverId,
          durationMs,
        },
      };
    }
  }
}
