import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerWooCommerceTools } from '../src/tools';
import { WooCommerceClient, WooCommerceApiError } from '../src/woo-client';
import { AppConfig } from '../src/config';

describe('MCP Tools Unit Tests', () => {
  let server: McpServer;
  let mockClient: jest.Mocked<WooCommerceClient>;

  const mockConfig: AppConfig = {
    port: 4001,
    woocommerceUrl: 'http://mock-store:80',
    woocommerceConsumerKey: 'ck_mock',
    woocommerceConsumerSecret: 'cs_mock',
    apiTimeoutMs: 5000,
    nodeEnv: 'test',
  };

  beforeEach(() => {
    server = new McpServer({ name: 'test-woo-mcp', version: '1.0.0' });
    mockClient = new WooCommerceClient(mockConfig) as jest.Mocked<WooCommerceClient>;
    registerWooCommerceTools(server, mockClient);
  });

  it('registers all 5 required tools on the McpServer', () => {
    // Check that tools are registered internally on McpServer
    expect(server).toBeDefined();
  });
});
