import request from 'supertest';
import express from 'express';
import http from 'http';
import { createChatAgentApp } from '../src/server';

describe('Chat Agent Server & MCP Loop Tests', () => {
  let mockGatewayServer: http.Server;
  let mockGatewayPort: number;
  let chatApp: any;
  let mcpClient: any;
  let agentRunner: any;

  beforeAll((done) => {
    // Spin up a mock Gateway
    const mockGw = express();
    mockGw.use(express.json());

    mockGw.get('/healthz', (_req, res) => {
      res.status(200).json({ status: 'healthy', service: 'mock-gateway' });
    });

    mockGw.get('/api/auth/me', (req, res) => {
      const auth = req.headers.authorization;
      if (auth === 'Bearer valid-member-key') {
        res.status(200).json({ authenticated: true, user: { keyId: 'key_member', name: 'Member Agent', role: 'member' } });
      } else if (auth === 'Bearer valid-admin-key') {
        res.status(200).json({ authenticated: true, user: { keyId: 'key_admin', name: 'Admin User', role: 'admin' } });
      } else {
        res.status(401).json({ error: true, message: 'Unauthorized' });
      }
    });

    mockGw.get('/api/tools', (_req, res) => {
      res.status(200).json({
        count: 3,
        tools: [
          {
            namespacedName: 'woo-mcp__list_products',
            originalName: 'list_products',
            serverId: 'woo-mcp',
            description: 'List products in store',
            inputSchema: { type: 'object' },
          },
          {
            namespacedName: 'utils-mcp__calculate_discount',
            originalName: 'calculate_discount',
            serverId: 'utils-mcp',
            description: 'Calculate discount on price',
            inputSchema: {
              type: 'object',
              properties: { price: { type: 'number' }, discountPercent: { type: 'number' } },
            },
          },
          {
            namespacedName: 'woo-mcp__create_product',
            originalName: 'create_product',
            serverId: 'woo-mcp',
            description: 'Create a product',
            inputSchema: { type: 'object' },
          },
        ],
      });
    });

    mockGw.post('/api/tools/execute', (req, res) => {
      const auth = req.headers.authorization;
      const { tool, arguments: args } = req.body;

      if (tool === 'woo-mcp__create_product') {
        if (auth === 'Bearer valid-admin-key') {
          return res.status(200).json({
            content: [
              {
                type: 'text',
                text: JSON.stringify({ id: 205, name: args.name || 'Silk Tie', price: args.regular_price || '35.00', status: 'publish' }),
              },
            ],
            isError: false,
            meta: { upstreamId: 'woo-mcp', durationMs: 25 },
          });
        }

        // Enforce RBAC denial for member key
        return res.status(403).json({
          error: true,
          code: 'FORBIDDEN_TOOL',
          message: "Role 'member' cannot execute mutating tool 'woo-mcp__create_product'.",
        });
      }

      if (tool === 'woo-mcp__list_products') {
        return res.status(200).json({
          content: [
            {
              type: 'text',
              text: JSON.stringify([{ id: 101, name: 'Cool Shoes', price: '120.00' }]),
            },
          ],
          isError: false,
          meta: { upstreamId: 'woo-mcp', durationMs: 15 },
        });
      }

      if (tool === 'utils-mcp__calculate_discount') {
        const price = args.price || 150;
        const discountPercent = args.discountPercent || 20;
        const discountAmount = (price * discountPercent) / 100;
        return res.status(200).json({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                originalPrice: price,
                discountPercent,
                discountAmount,
                discountedPrice: price - discountAmount,
              }),
            },
          ],
          isError: false,
          meta: { upstreamId: 'utils-mcp', durationMs: 8 },
        });
      }

      res.status(404).json({ error: true, message: `Tool ${tool} not found.` });
    });

    mockGatewayServer = mockGw.listen(0, () => {
      const addr = mockGatewayServer.address() as any;
      mockGatewayPort = addr.port;

      const created = createChatAgentApp({
        port: 5000,
        gatewayUrl: `http://127.0.0.1:${mockGatewayPort}`,
        memberApiKey: 'valid-member-key',
      });

      chatApp = created.app;
      mcpClient = created.mcpClient;
      agentRunner = created.agentRunner;
      done();
    });
  });

  afterAll((done) => {
    mockGatewayServer.close(done);
  });

  it('GET /healthz returns 200 for Kubernetes probes', async () => {
    const res = await request(chatApp).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.service).toBe('urumi-chat-agent');
  });

  it('GET /api/agent/status returns gateway connection and member identity', async () => {
    const res = await request(chatApp).get('/api/agent/status');
    expect(res.status).toBe(200);
    expect(res.body.gatewayConnected).toBe(true);
    expect(res.body.authenticatedUser.role).toBe('member');
  });

  it('GET /api/agent/tools discovers tools from Gateway', async () => {
    const res = await request(chatApp).get('/api/agent/tools');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
    expect(res.body.tools[0].namespacedName).toBe('woo-mcp__list_products');
  });

  it('POST /api/chat handles product listing workflow', async () => {
    const res = await request(chatApp)
      .post('/api/chat')
      .send({ message: 'Show me the products available in my store', conversationId: 'test_conv_1' });

    expect(res.status).toBe(200);
    expect(res.body.reply).toContain('Cool Shoes');
    expect(res.body.toolsUsed.length).toBeGreaterThan(0);
    expect(res.body.toolsUsed[0].name).toBe('woo-mcp__list_products');
  });

  it('POST /api/chat handles discount calculation workflow', async () => {
    const res = await request(chatApp)
      .post('/api/chat')
      .send({ message: 'What is the price after a 20% discount on 150?', conversationId: 'test_conv_1' });

    expect(res.status).toBe(200);
    expect(res.body.reply).toContain('120');
    expect(res.body.toolsUsed.some((t: any) => t.name === 'utils-mcp__calculate_discount')).toBe(true);
  });

  it('POST /api/chat handles RBAC denial for member attempting mutating tool', async () => {
    const res = await request(chatApp)
      .post('/api/chat')
      .send({ message: 'Create a new product named Forbidden Shirt for 30', conversationId: 'test_conv_1' });

    expect(res.status).toBe(200);
    expect(res.body.reply).toContain('Action Blocked by Gateway RBAC');
    expect(res.body.toolsUsed.some((t: any) => t.name === 'woo-mcp__create_product')).toBe(true);
    expect(res.body.toolsUsed.some((t: any) => t.status === 'ERROR')).toBe(true);
  });

  it('POST /api/chat with authorized admin key succeeds and creates product', async () => {
    const res = await request(chatApp)
      .post('/api/chat')
      .set('Authorization', 'Bearer valid-admin-key')
      .send({ message: 'Create a product named "Silk Tie" with price 35', conversationId: 'test_conv_admin' });

    expect(res.status).toBe(200);
    expect(res.body.reply).toContain('Product Created Successfully');
    expect(res.body.reply).toContain('Silk Tie');
    expect(res.body.toolsUsed.some((t: any) => t.name === 'woo-mcp__create_product')).toBe(true);
    expect(res.body.toolsUsed.some((t: any) => t.status === 'SUCCESS')).toBe(true);
  });

  it('POST /api/chat with invalid/revoked user key returns 401 UNAUTHORIZED', async () => {
    const res = await request(chatApp)
      .post('/api/chat')
      .set('Authorization', 'Bearer revoked-key')
      .send({ message: 'List products in store', conversationId: 'test_conv_revoked' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('POST /api/chat/reset clears conversation history', async () => {
    const res = await request(chatApp)
      .post('/api/chat/reset')
      .send({ conversationId: 'test_conv_1' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
