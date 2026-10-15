import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { UpstreamServerConfig } from './types';

import { validateUpstreamUrl } from './ssrf-validator';

interface ClientHandle {
  client: Client;
  transport: Transport;
  connectedAt: Date;
}

export class UpstreamManager {
  private servers: Map<string, UpstreamServerConfig> = new Map();
  private clients: Map<string, ClientHandle> = new Map();
  private serverHealth: Map<string, 'healthy' | 'unreachable'> = new Map();

  constructor(initialServers: UpstreamServerConfig[] = []) {
    for (const server of initialServers) {
      this.registerServer(server);
    }
  }

  public setServerHealth(id: string, status: 'healthy' | 'unreachable'): void {
    if (this.servers.has(id)) {
      this.serverHealth.set(id, status);
    }
  }

  public getServerHealth(id: string): 'healthy' | 'unreachable' | 'disabled' {
    const server = this.servers.get(id);
    if (!server || !server.enabled) return 'disabled';
    return this.serverHealth.get(id) || 'healthy';
  }

  public registerServer(config: UpstreamServerConfig): void {
    const ssrfCheck = validateUpstreamUrl(config.url);
    if (!ssrfCheck.valid) {
      throw new Error(`SSRF Security Violation: ${ssrfCheck.reason}`);
    }

    this.servers.set(config.id, { ...config });
    this.serverHealth.set(config.id, 'healthy');
    // Invalidate any existing client if re-registering
    this.closeClient(config.id);
  }

  public updateServer(id: string, updates: Partial<Omit<UpstreamServerConfig, 'id'>>): UpstreamServerConfig {
    const existing = this.servers.get(id);
    if (!existing) {
      throw new Error(`Upstream server '${id}' not found.`);
    }

    if (updates.url && updates.url !== existing.url) {
      const ssrfCheck = validateUpstreamUrl(updates.url);
      if (!ssrfCheck.valid) {
        throw new Error(`SSRF Security Violation: ${ssrfCheck.reason}`);
      }
      this.closeClient(id);
    }

    const updated: UpstreamServerConfig = {
      ...existing,
      ...updates,
      id, // protect immutable id
    };

    if (updates.enabled === false) {
      this.closeClient(id);
    }

    this.servers.set(id, updated);
    return this.getServer(id)!;
  }

  public removeServer(id: string): boolean {
    if (!this.servers.has(id)) {
      return false;
    }
    this.closeClient(id);
    this.serverHealth.delete(id);
    return this.servers.delete(id);
  }

  public toggleServer(id: string, enabled: boolean): boolean {
    const server = this.servers.get(id);
    if (!server) return false;

    server.enabled = enabled;
    if (!enabled) {
      this.closeClient(id);
    }
    return true;
  }

  public getServer(id: string): UpstreamServerConfig | undefined {
    const server = this.servers.get(id);
    if (!server) return undefined;
    return {
      ...server,
      status: !server.enabled ? 'disabled' : (this.serverHealth.get(id) || 'healthy'),
    };
  }

  public listServers(): UpstreamServerConfig[] {
    return Array.from(this.servers.values()).map((server) => ({
      ...server,
      status: !server.enabled ? 'disabled' : (this.serverHealth.get(server.id) || 'healthy'),
    }));
  }

  public async getClient(serverId: string): Promise<Client> {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Upstream server '${serverId}' is not registered.`);
    }

    if (!server.enabled) {
      throw new Error(`Upstream server '${serverId}' is currently disabled.`);
    }

    // Reuse existing active connection
    const existing = this.clients.get(serverId);
    if (existing) {
      return existing.client;
    }

    // Establish new connection with timeout
    const url = new URL(server.url);
    const transport: Transport =
      server.transport === 'streamable-http' || url.pathname.endsWith('/mcp')
        ? new StreamableHTTPClientTransport(url)
        : new SSEClientTransport(url);
    const client = new Client(
      {
        name: 'urumi-mcp-gateway',
        version: '1.0.0',
      },
      { capabilities: {} }
    );

    const connectPromise = client.connect(transport);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Connection timeout after ${server.timeoutMs}ms to ${server.url}`)), server.timeoutMs)
    );

    try {
      await Promise.race([connectPromise, timeoutPromise]);
      this.clients.set(serverId, {
        client,
        transport,
        connectedAt: new Date(),
      });
      this.setServerHealth(serverId, 'healthy');
      return client;
    } catch (err: any) {
      this.closeClient(serverId);
      this.setServerHealth(serverId, 'unreachable');
      throw new Error(`Failed connecting to upstream '${serverId}' (${server.url}): ${err.message}`);
    }
  }

  public async closeClient(serverId: string): Promise<void> {
    const handle = this.clients.get(serverId);
    if (handle) {
      this.clients.delete(serverId);
      try {
        await handle.client.close();
      } catch (err) {
        // ignore close errors
      }
    }
  }

  public async closeAll(): Promise<void> {
    const serverIds = Array.from(this.clients.keys());
    await Promise.all(serverIds.map((id) => this.closeClient(id)));
  }
}
