import { loadConfig } from './config';
import { AuthManager } from './auth';
import { AuditLogger } from './audit';
import { UpstreamManager } from './upstream-manager';
import { ToolAggregator } from './tool-aggregator';
import { createGatewayApp } from './server';

async function main() {
  const config = loadConfig();
  const authManager = new AuthManager(config.apiKeySalt);
  const auditLogger = new AuditLogger(1000);
  const upstreamManager = new UpstreamManager(config.defaultUpstreams);
  const toolAggregator = new ToolAggregator(upstreamManager, config.discoveryCacheTtlMs);

  // Initialize bootstrap API keys
  if (config.initialAdminKey) {
    const adminKey = authManager.createApiKey('Initial Admin', 'admin', config.initialAdminKey);
    console.log(`[Bootstrap] Registered Admin API Key: ${adminKey.record.prefix} (id: ${adminKey.record.id})`);
  }

  if (config.initialMemberKey) {
    const memberKey = authManager.createApiKey('Initial Member', 'member', config.initialMemberKey);
    console.log(`[Bootstrap] Registered Member API Key: ${memberKey.record.prefix} (id: ${memberKey.record.id})`);
  }

  const { app } = createGatewayApp(config, authManager, auditLogger, upstreamManager, toolAggregator);

  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`==============================================`);
    console.log(`  Urumi AI MCP Gateway`);
    console.log(`  Port: ${config.port}`);
    console.log(`  Health Check: http://0.0.0.0:${config.port}/healthz`);
    console.log(`  MCP SSE Stream: http://0.0.0.0:${config.port}/sse`);
    console.log(`  Tools API: http://0.0.0.0:${config.port}/api/tools`);
    console.log(`  Default Upstreams: ${config.defaultUpstreams.map((u) => u.id).join(', ')}`);
    console.log(`==============================================`);
  });

  const shutdown = async (signal: string) => {
    console.log(`\n[Gateway] Received ${signal}. Starting graceful shutdown...`);
    await upstreamManager.closeAll();
    server.close(() => {
      console.log('[Gateway] HTTP server closed cleanly. Exiting.');
      process.exit(0);
    });

    setTimeout(() => {
      console.error('[Gateway] Forcefully shutting down after timeout.');
      process.exit(1);
    }, 5000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[Gateway] Fatal startup error:', err);
  process.exit(1);
});
