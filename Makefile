CLUSTER_NAME ?= urumi-cluster
NAMESPACE ?= urumi
VALUES_FILE ?= values/values-local.yaml

.PHONY: help cluster-up cluster-down build-all deploy undeploy logs status test test-dod

help:
	@echo "Available targets:"
	@echo "  cluster-up   - Create local k3d Kubernetes cluster with mapped ports 80/443"
	@echo "  cluster-down - Delete local k3d Kubernetes cluster"
	@echo "  build-all    - Build container images for all services"
	@echo "  deploy       - Deploy all Helm charts to the cluster"
	@echo "  undeploy     - Uninstall all Helm releases"
	@echo "  logs         - Stream logs from gateway and services"
	@echo "  status       - Display cluster status and pod health"
	@echo "  test         - Run all unit tests across microservices"
	@echo "  test-dod     - Run end-to-end Definition of Done acceptance tests"

cluster-up:
	@echo "==> Creating k3d cluster: $(CLUSTER_NAME) with ports 80 and 443..."
	k3d cluster create $(CLUSTER_NAME) \
		-p "80:80@loadbalancer" \
		-p "443:443@loadbalancer" \
		--agents 1 \
		--wait
	@echo "==> Cluster $(CLUSTER_NAME) is ready."
	-@for /f "tokens=*" %%i in ('k3d kubeconfig get $(CLUSTER_NAME)') do @echo %%i | findstr /C:"server: https://" > temp_srv.txt
	-@powershell -Command "$cfg = k3d kubeconfig get $(CLUSTER_NAME) | Out-String; if ($cfg -match 'server:\s+https://[^:]+:(\d+)') { kubectl config set-cluster k3d-$(CLUSTER_NAME) --server=https://127.0.0.1:$$($matches[1]) --insecure-skip-tls-verify=true }"
	kubectl create namespace $(NAMESPACE) --dry-run=client -o yaml | kubectl apply -f -

cluster-down:
	@echo "==> Deleting k3d cluster: $(CLUSTER_NAME)..."
	k3d cluster delete $(CLUSTER_NAME)
	@echo "==> Cluster $(CLUSTER_NAME) deleted."

build-all:
	@echo "==> Building container images..."
	docker build -t woo-mcp:local ./apps/woo-mcp
	docker build -t utils-mcp:local ./apps/utils-mcp
	docker build -t notes-mcp:local ./apps/notes-mcp
	docker build -t gateway:local ./apps/gateway
	docker build -t dashboard:local ./apps/dashboard
	docker build -t chat-agent:local ./apps/chat-agent
	@echo "==> Importing images into k3d cluster $(CLUSTER_NAME)..."
	-k3d image import woo-mcp:local utils-mcp:local notes-mcp:local gateway:local dashboard:local chat-agent:local -c $(CLUSTER_NAME)

deploy:
	@echo "==> Deploying Helm releases to namespace $(NAMESPACE)..."
	kubectl create namespace $(NAMESPACE) --dry-run=client -o yaml | kubectl apply -f -
	helm upgrade --install woocommerce ./charts/woocommerce -n $(NAMESPACE) -f $(VALUES_FILE)
	helm upgrade --install woo-mcp ./charts/woo-mcp -n $(NAMESPACE) -f $(VALUES_FILE)
	helm upgrade --install utils-mcp ./charts/utils-mcp -n $(NAMESPACE) -f $(VALUES_FILE)
	helm upgrade --install notes-mcp ./charts/notes-mcp -n $(NAMESPACE) -f $(VALUES_FILE)
	helm upgrade --install gateway ./charts/gateway -n $(NAMESPACE) -f $(VALUES_FILE)
	helm upgrade --install dashboard ./charts/dashboard -n $(NAMESPACE) -f $(VALUES_FILE)
	helm upgrade --install chat-agent ./charts/chat-agent -n $(NAMESPACE) -f $(VALUES_FILE)
	@echo "==> All charts deployed successfully."

undeploy:
	@echo "==> Uninstalling Helm releases from namespace $(NAMESPACE)..."
	-helm uninstall chat-agent -n $(NAMESPACE)
	-helm uninstall dashboard -n $(NAMESPACE)
	-helm uninstall gateway -n $(NAMESPACE)
	-helm uninstall notes-mcp -n $(NAMESPACE)
	-helm uninstall utils-mcp -n $(NAMESPACE)
	-helm uninstall woo-mcp -n $(NAMESPACE)
	-helm uninstall woocommerce -n $(NAMESPACE)
	@echo "==> Helm releases uninstalled."

logs:
	@echo "==> Streaming logs for gateway in namespace $(NAMESPACE)..."
	kubectl logs -n $(NAMESPACE) -l app.kubernetes.io/name=gateway -f --tail=100 --all-containers=true --prefix=true

status:
	@echo "==> Cluster Nodes:"
	kubectl get nodes -o wide
	@echo "\n==> Pods in namespace $(NAMESPACE):"
	kubectl get pods -n $(NAMESPACE) -o wide
	@echo "\n==> Services in namespace $(NAMESPACE):"
	kubectl get svc -n $(NAMESPACE)
	@echo "\n==> Ingresses in namespace $(NAMESPACE):"
	kubectl get ingress -n $(NAMESPACE)
	@echo "\n==> Helm Releases in namespace $(NAMESPACE):"
	helm list -n $(NAMESPACE)

test:
	@echo "==> Running unit tests across all applications..."
	npm test --prefix apps/gateway
	npm test --prefix apps/woo-mcp
	npm test --prefix apps/utils-mcp
	npm test --prefix apps/notes-mcp
	npm test --prefix apps/chat-agent
	npm test --prefix apps/dashboard

test-dod:
	@echo "==> Running Definition of Done E2E verification..."
	node scripts/test-dod.mjs
