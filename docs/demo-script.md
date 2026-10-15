# Urumi MCP Gateway — Video Demo & Live Walkthrough Script

This script provides an exact, reproducible walkthrough designed for the **Round 2 Walkthrough Interview** and submission video. It demonstrates every single scenario required by the **official Urumi Definition of Done**.

---

## Prerequisites & URLs

| Component | Target URL | Ingress Host | Port |
|---|---|---|---|
| **WooCommerce Store** | `http://shop.localtest.me` | `shop.localtest.me` | 80 |
| **MCP Gateway** | `http://gateway.localtest.me` | `gateway.localtest.me` | 80 / 8080 |
| **Admin Dashboard** | `http://dashboard.localtest.me` | `dashboard.localtest.me` | 80 / 3000 |
| **AI Chat Agent** | `http://chat.localtest.me` | `chat.localtest.me` | 80 / 5000 |

### Test Credentials & API Keys
Retrieve the bootstrapped cluster keys from Kubernetes:
```bash
export ADMIN_KEY=$(kubectl get secret gateway-secret -n urumi -o jsonpath='{.data.initial-admin-key}' | base64 -d)
export MEMBER_KEY=$(kubectl get secret gateway-secret -n urumi -o jsonpath='{.data.initial-member-key}' | base64 -d)
```
- **Admin Key (User A)**: `YOUR_ADMIN_API_KEY` (Role: `admin` — exported as `$ADMIN_KEY`)
- **Member Key (User B)**: `YOUR_MEMBER_API_KEY` (Role: `member` — exported as `$MEMBER_KEY`)

---

## Walkthrough Step 1: System Health & Ingress Check (0:00 - 1:00)

**Interview Talking Point:**
> *"The platform consists of four distinct architectural layers running on Kubernetes. WooCommerce and MariaDB run on persistent volume claims. Three upstream MCP servers (woo-mcp, utils-mcp, notes-mcp) run as isolated ClusterIP services. The MCP Gateway aggregates all upstream tools, enforces HMAC-SHA256 authenticated RBAC, and exposes both official Streamable HTTP (`/mcp`) and SSE. On top, we have the Admin Dashboard and the AI Chat Agent."*

### Commands to Run:
```bash
# Check all Pods, Services, and Ingresses in namespace urumi
kubectl get pods,svc,ingress -n urumi

# Check Gateway Health & Upstreams
curl -s http://gateway.localtest.me/healthz
```
*Expected Output:*
- All 8 Pods (`chat-agent`, `dashboard`, `gateway`, `mariadb-0`, `notes-mcp`, `utils-mcp`, `woo-mcp`, `wordpress`) in `Running` state (1/1 Ready).
- Gateway reports `{"status":"ok","upstreams":{"total":3,"enabled":3}}`.

---

## Walkthrough Step 2: Storefront Catalog, Checkout & Grounded Order Confirmation (1:00 - 2:00)

