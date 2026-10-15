# System Architecture & Design Specification

## 1. High-Level Architecture Overview

The **Urumi MCP Gateway** platform decouples AI client interfaces from internal enterprise services through a unified, secure proxy layer.

```
┌────────────────────────────────────────────────────────┐
│                      CLIENT LAYER                      │
│   Web Browser (Storefront)   Cursor / Claude / Inspector│
│  (http://shop.localtest.me)    (http://gateway.localtest.me)│
│                                                        │
│   AI Chat Agent UI           Admin Dashboard           │
│  (http://chat.localtest.me)  (http://dashboard.localtest.me)│
└──────────────────────────┬─────────────────────────────┘
                           │ Traefik Ingress (Port 80/443)
                           ▼
┌────────────────────────────────────────────────────────┐
│                   GATEWAY & CONTROL LAYER              │
│  MCP Gateway (:8080)                                   │
│  ├── AuthManager (HMAC-SHA256, RBAC, Timing-Safe)       │
│  ├── ToolAggregator (Collision Shield, Dynamic Cache)  │
│  ├── AuditLogger (Sanitization, User Attribution)      │
│  └── Transports: Streamable HTTP (/mcp) & SSE (/sse)   │
└────────────┬──────────────┬──────────────┬─────────────┘
             │ ClusterIP    │ ClusterIP    │ ClusterIP
             ▼              ▼              ▼
┌──────────────────┐ ┌─────────────┐ ┌───────────────────┐
│     woo-mcp      │ │  utils-mcp  │ │     notes-mcp     │
│   Port 4001      │ │  Port 4002  │ │     Port 4003     │
│ 5 Woo Core Tools │ │ Calc & Sku  │ │ Order Notes Store │
└────────┬─────────┘ └─────────────┘ └───────────────────┘
         │ Internal HTTP
         ▼
┌────────────────────────────────────────────────────────┐
│                   PERSISTENT STORE LAYER               │
│  WordPress / WooCommerce Pod (:80)                     │
│  └── MariaDB StatefulSet (:3306) on PersistentVolumes  │
└────────────────────────────────────────────────────────┘
```

---

## 2. MCP Transport Architecture: Streamable HTTP vs Legacy SSE

The Gateway supports both modern and legacy MCP transports:

1. **Official Streamable HTTP (`POST /mcp`):**
   - Implemented via `@modelcontextprotocol/sdk/server/streamableHttp.js`.
   - Requires client headers: `Accept: application/json, text/event-stream` and `Content-Type: application/json`.
   - Issues a unique `Mcp-Session-Id` header on session initialization.
   - All subsequent JSON-RPC calls (`tools/list`, `tools/call`) are multiplexed over standard HTTP POST requests referencing the `Mcp-Session-Id`.
   - Compatible with modern MCP clients (Claude Code, Cursor, MCP Inspector).

2. **Legacy HTTP + SSE (`GET /sse` & `POST /messages`):**
   - Maintained for backward compatibility.
   - Long-lived HTTP connection receiving server events on `/sse`, with out-of-band JSON-RPC message delivery posted to `/messages?sessionId=...`.

---

## 3. Tool Aggregation, Namespacing & Collision Shield

When multiple microservices provide tools, name conflicts can corrupt LLM function calling schemas.

### Collision Shield Design:
1. **Namespacing:** All aggregated tools are registered under `<serverId>__<toolName>` (e.g., `woo-mcp__create_product`, `utils-mcp__create_product`).
2. **Dynamic Inspection:** The Gateway discovers tools across all enabled upstreams on startup or refresh.
3. **Collision Detection:** If a tool name appears on more than one server (e.g. `create_product` exists in both `woo-mcp` and `utils-mcp`), direct un-namespaced aliasing is explicitly disabled, and a warning is logged.
4. **Guaranteed Routing:** The Gateway inspects the namespaced prefix, strips the server identifier, and routes the payload to the correct upstream server without ambiguity.

---

## 4. Failure Handling, Timeouts & Fault Isolation

Enterprise systems must degrade gracefully when an upstream service crashes:

- **Per-Upstream Timeouts:** Each upstream registration specifies a timeout (default 10,000ms). All upstream HTTP calls utilize `AbortController`.
- **Fault Isolation:** If an upstream server (e.g., `notes-mcp`) experiences high latency, crashes, or has its Pod terminated by Kubernetes:
  - The Gateway logs the failure and excludes or reports the unhealthy upstream.
  - Other upstreams (`woo-mcp`, `utils-mcp`) continue processing requests with zero downtime and sub-10ms response times.
- **Dynamic Caching:** Discovered tool schemas are cached with a configurable TTL (default 15,000ms), protecting upstream servers against discovery storms.

---

## 5. User Identity & Server-Side RBAC

Authentication and authorization are strictly enforced at the Gateway boundary:

| Feature | Implementation Details |
|---|---|
| **Cryptographic Storage** | HMAC-SHA256 with application secret salt (`API_KEY_SALT`). Raw keys are never stored in memory or on disk. |
| **Side-Channel Defense** | `crypto.timingSafeEqual` prevents timing side-channel attacks during key verification. |
| **Role Matrix** | **`admin`**: Full tool execution, server toggle, key creation/revocation, audit logs.<br>**`member`**: Tool discovery, read & calculation execution. Mutating tools (`create_*`, `update_*`, `delete_*`, `add_*`) are rejected with `403 FORBIDDEN_TOOL`. |
| **Identity Propagation** | The Chat Agent propagates the authenticated caller's API key. Calls are audited and authorized against the individual caller's permissions. |

---

## 6. Local Development (k3d) vs Production VPS (k3s)

The repository provides dual configuration values (`values/values-local.yaml` and `values/values-prod.yaml`):

| Concern | Local Development (`values-local.yaml`) | Production VPS (`values-prod.yaml`) |
|---|---|---|
| **Cluster Environment** | Multi-node k3d containerized in Docker | Standalone k3s on Linux VPS (Ubuntu 22.04 / 24.04) |
| **DNS Resolution** | `*.localtest.me` (resolves natively to `127.0.0.1`) | Real domain names (e.g., `shop.example.com`, `gateway.example.com`) pointing to VPS Public IP |
| **TLS / SSL** | HTTP on port 80 | HTTPS on port 443 via Traefik + cert-manager Let's Encrypt |
| **StorageClass** | k3s built-in `local-path` provisioner | `local-path` with backup, or cloud block storage (EBS / Hetzner CSI) |
| **Secret Management** | Kubernetes Secrets populated by helm/scripts | Pre-provisioned Kubernetes Secrets or HashiCorp Vault / SealedSecrets |
| **Resource Limits** | Minimal for laptop execution (50m-200m CPU, 64Mi-256Mi RAM) | Scaled limits with horizontal pod autoscaling (HPA) |
| **Image Registry** | Local Docker daemon (`k3d image import`) | Container registry (GHCR / Docker Hub) with pull secrets |
