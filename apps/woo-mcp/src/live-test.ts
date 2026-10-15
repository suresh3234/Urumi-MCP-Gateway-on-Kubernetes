import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

async function main() {
  console.log('Connecting to MCP Server at http://localhost:4001/sse ...');
  const transport = new SSEClientTransport(new URL('http://localhost:4001/sse'));
  const client = new Client(
    { name: 'live-verification-client', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log('Connected to MCP server successfully!');

  // 1. List tools
  console.log('\n--- 1. Discovering Tools ---');
  const toolsResponse = await client.listTools();
  console.log(`Discovered ${toolsResponse.tools.length} tools:`);
  for (const t of toolsResponse.tools) {
    console.log(` - ${t.name}: ${t.description}`);
  }

  // 2. Call list_products
  console.log('\n--- 2. Invoking list_products ---');
  const listProductsRes = await client.callTool({
    name: 'list_products',
    arguments: { per_page: 5 },
  });
  console.log('list_products result:', JSON.stringify(listProductsRes, null, 2));

  // 3. Call create_product
  console.log('\n--- 3. Invoking create_product ---');
  const createProductRes = await client.callTool({
    name: 'create_product',
    arguments: {
      name: 'MCP Verified T-Shirt',
      price: '29.99',
      description: 'Created via WooCommerce MCP Server live test',
      sku: 'MCP-TSHIRT-001',
    },
  });
  console.log('create_product result:', JSON.stringify(createProductRes, null, 2));

  // 4. Call list_products with search
  console.log('\n--- 4. Invoking list_products with search="Verified" ---');
  const searchProductRes = await client.callTool({
    name: 'list_products',
    arguments: { search: 'Verified' },
  });
  console.log('search product result:', JSON.stringify(searchProductRes, null, 2));

  // 5. Call list_orders
  console.log('\n--- 5. Invoking list_orders ---');
  const listOrdersRes = await client.callTool({
    name: 'list_orders',
    arguments: { per_page: 5 },
  });
  console.log('list_orders result:', JSON.stringify(listOrdersRes, null, 2));

  // 6. Call get_order (test non-existent order ID 999999)
  console.log('\n--- 6. Invoking get_order (ID: 999999) ---');
  const getOrderRes = await client.callTool({
    name: 'get_order',
    arguments: { id: 999999 },
  });
  console.log('get_order result:', JSON.stringify(getOrderRes, null, 2));

  // 7. Call update_order_status (test non-existent order ID 999999)
  console.log('\n--- 7. Invoking update_order_status (ID: 999999, status: completed) ---');
  const updateOrderRes = await client.callTool({
    name: 'update_order_status',
    arguments: { id: 999999, status: 'completed' },
  });
  console.log('update_order_status result:', JSON.stringify(updateOrderRes, null, 2));

  await client.close();
  console.log('\nAll MCP live tests completed successfully!');
}

main().catch((err) => {
  console.error('Error during live MCP testing:', err);
  process.exit(1);
});
