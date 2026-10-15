import express, { Request, Response, Express } from 'express';
import cors from 'cors';
import path from 'path';
import http from 'http';

export interface DashboardServerConfig {
  port: number;
  internalGatewayUrl: string;
  publicGatewayUrl: string;
}

export function createDashboardApp(config: DashboardServerConfig): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Liveness & Readiness probe
  app.get('/healthz', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'healthy',
      service: 'urumi-dashboard',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // Client configuration provider
  app.get('/api/config', (_req: Request, res: Response) => {
    res.status(200).json({
      gatewayUrl: config.publicGatewayUrl || '/api/gateway',
      hasProxy: true,
      environment: process.env.NODE_ENV || 'development',
    });
  });

  // BFF Proxy to internal Gateway
  app.all('/api/gateway/*', async (req: Request, res: Response) => {
    const targetPath = req.url.replace(/^\/api\/gateway/, '') || '/';
    const targetUrl = `${config.internalGatewayUrl.replace(/\/$/, '')}${targetPath}`;

    try {
      const headers: Record<string, string> = {};
      if (req.headers.authorization) {
        headers['authorization'] = req.headers.authorization;
      }
      if (req.headers['x-api-key']) {
        headers['x-api-key'] = req.headers['x-api-key'] as string;
      }
      if (req.headers['content-type']) {
        headers['content-type'] = req.headers['content-type'] as string;
      }

      const fetchOptions: RequestInit = {
        method: req.method,
        headers,
      };

      if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body && Object.keys(req.body).length > 0) {
        fetchOptions.body = JSON.stringify(req.body);
      }

      const upstreamRes = await fetch(targetUrl, fetchOptions);
      const data = await upstreamRes.text();

      // Forward status and content-type
      res.status(upstreamRes.status);
      const contentType = upstreamRes.headers.get('content-type');
      if (contentType) {
        res.setHeader('content-type', contentType);
      }

      res.send(data);
    } catch (err: any) {
      res.status(502).json({
        error: true,
        code: 'GATEWAY_PROXY_ERROR',
        message: `Failed to connect to Gateway at ${config.internalGatewayUrl}: ${err.message}`,
      });
    }
  });

  // Serve static UI assets
  const publicDir = path.resolve(__dirname, 'public');
  app.use(express.static(publicDir));

  // SPA fallback to index.html for unknown routes
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(publicDir, 'index.html'), (err) => {
      if (err) {
        res.status(404).send('Dashboard UI assets not found. Build may be required.');
      }
    });
  });

  return app;
}
