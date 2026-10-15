import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

async function testOrder12() {
  const transport = new SSEClientTransport(new URL('http://localhost:4001/sse'));
  const client = new Client(
    { name: 'order-test-client', version: '1.0.0' },
    { capabilities: {} }
  );
  await client.connect(transport);

  console.log('\n--- Fetching Real Order 12 ---');
  const getOrderRes = await client.callTool({
    name: 'get_order',
    arguments: { id: 12 },
  });
  console.log('get_order (12):', JSON.stringify(getOrderRes, null, 2));

  console.log('\n--- Updating Order 12 status to completed ---');
  const updateOrderRes = await client.callTool({
    name: 'update_order_status',
    arguments: { id: 12, status: 'completed' },
  });
  console.log('update_order_status (12 -> completed):', JSON.stringify(updateOrderRes, null, 2));

  console.log('\n--- Re-fetching Order 12 to verify updated status ---');
  const verifyOrderRes = await client.callTool({
    name: 'get_order',
    arguments: { id: 12 },
  });
  console.log('verify order status:', JSON.stringify(verifyOrderRes, null, 2));

  await client.close();
}

testOrder12().catch(console.error);
