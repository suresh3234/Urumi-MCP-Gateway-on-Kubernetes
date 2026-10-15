# Utilities MCP Server (`utils-mcp`)

The **Utilities Model Context Protocol (MCP) Server** provides e-commerce mathematical calculations, currency conversions, SKU generation, and catalog draft utilities over both official Streamable HTTP (`/mcp`) and Server-Sent Events (`/sse`).

---

## 🛠️ Implemented MCP Tools

| Tool Name | Parameters | Description |
|---|---|---|
| [`calculate_discount`](file:///apps/utils-mcp/src/tools.ts#L18) | `price`, `discountPercent`, `taxPercent?` | Calculate discounted price, total savings, and post-tax total for an item. |
| [`convert_currency`](file:///apps/utils-mcp/src/tools.ts#L63) | `amount`, `from`, `to` | Convert an amount between supported currencies (USD, EUR, GBP, JPY, CAD, INR). |
| [`generate_sku`](file:///apps/utils-mcp/src/tools.ts#L106) | `category`, `productName`, `variant?` | Generate standardized product SKU code based on catalog attributes. |
| [`create_product`](file:///apps/utils-mcp/src/tools.ts#L145) | `name`, `price`, `sku?`, `category?` | Utility draft tool for preparing catalog item drafts (tests collision handling with `woo-mcp`). |

---

## 🏗️ Transports & Endpoints

- **Streamable HTTP:** `POST /mcp` (Official stateful Streamable HTTP transport with session tracking).
- **Server-Sent Events:** `GET /sse` and `POST /messages` (Backward-compatible SSE transport).
- **Health Probes:** `GET /healthz` (Kubernetes liveness and readiness probe).

---

## 🔒 Security & Deployment

- Runs as unprivileged non-root user `node` (UID 1000).
- Internal cluster service (`ClusterIP` on port 4002) with no public Ingress.
- Communicates directly with Gateway within the `urumi` namespace.
