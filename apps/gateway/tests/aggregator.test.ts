import { ToolAggregator } from '../src/tool-aggregator';
import { UpstreamManager } from '../src/upstream-manager';

describe('ToolAggregator & Collision-Resistant Router Unit Tests', () => {
  let upstreamManager: UpstreamManager;
  let aggregator: ToolAggregator;

  beforeEach(() => {
    upstreamManager = new UpstreamManager([
      {
        id: 'woo-mcp',
        name: 'WooCommerce Store',
        url: 'http://woo-mcp:4001/sse',
        transport: 'sse',
        enabled: true,
        timeoutMs: 500,
      },
      {
        id: 'utils-mcp',
        name: 'Utility Tools',
        url: 'http://utils-mcp:4002/sse',
        transport: 'sse',
        enabled: true,
        timeoutMs: 500,
      },
    ]);

    aggregator = new ToolAggregator(upstreamManager, 1000);
  });

  it('aggregates tools and handles namespace collisions safely', async () => {
    // Mock getClient for woo-mcp
    const mockWooClient: any = {
      listTools: jest.fn().mockResolvedValue({
        tools: [
          { name: 'list_products', description: 'List products', inputSchema: {} },
          { name: 'create_product', description: 'Create product in Woo', inputSchema: {} },
        ],
      }),
      callTool: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: '{"id": 10, "name": "Shirt"}' }],
      }),
    };

    // Mock getClient for utils-mcp with a colliding tool name 'create_product'
    const mockUtilsClient: any = {
      listTools: jest.fn().mockResolvedValue({
        tools: [
          { name: 'calculate_tax', description: 'Calculate taxes', inputSchema: {} },
          { name: 'create_product', description: 'Create draft item in utils', inputSchema: {} },
        ],
      }),
      callTool: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: '{"tax": 5.50}' }],
      }),
    };

    jest.spyOn(upstreamManager, 'getClient').mockImplementation(async (serverId: string) => {
      if (serverId === 'woo-mcp') return mockWooClient;
      if (serverId === 'utils-mcp') return mockUtilsClient;
      throw new Error(`Unknown server ${serverId}`);
    });

    const tools = await aggregator.getTools(true);
    expect(tools.length).toBe(4);

    const namespacedNames = tools.map((t) => t.namespacedName);
    expect(namespacedNames).toContain('woo-mcp__list_products');
    expect(namespacedNames).toContain('woo-mcp__create_product');
    expect(namespacedNames).toContain('utils-mcp__calculate_tax');
    expect(namespacedNames).toContain('utils-mcp__create_product');

    // Executing unique tool via alias
    const listRes = await aggregator.executeTool('list_products');
    expect(listRes.isError).toBe(false);
    expect(mockWooClient.callTool).toHaveBeenCalledWith({ name: 'list_products', arguments: {} });

    // Executing colliding tool via namespaced name routes to correct upstream
    await aggregator.executeTool('woo-mcp__create_product', { name: 'Cap' });
    expect(mockWooClient.callTool).toHaveBeenCalledWith({ name: 'create_product', arguments: { name: 'Cap' } });

    await aggregator.executeTool('utils-mcp__create_product', { name: 'Draft' });
    expect(mockUtilsClient.callTool).toHaveBeenCalledWith({ name: 'create_product', arguments: { name: 'Draft' } });
  });

  it('provides failure isolation when one upstream fails', async () => {
    const mockWooClient: any = {
      listTools: jest.fn().mockResolvedValue({
        tools: [{ name: 'list_products', description: 'List products' }],
      }),
    };

    jest.spyOn(upstreamManager, 'getClient').mockImplementation(async (serverId: string) => {
      if (serverId === 'woo-mcp') return mockWooClient;
      if (serverId === 'utils-mcp') throw new Error('Utils server down');
      throw new Error('Server not found');
    });

    // Tool discovery proceeds despite utils-mcp failure
    const tools = await aggregator.getTools(true);
    expect(tools.length).toBe(1);
    expect(tools[0].namespacedName).toBe('woo-mcp__list_products');
  });

  it('respects disabled upstream servers', async () => {
    upstreamManager.toggleServer('utils-mcp', false);

    const mockWooClient: any = {
      listTools: jest.fn().mockResolvedValue({
        tools: [{ name: 'list_products', description: 'List products' }],
      }),
    };

    const getClientSpy = jest.spyOn(upstreamManager, 'getClient').mockResolvedValue(mockWooClient);

    const tools = await aggregator.getTools(true);
    expect(tools.length).toBe(1);
    expect(getClientSpy).toHaveBeenCalledWith('woo-mcp');
    expect(getClientSpy).not.toHaveBeenCalledWith('utils-mcp');
  });
});
