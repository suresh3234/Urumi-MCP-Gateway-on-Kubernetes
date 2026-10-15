# Urumi MCP Gateway on Kubernetes

Enterprise-grade Model Context Protocol (MCP) API Gateway on Kubernetes, integrating WooCommerce e-commerce operations, intelligent tool aggregation, role-based access control (RBAC), cryptographically audited access logs, an administrative dashboard, and a team AI chat agent.

---

## 1. System Architecture Overview

The system is organized into four distinct architectural layers running natively on Kubernetes:

```
┌────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                              │
│   Storefront Web Browser          Claude Code / Cursor / Inspector     │
│   (http://shop.localtest.me)          (http://gateway.localtest.me)    │
│                                                                        │
│   AI Chat Agent UI                Admin Dashboard                      │
│   (http://chat.localtest.me)          (http://dashboard.localtest.me)  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Traefik Ingress (Port 80/443)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        GATEWAY & CONTROL LAYER                         │
│  MCP Gateway (:8080)                                                   │
│  ├── AuthManager (HMAC-SHA256, Timing-Safe Comparison, RBAC Engine)    │
│  ├── ToolAggregator (Prefix Namespacing, Collision Shield, Cache)     │
│  ├── AuditLogger (In-Memory Buffer, PII Sanitization, Attribution)     │
│  └── Transports: Official Streamable HTTP (/mcp) & Legacy SSE (/sse)   │
└───────────────────┬───────────────────┬───────────────────┬────────────┘
                    │ ClusterIP         │ ClusterIP         │ ClusterIP
                    ▼                   ▼                   ▼
┌─────────────────────────┐ ┌─────────────────────┐ ┌────────────────────┐
│         woo-mcp         │ │      utils-mcp      │ │     notes-mcp      │
│        Port 4001        │ │      Port 4002      │ │     Port 4003      │
│  5 Core Store Tools     │ │ Calc & Sku Engines  │ │ Order Notes Store  │
└────────────┬────────────┘ └─────────────────────┘ └────────────────────┘
             │ Internal HTTP
             ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         PERSISTENT STORE LAYER                         │
│  WordPress / WooCommerce Pod (:80)                                     │
│  └── MariaDB StatefulSet (:3306) on PersistentVolumes (PVCs)           │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Live Local Ingress Endpoints

All services are accessible locally via `*.localtest.me` (which resolves natively to `127.0.0.1`):

| Service | Local URL | Port | Purpose |
|---|---|---|---|
| **WooCommerce Store** | `http://shop.localtest.me` | 80 | Live storefront with active products and cart |
| **MCP Gateway** | `http://gateway.localtest.me` | 8080 / 80 | Unified MCP entrypoint (`/mcp`, `/sse`, `/api/tools`) |
| **Admin Dashboard** | `http://dashboard.localtest.me` | 3000 / 80 | Server management, API keys, audit logs |
| **AI Chat Agent** | `http://chat.localtest.me` | 5000 / 80 | Team chat assistant with MCP function calling |

---

## 3. Quick Start & Local Deployment

### Prerequisites
- Docker Desktop (with WSL2 backend on Windows)
- k3d (v5+)
- kubectl
- Helm (v3+)
- Node.js (v20+)

### 1. Launch Kubernetes Cluster
```bash
k3d cluster create urumi-cluster \
  -p "80:80@loadbalancer" \
  -p "443:443@loadbalancer" \
  --agents 1 \
  --wait
```

### 2. Verify Pod Status
```bash
kubectl get pods,svc,ingress -n urumi
```
*Expected: All 8 Pods (`gateway`, `dashboard`, `chat-agent`, `woo-mcp`, `utils-mcp`, `notes-mcp`, `wordpress`, `mariadb-0`) Running (1/1 Ready).*

### 3. Run Automated Acceptance Tests (Definition of Done)
```bash
node scripts/test-dod.mjs
```
*Executes all 4 official acceptance scenarios (Storefront, Chat Agent User A, External MCP Client User B, Team Control & Revocation) and validates 100% success.*

