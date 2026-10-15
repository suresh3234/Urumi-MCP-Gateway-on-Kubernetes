import express, { Request, Response, Express } from 'express';
import cors from 'cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { NoteStore } from './store';
import { registerNotesTools } from './tools';

export function createNotesServer(_port: number = 4003): { app: Express; store: NoteStore } {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const store = new NoteStore();

  function createMcpInstance(): McpServer {
    const mcpServer = new McpServer({
      name: 'notes-mcp',
      version: '1.0.0',
    });
    registerNotesTools(mcpServer, store);
    return mcpServer;
  }

  // Store active SSE transports by sessionId
  const sseTransports = new Map<string, SSEServerTransport>();

  // 1. Health endpoint for Kubernetes probes
  app.get('/healthz', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      service: 'notes-mcp',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      noteCount: store.getAllNotes().length,
    });
  });

  // 2. Root metadata endpoint
  app.get('/', (_req: Request, res: Response) => {
    res.status(200).json({
      service: 'notes-mcp',
      description: 'Order notes and customer context MCP server',
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
          sessionIdGenerator: () => `notes-session-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
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
      console.error('[Notes MCP] Streamable HTTP error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: true, message: 'Streamable transport error' });
      }
    }
  });

  // 4. Backward-compatible SSE Transport endpoints (/sse & /messages)
  app.get('/sse', async (_req: Request, res: Response) => {
    console.log('[Notes MCP] Client connected to /sse stream');
    const mcpServer = createMcpInstance();
    const transport = new SSEServerTransport('/messages', res);
    const sessionId = transport.sessionId;
    sseTransports.set(sessionId, transport);

    transport.onclose = () => {
      console.log(`[Notes MCP] Session ${sessionId} closed`);
      sseTransports.delete(sessionId);
    };

    await mcpServer.connect(transport);
  });

  app.post('/messages', async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;
    const transport = sessionId ? sseTransports.get(sessionId) : Array.from(sseTransports.values())[0];

    if (!transport) {
      res.status(404).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'No active session. Connect to /sse first.' },
      });
      return;
    }

    try {
      await transport.handlePostMessage(req, res, req.body);
    } catch (err: any) {
      console.error('[Notes MCP] Error handling post message:', err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal error processing message' },
        });
      }
    }
  });

  return { app, store };
}
