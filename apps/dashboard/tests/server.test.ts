import request from 'supertest';
import express from 'express';
import http from 'http';
import { createDashboardApp } from '../src/server';

describe('Dashboard Server Unit Tests', () => {
  let mockGatewayServer: http.Server;
  let mockGatewayPort: number;
  let dashboardApp: any;

  beforeAll((done) => {
    // Spin up a mock Gateway on an ephemeral port
    const mockGwApp = express();
    mockGwApp.use(express.json());

    mockGwApp.get('/healthz', (_req, res) => {
      res.status(200).json({ status: 'healthy', service: 'mock-gateway' });
    });

    mockGwApp.get('/api/auth/me', (req, res) => {
      const auth = req.headers.authorization;
      if (auth === 'Bearer valid-admin-key') {
        res.status(200).json({ authenticated: true, user: { keyId: 'key_1', name: 'Admin', role: 'admin' } });
      } else {
        res.status(401).json({ error: true, message: 'Unauthorized' });
      }
    });

    mockGatewayServer = mockGwApp.listen(0, () => {
      const addr = mockGatewayServer.address() as any;
      mockGatewayPort = addr.port;

      dashboardApp = createDashboardApp({
        port: 3000,
        internalGatewayUrl: `http://127.0.0.1:${mockGatewayPort}`,
        publicGatewayUrl: '/api/gateway',
      });

      done();
    });
  });

  afterAll((done) => {
    if (typeof (mockGatewayServer as any).closeAllConnections === 'function') {
      (mockGatewayServer as any).closeAllConnections();
    }
    mockGatewayServer.close(done);
  });

  it('GET /healthz returns 200 and healthy status for Kubernetes probes', async () => {
    const res = await request(dashboardApp).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.service).toBe('urumi-dashboard');
    expect(res.body.uptime).toBeDefined();
  });

  it('GET /api/config returns client gateway config', async () => {
    const res = await request(dashboardApp).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body.gatewayUrl).toBe('/api/gateway');
    expect(res.body.hasProxy).toBe(true);
  });

  it('GET / serves the dashboard HTML', async () => {
    const res = await request(dashboardApp).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Urumi MCP Gateway');
  });

  it('BFF Proxy forwards /api/gateway/healthz to target Gateway', async () => {
    const res = await request(dashboardApp).get('/api/gateway/healthz');
    expect(res.status).toBe(200);
    expect(res.body.service).toBe('mock-gateway');
  });

  it('BFF Proxy preserves Authorization header and handles 401', async () => {
    const resUnauthorized = await request(dashboardApp).get('/api/gateway/api/auth/me');
    expect(resUnauthorized.status).toBe(401);

    const resAuthorized = await request(dashboardApp)
      .get('/api/gateway/api/auth/me')
      .set('Authorization', 'Bearer valid-admin-key');
    expect(resAuthorized.status).toBe(200);
    expect(resAuthorized.body.authenticated).toBe(true);
  });
});