1. Open `http://shop.localtest.me` in the browser.
2. Browse products in the catalog: e.g. `MCP Gateway Test Product`, `MCP Verified T-Shirt`.
3. Add a product to cart and proceed to Checkout (`http://shop.localtest.me/checkout/`):
   - Fill in demo billing details (Cash on Delivery / Direct Bank Transfer).
   - Place Order and observe the Order Received confirmation screen (e.g. Order #12).
4. Verify the grounded order in the database via the MCP Gateway tool:
   ```bash
   node -e "fetch('http://gateway.localtest.me/api/tools/execute', {method:'POST', headers:{'Content-Type':'application/json', 'Authorization':`Bearer ${process.env.ADMIN_KEY || 'YOUR_ADMIN_API_KEY'}`}, body: JSON.stringify({tool:'woo-mcp__list_orders', arguments:{}})}).then(r=>r.json()).then(d=>console.log(d.content[0].text))"
   ```
   *The newly placed or seeded order details (ID, status, line items, customer name) are returned directly from MariaDB through woo-mcp.*

---

## Walkthrough Step 3: Chat Agent — User A (Authorized Identity) (2:00 - 3:30)

**Scenario:** User A operates with an authorized `admin` key. User A creates a new product in the store via natural language, and queries orders.

> [!NOTE]
> **LLM Engine Status:** The Chat Agent currently runs in **deterministic fallback mode** using the Gateway's MCP tool execution engine. If an `OPENAI_API_KEY` is provided in `gateway-secret`, the agent transparently executes OpenAI function-calling loops. The deterministic engine guarantees identical tool selection, parameter extraction, and RBAC enforcement without external API billing.

1. Open `http://chat.localtest.me` in browser.
2. In the topbar identity selector, select **👑 User A (Admin)** (or pass Authorization header in API).
3. Send prompt:
   > *"Create a product named 'Artisan Ceramic Cup' with price 24.50"*
4. **Observe Response:**
   - The Chat Agent calls Gateway tool `woo-mcp__create_product`.
   - Gateway verifies User A's `admin` role and allows the mutating call.
   - WooCommerce creates the product in the MariaDB database.
   - Chat Agent replies with confirmation, ID, and price.
5. **Verify in Store:**
   - Refresh `http://shop.localtest.me` in browser. The new product appears immediately on the storefront!
6. Ask Chat Agent:
   > *"What orders came in today?"*
   - Chat Agent invokes `woo-mcp__list_orders` and displays Order #12 grounded in actual WooCommerce store data.

---

## Walkthrough Step 4: External MCP Client — User B (Streamable HTTP) (3:30 - 5:00)

**Scenario:** User B connects using an external MCP client (Claude Code, Cursor, or CLI script) connecting *only* to the Gateway URL with User B's member key.

### Connect via Official MCP Streamable HTTP:
```bash
# Run the external MCP client verification script
node scripts/verify-external-mcp-client.mjs
```

### Live CLI Demonstration:
1. **Initialize MCP session (`POST /mcp`):**
   ```bash
   curl -i -X POST http://gateway.localtest.me/mcp \
     -H "Content-Type: application/json" \
     -H "Accept: application/json, text/event-stream" \
     -H "Authorization: Bearer ${MEMBER_KEY:-YOUR_MEMBER_API_KEY}" \
     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"cursor-client","version":"1.0"}}}'
   ```
   *Gateway returns `200 OK` with `Mcp-Session-Id` header.*

2. **Discover all tools (`tools/list`):**
   ```bash
   curl -X POST http://gateway.localtest.me/mcp \
     -H "Content-Type: application/json" \
     -H "Accept: application/json, text/event-stream" \
     -H "Authorization: Bearer ${MEMBER_KEY:-YOUR_MEMBER_API_KEY}" \
     -H "Mcp-Session-Id: <SESSION_ID>" \
     -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
   ```
   *Gateway returns all 13 aggregated tools across woo-mcp, utils-mcp, and notes-mcp.*

3. **Multi-Upstream Execution Workflow (woo-mcp + utils-mcp):**
   - User B queries Order #12 details from `woo-mcp__get_order`. Total is $49.99.
   - User B calculates a 25% VIP promotional discount on that total using `utils-mcp__calculate_discount`:
   ```bash
   curl -X POST http://gateway.localtest.me/mcp \
     -H "Content-Type: application/json" \
     -H "Accept: application/json, text/event-stream" \
     -H "Authorization: Bearer ${MEMBER_KEY:-YOUR_MEMBER_API_KEY}" \
     -H "Mcp-Session-Id: <SESSION_ID>" \
     -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"utils-mcp__calculate_discount","arguments":{"price":49.99,"discountPercent":25}}}'
   ```
   *Discount result returns final discounted total ($37.49) combining real data from two independent upstreams.*

4. **Verify Upstream Isolation:**
   - Attempt to access upstream servers directly:
   ```bash
   curl http://woo-mcp.localtest.me/healthz
   # Returns 404 / connection refused — upstream is NOT publicly exposed!
   ```

---

## Walkthrough Step 5: Team Control, Revocation & Upstream Fault Isolation (5:00 - 7:00)

### 1. Key Revocation Test:
1. Open Admin Dashboard at `http://dashboard.localtest.me` (or use REST API).
2. Create a dedicated API key for User B (`POST /api/auth/keys` with name "User B Dedicated", role "member").
3. Make a successful tool call with this key.
4. Revoke the key (`POST /api/auth/keys/:id/revoke`).
5. **Immediate rejection:** The very next call with that key fails with `401 Unauthorized`.

### 2. Upstream Toggle Test:
1. In Dashboard, toggle `notes-mcp` to **Disabled** (`POST /api/servers/notes-mcp/toggle`).
2. Refresh tool list: `notes-mcp` tools disappear from discovery.
3. Re-enable `notes-mcp`: tools reappear immediately.

### 3. Upstream Pod Kill (Fault Isolation) Test:
1. Delete the `notes-mcp` Pod:
   ```bash
   kubectl delete pod -l app.kubernetes.io/name=notes-mcp -n urumi
   ```
2. While `notes-mcp` restarts, immediately invoke `utils-mcp__calculate_discount`:
   ```bash
   node -e "fetch('http://gateway.localtest.me/api/tools/execute', {method:'POST', headers:{'Content-Type':'application/json', 'Authorization':`Bearer ${process.env.MEMBER_KEY || 'YOUR_MEMBER_API_KEY'}`}, body: JSON.stringify({tool:'utils-mcp__calculate_discount', arguments:{price:100, discountPercent:15}})}).then(r=>r.json()).then(console.log)"
   ```
   *Succeeds immediately with 0 downtime! Unrelated upstreams are 100% unaffected.*

### 4. Audit Log Attribution & Redaction:
Inspect Gateway audit logs:
```bash
curl -s -H "Authorization: Bearer ${ADMIN_KEY:-YOUR_ADMIN_API_KEY}" http://gateway.localtest.me/api/audit-logs?limit=10
```
*Observe that every single action, whether tool discovery, tool execution, success, failure, or revocation, is recorded with exact user identity (`keyId`), role (`admin`/`member`), tool name, and duration, while sensitive keys and arguments are sanitized.*

---

## Walkthrough Step 6: Architecture, Security Defense & Local-to-VPS Transition (7:00 - 9:00)

**Interview Defense Points:**

### 1. Defense-in-Depth & Kubernetes Security Configuration:
- **Kubernetes NetworkPolicies (`charts/network-policies.yaml`):**
  - Upstream MCP servers (`woo-mcp`, `utils-mcp`, `notes-mcp`) accept ingress *only* from `gateway`.
  - MariaDB accepts ingress *only* from `wordpress` pod on port 3306.
  - Gateway accepts ingress only from Traefik ingress, Dashboard BFF, and Chat Agent.
- **Container Hardening:**
  - All application pods run non-root (`runAsUser: 1000`, `runAsNonRoot: true`).
  - `allowPrivilegeEscalation: false`.
- **SSRF Protection (`apps/gateway/src/ssrf-validator.ts`):**
  - Blocks loopback (`127.0.0.1`, `localhost`), cloud metadata (`169.254.169.254`, `metadata.google.internal`), link-local IPs, and non-http schemes.
- **Timing-Safe Key Verification:**
  - HMAC-SHA256 hashed keys verified with `crypto.timingSafeEqual` preventing timing side-channel attacks.

### 2. Local vs VPS Deployment Differences:
- **Cluster runtime:** Local uses `k3d` inside Docker Desktop. Production uses lightweight `k3s` running directly on Ubuntu LTS VPS.
- **DNS & Ingress:** Local uses wildcard loopback DNS `*.localtest.me` (resolves to 127.0.0.1). Production requires public DNS A-records pointing to the VPS public IP.
- **TLS & Certificates:** Local TLS is disabled (`values-local.yaml`). Production enables `cert-manager` with Let's Encrypt ACME automated certificates (`values-prod.yaml`).
- **Storage Class:** Local uses `local-path`. Production uses host persistent directory or CSI block storage (`longhorn` / cloud provider volumes).
- **Secrets Management:** Local initializes secrets via Helm/kubectl scripts. Production requires pre-created sealed secrets (`production-gateway-secret`, `production-mariadb-secret`).

### 3. Upgrade and Rollback Demonstration:
Explain how zero-downtime upgrades and rollbacks are executed:
```bash
# Upgrade gateway to a new version
helm upgrade gateway ./charts/gateway -n urumi -f values/values-prod.yaml --set image.tag="v1.1.0"

# Check revision history
helm history gateway -n urumi

# Perform immediate atomic rollback in case of an incident
helm rollback gateway 1 -n urumi
```

---

## Automated Verification Command
To run all Definition of Done scenarios automatically in one command:
```bash
node scripts/test-dod.mjs
```
Expected final output:
```
========================================================
  🎉 ALL DEFINITION OF DONE SCENARIOS PASSED 100%! 🎉
========================================================
```
