import { createDashboardApp } from './server';

const PORT = parseInt(process.env.PORT || '3000', 10);
const INTERNAL_GATEWAY_URL = process.env.INTERNAL_GATEWAY_URL || process.env.GATEWAY_URL || 'http://gateway:8080';
const PUBLIC_GATEWAY_URL = process.env.PUBLIC_GATEWAY_URL || '/api/gateway';

const app = createDashboardApp({
  port: PORT,
  internalGatewayUrl: INTERNAL_GATEWAY_URL,
  publicGatewayUrl: PUBLIC_GATEWAY_URL,
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Dashboard] Admin UI server running on http://0.0.0.0:${PORT}`);
  console.log(`[Dashboard] Internal Gateway Proxy configured to: ${INTERNAL_GATEWAY_URL}`);
});
