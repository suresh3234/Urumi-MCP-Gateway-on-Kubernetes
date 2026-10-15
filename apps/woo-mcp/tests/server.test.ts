import request from 'supertest';
import { createServer } from '../src/server';
import { AppConfig } from '../src/config';

describe('MCP Server Endpoints', () => {
  const mockConfig: AppConfig = {
    port: 4001,
    woocommerceUrl: 'http://mock-store:80',
    woocommerceConsumerKey: 'ck_mock',
    woocommerceConsumerSecret: 'cs_mock',
    apiTimeoutMs: 5000,
    nodeEnv: 'test',
  };

  const { app } = createServer(mockConfig);

  it('GET /healthz returns 200 OK with service status', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('woo-mcp');
    expect(res.body.version).toBe('1.0.0');
    expect(res.body.timestamp).toBeDefined();
  });

  it('GET / returns metadata about MCP service endpoints', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.service).toBe('woo-mcp');
    expect(res.body.endpoints.health).toBe('/healthz');
  });
});
