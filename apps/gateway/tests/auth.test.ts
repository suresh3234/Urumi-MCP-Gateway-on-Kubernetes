import { AuthManager } from '../src/auth';

describe('AuthManager & RBAC Unit Tests', () => {
  let auth: AuthManager;
  const salt = 'test-salt-gateway-2026';

  beforeEach(() => {
    auth = new AuthManager(salt);
  });

  it('creates and verifies a valid API key', () => {
    const { record, rawKey } = auth.createApiKey('Test Admin', 'admin');
    expect(record.id).toBeDefined();
    expect(record.role).toBe('admin');
    expect(rawKey.startsWith('ugk_admin_')).toBe(true);

    const authUser = auth.authenticateKey(rawKey);
    expect(authUser).not.toBeNull();
    expect(authUser?.name).toBe('Test Admin');
    expect(authUser?.role).toBe('admin');
  });

  it('rejects invalid or tampered API keys', () => {
    auth.createApiKey('Test Admin', 'admin');
    expect(auth.authenticateKey('invalid-key-xyz')).toBeNull();
    expect(auth.authenticateKey('')).toBeNull();
  });

  it('rejects revoked API keys', () => {
    const { record, rawKey } = auth.createApiKey('Test Member', 'member');
    expect(auth.authenticateKey(rawKey)).not.toBeNull();

    auth.revokeKey(record.id);
    expect(auth.authenticateKey(rawKey)).toBeNull();
  });

  it('enforces RBAC policy: admin can execute any tool', () => {
    expect(auth.canExecuteTool('admin', 'list_products')).toBe(true);
    expect(auth.canExecuteTool('admin', 'create_product')).toBe(true);
    expect(auth.canExecuteTool('admin', 'update_order_status')).toBe(true);
  });

  it('enforces RBAC policy: member can only execute read tools', () => {
    expect(auth.canExecuteTool('member', 'list_products')).toBe(true);
    expect(auth.canExecuteTool('member', 'list_orders')).toBe(true);
    expect(auth.canExecuteTool('member', 'get_order')).toBe(true);
    // Mutating tools disallowed for member
    expect(auth.canExecuteTool('member', 'create_product')).toBe(false);
    expect(auth.canExecuteTool('member', 'update_order_status')).toBe(false);
    expect(auth.canExecuteTool('member', 'woo-mcp__create_product')).toBe(false);
  });
});
