import request from 'supertest';
import express from 'express';
import http from 'http';
import { createChatAgentApp } from '../src/server';

describe('Real LLM Tool-Calling Cycle & Integration Tests', () => {
  let mockGatewayServer: http.Server;
  let mockGatewayPort: number;
  let mockLlmServer: http.Server;
  let mockLlmPort: number;
  let chatApp: any;

  let llmCallCount = 0;
  let lastLlmReceivedMessages: any[] = [];
  let gatewayToolCallsReceived: any[] = [];

  beforeAll((done) => {
    // 1. Spin up Mock Gateway
    const mockGw = express();
    mockGw.use(express.json());

    mockGw.get('/api/auth/me', (req, res) => {
      const auth = req.headers.authorization;
      if (auth === 'Bearer valid-member-key') {
        res.status(200).json({ authenticated: true, user: { keyId: 'key_member', name: 'Member Agent', role: 'member' } });
      } else if (auth === 'Bearer valid-admin-key') {
        res.status(200).json({ authenticated: true, user: { keyId: 'key_admin', name: 'Admin User', role: 'admin' } });
      } else {
        res.status(401).json({ error: true, code: 'UNAUTHORIZED', message: 'Unauthorized key' });
      }
    });

    mockGw.get('/api/tools', (_req, res) => {
      res.status(200).json({
        count: 2,
        tools: [
          {
            namespacedName: 'woo-mcp__list_orders',
            originalName: 'list_orders',
            serverId: 'woo-mcp',
            description: 'List store orders',
            inputSchema: { type: 'object', properties: {} },
          },
          {
            namespacedName: 'woo-mcp__create_product',
            originalName: 'create_product',
            serverId: 'woo-mcp',
            description: 'Create a product',
            inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
          },
        ],
      });
    });

    mockGw.post('/api/tools/execute', (req, res) => {
      const auth = req.headers.authorization;
      const { tool, arguments: args } = req.body;
      gatewayToolCallsReceived.push({ auth, tool, args });

      if (tool === 'woo-mcp__create_product') {
        if (auth === 'Bearer valid-admin-key') {
          return res.status(200).json({
            content: [{ type: 'text', text: JSON.stringify({ id: 99, name: args.name, status: 'publish' }) }],
            isError: false,
            meta: { upstreamId: 'woo-mcp', durationMs: 20 },
          });
        }
        return res.status(403).json({
          error: true,
          code: 'FORBIDDEN_TOOL',
          message: "Role 'member' cannot execute mutating tool 'woo-mcp__create_product'.",
        });
      }

      if (tool === 'woo-mcp__list_orders') {
        return res.status(200).json({
          content: [{ type: 'text', text: JSON.stringify([{ id: 12, status: 'completed', total: '49.99' }]) }],
          isError: false,
          meta: { upstreamId: 'woo-mcp', durationMs: 15 },
        });
      }

      res.status(404).json({ error: true, message: 'Tool not found' });
    });

    // 2. Spin up Mock OpenAI Provider
    const mockLlm = express();
    mockLlm.use(express.json());

    mockLlm.post('/v1/chat/completions', (req, res) => {
      llmCallCount++;
      lastLlmReceivedMessages = req.body.messages || [];

      // Verify Authorization header passed
      if (req.headers.authorization !== 'Bearer mock-provider-openai-key') {
        return res.status(401).json({ error: { message: 'Invalid OpenAI API Key' } });
      }

      // Check if this request includes tool results (Turn 2)
      const hasToolResult = lastLlmReceivedMessages.some((m) => m.role === 'tool');

      if (!hasToolResult) {
        // Turn 1: Model decides to call a tool based on user message
        const lastUserMsg = lastLlmReceivedMessages.filter((m) => m.role === 'user').pop()?.content || '';

        if (lastUserMsg.includes('create')) {
          // Model calls create_product
          return res.status(200).json({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'call_create_123',
                      type: 'function',
                      function: {
                        name: 'woo-mcp__create_product',
                        arguments: JSON.stringify({ name: 'Smart Watch' }),
                      },
                    },
                  ],
                },
              },
            ],
          });
        }

        // Model calls list_orders
        return res.status(200).json({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_orders_456',
                    type: 'function',
                    function: {
                      name: 'woo-mcp__list_orders',
                      arguments: '{}',
                    },
                  },
                ],
              },
            },
          ],
        });
      } else {
        // Turn 2: Model sees tool result and synthesizes final answer
        const toolResultMsg = lastLlmReceivedMessages.find((m) => m.role === 'tool');
        const isError = toolResultMsg?.content?.includes('Permission Denied') || toolResultMsg?.content?.includes('FORBIDDEN_TOOL');

        if (isError) {
          return res.status(200).json({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'I apologize, but you do not have permission to create products with your member key.',
                },
              },
            ],
          });
        }

        return res.status(200).json({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'I checked your store and found Order #12 completed for $49.99.',
              },
            },
          ],
        });
      }
    });

    mockGatewayServer = mockGw.listen(0, () => {
      const gAddr = mockGatewayServer.address() as any;
      mockGatewayPort = gAddr.port;

      mockLlmServer = mockLlm.listen(0, () => {
        const lAddr = mockLlmServer.address() as any;
        mockLlmPort = lAddr.port;

        const created = createChatAgentApp({
          port: 5000,
          gatewayUrl: `http://127.0.0.1:${mockGatewayPort}`,
          memberApiKey: 'valid-member-key',
          openaiApiKey: 'mock-provider-openai-key',
          openaiBaseUrl: `http://127.0.0.1:${mockLlmPort}/v1`,
          openaiModel: 'gpt-4o-mini',
        });

        chatApp = created.app;
        done();
      });
    });
  });

  afterAll((done) => {
    mockGatewayServer.close(() => {
      mockLlmServer.close(done);
    });
  });

  beforeEach(() => {
    llmCallCount = 0;
    lastLlmReceivedMessages = [];
    gatewayToolCallsReceived = [];
  });

  it('verifies agent status indicates LLM is configured', async () => {
    const res = await request(chatApp).get('/api/agent/status');
    expect(res.status).toBe(200);
    expect(res.body.llmConfigured).toBe(true);
    expect(res.body.model).toBe('gpt-4o-mini');
  });

  it('executes full LLM tool-calling cycle: user message -> LLM tool selection -> Gateway tool execution -> LLM final answer', async () => {
    const res = await request(chatApp)
      .post('/api/chat')
      .set('Authorization', 'Bearer valid-member-key')
      .send({
        message: 'Can you check recent orders for me?',
        conversationId: 'llm_test_cycle_1',
      });

    expect(res.status).toBe(200);
    expect(res.body.executionMode).toBe('llm');
    expect(res.body.reply).toBe('I checked your store and found Order #12 completed for $49.99.');

    // Verify which tools were called
    expect(res.body.toolsUsed).toHaveLength(1);
    expect(res.body.toolsUsed[0].name).toBe('woo-mcp__list_orders');
    expect(res.body.toolsUsed[0].status).toBe('SUCCESS');

    // Verify LLM turns: Turn 1 (tool call) + Turn 2 (final answer)
    expect(llmCallCount).toBe(2);

    // Verify Gateway was called with caller user identity header
    expect(gatewayToolCallsReceived).toHaveLength(1);
    expect(gatewayToolCallsReceived[0].auth).toBe('Bearer valid-member-key');
    expect(gatewayToolCallsReceived[0].tool).toBe('woo-mcp__list_orders');
  });

  it('handles server-side RBAC denial within LLM tool-calling cycle for member key', async () => {
    const res = await request(chatApp)
      .post('/api/chat')
      .set('Authorization', 'Bearer valid-member-key')
      .send({
        message: 'Please create a new product named Smart Watch',
        conversationId: 'llm_test_rbac_denial',
      });

    expect(res.status).toBe(200);
    expect(res.body.executionMode).toBe('llm');
    expect(res.body.reply).toContain('do not have permission');

    // Verify tool execution was flagged as ERROR in toolsUsed
    expect(res.body.toolsUsed).toHaveLength(1);
    expect(res.body.toolsUsed[0].name).toBe('woo-mcp__create_product');
    expect(res.body.toolsUsed[0].status).toBe('ERROR');
  });

  it('rejects revoked user API key with 401 before LLM invocation', async () => {
    const res = await request(chatApp)
      .post('/api/chat')
      .set('Authorization', 'Bearer revoked-key')
      .send({
        message: 'Check orders',
        conversationId: 'llm_test_revoked',
      });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
    // Ensure LLM was never called
    expect(llmCallCount).toBe(0);
  });
});