---

## 4. Connecting External MCP Clients (Cursor, Claude Code, Inspector)

The Gateway exposes the official MCP **Streamable HTTP** transport on `/mcp` and legacy **SSE** on `/sse`.

### Protocol Authentication:
Clients authenticate by providing an API key via:
- `Authorization: Bearer <key>` header, OR
- `?apiKey=<key>` query parameter.

### Example Cursor / Claude Code Configuration:
```json
{
  "mcpServers": {
    "urumi-gateway": {
      "url": "http://gateway.localtest.me/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MEMBER_API_KEY"
      }
    }
  }
}
```

### CLI Verification:
```bash
node scripts/verify-external-mcp-client.mjs
```
*Performs JSON-RPC `initialize`, discovers all 13 aggregated tools, invokes calculation and store tools, and verifies that upstreams remain shielded from public exposure.*

---

## 5. Security & Governance

1. **HMAC-SHA256 Hashed Keys:** Keys are hashed with a secret salt (`API_KEY_SALT`). Only the prefix is stored/displayed; raw keys are never written to disk.
2. **Server-Side RBAC:**
   - **`admin`**: Full execution, upstream toggle, key generation/revocation, audit trail access.
   - **`member`**: Tool discovery and read/calculation execution. Mutating tools (`create_*`, `update_*`, `delete_*`, `add_*`) are blocked server-side with `403 FORBIDDEN_TOOL`.
3. **Immediate Revocation:** Revoking a key immediately terminates access; the very next call fails with `401 Unauthorized`.
4. **Upstream Isolation:** Upstream servers are only accessible via internal Kubernetes `ClusterIP` networks. Client tokens never reach upstream servers.
5. **PII Sanitization:** The in-memory audit log ring buffer automatically scrubs customer email addresses, phone numbers, street addresses, and API keys.

---

## 6. Monorepo Structure & Documentation Index

```
urumi-mcp-gateway/
├── apps/
│   ├── gateway/       # Central MCP Gateway (Streamable HTTP, SSE, RBAC, Audit)
│   ├── dashboard/     # Admin Dashboard (React 18 SPA, Express BFF proxy, Zero-Trust UI)
│   ├── chat-agent/    # AI Chat Agent (Tool discovery, LLM tool-calling loop, fallback)
│   ├── woo-mcp/       # WooCommerce MCP server (5 store tools)
│   ├── utils-mcp/     # Utility MCP server (Discounts, SKU, Currency)
│   └── notes-mcp/     # Order notes MCP server (Notes store)
│
├── charts/            # Production & local Helm charts (7 charts + network-policies.yaml)
├── docs/
│   ├── design.md      # Architecture, transports, collisions, failure handling
│   ├── threat-model.md# Security posture, token boundaries, SSRF, NetworkPolicies
│   ├── demo-script.md # Reproducible interview & video demonstration script
│   └── production-deployment.md # k3s VPS guide, TLS, DNS, rollbacks
│
├── scripts/
│   ├── test-dod.mjs   # Official Definition of Done automated verification
│   └── verify-external-mcp-client.mjs # External MCP client test suite
└── values/
    ├── values-local.yaml  # Local k3d cluster values
    └── values-prod.yaml   # Production VPS cluster values
```

---

## 7. Test Suite Status

Run unit tests across all applications:
```bash
npm test --prefix apps/gateway      # 28 tests passing (includes SSRF security tests)
npm test --prefix apps/dashboard    # 5 tests passing (React BFF & health checks)
npm test --prefix apps/chat-agent   # 13 tests passing (includes LLM tool-calling cycle)
npm test --prefix apps/woo-mcp      # 31 tests passing
npm test --prefix apps/notes-mcp    # 5 tests passing
npm test --prefix apps/utils-mcp    # 7 tests passing
```
**Total Unit Tests: 89 / 89 Passing (100% Pass Rate).**
#   U r u m i - M C P - G a t e w a y - o n - K u b e r n e t e s  
 