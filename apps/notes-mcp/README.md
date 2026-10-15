# Notes MCP Server (`notes-mcp`)

The **Notes Model Context Protocol (MCP) Server** provides order notes management and customer context annotation tools over both official Streamable HTTP (`/mcp`) and Server-Sent Events (`/sse`).

---

## 🛠️ Implemented MCP Tools

| Tool Name | Parameters | Description |
|---|---|---|
| [`add_order_note`](file:///apps/notes-mcp/src/tools.ts#L8) | `orderId`, `note`, `isCustomerNote?`, `author?` | Add an internal or customer-facing note associated with a WooCommerce order. |
| [`list_order_notes`](file:///apps/notes-mcp/src/tools.ts#L47) | `orderId` | Retrieve all internal and customer notes for a specific order ID. |
| [`search_notes`](file:///apps/notes-mcp/src/tools.ts#L79) | `query?`, `author?`, `orderId?` | Search notes across all orders by keyword, author, or order ID. |
| [`delete_order_note`](file:///apps/notes-mcp/src/tools.ts#L121) | `noteId` | Delete a specific order note by its unique note ID. |

---

## 🏗️ Transports & Endpoints

- **Streamable HTTP:** `POST /mcp` (Official stateful Streamable HTTP transport with session tracking).
- **Server-Sent Events:** `GET /sse` and `POST /messages` (Backward-compatible SSE transport).
- **Health Probes:** `GET /healthz` (Kubernetes liveness and readiness probe).

---

## 🔒 Security & Deployment

- Runs as non-root user `node` (UID 1000).
- Internal cluster service (`ClusterIP` on port 4003) with no public Ingress.
- Communicates directly with Gateway within the `urumi` namespace.
