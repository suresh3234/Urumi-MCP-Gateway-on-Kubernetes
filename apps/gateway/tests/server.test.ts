import request from 'supertest';
import { createGatewayApp } from '../src/server';
import { AuthManager } from '../src/auth';
import { AuditLogger } from '../src/audit';
import { UpstreamManager } from '../src/upstream-manager';
import { ToolAggregator } from '../src/tool-aggregator';

describe('Gateway HTTP & REST Endpoints Unit Tests', () => {
  let app: any;
  let authManager: AuthManager;
  let auditLogger: AuditLogger;
  let upstreamManager: UpstreamManager;
  let toolAggregator: ToolAggregator;
  let adminKey: string;
  let memberKey: string;

  beforeEach(() => {
    authManager = new AuthManager('test-salt-server-2026');
    auditLogger = new AuditLogger(50);
    upstreamManager = new UpstreamManager([
      {
        id: 'woo-mcp',
        name: 'WooCommerce MCP',
        url: 'http://woo-mcp:4001/sse',
        transport: 'sse',
        enabled: true,
        timeoutMs: 1000,
      },
    ]);
    toolAggregator = new ToolAggregator(upstreamManager, 1000);

    // Bootstrap test keys
    const adminRes = authManager.createApiKey('Admin User', 'admin');
    adminKey = adminRes.rawKey;

    const memberRes = authManager.createApiKey('Member User', 'member');
    memberKey = memberRes.rawKey;

    // Mock tool discovery and execution
    jest.spyOn(toolAggregator, 'getTools').mockResolvedValue([
      {
        namespacedName: 'woo-mcp__list_products',
        originalName: 'list_products',
        serverId: 'woo-mcp',
        serverName: 'WooCommerce MCP',
        description: 'List products',
        inputSchema: { type: 'object' },
      },
      {
        namespacedName: 'woo-mcp__create_product',
        originalName: 'create_product',
        serverId: 'woo-mcp',
        serverName: 'WooCommerce MCP',
        description: 'Create product',
        inputSchema: { type: 'object' },
      },
    ]);

    jest.spyOn(toolAggregator, 'executeTool').mockImplementation(async (tool: string, args: any) => {
      if (tool === 'list_products' || tool === 'woo-mcp__list_products') {
        return {
          content: [{ type: 'text', text: JSON.stringify([{ id: 10, name: 'Product A' }]) }],
          isError: false,
          meta: { upstreamId: 'woo-mcp', durationMs: 25 },
        };
      }
      if (tool === 'create_product' || tool === 'woo-mcp__create_product') {
        return {
          content: [{ type: 'text', text: JSON.stringify({ id: 20, name: args?.name || 'New' }) }],
          isError: false,
          meta: { upstreamId: 'woo-mcp', durationMs: 30 },
        };
      }
      throw new Error(`Tool ${tool} not found`);
    });

    const config = {
      port: 8080,
      apiKeySalt: 'test-salt-server-2026',
      defaultUpstreams: [],
      discoveryCacheTtlMs: 30000,
    };

    const setup = createGatewayApp(config, authManager, auditLogger, upstreamManager, toolAggregator);
    app = setup.app;
  });

  it('GET /healthz returns 200 OK with system status', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('urumi-gateway');
    expect(res.body.upstreams.total).toBe(1);
    expect(res.body.upstreams.enabled).toBe(1);
  });

  it('GET /api/tools requires valid API key', async () => {
    const resNoAuth = await request(app).get('/api/tools');
    expect(resNoAuth.status).toBe(401);

    const resAuth = await request(app)
      .get('/api/tools')
      .set('Authorization', `Bearer ${memberKey}`);
    expect(resAuth.status).toBe(200);
    expect(resAuth.body.count).toBe(2);
    expect(resAuth.body.tools[0].namespacedName).toBe('woo-mcp__list_products');
  });

  it('POST /api/tools/execute allows member to execute read tool', async () => {
    const res = await request(app)
      .post('/api/tools/execute')
      .set('Authorization', `Bearer ${memberKey}`)
      .send({ tool: 'woo-mcp__list_products', arguments: {} });

    expect(res.status).toBe(200);
    expect(res.body.isError).toBe(false);
  });

  it('POST /api/tools/execute blocks member from executing mutating tool (RBAC)', async () => {
    const res = await request(app)
      .post('/api/tools/execute')
      .set('Authorization', `Bearer ${memberKey}`)
      .send({ tool: 'woo-mcp__create_product', arguments: { name: 'Unauthorized Shirt' } });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_TOOL');
  });

  it('POST /api/tools/execute allows admin to execute mutating tool', async () => {
    const res = await request(app)
      .post('/api/tools/execute')
      .set('Authorization', `Bearer ${adminKey}`)
      .send({ tool: 'woo-mcp__create_product', arguments: { name: 'Authorized Shirt' } });

    expect(res.status).toBe(200);
    expect(res.body.isError).toBe(false);
  });

  it('GET /api/servers is protected for admin only', async () => {
    const resMember = await request(app)
      .get('/api/servers')
      .set('Authorization', `Bearer ${memberKey}`);
    expect(resMember.status).toBe(403);

    const resAdmin = await request(app)
      .get('/api/servers')
      .set('Authorization', `Bearer ${adminKey}`);
    expect(resAdmin.status).toBe(200);
    expect(resAdmin.body.count).toBe(1);
    expect(resAdmin.body.servers[0].id).toBe('woo-mcp');
  });

  it('GET /api/audit-logs records tool invocations and is admin protected', async () => {
    // Make a call to generate log
    await request(app)
      .post('/api/tools/execute')
      .set('Authorization', `Bearer ${adminKey}`)
      .send({ tool: 'woo-mcp__list_products', arguments: {} });

    const res = await request(app)
      .get('/api/audit-logs')
      .set('Authorization', `Bearer ${adminKey}`);

    expect(res.status).toBe(200);
    expect(res.body.logs.length).toBeGreaterThan(0);
  });

  it('GET /sse rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get('/sse');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('POST /mcp rejects unauthenticated requests with 401', async () => {
    const res = await request(app).post('/mcp').send({});
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('GET /api/auth/me returns authenticated user details for valid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${adminKey}`);
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(true);
    expect(res.body.user.role).toBe('admin');

    const unauth = await request(app).get('/api/auth/me');
    expect(unauth.status).toBe(401);
  });

  it('POST /api/auth/keys generates key and POST /api/auth/keys/:id/revoke revokes it', async () => {
    // 1. Create a member key as admin
    const createRes = await request(app)
      .post('/api/auth/keys')
      .set('Authorization', `Bearer ${adminKey}`)
      .send({ name: 'Temp Bot', role: 'member' });

    expect(createRes.status).toBe(201);
    expect(createRes.body.apiKey).toBeDefined();
    const newKey = createRes.body.apiKey;
    const newKeyId = createRes.body.record.id;

    // 2. Test that new key can authenticate to /api/auth/me
    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${newKey}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.name).toBe('Temp Bot');

    // 3. Member cannot revoke keys (RBAC check)
    const memberRevokeRes = await request(app)
      .post(`/api/auth/keys/${newKeyId}/revoke`)
      .set('Authorization', `Bearer ${memberKey}`);
    expect(memberRevokeRes.status).toBe(403);

    // 4. Admin revokes the key
    const revokeRes = await request(app)
      .post(`/api/auth/keys/${newKeyId}/revoke`)
      .set('Authorization', `Bearer ${adminKey}`);
    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.success).toBe(true);

    // 5. Subsequent authentication with revoked key is rejected
    const afterRevokeRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${newKey}`);
    expect(afterRevokeRes.status).toBe(401);
    expect(afterRevokeRes.body.code).toBe('INVALID_KEY');
  });

  it('PUT /api/servers/:id allows admin to edit upstream config and rejects member', async () => {
    // 1. Member gets 403
    const memberRes = await request(app)
      .put('/api/servers/woo-mcp')
      .set('Authorization', `Bearer ${memberKey}`)
      .send({ name: 'Renamed Woo Server', timeoutMs: 15000 });
    expect(memberRes.status).toBe(403);

    // 2. Admin can update
    const adminRes = await request(app)
      .put('/api/servers/woo-mcp')
      .set('Authorization', `Bearer ${adminKey}`)
      .send({ name: 'Renamed Woo Server', timeoutMs: 15000 });
    expect(adminRes.status).toBe(200);
    expect(adminRes.body.server.name).toBe('Renamed Woo Server');
    expect(adminRes.body.server.timeoutMs).toBe(15000);

    // 3. Admin SSRF rejection on unsafe target URL
    const ssrfRes = await request(app)
      .put('/api/servers/woo-mcp')
      .set('Authorization', `Bearer ${adminKey}`)
      .send({ url: 'http://127.0.0.1:9090' });
    expect(ssrfRes.status).toBe(400);
    expect(ssrfRes.body.code).toBe('UPDATE_FAILED');
  });

  it('DELETE /api/servers/:id allows admin to remove server and rejects member', async () => {
    // 1. Register a temporary upstream server
    await request(app)
      .post('/api/servers')
      .set('Authorization', `Bearer ${adminKey}`)
      .send({ id: 'temp-mcp', name: 'Temp Upstream', url: 'http://temp-mcp:4005/sse' });

    // 2. Member gets 403 trying to delete
    const memberRes = await request(app)
      .delete('/api/servers/temp-mcp')
      .set('Authorization', `Bearer ${memberKey}`);
    expect(memberRes.status).toBe(403);

    // 3. Admin can remove
    const adminRes = await request(app)
      .delete('/api/servers/temp-mcp')
      .set('Authorization', `Bearer ${adminKey}`);
    expect(adminRes.status).toBe(200);
    expect(adminRes.body.success).toBe(true);

    // 4. Server is no longer listed
    const listRes = await request(app)
      .get('/api/servers')
      .set('Authorization', `Bearer ${adminKey}`);
    expect(listRes.body.servers.find((s: any) => s.id === 'temp-mcp')).toBeUndefined();
  });
});
