import express, { Request, Response, Express } from 'express';
import cors from 'cors';
import path from 'path';
import { GatewayMcpClient } from './mcp-client';
import { AgentRunner } from './agent-runner';

export interface ChatAgentServerConfig {
  port: number;
  gatewayUrl: string;
  memberApiKey: string;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
}

export function createChatAgentApp(config: ChatAgentServerConfig): {
  app: Express;
  mcpClient: GatewayMcpClient;
  agentRunner: AgentRunner;
} {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Initialize MCP client targeting Gateway with member key
  const mcpClient = new GatewayMcpClient(config.gatewayUrl, config.memberApiKey);

  // Initialize Agent Runner
  const agentRunner = new AgentRunner(mcpClient, {
    openaiApiKey: config.openaiApiKey,
    openaiBaseUrl: config.openaiBaseUrl,
    openaiModel: config.openaiModel,
  });

  function extractUserApiKey(req: Request): string | undefined {
    const authHeader = req.headers.authorization;
    const customHeader = req.headers['x-api-key'];
    const bodyKey = req.body?.apiKey;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7).trim();
    }
    if (typeof customHeader === 'string' && customHeader.trim()) {
      return customHeader.trim();
    }
    if (typeof bodyKey === 'string' && bodyKey.trim()) {
      return bodyKey.trim();
    }
    return undefined;
  }

  // Liveness & Readiness probe
  app.get('/healthz', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'healthy',
      service: 'urumi-chat-agent',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // Status & Provider diagnostics
  app.get('/api/agent/status', async (req: Request, res: Response) => {
    const userApiKey = extractUserApiKey(req);
    const identity = await mcpClient.verifyIdentity(userApiKey);

    res.status(200).json({
      service: 'urumi-chat-agent',
      gatewayUrl: mcpClient.getGatewayUrl(),
      gatewayConnected: identity.authenticated,
      authenticatedUser: identity.user || null,
      llmConfigured: agentRunner.isLlmConfigured(),
      model: agentRunner.getModelName(),
    });
  });

  // Discover active tools through Gateway
  app.get('/api/agent/tools', async (req: Request, res: Response) => {
    const userApiKey = extractUserApiKey(req);
    const refresh = req.query.refresh === 'true';
    try {
      const tools = await mcpClient.discoverTools(refresh, userApiKey);
      res.status(200).json({
        count: tools.length,
        tools,
      });
    } catch (err: any) {
      res.status(502).json({
        error: true,
        message: `Failed to discover tools through Gateway: ${err.message}`,
      });
    }
  });

  // Main Chat message endpoint
  app.post('/api/chat', async (req: Request, res: Response) => {
    const { message, conversationId } = req.body;
    const userApiKey = extractUserApiKey(req);

    if (!message || typeof message !== 'string') {
      res.status(400).json({
        error: true,
        message: "Missing 'message' string in request body.",
      });
      return;
    }

    // If an explicit user key was supplied, verify it against Gateway
    if (userApiKey) {
      const identity = await mcpClient.verifyIdentity(userApiKey);
      if (!identity.authenticated) {
        res.status(401).json({
          error: true,
          code: 'UNAUTHORIZED',
          message: 'User authentication failed: API key is invalid or revoked.',
        });
        return;
      }
    }

    try {
      const result = await agentRunner.handleUserMessage(message, conversationId, userApiKey);
      res.status(200).json(result);
    } catch (err: any) {
      res.status(500).json({
        error: true,
        message: `Agent execution failed: ${err.message}`,
      });
    }
  });

  // Reset conversation
  app.post('/api/chat/reset', (req: Request, res: Response) => {
    const { conversationId } = req.body;
    if (conversationId) {
      agentRunner.resetSession(conversationId);
    }
    res.status(200).json({ success: true, message: 'Conversation session cleared.' });
  });

  // Serve static UI assets
  const publicDir = path.resolve(__dirname, 'public');
  app.use(express.static(publicDir));

  // SPA fallback
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(publicDir, 'index.html'), (err) => {
      if (err) {
        res.status(404).send('Chat Agent UI assets not found. Build may be required.');
      }
    });
  });

  return { app, mcpClient, agentRunner };
}
