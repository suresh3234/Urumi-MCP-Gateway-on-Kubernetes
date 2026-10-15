import express, { Request, Response, Express } from 'express';
import cors from 'cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { AppConfig } from './config';
import { WooCommerceClient } from './woo-client';
import { registerWooCommerceTools } from './tools';

export function createServer(config: AppConfig): { app: Express; wooClient: WooCommerceClient } {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const wooClient = new WooCommerceClient(config);

  function createMcpInstance(): McpServer {
    const mcpServer = new McpServer({
      name: 'woo-mcp',
      version: '1.0.0',
    });
    registerWooCommerceTools(mcpServer, wooClient);
    return mcpServer;
  }

  // Store active SSE transports by sessionId
  const transports = new Map<string, SSEServerTransport>();

  // 1. Health endpoint for Kubernetes liveness & readiness probes
  app.get('/healthz', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      service: 'woo-mcp',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    });
  });

  // 2. Root info endpoint
  app.get('/', (_req: Request, res: Response) => {
    res.status(200).json({
      service: 'woo-mcp',
      description: 'WooCommerce Model Context Protocol (MCP) Server',
      endpoints: {
        health: '/healthz',
        streamableHttp: '/mcp',
        sse: '/sse',
        messages: '/messages',
      },
    });
  });

  // Store active Streamable HTTP transports by sessionId
  const streamableSessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer }>();

  // 3. Official Streamable HTTP Transport endpoint (/mcp)
  app.all('/mcp', async (req: Request, res: Response) => {
    try {
      const sessionId = (req.headers['mcp-session-id'] as string) || (req.query.sessionId as string);
      let session = sessionId ? streamableSessions.get(sessionId) : undefined;

      if (!session) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => `woo-session-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        });
        const server = createMcpInstance();
        await server.connect(transport);
        session = { transport, server };
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
      console.error('[Woo MCP] Streamable HTTP error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: true, message: 'Streamable transport error' });
      }
    }
  });

  // 4. SSE endpoint for initiating MCP sessions
  app.get('/sse', async (_req: Request, res: Response) => {
    console.log('[Woo MCP] Client connected to /sse stream');
    const mcpServer = createMcpInstance();
    const transport = new SSEServerTransport('/messages', res);
    const sessionId = transport.sessionId;

    transports.set(sessionId, transport);

    transport.onclose = () => {
      console.log(`[Woo MCP] Session ${sessionId} closed`);
      transports.delete(sessionId);
    };

    transport.onerror = (err) => {
      console.error(`[Woo MCP] Session ${sessionId} error:`, err);
    };

    await mcpServer.connect(transport);
  });

  // 5. Message endpoint for receiving JSON-RPC requests from connected clients
  app.post('/messages', async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;
    const transport = sessionId ? transports.get(sessionId) : Array.from(transports.values())[0];

    if (!transport) {
      res.status(404).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: sessionId ? `Session ${sessionId} not found` : 'No active MCP session found. Connect to /sse first.',
        },
      });
      return;
    }

    try {
      await transport.handlePostMessage(req, res, req.body);
    } catch (err: any) {
      console.error('[Woo MCP] Error handling post message:', err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal error processing MCP message',
          },
        });
      }
    }
  });

  return { app, wooClient };
}
