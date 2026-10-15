import request from 'supertest';
import { createNotesServer } from '../src/server';

describe('Notes MCP Server Endpoints', () => {
  const { app } = createNotesServer(4003);

  it('GET /healthz returns 200 OK with note count', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('notes-mcp');
    expect(res.body.noteCount).toBeGreaterThanOrEqual(1);
  });

  it('GET / returns metadata with streamableHttp and sse endpoints', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.endpoints.streamableHttp).toBe('/mcp');
    expect(res.body.endpoints.sse).toBe('/sse');
  });
});
