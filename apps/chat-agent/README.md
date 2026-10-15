# Urumi MCP Chat Agent (`chat-agent`)

The **Urumi MCP Chat Agent** is a team AI assistant web interface and backend execution engine that interacts with the Urumi MCP Gateway. It supports user identity switching, function-calling loops, and strict role-based access control.

---

## 🏗️ Architecture & Component Topology

```mermaid
flowchart TD
    User[Team User / Browser] -->|HTTP / WebSocket / Chat UI :5000| ChatAgent[Chat Agent Server]
    
    subgraph Chat Agent Internals
        AgentRunner[AgentRunner & Session State]
        IdentityProp[Identity & Key Propagator]
        FallbackEngine[Deterministic Tool Execution Engine]
        OpenAIEngine[OpenAI Function Calling Loop (Optional)]
    end

    ChatAgent --> IdentityProp
    IdentityProp --> AgentRunner
    AgentRunner --> FallbackEngine
    AgentRunner -.->|If OPENAI_API_KEY present| OpenAIEngine
    
    FallbackEngine -->|HTTP POST /api/tools/execute| Gateway[Urumi MCP Gateway :8080]
    OpenAIEngine -->|HTTP POST /api/tools/execute| Gateway
```

---

## 🚀 Features & Capabilities

1. **User Identity Propagation:**
   - Supports role switching in the UI between **👑 User A (Admin)** and **👤 User B (Member)**.
   - Every request propagates the user's specific API key to the Gateway, strictly enforcing Gateway-side RBAC and audit attribution.
2. **Dual Execution Engine:**
   - **Deterministic Fallback Engine (Default):** Runs tool discovery, intent parsing, parameter extraction, and tool execution without external LLM API billing or external dependencies.
   - **Generative LLM Engine:** When `OPENAI_API_KEY` is set in the `gateway-secret` Kubernetes Secret, transparently executes OpenAI function-calling loops (`gpt-4o-mini`).
3. **Storefront & Order Grounding:**
   - Grounded queries: fetches live store catalog data and customer orders through `woo-mcp__list_products`, `woo-mcp__list_orders`, and `woo-mcp__create_product`.

---

## 📡 REST API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/healthz` | `GET` | Kubernetes liveness and readiness probe. |
| `/api/agent/status` | `GET` | Retrieves Gateway connection status, member identity, and configured engine. |
| `/api/agent/tools` | `GET` | Lists discovered tools from the Gateway. |
| `/api/chat` | `POST` | Sends a message to the agent; executes tool calling and returns agent reply. |
| `/api/chat/reset` | `POST` | Clears conversation history for the current session. |

---

## 🧪 Testing & Build

```bash
# Run unit tests
npm test

# Run TypeScript compilation & copy assets
npm run build
```
