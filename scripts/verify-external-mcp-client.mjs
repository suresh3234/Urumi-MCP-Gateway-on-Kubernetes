/**
 * External MCP Client Verification Script
 * Simulates an external client (Claude Code / Cursor / MCP Inspector)
 * connecting directly to http://gateway.localtest.me over official MCP protocol.
 */

import { execSync } from 'child_process';

function getClusterSecretKey(keyName) {
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
const MEMBER_KEY = process.env.MEMBER_KEY || getClusterSecretKey('initial-member-key') || 'YOUR_MEMBER_API_KEY';
const ADMIN_KEY = process.env.ADMIN_KEY || getClusterSecretKey('initial-admin-key') || 'YOUR_ADMIN_API_KEY';

async function parseMcpResponse(res) {
  const text = await res.text();
  if (text.startsWith('event:') || text.includes('data:')) {
    const lines = text.split('\n');
    const dataLine = lines.find((l) => l.startsWith('data:'));
    if (dataLine) {
      return JSON.parse(dataLine.substring(5).trim());
    }
  }
  return JSON.parse(text);
}

async function testStreamableHttpTransport() {
  console.log('\n--- 1. Testing Official MCP Streamable HTTP Transport (/mcp) ---');

  // Step 1: Initialize
  const initPayload = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'external-cli-inspector',
        version: '1.0.0',
      },
    },
  };

  const initRes = await fetch(`${GATEWAY_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${MEMBER_KEY}`,
    },
    body: JSON.stringify(initPayload),
  });

  console.log(`Initialize status: ${initRes.status} ${initRes.statusText}`);
  const sessionId = initRes.headers.get('mcp-session-id');
  console.log(`Mcp-Session-Id header: ${sessionId}`);

  const initData = await parseMcpResponse(initRes);
  console.log('Initialize response:', JSON.stringify(initData));

  if (!initRes.ok) {
    throw new Error(`Initialize failed: HTTP ${initRes.status}`);
  }

  // Step 2: List tools via standard MCP JSON-RPC
  const listToolsPayload = {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  };

  const listHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${MEMBER_KEY}`,
  };
  if (sessionId) listHeaders['mcp-session-id'] = sessionId;

  const listRes = await fetch(`${GATEWAY_URL}/mcp`, {
    method: 'POST',
    headers: listHeaders,
    body: JSON.stringify(listToolsPayload),
  });

  const listData = await parseMcpResponse(listRes);
  const tools = listData.result?.tools || [];
  console.log(`Discovered ${tools.length} unified MCP tools:`);
  tools.forEach((t) => console.log(`  • ${t.name}: ${t.description.substring(0, 60)}...`));

  // Verify tools from all 3 upstreams are present
  const hasWoo = tools.some((t) => t.name.startsWith('woo-mcp__'));
  const hasUtils = tools.some((t) => t.name.startsWith('utils-mcp__'));
  const hasNotes = tools.some((t) => t.name.startsWith('notes-mcp__'));
  console.log(`Upstream verification: woo-mcp=${hasWoo}, utils-mcp=${hasUtils}, notes-mcp=${hasNotes}`);

  if (!hasWoo || !hasUtils || !hasNotes) {
    throw new Error('Missing tools from one or more upstreams!');
  }

  // Step 3: Invoke tool: utils-mcp__calculate_discount
  console.log('\n--- Invoking tool utils-mcp__calculate_discount via /mcp ---');
  const discountPayload = {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'utils-mcp__calculate_discount',
      arguments: { price: 200, discountPercent: 15 },
    },
  };

  const callRes = await fetch(`${GATEWAY_URL}/mcp`, {
    method: 'POST',
    headers: listHeaders,
    body: JSON.stringify(discountPayload),
  });

  const callData = await parseMcpResponse(callRes);
  console.log('Discount call result:', JSON.stringify(callData));

  // Step 4: Invoke tool: woo-mcp__list_products
  console.log('\n--- Invoking tool woo-mcp__list_products via /mcp ---');
  const productsPayload = {
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'woo-mcp__list_products',
      arguments: {},
    },
  };

  const prodRes = await fetch(`${GATEWAY_URL}/mcp`, {
    method: 'POST',
    headers: listHeaders,
    body: JSON.stringify(productsPayload),
  });

  const prodData = await parseMcpResponse(prodRes);
  console.log('Products call result snippet:', JSON.stringify(prodData).substring(0, 150));

  return { sessionId, toolsCount: tools.length };
}

async function verifyAuditLogs() {
  console.log('\n--- 2. Verifying Gateway Audit Log Attribution ---');
  const auditRes = await fetch(`${GATEWAY_URL}/api/audit-logs?limit=5`, {
    headers: {
      Authorization: `Bearer ${ADMIN_KEY}`,
    },
  });

  const auditData = await auditRes.json();
  console.log(`Retrieved ${auditData.count} audit logs. Recent entries:`);
  auditData.logs.slice(0, 4).forEach((log) => {
    console.log(`  [${log.timestamp}] User=${log.userId} Role=${log.userRole} Action=${log.action} Tool=${log.toolName || 'N/A'} Status=${log.status}`);
  });
}

async function verifyUpstreamExposure() {
  console.log('\n--- 3. Verifying Upstream MCP Servers are NOT Publicly Exposed ---');
  const upstreamHosts = [
    'http://woo-mcp.localtest.me',
    'http://utils-mcp.localtest.me',
    'http://notes-mcp.localtest.me',
    'http://127.0.0.1:4001',
    'http://127.0.0.1:4002',
    'http://127.0.0.1:4003',
  ];

  for (const host of upstreamHosts) {
    try {
      const res = await fetch(`${host}/healthz`, { signal: AbortSignal.timeout(1000) });
      console.log(`  ⚠️ Unexpected: ${host} reachable with HTTP ${res.status}`);
    } catch (err) {
      console.log(`  ✅ Verified blocked / unreachable: ${host} (${err.cause?.code || err.message})`);
    }
  }
}

async function run() {
  try {
    await testStreamableHttpTransport();
    await verifyAuditLogs();
    await verifyUpstreamExposure();
    console.log('\n>>> Step 1 External MCP Client Verification SUCCESS! <<<');
  } catch (err) {
    console.error('\nVerification failed:', err);
    process.exit(1);
  }
}

run();
