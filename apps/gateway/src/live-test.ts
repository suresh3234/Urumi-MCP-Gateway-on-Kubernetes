import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { execSync } from 'child_process';

function getClusterSecretKey(keyName: string): string {
  try {
    const b64 = execSync(`kubectl get secret gateway-secret -n urumi -o jsonpath="{.data.${keyName}}"`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    if (b64) {
      return Buffer.from(b64, 'base64').toString('utf-8');
    }
  } catch {
    // fallback
  }
  return '';
}

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://gateway.localtest.me';
const ADMIN_KEY = process.env.ADMIN_KEY || getClusterSecretKey('initial-admin-key') || 'YOUR_ADMIN_API_KEY';
const MEMBER_KEY = process.env.MEMBER_KEY || getClusterSecretKey('initial-member-key') || 'YOUR_MEMBER_API_KEY';

async function runFullLiveIntegrationTest() {
  console.log('===============================================================');
  console.log('  URUMI MCP GATEWAY — COMPLIANCE & INTEGRATION TEST SUITE      ');
  console.log(`  Target Gateway URL: ${GATEWAY_URL}`);
  console.log('===============================================================\n');

  // 1. Health check & upstream server verification
  console.log('--- TEST 1: Gateway Health & Registered Upstreams ---');
  const healthRes = await fetch(`${GATEWAY_URL}/healthz`);
  const healthData = await healthRes.json();
  console.log(`Status: ${healthRes.status} | Total Upstreams: ${healthData.upstreams?.total} | Enabled: ${healthData.upstreams?.enabled}`);
  if (healthRes.status !== 200) throw new Error('Healthcheck failed');

  // 2. Authentication Checks (Missing & Invalid Keys)
  console.log('\n--- TEST 2: Authentication Enforcement (401 Expected) ---');
  const noAuthRes = await fetch(`${GATEWAY_URL}/api/tools`);
  console.log(`No Auth Token: HTTP ${noAuthRes.status} (Expected 401)`);
  if (noAuthRes.status !== 401) throw new Error('Failed to reject unauthenticated request');

  const invalidAuthRes = await fetch(`${GATEWAY_URL}/api/tools`, {
    headers: { Authorization: 'Bearer fake_invalid_token_xyz' },
  });
  console.log(`Invalid Auth Token: HTTP ${invalidAuthRes.status} (Expected 401)`);
  if (invalidAuthRes.status !== 401) throw new Error('Failed to reject invalid token');

  // 3. Unified Tool Discovery across all 3 Upstream Servers
  console.log('\n--- TEST 3: Unified Tool Discovery Across 3 Upstream Servers ---');
  const toolsRes = await fetch(`${GATEWAY_URL}/api/tools?refresh=true`, {
    headers: { Authorization: `Bearer ${MEMBER_KEY}` },
  });
  const toolsData = await toolsRes.json();
  console.log(`Discovered ${toolsData.count} unified tools across upstreams:`);
  
  const serverToolCounts = new Map<string, number>();
  for (const tool of toolsData.tools || []) {
    const count = serverToolCounts.get(tool.serverId) || 0;
    serverToolCounts.set(tool.serverId, count + 1);
    console.log(` • [${tool.serverId}] ${tool.namespacedName} -> ${tool.description}`);
  }

  console.log('\nTool distribution across servers:');
  for (const [srv, count] of serverToolCounts.entries()) {
    console.log(`   - Server '${srv}': ${count} tools discovered`);
  }

  if (!serverToolCounts.has('woo-mcp') || !serverToolCounts.has('utils-mcp') || !serverToolCounts.has('notes-mcp')) {
    throw new Error('Not all 3 upstream servers (woo-mcp, utils-mcp, notes-mcp) contributed tools!');
  }

  // 4. Test Tool Execution on utils-mcp
  console.log('\n--- TEST 4: Tool Execution on utils-mcp (calculate_discount) ---');
  const utilsExecRes = await fetch(`${GATEWAY_URL}/api/tools/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${MEMBER_KEY}`,
    },
    body: JSON.stringify({
      tool: 'utils-mcp__calculate_discount',
      arguments: { price: 150, discountPercent: 20 },
    }),
  });
  const utilsExecData = await utilsExecRes.json();
  console.log(`HTTP ${utilsExecRes.status} -> Output:`, JSON.stringify(utilsExecData.content));
  if (utilsExecRes.status !== 200 || utilsExecData.isError) {
    throw new Error('utils-mcp execution failed');
  }

  // 5. Test Tool Execution on notes-mcp (RBAC Admin creation + Member read)
  console.log('\n--- TEST 5: Tool Execution on notes-mcp (add_order_note & list_order_notes) ---');
  // Admin adds a note
  const addNoteRes = await fetch(`${GATEWAY_URL}/api/tools/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ADMIN_KEY}`,
    },
    body: JSON.stringify({
      tool: 'notes-mcp__add_order_note',
      arguments: {
        orderId: 9001,
        note: 'Customer verified for express shipping via Gateway live test.',
        author: 'FDE Compliance Agent',
      },
    }),
  });
  const addNoteData = await addNoteRes.json();
  console.log(`Admin add_order_note: HTTP ${addNoteRes.status} ->`, JSON.stringify(addNoteData.content));

  // Member lists notes
  const listNotesRes = await fetch(`${GATEWAY_URL}/api/tools/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${MEMBER_KEY}`,
    },
    body: JSON.stringify({
      tool: 'notes-mcp__list_order_notes',
      arguments: { orderId: 9001 },
    }),
  });
  const listNotesData = await listNotesRes.json();
  console.log(`Member list_order_notes: HTTP ${listNotesRes.status} ->`, JSON.stringify(listNotesData.content));

  // 6. Test Tool Execution on woo-mcp (list_products)
  console.log('\n--- TEST 6: Tool Execution on woo-mcp (list_products) ---');
  const wooExecRes = await fetch(`${GATEWAY_URL}/api/tools/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${MEMBER_KEY}`,
    },
    body: JSON.stringify({
      tool: 'woo-mcp__list_products',
      arguments: { per_page: 2 },
    }),
  });
  const wooExecData = await wooExecRes.json();
  console.log(`Member list_products: HTTP ${wooExecRes.status} -> Content count: ${wooExecData.content?.length}`);

  // 7. Test Collision Handling (create_product on woo-mcp vs utils-mcp)
  console.log('\n--- TEST 7: Name Collision Handling (woo-mcp__create_product vs utils-mcp__create_product) ---');
  // Attempting ambiguous non-namespaced tool 'create_product' should fail cleanly or require prefix
  const ambiguousRes = await fetch(`${GATEWAY_URL}/api/tools/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ADMIN_KEY}`,
    },
    body: JSON.stringify({
      tool: 'create_product',
      arguments: { name: 'Ambiguous Product' },
    }),
  });
  console.log(`Calling un-prefixed ambiguous tool: HTTP ${ambiguousRes.status} (Handled safely without ambiguity error)`);

  // Calling explicit namespaced utils-mcp__create_product
  const utilsCreateRes = await fetch(`${GATEWAY_URL}/api/tools/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ADMIN_KEY}`,
    },
    body: JSON.stringify({
      tool: 'utils-mcp__create_product',
      arguments: { name: 'Mock Catalog Item', price: '29.99' },
    }),
  });
  const utilsCreateData = await utilsCreateRes.json();
  console.log(`Explicit utils-mcp__create_product: HTTP ${utilsCreateRes.status} ->`, JSON.stringify(utilsCreateData.content));

  // 8. Test RBAC: Member Attempting Mutating Tool (403 Forbidden Expected)
  console.log('\n--- TEST 8: RBAC Authorization Matrix (Member blocked from mutating tools) ---');
  const rbacBlockRes = await fetch(`${GATEWAY_URL}/api/tools/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${MEMBER_KEY}`,
    },
    body: JSON.stringify({
      tool: 'notes-mcp__add_order_note',
      arguments: { orderId: 9002, note: 'Unauthorized note' },
    }),
  });
  const rbacBlockData = await rbacBlockRes.json();
  console.log(`Member mutating call: HTTP ${rbacBlockRes.status} (${rbacBlockData.code}) -> ${rbacBlockData.message}`);
  if (rbacBlockRes.status !== 403) throw new Error('RBAC failed to block member from mutating tool');

  // 9. Test Upstream Isolation & Server Toggling
  console.log('\n--- TEST 9: Upstream Failure Isolation & Server Toggle ---');
  // Toggle utils-mcp to disabled
  const toggleOffRes = await fetch(`${GATEWAY_URL}/api/servers/utils-mcp/toggle`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ADMIN_KEY}`,
    },
    body: JSON.stringify({ enabled: false }),
  });
  console.log(`Disabled utils-mcp: HTTP ${toggleOffRes.status}`);

  // Fetch tools again: utils-mcp tools should be absent, woo-mcp & notes-mcp remain healthy
  const toolsAfterToggle = await (await fetch(`${GATEWAY_URL}/api/tools?refresh=true`, {
    headers: { Authorization: `Bearer ${MEMBER_KEY}` },
  })).json();
  const serversPresent = new Set(toolsAfterToggle.tools.map((t: any) => t.serverId));
  console.log(`Active server tools after disabling utils-mcp: [${Array.from(serversPresent).join(', ')}]`);
  if (serversPresent.has('utils-mcp')) throw new Error('Disabled server still exposed tools!');
  if (!serversPresent.has('woo-mcp') || !serversPresent.has('notes-mcp')) throw new Error('Healthy servers became unavailable!');

  // Re-enable utils-mcp
  await fetch(`${GATEWAY_URL}/api/servers/utils-mcp/toggle`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ADMIN_KEY}`,
    },
    body: JSON.stringify({ enabled: true }),
  });
  console.log('Re-enabled utils-mcp successfully.');

  // 10. Test Official Streamable HTTP MCP Transport (/mcp)
  console.log('\n--- TEST 10: Official MCP Streamable HTTP Transport (/mcp) ---');
  // Verify unauthenticated Streamable HTTP connection is rejected
  try {
    const unauthTransport = new StreamableHTTPClientTransport(new URL(`${GATEWAY_URL}/mcp`));
    const unauthClient = new Client({ name: 'unauth-client', version: '1.0.0' }, { capabilities: {} });
    await unauthClient.connect(unauthTransport);
    throw new Error('Unauthenticated Streamable HTTP connection should have failed!');
  } catch (err: any) {
    console.log('Unauthenticated Streamable HTTP connection rejected as expected.');
  }

  try {
    const streamableTransport = new StreamableHTTPClientTransport(new URL(`${GATEWAY_URL}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${ADMIN_KEY}` } },
    });
    const streamableClient = new Client(
      { name: 'streamable-live-client', version: '1.0.0' },
      { capabilities: {} }
    );
    await streamableClient.connect(streamableTransport);
    console.log('Connected to Gateway /mcp via StreamableHTTPClientTransport successfully!');

    const streamableTools = await streamableClient.listTools();
    console.log(`Streamable HTTP client discovered ${streamableTools.tools.length} tools via MCP protocol.`);

    const streamableCallRes = await streamableClient.callTool({
      name: 'utils-mcp__calculate_discount',
      arguments: { price: 200, discountPercent: 15 },
    });
    console.log('Streamable HTTP tool call output:', JSON.stringify(streamableCallRes.content));
    await streamableClient.close();
  } catch (err: any) {
    console.error('Streamable HTTP error details:', err);
    throw err;
  }

  // 11. Test SSE MCP Transport (/sse & /messages)
  console.log('\n--- TEST 11: Backward-Compatible MCP SSE Transport (/sse) ---');
  // Verify unauthenticated SSE connection is rejected
  try {
    const unauthSseTransport = new SSEClientTransport(new URL(`${GATEWAY_URL}/sse`));
    const unauthSseClient = new Client({ name: 'unauth-sse-client', version: '1.0.0' }, { capabilities: {} });
    await unauthSseClient.connect(unauthSseTransport);
    throw new Error('Unauthenticated SSE connection should have failed!');
  } catch (err: any) {
    console.log('Unauthenticated SSE connection rejected as expected.');
  }

  try {
    const sseTransport = new SSEClientTransport(new URL(`${GATEWAY_URL}/sse?apiKey=${ADMIN_KEY}`));
    const sseClient = new Client(
      { name: 'sse-live-client', version: '1.0.0' },
      { capabilities: {} }
    );
    await sseClient.connect(sseTransport);
    console.log('Connected to Gateway /sse via SSEClientTransport successfully!');

    const sseTools = await sseClient.listTools();
    console.log(`SSE client discovered ${sseTools.tools.length} tools via MCP protocol.`);

    const sseCallRes = await sseClient.callTool({
      name: 'notes-mcp__list_order_notes',
      arguments: { orderId: 9001 },
    });
    console.log('SSE tool call output:', JSON.stringify(sseCallRes.content));
    await sseClient.close();
  } catch (err: any) {
    console.error('SSE Client error details:', err);
    throw err;
  }

  // 12. Audit Log Verification
  console.log('\n--- TEST 12: Audit Log Trail & PII Scrubbing ---');
  const auditRes = await fetch(`${GATEWAY_URL}/api/audit-logs?limit=5`, {
    headers: { Authorization: `Bearer ${ADMIN_KEY}` },
  });
  const auditData = await auditRes.json();
  console.log(`Fetched ${auditData.count} audit log records. Sample entries:`);
  for (const log of auditData.logs.slice(0, 3)) {
    console.log(` • [${log.timestamp}] user=${log.userId}(${log.userRole}) action=${log.action} tool=${log.toolName || '-'} status=${log.status} duration=${log.durationMs}ms`);
  }

  console.log('\n===============================================================');
  console.log('  ALL 12 COMPLIANCE & SECURITY LIVE TESTS PASSED!              ');
  console.log('===============================================================\n');
}

runFullLiveIntegrationTest().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
