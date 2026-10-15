# Urumi MCP Gateway Admin Dashboard (`dashboard`)

The **Urumi MCP Gateway Admin Dashboard** is a responsive React 18 single-page application and Backend-for-Frontend (BFF) Express proxy for managing the Urumi MCP Gateway on Kubernetes.

---

## 🏗️ Architecture & Component Topology

```mermaid
flowchart TD
    Browser[Administrator Browser :3000] -->|HTTP / SPA UI| Dashboard[Dashboard BFF Server]
    
    subgraph Dashboard BFF Internals
        StaticServer[Static File Server : public/]
        BFFProxy[BFF Reverse Proxy : /api/gateway/*]
        HealthProbe[Health Probes : /healthz]
        ConfigProvider[Client Config Provider : /api/config]
    end

    Dashboard --> StaticServer
    Dashboard --> BFFProxy
    Dashboard --> HealthProbe
    Dashboard --> ConfigProvider
    
    BFFProxy -->|Internal HTTP Proxy (ClusterIP)| Gateway[Urumi MCP Gateway :8080]
```

---

## 🚀 Features & Capabilities

1. **Gateway & Upstream Health Overview:**
   - Real-time status cards showing Gateway uptime, active sessions, and registered upstreams.
2. **Upstream Microservice Control:**
   - Toggle upstream MCP servers (`woo-mcp`, `utils-mcp`, `notes-mcp`) between Enabled and Disabled states with instant tool cache invalidation.
3. **Unified Tools Catalog:**
   - Live inspection of all aggregated tools, upstream provenance, namespaced aliases, and JSON schemas.
4. **API Key Lifecycle & Zero-Trust Revocation:**
   - Generate scoped API keys (`admin` or `member`).
   - Copy generated keys securely; raw keys are never stored on disk.
   - Immediate key revocation with instant `401 Unauthorized` enforcement.
5. **Real-Time Audit Trail:**
   - Live audit stream showing timestamp, caller user ID, role, action, tool name, execution duration, and sanitized parameters.

---

## 📡 REST API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/healthz` | `GET` | Kubernetes liveness and readiness probe. |
| `/api/config` | `GET` | Returns runtime configuration (Gateway URL, environment). |
| `/api/gateway/*` | `ALL` | BFF proxy forwarding calls with authorization headers to internal Gateway. |
| `/*` | `GET` | Serves the single-page admin application. |

---

## 🧪 Testing & Build

```bash
# Run unit tests
npm test

# Run TypeScript compilation & copy public assets
npm run build
```
