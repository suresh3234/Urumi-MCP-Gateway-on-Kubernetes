import React, { useState, useEffect, useCallback } from 'react';
import { UpstreamServer, AggregatedTool, ApiKeyRecord, AuditLogEntry, GatewayHealth } from './types';

export const App: React.FC = () => {
  // Authentication State (In-Memory Only, Zero-Trust)
  const [adminKey, setAdminKey] = useState<string>('');
  const [gatewayUrl, setGatewayUrl] = useState<string>('/api/gateway');
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<{ keyId: string; name: string; role: string } | null>(null);

  // App UI State
  const [activeView, setActiveView] = useState<'overview' | 'servers' | 'tools' | 'keys' | 'audit' | 'health'>('overview');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // Data State
  const [servers, setServers] = useState<UpstreamServer[]>([]);
  const [tools, setTools] = useState<AggregatedTool[]>([]);
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [health, setHealth] = useState<GatewayHealth | null>(null);

  // Modals & Forms State
  const [isNewKeyModalOpen, setIsNewKeyModalOpen] = useState<boolean>(false);
  const [newKeyName, setNewKeyName] = useState<string>('');
  const [newKeyRole, setNewKeyRole] = useState<'admin' | 'member'>('member');
  const [generatedKeyResult, setGeneratedKeyResult] = useState<{ key: string; name: string; role: string } | null>(null);

  // Upstream Server Form State
  const [isAddServerModalOpen, setIsAddServerModalOpen] = useState<boolean>(false);
  const [newServerId, setNewServerId] = useState<string>('');
  const [newServerName, setNewServerName] = useState<string>('');
  const [newServerUrl, setNewServerUrl] = useState<string>('');
  const [newServerTransport, setNewServerTransport] = useState<'sse' | 'streamable-http'>('sse');
  const [newServerTimeout, setNewServerTimeout] = useState<number>(10000);

  const [isEditServerModalOpen, setIsEditServerModalOpen] = useState<boolean>(false);
  const [editingServerId, setEditingServerId] = useState<string>('');
  const [editServerName, setEditServerName] = useState<string>('');
  const [editServerUrl, setEditServerUrl] = useState<string>('');
  const [editServerTimeout, setEditServerTimeout] = useState<number>(10000);

  // Search & Filter State
  const [toolSearch, setToolSearch] = useState<string>('');
  const [toolServerFilter, setToolServerFilter] = useState<string>('all');
  const [auditActionFilter, setAuditActionFilter] = useState<string>('all');

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  };

  // Helper for authenticated requests to Gateway via BFF proxy
  const gatewayFetch = useCallback(
    async (path: string, options: RequestInit = {}) => {
      const target = `${gatewayUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
      const headers = new Headers(options.headers || {});
      if (adminKey) {
        headers.set('Authorization', `Bearer ${adminKey}`);
      }
      if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
        headers.set('Content-Type', 'application/json');
      }

      return fetch(target, {
        ...options,
        headers,
      });
    },
    [gatewayUrl, adminKey]
  );

  // Authenticate session
  const handleAuthenticate = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsLoading(true);

    try {
      const res = await gatewayFetch('/api/auth/me');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `Authentication failed: HTTP ${res.status}`);
      }

      const userData = await res.json();
      if (!userData.authenticated) {
        throw new Error('Key validation failed: Server returned unauthenticated.');
      }

      setCurrentUser(userData.user || { keyId: 'admin_session', name: 'Admin', role: 'admin' });
      setIsAuthenticated(true);
      showToast('Session authenticated successfully!', 'success');
    } catch (err: any) {
      setAuthError(err.message || 'Failed to authenticate key against Gateway.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = () => {
    setAdminKey('');
    setIsAuthenticated(false);
    setCurrentUser(null);
    setServers([]);
    setTools([]);
    setKeys([]);
    setAuditLogs([]);
    setHealth(null);
    showToast('Session locked. Key cleared from browser memory.', 'info');
  };

  // Fetch all dashboard data
  const refreshAllData = useCallback(async () => {
    if (!isAuthenticated) return;
    setIsLoading(true);

    try {
      // 1. Health
      const healthRes = await gatewayFetch('/healthz');
      if (healthRes.ok) {
        const hData = await healthRes.json();
        setHealth(hData);
      }

      // 2. Upstream Servers
      const serversRes = await gatewayFetch('/api/servers');
      if (serversRes.ok) {
        const sData = await serversRes.json();
        setServers(sData.servers || []);
      }

      // 3. Tools
      const toolsRes = await gatewayFetch('/api/tools');
      if (toolsRes.ok) {
        const tData = await toolsRes.json();
        setTools(tData.tools || []);
      }

      // 4. API Keys
      const keysRes = await gatewayFetch('/api/auth/keys');
      if (keysRes.ok) {
        const kData = await keysRes.json();
        setKeys(kData.keys || []);
      }

      // 5. Audit Logs
      const auditRes = await gatewayFetch('/api/audit-logs?limit=50');
      if (auditRes.ok) {
        const aData = await auditRes.json();
        setAuditLogs(aData.logs || []);
      }
    } catch (err: any) {
      showToast(`Error fetching data: ${err.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, gatewayFetch]);

  // Initial load and periodic refresh
  useEffect(() => {
    if (isAuthenticated) {
      refreshAllData();
      const interval = setInterval(() => {
        refreshAllData();
      }, 15000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated, refreshAllData]);

  // Server toggle handler
  const handleToggleServer = async (serverId: string, currentEnabled: boolean) => {
    try {
      const res = await gatewayFetch(`/api/servers/${serverId}/toggle`, {
        method: 'POST',
        body: JSON.stringify({ enabled: !currentEnabled }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Toggle failed with HTTP ${res.status}`);
      }

      showToast(`Upstream server '${serverId}' ${!currentEnabled ? 'enabled' : 'disabled'}!`, 'success');
      refreshAllData();
    } catch (err: any) {
      showToast(`Failed to toggle server: ${err.message}`, 'error');
    }
  };

  // Add server handler
  const handleAddServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newServerId.trim() || !newServerName.trim() || !newServerUrl.trim()) return;

    try {
      const res = await gatewayFetch('/api/servers', {
        method: 'POST',
        body: JSON.stringify({
          id: newServerId.trim(),
          name: newServerName.trim(),
          url: newServerUrl.trim(),
          transport: newServerTransport,
          timeoutMs: newServerTimeout || 10000,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Registration failed with HTTP ${res.status}`);
      }

      showToast(`Upstream server '${newServerId.trim()}' registered successfully!`, 'success');
      setNewServerId('');
      setNewServerName('');
      setNewServerUrl('');
      setIsAddServerModalOpen(false);
      refreshAllData();
    } catch (err: any) {
      showToast(`Failed to register server: ${err.message}`, 'error');
    }
  };

  // Edit server modal open helper
  const openEditServerModal = (server: UpstreamServer) => {
    setEditingServerId(server.id);
    setEditServerName(server.name || server.id);
    setEditServerUrl(server.url);
    setEditServerTimeout(server.timeoutMs || 10000);
    setIsEditServerModalOpen(true);
  };

  // Edit server submit handler
  const handleEditServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingServerId) return;

    try {
      const res = await gatewayFetch(`/api/servers/${editingServerId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: editServerName.trim(),
          url: editServerUrl.trim(),
          timeoutMs: editServerTimeout || 10000,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Update failed with HTTP ${res.status}`);
      }

      showToast(`Upstream server '${editingServerId}' updated successfully!`, 'success');
      setIsEditServerModalOpen(false);
      refreshAllData();
    } catch (err: any) {
      showToast(`Failed to update server: ${err.message}`, 'error');
    }
  };

  // Remove server handler
  const handleRemoveServer = async (serverId: string, serverName?: string) => {
    if (!window.confirm(`Are you sure you want to remove upstream server "${serverName || serverId}" (${serverId})? Tools from this server will be removed immediately.`)) {
      return;
    }

    try {
      const res = await gatewayFetch(`/api/servers/${serverId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Removal failed with HTTP ${res.status}`);
      }

      showToast(`Upstream server '${serverId}' removed!`, 'success');
      refreshAllData();
    } catch (err: any) {
      showToast(`Failed to remove server: ${err.message}`, 'error');
    }
  };

  // API Key creation handler
  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;

    try {
      const res = await gatewayFetch('/api/auth/keys', {
        method: 'POST',
        body: JSON.stringify({ name: newKeyName, role: newKeyRole }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Key generation failed');
      }

      const data = await res.json();
      setGeneratedKeyResult({
        key: data.apiKey,
        name: data.record.name,
        role: data.record.role,
      });
      setNewKeyName('');
      setIsNewKeyModalOpen(false);
      showToast(`API Key for '${data.record.name}' created!`, 'success');
      refreshAllData();
    } catch (err: any) {
      showToast(`Key creation failed: ${err.message}`, 'error');
    }
  };

  // API Key revocation handler
  const handleRevokeKey = async (keyId: string, keyName: string) => {
    if (!window.confirm(`Are you sure you want to revoke key "${keyName}" (${keyId})? This will immediately terminate all access.`)) {
      return;
    }

    try {
      const res = await gatewayFetch(`/api/auth/keys/${keyId}/revoke`, {
        method: 'POST',
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Revocation failed');
      }

      showToast(`Key "${keyName}" revoked immediately!`, 'success');
      refreshAllData();
    } catch (err: any) {
      showToast(`Revocation failed: ${err.message}`, 'error');
    }
  };

  // Filtered tools
  const filteredTools = tools.filter((t) => {
    const matchesSearch =
      toolSearch === '' ||
      t.namespacedName.toLowerCase().includes(toolSearch.toLowerCase()) ||
      t.description.toLowerCase().includes(toolSearch.toLowerCase());
    const matchesServer = toolServerFilter === 'all' || t.serverId === toolServerFilter;
    return matchesSearch && matchesServer;
  });

  // Filtered audit logs
  const filteredAuditLogs = auditLogs.filter((l) => {
    if (auditActionFilter === 'all') return true;
    return l.action === auditActionFilter;
  });

  // Render Authentication Modal if not authenticated
  if (!isAuthenticated) {
    return (
      <div className="modal-backdrop active">
        <div className="modal card" style={{ maxWidth: '480px', margin: '60px auto' }}>
          <div className="modal-header">
            <div className="logo-icon" style={{ fontSize: '32px', marginBottom: '8px' }}>🛡️</div>
            <h2>Authenticate to MCP Gateway</h2>
            <p className="subtitle" style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Enter your Admin API Key to access the control plane. In accordance with zero-trust principles, credentials are held{' '}
              <strong>strictly in browser memory</strong> for this session and are never saved to localStorage.
            </p>
          </div>
          <form onSubmit={handleAuthenticate}>
            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label htmlFor="admin-key-input" style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>
                Admin API Key
              </label>
              <input
                type="password"
                id="admin-key-input"
                className="input"
                style={{ width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}
                placeholder="ugk_admin_..."
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                required
                autoComplete="off"
              />
              <span className="form-hint" style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px', display: 'block' }}>
                Use your cluster Admin API Key (bootstrapped from <code>gateway-secret</code> in Kubernetes)
              </span>
            </div>
            <div className="form-group" style={{ marginBottom: '20px' }}>
              <label htmlFor="gateway-endpoint-input" style={{ display: 'block', marginBottom: '6px', fontWeight: 500 }}>
                Gateway API Endpoint
              </label>
              <input
                type="text"
                id="gateway-endpoint-input"
                className="input"
                style={{ width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}
                value={gatewayUrl}
                onChange={(e) => setGatewayUrl(e.target.value)}
                required
              />
              <span className="form-hint" style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px', display: 'block' }}>
                Default <code>/api/gateway</code> routes through internal BFF proxy.
              </span>
            </div>
            {authError && (
              <div className="alert alert-error" style={{ marginBottom: '16px', padding: '10px 14px', borderRadius: 'var(--radius-sm)', background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger)', color: 'var(--color-danger)', fontSize: '13px' }}>
                {authError}
              </div>
            )}
            <button
              type="submit"
              className="btn btn-primary btn-block"
              style={{ width: '100%', padding: '12px', borderRadius: 'var(--radius-sm)', background: 'var(--brand-primary)', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' }}
              disabled={isLoading}
            >
              {isLoading ? 'Verifying Key...' : 'Authenticate Session'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      {/* Toast Notification */}
      {notification && (
        <div
          style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            padding: '12px 18px',
            borderRadius: 'var(--radius-sm)',
            background: notification.type === 'error' ? 'var(--color-danger)' : notification.type === 'success' ? 'var(--color-success)' : 'var(--brand-primary)',
            color: '#fff',
            zIndex: 9999,
            fontWeight: 500,
            boxShadow: 'var(--shadow-lg)',
            transition: 'all 0.2s ease',
          }}
        >
          {notification.message}
        </div>
      )}

      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-logo">⚡</div>
          <div className="brand-info">
            <h1>Urumi Gateway</h1>
            <span className="badge badge-brand">React Console</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          <button className={`nav-item ${activeView === 'overview' ? 'active' : ''}`} onClick={() => setActiveView('overview')}>
            <span className="nav-icon">📊</span>
            <span>Overview</span>
          </button>
          <button className={`nav-item ${activeView === 'servers' ? 'active' : ''}`} onClick={() => setActiveView('servers')}>
            <span className="nav-icon">🔌</span>
            <span>Upstream Servers</span>
          </button>
          <button className={`nav-item ${activeView === 'tools' ? 'active' : ''}`} onClick={() => setActiveView('tools')}>
            <span className="nav-icon">🛠️</span>
            <span>Unified Tools</span>
          </button>
          <button className={`nav-item ${activeView === 'keys' ? 'active' : ''}`} onClick={() => setActiveView('keys')}>
            <span className="nav-icon">🔑</span>
            <span>API Keys</span>
          </button>
          <button className={`nav-item ${activeView === 'audit' ? 'active' : ''}`} onClick={() => setActiveView('audit')}>
            <span className="nav-icon">📜</span>
            <span>Audit Logs</span>
          </button>
          <button className={`nav-item ${activeView === 'health' ? 'active' : ''}`} onClick={() => setActiveView('health')}>
            <span className="nav-icon">❤️</span>
            <span>System Health</span>
          </button>
          <a href="http://chat.localtest.me" target="_blank" rel="noreferrer" className="nav-item" style={{ textDecoration: 'none' }}>
            <span className="nav-icon">🤖</span>
            <span>AI Chat Agent ↗</span>
          </a>
        </nav>

        <div className="sidebar-footer">
          <div className="user-profile">
            <div className="user-avatar">{currentUser?.name?.charAt(0) || 'A'}</div>
            <div className="user-meta">
              <span className="user-name">{currentUser?.name || 'Administrator'}</span>
              <span className="user-role">Role: {currentUser?.role || 'admin'}</span>
            </div>
          </div>
          <button onClick={handleLogout} className="btn btn-sm btn-outline-danger" title="Lock session & clear token from memory">
            🔒 Lock Session
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        <header className="topbar">
          <div className="topbar-title">
            <h2>
              {activeView === 'overview' && 'System Overview'}
              {activeView === 'servers' && 'Upstream MCP Servers'}
              {activeView === 'tools' && 'Unified Tools Catalog'}
              {activeView === 'keys' && 'API Key Management & RBAC'}
              {activeView === 'audit' && 'Cryptographic Audit Trail'}
              {activeView === 'health' && 'System Diagnostics & Health'}
            </h2>
            <span className="topbar-breadcrumb">
              Gateway Control Plane &gt; {activeView.charAt(0).toUpperCase() + activeView.slice(1)}
            </span>
          </div>

          <div className="topbar-actions">
            <div className="status-indicator">
              <span className={`status-dot ${health?.status === 'ok' ? 'status-dot-pulse' : ''}`}></span>
              <span>Gateway: {health?.status === 'ok' ? 'Healthy' : 'Connecting...'}</span>
            </div>
            <button onClick={refreshAllData} className="btn btn-outline btn-sm" disabled={isLoading}>
              🔄 {isLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </header>

        <div className="view-container">
          {/* VIEW: OVERVIEW */}
          {activeView === 'overview' && (
            <div>
              <div className="metrics-grid">
                <div className="card metric-card">
                  <div className="metric-icon icon-primary">🔌</div>
                  <div className="metric-data">
                    <span className="metric-label">Active Upstreams</span>
                    <span className="metric-value">{servers.filter((s) => s.enabled).length} / {servers.length}</span>
                    <span className="metric-sub">ClusterIP microservices</span>
                  </div>
                </div>

                <div className="card metric-card">
                  <div className="metric-icon icon-success">🛠️</div>
                  <div className="metric-data">
                    <span className="metric-label">Aggregated Tools</span>
                    <span className="metric-value">{tools.length}</span>
                    <span className="metric-sub">Prefix-namespaced tools</span>
                  </div>
                </div>

                <div className="card metric-card">
                  <div className="metric-icon icon-warning">🔑</div>
                  <div className="metric-data">
                    <span className="metric-label">Issued API Keys</span>
                    <span className="metric-value">{keys.filter((k) => !k.isRevoked).length}</span>
                    <span className="metric-sub">HMAC-SHA256 hashed</span>
                  </div>
                </div>

                <div className="card metric-card">
                  <div className="metric-icon icon-info">📜</div>
                  <div className="metric-data">
                    <span className="metric-label">Audit Logs Recorded</span>
                    <span className="metric-value">{auditLogs.length}</span>
                    <span className="metric-sub">In-memory sanitized buffer</span>
                  </div>
                </div>
              </div>

              {/* Quick Servers Table */}
              <div className="card" style={{ marginTop: '24px' }}>
                <div className="card-header">
                  <h3>Registered Upstream MCP Servers</h3>
                  <button className="btn btn-sm btn-outline" onClick={() => setActiveView('servers')}>
                    Manage Upstreams
                  </button>
                </div>
                <div className="table-responsive">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Server ID</th>
                        <th>Internal Target</th>
                        <th>Status</th>
                        <th>Enabled</th>
                        <th>Tools</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {servers.map((s) => (
                        <tr key={s.id}>
                          <td><strong>{s.id}</strong></td>
                          <td><code>{s.url}</code></td>
                          <td>
                            <span
                              className={`badge ${
                                !s.enabled
                                  ? 'badge-warning'
                                  : s.status === 'healthy'
                                  ? 'badge-success'
                                  : s.status === 'unreachable'
                                  ? 'badge-danger'
                                  : 'badge-warning'
                              }`}
                            >
                              {!s.enabled ? 'Disabled' : s.status === 'healthy' ? 'Healthy' : s.status === 'unreachable' ? 'Unreachable' : 'Active'}
                            </span>
                          </td>
                          <td>{s.enabled ? '✅ Active' : '⏸️ Disabled'}</td>
                          <td>{s.toolsCount ?? '-'}</td>
                          <td>
                            <button
                              className={`btn btn-xs ${s.enabled ? 'btn-outline-danger' : 'btn-outline-success'}`}
                              onClick={() => handleToggleServer(s.id, s.enabled)}
                            >
                              {s.enabled ? 'Disable' : 'Enable'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* VIEW: SERVERS */}
          {activeView === 'servers' && (
            <div className="card">
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3>Upstream MCP Microservices</h3>
                  <p className="subtitle" style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                    Add, edit, disable, and remove upstream MCP servers. Dynamic tool aggregation, health tracking, and fault isolation are enforced automatically.
                  </p>
                </div>
                <button className="btn btn-primary" onClick={() => setIsAddServerModalOpen(true)}>
                  + Add Upstream Server
                </button>
              </div>
              <div className="table-responsive">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Server ID</th>
                      <th>Friendly Name</th>
                      <th>Internal URL</th>
                      <th>Transport</th>
                      <th>Status</th>
                      <th>Timeout</th>
                      <th>Tools</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {servers.map((s) => (
                      <tr key={s.id}>
                        <td><strong>{s.id}</strong></td>
                        <td>{s.name || s.id}</td>
                        <td><code>{s.url}</code></td>
                        <td><span className="badge badge-brand">{(s.transport || s.type || 'sse').toUpperCase()}</span></td>
                        <td>
                          <span
                            className={`badge ${
                              !s.enabled
                                ? 'badge-warning'
                                : s.status === 'healthy'
                                ? 'badge-success'
                                : s.status === 'unreachable'
                                ? 'badge-danger'
                                : 'badge-warning'
                            }`}
                          >
                            {!s.enabled ? 'Disabled' : s.status === 'healthy' ? 'Healthy' : s.status === 'unreachable' ? 'Unreachable' : 'Active'}
                          </span>
                        </td>
                        <td>{s.timeoutMs ? `${s.timeoutMs}ms` : '10000ms'}</td>
                        <td>{s.toolsCount ?? tools.filter(t => t.serverId === s.id).length} tools</td>
                        <td>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                              className={`btn btn-xs ${s.enabled ? 'btn-outline-warning' : 'btn-outline-success'}`}
                              onClick={() => handleToggleServer(s.id, s.enabled)}
                            >
                              {s.enabled ? 'Disable' : 'Enable'}
                            </button>
                            <button
                              className="btn btn-xs btn-outline"
                              onClick={() => openEditServerModal(s)}
                            >
                              Edit
                            </button>
                            <button
                              className="btn btn-xs btn-outline-danger"
                              onClick={() => handleRemoveServer(s.id, s.name)}
                            >
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* VIEW: TOOLS */}
          {activeView === 'tools' && (
            <div>
              <div className="card" style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                  <input
                    type="text"
                    className="input"
                    style={{ flex: 1, padding: '10px 14px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}
                    placeholder="Search tools by name or description..."
                    value={toolSearch}
                    onChange={(e) => setToolSearch(e.target.value)}
                  />
                  <select
                    className="input"
                    style={{ padding: '10px 14px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}
                    value={toolServerFilter}
                    onChange={(e) => setToolServerFilter(e.target.value)}
                  >
                    <option value="all">All Upstream Servers</option>
                    <option value="woo-mcp">woo-mcp</option>
                    <option value="utils-mcp">utils-mcp</option>
                    <option value="notes-mcp">notes-mcp</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '16px' }}>
                {filteredTools.map((t) => (
                  <div key={t.namespacedName} className="card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <code style={{ fontSize: '14px', color: 'var(--brand-light)', fontWeight: 600 }}>{t.namespacedName}</code>
                      <span className="badge badge-brand">{t.serverId}</span>
                    </div>
                    <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '12px', minHeight: '38px' }}>
                      {t.description}
                    </p>
                    <div style={{ background: 'var(--bg-primary)', padding: '8px 12px', borderRadius: 'var(--radius-sm)', fontSize: '12px' }}>
                      <span style={{ color: 'var(--text-dim)' }}>Parameters: </span>
                      <code>{Object.keys(t.inputSchema?.properties || {}).join(', ') || 'None'}</code>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* VIEW: KEYS */}
          {activeView === 'keys' && (
            <div>
              <div className="card">
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h3>API Keys & Role-Based Access Control</h3>
                    <p className="subtitle" style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                      Keys are hashed with HMAC-SHA256 and verified using constant-time comparison.
                    </p>
                  </div>
                  <button className="btn btn-primary" onClick={() => setIsNewKeyModalOpen(true)}>
                    + Generate New API Key
                  </button>
                </div>

                <div className="table-responsive">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Key ID</th>
                        <th>Name</th>
                        <th>Role</th>
                        <th>Key Prefix</th>
                        <th>Created</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {keys.map((k) => (
                        <tr key={k.id}>
                          <td><code>{k.id}</code></td>
                          <td><strong>{k.name}</strong></td>
                          <td>
                            <span className={`badge ${k.role === 'admin' ? 'badge-brand' : 'badge-info'}`}>
                              {k.role.toUpperCase()}
                            </span>
                          </td>
                          <td><code>{k.prefix}...</code></td>
                          <td>{new Date(k.createdAt).toLocaleDateString()}</td>
                          <td>
                            <span className={`badge ${k.isRevoked ? 'badge-danger' : 'badge-success'}`}>
                              {k.isRevoked ? 'Revoked' : 'Active'}
                            </span>
                          </td>
                          <td>
                            {!k.isRevoked ? (
                              <button
                                className="btn btn-xs btn-outline-danger"
                                onClick={() => handleRevokeKey(k.id, k.name)}
                              >
                                Revoke
                              </button>
                            ) : (
                              <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>Revoked</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Modal: Generate New Key */}
              {isNewKeyModalOpen && (
                <div className="modal-backdrop active">
                  <div className="modal card" style={{ maxWidth: '440px', margin: '80px auto' }}>
                    <div className="modal-header">
                      <h3>Generate Scoped API Key</h3>
                    </div>
                    <form onSubmit={handleCreateKey}>
                      <div className="form-group" style={{ marginBottom: '14px' }}>
                        <label style={{ display: 'block', marginBottom: '6px' }}>Key Friendly Name</label>
                        <input
                          type="text"
                          className="input"
                          style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: '#fff' }}
                          placeholder="e.g. User B Dedicated"
                          value={newKeyName}
                          onChange={(e) => setNewKeyName(e.target.value)}
                          required
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: '20px' }}>
                        <label style={{ display: 'block', marginBottom: '6px' }}>Assigned RBAC Role</label>
                        <select
                          className="input"
                          style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: '#fff' }}
                          value={newKeyRole}
                          onChange={(e) => setNewKeyRole(e.target.value as 'admin' | 'member')}
                        >
                          <option value="member">member (Read &amp; Calculate tools only)</option>
                          <option value="admin">admin (Full tools + key &amp; server management)</option>
                        </select>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                        <button type="button" className="btn btn-outline" onClick={() => setIsNewKeyModalOpen(false)}>
                          Cancel
                        </button>
                        <button type="submit" className="btn btn-primary">
                          Generate Key
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}

              {/* Modal: Generated Key Display */}
              {generatedKeyResult && (
                <div className="modal-backdrop active">
                  <div className="modal card" style={{ maxWidth: '500px', margin: '80px auto' }}>
                    <div className="modal-header">
                      <div style={{ fontSize: '28px', marginBottom: '6px' }}>🔑</div>
                      <h3>API Key Generated</h3>
                      <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                        Copy this key now. For zero-trust security, raw secret keys are <strong>never stored</strong> in the database and cannot be retrieved later.
                      </p>
                    </div>
                    <div style={{ background: 'var(--bg-primary)', padding: '14px', borderRadius: 'var(--radius-sm)', margin: '14px 0', border: '1px solid var(--border-color)' }}>
                      <code style={{ fontSize: '13px', color: 'var(--color-success)', wordBreak: 'break-all' }}>
                        {generatedKeyResult.key}
                      </code>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                      <button
                        className="btn btn-primary"
                        onClick={() => {
                          navigator.clipboard.writeText(generatedKeyResult.key);
                          showToast('API Key copied to clipboard!', 'success');
                          setGeneratedKeyResult(null);
                        }}
                      >
                        Copy &amp; Close
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Modal: Add Upstream Server */}
              {isAddServerModalOpen && (
                <div className="modal-backdrop active">
                  <div className="modal card" style={{ maxWidth: '480px', margin: '60px auto' }}>
                    <div className="modal-header">
                      <h3>Register New Upstream Server</h3>
                      <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                        Target an internal Kubernetes ClusterIP MCP service. URLs are validated against SSRF.
                      </p>
                    </div>
                    <form onSubmit={handleAddServer}>
                      <div className="form-group" style={{ marginBottom: '12px' }}>
                        <label style={{ display: 'block', marginBottom: '4px' }}>Server ID (Unique Identifier)</label>
                        <input
                          type="text"
                          className="input"
                          style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: '#fff' }}
                          placeholder="e.g. analytics-mcp"
                          value={newServerId}
                          onChange={(e) => setNewServerId(e.target.value)}
                          required
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: '12px' }}>
                        <label style={{ display: 'block', marginBottom: '4px' }}>Friendly Display Name</label>
                        <input
                          type="text"
                          className="input"
                          style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: '#fff' }}
                          placeholder="e.g. Analytics MCP Server"
                          value={newServerName}
                          onChange={(e) => setNewServerName(e.target.value)}
                          required
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: '12px' }}>
                        <label style={{ display: 'block', marginBottom: '4px' }}>Upstream Target URL</label>
                        <input
                          type="text"
                          className="input"
                          style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: '#fff' }}
                          placeholder="e.g. http://analytics-mcp:4005/sse"
                          value={newServerUrl}
                          onChange={(e) => setNewServerUrl(e.target.value)}
                          required
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: '12px' }}>
                        <label style={{ display: 'block', marginBottom: '4px' }}>MCP Transport</label>
                        <select
                          className="input"
                          style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: '#fff' }}
                          value={newServerTransport}
                          onChange={(e) => setNewServerTransport(e.target.value as 'sse' | 'streamable-http')}
                        >
                          <option value="sse">SSE (Server-Sent Events: /sse)</option>
                          <option value="streamable-http">Streamable HTTP (/mcp)</option>
                        </select>
                      </div>
                      <div className="form-group" style={{ marginBottom: '20px' }}>
                        <label style={{ display: 'block', marginBottom: '4px' }}>Timeout (ms)</label>
                        <input
                          type="number"
                          className="input"
                          style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: '#fff' }}
                          min="1000"
                          max="60000"
                          value={newServerTimeout}
                          onChange={(e) => setNewServerTimeout(parseInt(e.target.value, 10))}
                          required
                        />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                        <button type="button" className="btn btn-outline" onClick={() => setIsAddServerModalOpen(false)}>
                          Cancel
                        </button>
                        <button type="submit" className="btn btn-primary">
                          Register Upstream
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}

              {/* Modal: Edit Upstream Server */}
              {isEditServerModalOpen && (
                <div className="modal-backdrop active">
                  <div className="modal card" style={{ maxWidth: '480px', margin: '60px auto' }}>
                    <div className="modal-header">
                      <h3>Edit Upstream Server ({editingServerId})</h3>
                      <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                        Update configuration parameters for this upstream service.
                      </p>
                    </div>
                    <form onSubmit={handleEditServer}>
                      <div className="form-group" style={{ marginBottom: '12px' }}>
                        <label style={{ display: 'block', marginBottom: '4px' }}>Friendly Display Name</label>
                        <input
                          type="text"
                          className="input"
                          style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: '#fff' }}
                          value={editServerName}
                          onChange={(e) => setEditServerName(e.target.value)}
                          required
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: '12px' }}>
                        <label style={{ display: 'block', marginBottom: '4px' }}>Target URL</label>
                        <input
                          type="text"
                          className="input"
                          style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: '#fff' }}
                          value={editServerUrl}
                          onChange={(e) => setEditServerUrl(e.target.value)}
                          required
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: '20px' }}>
                        <label style={{ display: 'block', marginBottom: '4px' }}>Timeout (ms)</label>
                        <input
                          type="number"
                          className="input"
                          style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: '#fff' }}
                          min="1000"
                          max="60000"
                          value={editServerTimeout}
                          onChange={(e) => setEditServerTimeout(parseInt(e.target.value, 10))}
                          required
                        />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                        <button type="button" className="btn btn-outline" onClick={() => setIsEditServerModalOpen(false)}>
                          Cancel
                        </button>
                        <button type="submit" className="btn btn-primary">
                          Save Changes
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* VIEW: AUDIT LOGS */}
          {activeView === 'audit' && (
            <div className="card">
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3>Cryptographic Audit Trail</h3>
                  <p className="subtitle" style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                    Every tool discovery, invocation, key modification, and upstream toggle is attributed with verified user identity.
                  </p>
                </div>
                <div>
                  <select
                    className="input"
                    style={{ padding: '8px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: '#fff' }}
                    value={auditActionFilter}
                    onChange={(e) => setAuditActionFilter(e.target.value)}
                  >
                    <option value="all">All Actions</option>
                    <option value="TOOL_INVOCATION">TOOL_INVOCATION</option>
                    <option value="TOOL_DISCOVERY">TOOL_DISCOVERY</option>
                    <option value="KEY_CREATION">KEY_CREATION</option>
                    <option value="KEY_REVOCATION">KEY_REVOCATION</option>
                    <option value="SERVER_TOGGLE">SERVER_TOGGLE</option>
                  </select>
                </div>
              </div>

              <div className="table-responsive">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>User ID</th>
                      <th>Role</th>
                      <th>Action</th>
                      <th>Tool Name</th>
                      <th>Status</th>
                      <th>Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAuditLogs.map((log) => (
                      <tr key={log.id}>
                        <td><small>{new Date(log.timestamp).toLocaleTimeString()}</small></td>
                        <td><code>{log.userId.substring(0, 16)}</code></td>
                        <td>
                          <span className={`badge ${log.userRole === 'admin' ? 'badge-brand' : 'badge-info'}`}>
                            {log.userRole}
                          </span>
                        </td>
                        <td><code>{log.action}</code></td>
                        <td>{log.toolName ? <strong>{log.toolName}</strong> : <span style={{ color: 'var(--text-dim)' }}>-</span>}</td>
                        <td>
                          <span className={`badge ${log.status === 'SUCCESS' ? 'badge-success' : log.status === 'UNAUTHORIZED' ? 'badge-warning' : 'badge-danger'}`}>
                            {log.status}
                          </span>
                        </td>
                        <td>{log.durationMs}ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* VIEW: HEALTH */}
          {activeView === 'health' && (
            <div>
              <div className="metrics-grid" style={{ marginBottom: '24px' }}>
                <div className="card metric-card">
                  <div className="metric-icon icon-success">⚡</div>
                  <div className="metric-data">
                    <span className="metric-label">Gateway Status</span>
                    <span className="metric-value">{health?.status?.toUpperCase() || 'UNKNOWN'}</span>
                    <span className="metric-sub">{health?.service} v{health?.version}</span>
                  </div>
                </div>

                <div className="card metric-card">
                  <div className="metric-icon icon-primary">📡</div>
                  <div className="metric-data">
                    <span className="metric-label">Streamable HTTP Sessions</span>
                    <span className="metric-value">{health?.activeStreamableSessions ?? 0}</span>
                    <span className="metric-sub">Official MCP /mcp transport</span>
                  </div>
                </div>

                <div className="card metric-card">
                  <div className="metric-icon icon-info">🔄</div>
                  <div className="metric-data">
                    <span className="metric-label">SSE Sessions</span>
                    <span className="metric-value">{health?.activeSseSessions ?? 0}</span>
                    <span className="metric-sub">Legacy /sse transport</span>
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card-header">
                  <h3>Raw Gateway Diagnostics (/healthz)</h3>
                </div>
                <pre style={{ background: 'var(--bg-primary)', padding: '16px', borderRadius: 'var(--radius-sm)', color: 'var(--brand-light)', fontSize: '13px', overflowX: 'auto' }}>
                  {JSON.stringify(health, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};
export default App;
