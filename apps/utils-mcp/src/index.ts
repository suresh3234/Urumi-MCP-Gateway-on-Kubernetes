import dotenv from 'dotenv';
import { createUtilsServer } from './server';

dotenv.config();

const port = parseInt(process.env.PORT || '4002', 10);
const { app } = createUtilsServer(port);

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`==============================================`);
  console.log(`  Utils MCP Server`);
  console.log(`  Port: ${port}`);
  console.log(`  Health Check: http://0.0.0.0:${port}/healthz`);
  console.log(`  Streamable HTTP: http://0.0.0.0:${port}/mcp`);
  console.log(`  Legacy SSE Stream: http://0.0.0.0:${port}/sse`);
  console.log(`==============================================`);
});

const shutdown = (signal: string) => {
  console.log(`\n[Utils MCP] Received ${signal}. Shutting down cleanly...`);
  server.close(() => {
    console.log('[Utils MCP] Server closed. Exiting.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
