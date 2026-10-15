param (
    [Parameter(Position = 0)]
    [string]$Target = "help",
    [string]$ClusterName = "urumi-cluster",
    [string]$Namespace = "urumi",
    [string]$ValuesFile = "values/values-local.yaml"
)

function Show-Help {
    Write-Host "Available targets:"
    Write-Host "  cluster-up   - Create local k3d Kubernetes cluster with mapped ports 80/443"
    Write-Host "  cluster-down - Delete local k3d Kubernetes cluster"
    Write-Host "  build-all    - Build container images for all services"
    Write-Host "  deploy       - Deploy all Helm charts to the cluster"
    Write-Host "  undeploy     - Uninstall all Helm releases"
    Write-Host "  logs         - Stream logs from gateway and services"
    Write-Host "  status       - Display cluster status and pod health"
    Write-Host "  test         - Run all unit tests across microservices"
    Write-Host "  test-dod     - Run end-to-end Definition of Done acceptance tests"
}

switch ($Target) {
    "cluster-up" {
        Write-Host "==> Creating k3d cluster: $ClusterName with ports 80 and 443..."
        k3d cluster create $ClusterName -p "80:80@loadbalancer" -p "443:443@loadbalancer" --agents 1 --wait
        Write-Host "==> Configuring cluster endpoint for local connection..."
        $cfg = k3d kubeconfig get $ClusterName | Out-String
        if ($cfg -match 'server:\s+https://[^:]+:(\d+)') {
            kubectl config set-cluster "k3d-$ClusterName" --server="https://127.0.0.1:$($matches[1])" --insecure-skip-tls-verify=true
        }
        Write-Host "==> Creating namespace $Namespace..."
        kubectl create namespace $Namespace --dry-run=client -o yaml | kubectl apply -f -
    }
    "cluster-down" {
        Write-Host "==> Deleting k3d cluster: $ClusterName..."
        k3d cluster delete $ClusterName
    }
    "build-all" {
        Write-Host "==> Building container images..."
        docker build -t woo-mcp:local ./apps/woo-mcp
        docker build -t utils-mcp:local ./apps/utils-mcp
        docker build -t notes-mcp:local ./apps/notes-mcp
        docker build -t gateway:local ./apps/gateway
        docker build -t dashboard:local ./apps/dashboard
        docker build -t chat-agent:local ./apps/chat-agent
        Write-Host "==> Importing images into k3d cluster $ClusterName..."
        try {
            k3d image import woo-mcp:local utils-mcp:local notes-mcp:local gateway:local dashboard:local chat-agent:local -c $ClusterName
        } catch {
            Write-Warning "Failed to import images into k3d cluster."
        }
    }
    "deploy" {
        Write-Host "==> Deploying Helm releases to namespace $Namespace..."
        kubectl create namespace $Namespace --dry-run=client -o yaml | kubectl apply -f -
        helm upgrade --install woocommerce ./charts/woocommerce -n $Namespace -f $ValuesFile
        helm upgrade --install woo-mcp ./charts/woo-mcp -n $Namespace -f $ValuesFile
        helm upgrade --install utils-mcp ./charts/utils-mcp -n $Namespace -f $ValuesFile
        helm upgrade --install notes-mcp ./charts/notes-mcp -n $Namespace -f $ValuesFile
        helm upgrade --install gateway ./charts/gateway -n $Namespace -f $ValuesFile
        helm upgrade --install dashboard ./charts/dashboard -n $Namespace -f $ValuesFile
        helm upgrade --install chat-agent ./charts/chat-agent -n $Namespace -f $ValuesFile
        Write-Host "==> All charts deployed successfully."
    }
    "undeploy" {
        Write-Host "==> Uninstalling Helm releases from namespace $Namespace..."
        helm uninstall chat-agent -n $Namespace
        helm uninstall dashboard -n $Namespace
        helm uninstall gateway -n $Namespace
        helm uninstall notes-mcp -n $Namespace
        helm uninstall utils-mcp -n $Namespace
        helm uninstall woo-mcp -n $Namespace
        helm uninstall woocommerce -n $Namespace
        Write-Host "==> Helm releases uninstalled."
    }
    "logs" {
        Write-Host "==> Streaming logs for gateway in namespace $Namespace..."
        kubectl logs -n $Namespace -l app.kubernetes.io/name=gateway -f --tail=100 --all-containers=true --prefix=true
    }
    "status" {
        Write-Host "==> Cluster Nodes:"
        kubectl get nodes -o wide
        Write-Host "`n==> Pods in namespace ${Namespace}:"
        kubectl get pods -n $Namespace -o wide
        Write-Host "`n==> Services in namespace ${Namespace}:"
        kubectl get svc -n $Namespace
        Write-Host "`n==> Ingresses in namespace ${Namespace}:"
        kubectl get ingress -n $Namespace
        Write-Host "`n==> Helm Releases in namespace ${Namespace}:"
        helm list -n $Namespace
    }
    "test" {
        Write-Host "==> Running unit tests across all applications..."
        npm test --prefix apps/gateway
        npm test --prefix apps/woo-mcp
        npm test --prefix apps/utils-mcp
        npm test --prefix apps/notes-mcp
        npm test --prefix apps/chat-agent
        npm test --prefix apps/dashboard
    }
    "test-dod" {
        Write-Host "==> Running Definition of Done E2E verification..."
        node scripts/test-dod.mjs
    }
    Default {
        Show-Help
    }
}
