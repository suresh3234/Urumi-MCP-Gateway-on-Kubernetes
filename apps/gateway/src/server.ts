import express, { Request, Response, Express } from 'express';
import cors from 'cors';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { AuthManager } from './auth';
import { AuditLogger } from './audit';
import { UpstreamManager } from './upstream-manager';
import { ToolAggregator } from './tool-aggregator';
import { GatewayConfig } from './config';

import { AuthenticatedUser } from './types';

export function createGatewayApp(
  config: GatewayConfig,
  authManager: AuthManager,
  auditLogger: AuditLogger,
  upstreamManager: UpstreamManager,
  toolAggregator: ToolAggregator
): { app: Express } {
  const app = express();
  app.use(cors());
  app.use(express.json());

  function extractUserFromRequest(req: Request): AuthenticatedUser | null {
    const authHeader = req.headers.authorization;
    const customHeader = req.headers['x-api-key'];
    const queryKey = (req.query.apiKey as string) || (req.query.token as string);

    let rawKey = '';
    if (authHeader && authHeader.startsWith('Bearer ')) {
      rawKey = authHeader.substring(7).trim();
    } else if (typeof customHeader === 'string') {
      rawKey = customHeader.trim();
    } else if (queryKey) {
      rawKey = queryKey.trim();
    }

    if (!rawKey) return null;
    return authManager.authenticateKey(rawKey);
  }

  async function createGatewayMcpInstance(user: AuthenticatedUser): Promise<Server> {
    const server = new Server(
      {
        name: 'urumi-mcp-gateway',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => {
      const startTime = Date.now();
      const tools = await toolAggregator.getTools();
      auditLogger.log({
        userId: user.keyId,
        userRole: user.role,
        action: 'TOOL_DISCOVERY',
        durationMs: Date.now() - startTime,
        status: 'SUCCESS',
        details: { toolCount: tools.length, channel: 'mcp' },
      });

      return {
        tools: tools.map((t) => ({
          name: t.namespacedName,
          description: t.description,
          inputSchema: t.inputSchema || { type: 'object' },
        })),
      };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name;
      const args = request.params.arguments || {};
      const startTime = Date.now();

      // Role-based authorization check
      if (!authManager.canExecuteTool(user.role, toolName)) {
        auditLogger.log({
          userId: user.keyId,
          userRole: user.role,
          action: 'TOOL_INVOCATION',
          toolName,
          durationMs: Date.now() - startTime,
          status: 'UNAUTHORIZED',
          error: `Role '${user.role}' is not authorized to execute mutating tool '${toolName}'. Admin access required.`,
          details: { requestedTool: toolName, args: auditLogger.sanitizeData(args), channel: 'mcp' },
        });

        return {
          content: [
            {
              type: 'text',
              text: `Your role '${user.role}' is not authorized to execute mutating tool '${toolName}'. Admin access required.`,
            },
          ],
          isError: true,
        };
      }

      try {
        const res = await toolAggregator.executeTool(toolName, args);
        const durationMs = Date.now() - startTime;

        auditLogger.log({
          userId: user.keyId,
          userRole: user.role,
          action: 'TOOL_INVOCATION',
          toolName,
          upstreamId: res.meta?.upstreamId,
          durationMs,
          status: res.isError ? 'ERROR' : 'SUCCESS',
          details: { args: auditLogger.sanitizeData(args), channel: 'mcp' },
        });

        return {
          content: res.content as any,
          isError: res.isError,
        };
      } catch (err: any) {
        const durationMs = Date.now() - startTime;
        auditLogger.log({
          userId: user.keyId,
          userRole: user.role,
          action: 'TOOL_INVOCATION',
          toolName,
          durationMs,
          status: 'ERROR',
          error: err.message,
          details: { args: auditLogger.sanitizeData(args), channel: 'mcp' },
        });

        return {
          content: [{ type: 'text', text: JSON.stringify({ error: true, message: err.message }) }],
          isError: true,
        };
      }
    });

    return server;
  }

  interface ActiveSseSession {
    transport: SSEServerTransport;
    server: Server;
    user: AuthenticatedUser;
  }
  const activeSseSessions = new Map<string, ActiveSseSession>();
  const streamableSessions = new Map<string, { transport: StreamableHTTPServerTransport; server: Server; user: AuthenticatedUser }>();

  // 1. Healthcheck endpoint
  app.get('/healthz', (_req: Request, res: Response) => {
    const servers = upstreamManager.listServers();
    const enabledCount = servers.filter((s) => s.enabled).length;

    res.status(200).json({
      status: 'ok',
      service: 'urumi-gateway',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      upstreams: {
        total: servers.length,
        enabled: enabledCount,
      },
      activeSseSessions: activeSseSessions.size,
      activeStreamableSessions: streamableSessions.size,
    });
  });

  // 2. Gateway Discovery / Metadata root
  app.get('/', (_req: Request, res: Response) => {
    res.status(200).json({
      service: 'urumi-mcp-gateway',
      description: 'Unified AI Model Context Protocol (MCP) Gateway',
      endpoints: {
        health: '/healthz',
        sse: '/sse',
        messages: '/messages',
        tools: '/api/tools',
        executeTool: '/api/tools/execute',
        servers: '/api/servers',
        auditLogs: '/api/audit-logs',
        authKeys: '/api/auth/keys',
      },
    });
  });

  // 3. REST Endpoint: List unified tools (Protected by API key)
  app.get('/api/tools', authManager.getAuthMiddleware(), async (req: Request, res: Response) => {
    const user = (req as any).user;
    const force = req.query.refresh === 'true';
    const startTime = Date.now();

    try {
      const tools = await toolAggregator.getTools(force);
      auditLogger.log({
        userId: user.keyId,
        userRole: user.role,
        action: 'TOOL_DISCOVERY',
        durationMs: Date.now() - startTime,
        status: 'SUCCESS',
        details: { toolCount: tools.length, refreshed: force },
      });

      res.status(200).json({
        count: tools.length,
        tools,
      });
    } catch (err: any) {
      auditLogger.log({
        userId: user.keyId,
        userRole: user.role,
        action: 'TOOL_DISCOVERY',
        durationMs: Date.now() - startTime,
        status: 'ERROR',
        error: err.message,
      });

      res.status(500).json({
        error: true,
        code: 'DISCOVERY_FAILED',
        message: err.message || 'Failed to discover upstream tools',
      });
    }
  });

  // 4. REST Endpoint: Execute a tool (Protected with RBAC & Audit Logging)
  app.post('/api/tools/execute', authManager.getAuthMiddleware(), async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { tool, arguments: args } = req.body;
    const startTime = Date.now();

    if (!tool || typeof tool !== 'string') {
      res.status(400).json({
        error: true,
        code: 'INVALID_REQUEST',
        message: "Missing required 'tool' field in request body.",
      });
      return;
    }

    // Role-based authorization check
    if (!authManager.canExecuteTool(user.role, tool)) {
      auditLogger.log({
        userId: user.keyId,
        userRole: user.role,
        action: 'TOOL_INVOCATION',
        toolName: tool,
        durationMs: Date.now() - startTime,
        status: 'UNAUTHORIZED',
        error: `Role '${user.role}' is not authorized to execute tool '${tool}'`,
        details: { requestedTool: tool, args: auditLogger.sanitizeData(args) },
      });

      res.status(403).json({
        error: true,
        code: 'FORBIDDEN_TOOL',
        message: `Your role '${user.role}' is not authorized to execute mutating tool '${tool}'. Admin access required.`,
      });
      return;
    }

    try {
      const result = await toolAggregator.executeTool(tool, args || {});
      const durationMs = Date.now() - startTime;

      auditLogger.log({
        userId: user.keyId,
        userRole: user.role,
        action: 'TOOL_INVOCATION',
        toolName: tool,
        upstreamId: result.meta?.upstreamId,
        durationMs,
        status: result.isError ? 'ERROR' : 'SUCCESS',
        details: { args: auditLogger.sanitizeData(args) },
      });

      res.status(200).json(result);
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      auditLogger.log({
        userId: user.keyId,
        userRole: user.role,
        action: 'TOOL_INVOCATION',
        toolName: tool,
        durationMs,
        status: 'ERROR',
        error: err.message,
        details: { args: auditLogger.sanitizeData(args) },
      });

      res.status(500).json({
        content: [{ type: 'text', text: JSON.stringify({ error: true, message: err.message }) }],
        isError: true,
      });
    }
  });

  // 5. REST Endpoint: Server Registry Management (Admin Only)
  app.get('/api/servers', authManager.getAuthMiddleware('admin'), (_req: Request, res: Response) => {
    const servers = upstreamManager.listServers();
    res.status(200).json({
      count: servers.length,
      servers,
    });
  });

  app.post('/api/servers', authManager.getAuthMiddleware('admin'), async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { id, name, url, transport, enabled, timeoutMs, metadata } = req.body;

    if (!id || !name || !url) {
      res.status(400).json({
        error: true,
        message: 'Missing required server parameters: id, name, url',
      });
      return;
    }

    try {
      upstreamManager.registerServer({
        id,
        name,
        url,
        transport: transport || 'sse',
        enabled: enabled !== false,
        timeoutMs: timeoutMs || 10000,
        metadata,
      });
      // Invalidate and refresh cached tools for new server
      await toolAggregator.refreshTools();
    } catch (err: any) {
      res.status(400).json({
        error: true,
        code: 'SSRF_PROHIBITED',
        message: err.message,
      });
      return;
    }

    auditLogger.log({
      userId: user.keyId,
      userRole: user.role,
      action: 'SERVER_REGISTRATION',
      upstreamId: id,
      durationMs: 0,
      status: 'SUCCESS',
      details: { serverName: name, url },
    });

    res.status(201).json({
      message: `Server '${id}' registered successfully.`,
      server: upstreamManager.getServer(id),
    });
  });

  app.put('/api/servers/:id', authManager.getAuthMiddleware('admin'), async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { id } = req.params;
    const { name, url, transport, enabled, timeoutMs, metadata } = req.body;

    const existing = upstreamManager.getServer(id);
    if (!existing) {
      res.status(404).json({ error: true, message: `Server '${id}' not found.` });
      return;
    }

    try {
      const updated = upstreamManager.updateServer(id, {
        ...(name !== undefined && { name }),
        ...(url !== undefined && { url }),
        ...(transport !== undefined && { transport }),
        ...(enabled !== undefined && { enabled }),
        ...(timeoutMs !== undefined && { timeoutMs }),
        ...(metadata !== undefined && { metadata }),
      });

      // Invalidate and refresh cached tools
      await toolAggregator.refreshTools();

      auditLogger.log({
        userId: user.keyId,
        userRole: user.role,
        action: 'SERVER_UPDATE',
        upstreamId: id,
        durationMs: 0,
        status: 'SUCCESS',
        details: { updates: req.body },
      });

      res.status(200).json({
        message: `Server '${id}' updated successfully.`,
        server: updated,
      });
    } catch (err: any) {
      res.status(400).json({
        error: true,
        code: 'UPDATE_FAILED',
        message: err.message,
      });
    }
  });

  app.delete('/api/servers/:id', authManager.getAuthMiddleware('admin'), async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { id } = req.params;

    const removed = upstreamManager.removeServer(id);
    if (!removed) {
      res.status(404).json({ error: true, message: `Server '${id}' not found.` });
      return;
    }

    // Invalidate and refresh cached tools so removed server tools disappear immediately
    await toolAggregator.refreshTools();

    auditLogger.log({
      userId: user.keyId,
      userRole: user.role,
      action: 'SERVER_REMOVAL',
      upstreamId: id,
      durationMs: 0,
      status: 'SUCCESS',
      details: { removedServerId: id },
    });

    res.status(200).json({
      success: true,
      message: `Server '${id}' removed successfully.`,
    });
  });

  app.post('/api/servers/:id/toggle', authManager.getAuthMiddleware('admin'), async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { id } = req.params;
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: true, message: "Field 'enabled' (boolean) is required." });
      return;
    }

    const updated = upstreamManager.toggleServer(id, enabled);
    if (!updated) {
      res.status(404).json({ error: true, message: `Server '${id}' not found.` });
      return;
    }

    // Invalidate cached tools
    await toolAggregator.refreshTools();

    auditLogger.log({
      userId: user.keyId,
      userRole: user.role,
      action: 'SERVER_TOGGLE',
      upstreamId: id,
      durationMs: 0,
      status: 'SUCCESS',
      details: { enabled },
    });

    res.status(200).json({
      message: `Server '${id}' enabled status set to ${enabled}.`,
      server: upstreamManager.getServer(id),
    });
  });

  // 6. REST Endpoint: Audit Logs (Admin Only)
  app.get('/api/audit-logs', authManager.getAuthMiddleware('admin'), (req: Request, res: Response) => {
    const { userId, action, status, limit } = req.query;
    const logs = auditLogger.getLogs({
      userId: userId as string,
      action: action as string,
      status: status as any,
      limit: limit ? parseInt(limit as string, 10) : 100,
    });

    res.status(200).json({
      count: logs.length,
      logs,
    });
  });

  // 7. REST Endpoint: Authentication & API Key Management
  app.get('/api/auth/me', authManager.getAuthMiddleware(), (req: Request, res: Response) => {
    const user = (req as any).user;
    res.status(200).json({
      authenticated: true,
      user: {
        keyId: user.keyId,
        name: user.name,
        role: user.role,
      },
    });
  });

  app.get('/api/auth/keys', authManager.getAuthMiddleware('admin'), (_req: Request, res: Response) => {
    const keys = authManager.listKeys();
    res.status(200).json({
      count: keys.length,
      keys,
    });
  });

  app.post('/api/auth/keys', authManager.getAuthMiddleware('admin'), (req: Request, res: Response) => {
    const user = (req as any).user;
    const { name, role } = req.body;
    if (!name || (role !== 'admin' && role !== 'member')) {
      res.status(400).json({
        error: true,
        message: "Invalid payload. Provide 'name' (string) and 'role' ('admin' | 'member').",
      });
      return;
    }

    const { record, rawKey } = authManager.createApiKey(name, role);

    auditLogger.log({
      userId: user.keyId,
      userRole: user.role,
      action: 'KEY_CREATION',
      durationMs: 0,
      status: 'SUCCESS',
      details: { keyId: record.id, keyName: name, targetRole: role },
    });

    res.status(201).json({
      message: 'API Key generated successfully. Save this raw key now; it cannot be retrieved again.',
      apiKey: rawKey,
      record: {
        id: record.id,
        name: record.name,
        role: record.role,
        prefix: record.prefix,
        createdAt: record.createdAt,
      },
    });
  });

  app.post('/api/auth/keys/:id/revoke', authManager.getAuthMiddleware('admin'), (req: Request, res: Response) => {
    const user = (req as any).user;
    const { id } = req.params;

    const revoked = authManager.revokeKey(id);
    if (!revoked) {
      res.status(404).json({
        error: true,
        message: `API Key '${id}' not found.`,
      });
      return;
    }

    auditLogger.log({
      userId: user.keyId,
      userRole: user.role,
      action: 'KEY_REVOCATION',
      durationMs: 0,
      status: 'SUCCESS',
      details: { revokedKeyId: id },
    });

    res.status(200).json({
      success: true,
      message: `API Key '${id}' has been revoked.`,
    });
  });

  // 8. Gateway Official Streamable HTTP Transport endpoint (/mcp)
  app.all('/mcp', async (req: Request, res: Response) => {
    try {
      const sessionId = (req.headers['mcp-session-id'] as string) || (req.query.sessionId as string);
      let session = sessionId ? streamableSessions.get(sessionId) : undefined;

      if (!session) {
        const user = extractUserFromRequest(req);
        if (!user) {
          res.status(401).json({
            error: true,
            code: 'UNAUTHORIZED',
            message: 'Missing or invalid API key. Provide Authorization: Bearer <key> header or ?apiKey=<key> query parameter.',
          });
          return;
        }

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => `gw-session-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        });
        const server = await createGatewayMcpInstance(user);
        await server.connect(transport);
        session = { transport, server, user };
      }

      await session.transport.handleRequest(req, res, req.body);

      if (session.transport.sessionId && !streamableSessions.has(session.transport.sessionId)) {
        streamableSessions.set(session.transport.sessionId, session);
        session.transport.onclose = () => {
          if (session?.transport.sessionId) {
            streamableSessions.delete(session.transport.sessionId);
          }
        };
      }
    } catch (err: any) {
      console.error('[Gateway MCP] Streamable HTTP error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: true, message: 'Streamable transport error' });
      }
    }
  });

  // 9. Gateway Backward-Compatible SSE Transport Endpoints (/sse & /messages)
  app.get('/sse', async (req: Request, res: Response) => {
    const user = extractUserFromRequest(req);
    if (!user) {
      res.status(401).json({
        error: true,
        code: 'UNAUTHORIZED',
        message: 'Missing or invalid API key. Provide Authorization: Bearer <key> header or ?apiKey=<key> query parameter.',
      });
      return;
    }

    const transport = new SSEServerTransport('/messages', res);
    const sessionId = transport.sessionId;
    const server = await createGatewayMcpInstance(user);

    activeSseSessions.set(sessionId, { transport, server, user });

    transport.onclose = () => {
      console.log(`[Gateway MCP] SSE Session ${sessionId} closed`);
      activeSseSessions.delete(sessionId);
    };

    transport.onerror = (err) => {
      console.error(`[Gateway MCP] SSE Session ${sessionId} error:`, err);
    };

    await server.connect(transport);
  });

  app.post('/messages', async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;
    const session = sessionId ? activeSseSessions.get(sessionId) : Array.from(activeSseSessions.values())[0];

    if (!session) {
      res.status(404).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'No active MCP session. Connect to /sse first.',
        },
      });
      return;
    }

    try {
      await session.transport.handlePostMessage(req, res, req.body);
    } catch (err: any) {
      console.error('[Gateway MCP] Error handling post message:', err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal error in Gateway MCP transport',
          },
        });
      }
    }
  });

  return { app };
}
