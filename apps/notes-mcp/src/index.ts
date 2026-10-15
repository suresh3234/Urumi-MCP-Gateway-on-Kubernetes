import dotenv from 'dotenv';
import { createNotesServer } from './server';

dotenv.config();

const port = parseInt(process.env.PORT || '4003', 10);
const { app } = createNotesServer(port);

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`==============================================`);
  console.log(`  Notes MCP Server`);
  console.log(`  Port: ${port}`);
  console.log(`  Health Check: http://0.0.0.0:${port}/healthz`);
  console.log(`  Streamable HTTP: http://0.0.0.0:${port}/mcp`);
  console.log(`  Legacy SSE Stream: http://0.0.0.0:${port}/sse`);
  console.log(`==============================================`);
});

const shutdown = (signal: string) => {
  console.log(`\n[Notes MCP] Received ${signal}. Shutting down cleanly...`);
  server.close(() => {
    console.log('[Notes MCP] Server closed. Exiting.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
