import request from 'supertest';
import { createUtilsServer } from '../src/server';

describe('Utils MCP Server Endpoints', () => {
  const { app } = createUtilsServer(4002);

  it('GET /healthz returns 200 OK', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('utils-mcp');
  });

  it('GET / returns metadata with streamableHttp and sse endpoints', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.endpoints.streamableHttp).toBe('/mcp');
    expect(res.body.endpoints.sse).toBe('/sse');
  });
});
