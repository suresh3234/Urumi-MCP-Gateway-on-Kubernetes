# Architecture Overview

## Summary
The **Urumi AI MCP Gateway** is a reverse proxy, protocol router, and security enforcement layer providing unified, authenticated Model Context Protocol (MCP) access to e-commerce and store operations.

## High-Level Topology

```mermaid
flowchart TD
    subgraph Clients["External Clients"]
        Agent[AI Chat Agent / Cursor / MCP Client]
        AdminUI[Admin Dashboard / CLI]
    end

    subgraph IngressLayer["Kubernetes Ingress (Traefik)"]
        GW_Ingress["gateway.localtest.me (:80)"]
        WP_Ingress["shop.localtest.me (:80)"]
    end

    subgraph GatewayPod["Urumi MCP Gateway (:8080)"]
        AuthModule[AuthManager\nHMAC-SHA256 + TimingSafe]
        AuditModule[AuditLogger\nPII Scrubbing + Ring Buffer]
        Aggregator[ToolAggregator\nNamespace & Collision Shield]
        UpstreamMgr[UpstreamManager\nStreamable HTTP & SSE Pool]
        StreamableEndpoint["/mcp (Streamable HTTP)"]
        SSEEndpoint["/sse (SSE Transport)"]
        RestAPI["/api/* (REST Management)"]
    end

    subgraph UpstreamMCP["Internal MCP Services (ClusterIP)"]
        WooMCP["woo-mcp (:4001)\nProducts & Orders Tools"]
        UtilsMCP["utils-mcp (:4002)\nCalculations & SKU Tools"]
        NotesMCP["notes-mcp (:4003)\nSession & Order Notes"]
    end

    subgraph Storefront["Store Backend"]
        WordPress["WordPress + WooCommerce (:80)"]
        MariaDB[("MariaDB (:3306)")]
    end

    Agent -->|Streamable HTTP / SSE with Auth| GW_Ingress
    AdminUI -->|REST API with Auth| GW_Ingress
    GW_Ingress --> GatewayPod

    GatewayPod --> AuthModule
    GatewayPod --> AuditModule
    GatewayPod --> Aggregator
    Aggregator --> UpstreamMgr

    UpstreamMgr -->|Streamable HTTP / SSE| WooMCP
    UpstreamMgr -->|Streamable HTTP / SSE| UtilsMCP
    UpstreamMgr -->|Streamable HTTP / SSE| NotesMCP

    WooMCP -->|REST API /wp-json/wc/v3| WordPress
    WP_Ingress --> WordPress
    WordPress --> MariaDB
```

## Transport Architecture
1. **MCP Streamable HTTP (`POST /mcp`):**
   - The primary modern transport conforming to MCP specification (`@modelcontextprotocol/sdk`).
   - Stateful session tracking using `Mcp-Session-Id` header with automatic session cleanup.
   - Authentication enforced via `Authorization: Bearer <key>` header or `?apiKey=<key>`.
2. **MCP Server-Sent Events (`GET /sse`, `POST /messages`):**
   - Maintained for backwards compatibility with legacy MCP clients and browser EventSource consumers.
   - Authenticated via query parameter `?apiKey=<key>` or `Authorization` header.
3. **Gateway REST API (`/api/*`):**
   - Direct HTTP endpoints for tool execution, catalog discovery, audit logs, and server management.

## Component Responsibilities
- **Gateway:** Protocol dispatch, authentication, RBAC, tool aggregation, upstream health checking, audit logging.
- **woo-mcp:** Bridges MCP requests to the WooCommerce REST API (`/wp-json/wc/v3`). Zero direct database access.
- **utils-mcp:** Provides stateless utilities (discounts, currency conversion, SKU generation).
- **notes-mcp:** Manages session notes and annotations for order auditing.
