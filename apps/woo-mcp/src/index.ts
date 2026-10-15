import { loadConfig } from './config';
import { createServer } from './server';

async function main() {
  const config = loadConfig();
  const { app } = createServer(config);

  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log('==============================================');
    console.log('  WooCommerce MCP Server');
    console.log(`  Port: ${config.port}`);
    console.log(`  Target Store: ${config.woocommerceUrl}`);
    console.log(`  Environment: ${config.nodeEnv}`);
    console.log(`  Health Check: http://0.0.0.0:${config.port}/healthz`);
    console.log(`  MCP SSE Stream: http://0.0.0.0:${config.port}/sse`);
    console.log(`  MCP Endpoint: http://0.0.0.0:${config.port}/mcp`);
    console.log('==============================================');
  });

  const shutdown = () => {
    console.log('\n[Process] Received termination signal. Initiating graceful shutdown...');
    server.close(() => {
      console.log('[Process] HTTP server closed. Exiting cleanly.');
      process.exit(0);
    });

    // Force close if graceful shutdown takes too long
    setTimeout(() => {
      console.error('[Process] Forcing shutdown after timeout.');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[Fatal] Failed to start WooCommerce MCP Server:', err);
  process.exit(1);
});
