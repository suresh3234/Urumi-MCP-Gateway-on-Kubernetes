# Production Deployment & Operations Guide

This guide details the procedure for deploying the **Urumi MCP Gateway** to a production Linux VPS running **k3s**, contrasting it with local **k3d** development.

---

## 1. Local Development (k3d) vs Production VPS (k3s)

| Operational Concern | Local Development (k3d) | Production VPS (k3s) |
|---|---|---|
| **Host Environment** | Docker Desktop on Windows / macOS | Ubuntu 22.04 / 24.04 LTS (AMD64 / ARM64) |
| **Ingress DNS** | `*.localtest.me` (resolves natively to `127.0.0.1`) | Real domains (`shop.urumi.ai`, `gateway.urumi.ai`) via public DNS A-records |
| **Ingress Controller** | Traefik bound to localhost port 80 | Traefik bound to public port 80/443 with Let's Encrypt automated TLS |
| **StorageClass** | `local-path` provisioner | `local-path` with scheduled volume snapshots, or CSI Block Storage |
| **Secrets Management** | Injected via Helm / local scripts | SealedSecrets / External Secrets Operator / Vault |
| **Image Distribution** | Direct cluster import (`k3d image import`) | Container registry (GHCR / Docker Hub) with `imagePullSecrets` |

---

## 2. Step-by-Step Production VPS Provisioning

### Step 1: Install k3s on VPS
```bash
curl -sfL https://get.k3s.io | sh -s - \
  --write-kubeconfig-mode 644 \
  --disable traefik # (or keep default Traefik)
```

Verify cluster status:
```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl get nodes
```

### Step 2: Configure Public DNS
Point the following DNS A-records to your VPS public IPv4 address:
- `shop.<your-domain>.com`
- `gateway.<your-domain>.com`
- `dashboard.<your-domain>.com`
- `chat.<your-domain>.com`

### Step 3: Configure Cert-Manager for Automated TLS
```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.4/cert-manager.yaml
```

Create a Let's Encrypt ClusterIssuer:
```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: admin@your-domain.com
    privateKeySecretRef:
      name: letsencrypt-prod-account-key
    solvers:
      - http01:
          ingress:
            class: traefik
```

---

## 3. Provisioning Kubernetes Secrets
Create production secrets before installing Helm charts:

```bash
kubectl create namespace urumi

# Gateway secrets
kubectl create secret generic gateway-secret -n urumi \
  --from-literal=api-key-salt="<STRONG_HMAC_SALT_32_BYTES>" \
  --from-literal=initial-admin-key="<STRONG_ADMIN_KEY_HEX>" \
  --from-literal=initial-member-key="<STRONG_MEMBER_KEY_HEX>" \
  --from-literal=openai-api-key="<OPTIONAL_OPENAI_KEY>"

# MariaDB secrets
kubectl create secret generic mariadb-secret -n urumi \
  --from-literal=mariadb-root-password="<STRONG_ROOT_PASS>" \
  --from-literal=mariadb-password="<STRONG_DB_PASS>"

# WooCommerce MCP secrets
kubectl create secret generic woo-mcp-secret -n urumi \
  --from-literal=consumer-key="<WOO_CONSUMER_KEY>" \
  --from-literal=consumer-secret="<WOO_CONSUMER_SECRET>"
```

---

## 4. Deploying with Helm

Use `values/values-prod.yaml` configured for your production domains:

```bash
# 1. Deploy Database & WooCommerce
helm upgrade --install woocommerce charts/woocommerce \
  --namespace urumi \
  -f values/values-prod.yaml

# 2. Deploy Upstream MCP Microservices
helm upgrade --install woo-mcp charts/woo-mcp -n urumi -f values/values-prod.yaml
helm upgrade --install utils-mcp charts/utils-mcp -n urumi -f values/values-prod.yaml
helm upgrade --install notes-mcp charts/notes-mcp -n urumi -f values/values-prod.yaml

# 3. Deploy Gateway, Dashboard, and Chat Agent
helm upgrade --install gateway charts/gateway -n urumi -f values/values-prod.yaml
helm upgrade --install dashboard charts/dashboard -n urumi -f values/values-prod.yaml
helm upgrade --install chat-agent charts/chat-agent -n urumi -f values/values-prod.yaml
```

---

## 5. Upgrade and Rollback Strategy

### Zero-Downtime Rolling Upgrades:
Deployments use `RollingUpdate` with `maxUnavailable: 0` and `maxSurge: 1`:
```bash
# Update image tag
helm upgrade gateway charts/gateway \
  --namespace urumi \
  -f values/values-prod.yaml \
  --set image.tag="v1.1.0"

# Monitor rollout
kubectl rollout status deployment gateway -n urumi
```

### Instant Rollback:
If an upgrade fails health checks:
```bash
# Roll back Helm release
helm rollback gateway <PREVIOUS_REVISION_NUMBER> -n urumi

# Or roll back Kubernetes deployment directly
kubectl rollout undo deployment gateway -n urumi
```
