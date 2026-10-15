import { AuditLogger } from '../src/audit';

describe('AuditLogger Unit Tests', () => {
  let audit: AuditLogger;

  beforeEach(() => {
    audit = new AuditLogger(50);
  });

  it('records an audit event with metadata and duration', () => {
    const entry = audit.log({
      userId: 'user_123',
      userRole: 'admin',
      action: 'TOOL_INVOCATION',
      toolName: 'list_products',
      upstreamId: 'woo-mcp',
      durationMs: 45,
      status: 'SUCCESS',
      details: { page: 1 },
    });

    expect(entry.id.startsWith('audit_')).toBe(true);
    expect(entry.status).toBe('SUCCESS');
    expect(entry.toolName).toBe('list_products');

    const logs = audit.getLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].userId).toBe('user_123');
  });

  it('redacts sensitive credentials, consumer secrets, and raw API keys', () => {
    const entry = audit.log({
      userId: 'user_123',
      userRole: 'admin',
      action: 'TOOL_INVOCATION',
      toolName: 'create_product',
      durationMs: 30,
      status: 'SUCCESS',
      details: {
        authorization: 'Bearer ugk_admin_secret_token_12345',
        consumer_key: 'ck_secret_key_6789',
        consumer_secret: 'cs_very_secret_key_abc',
        normalField: 'Sample T-Shirt',
      },
      error: 'Failed with key ugk_admin_12345abc',
    });

    expect(entry.sanitizedDetails?.authorization).toBe('[REDACTED]');
    expect(entry.sanitizedDetails?.consumer_key).toBe('[REDACTED]');
    expect(entry.sanitizedDetails?.consumer_secret).toBe('[REDACTED]');
    expect(entry.sanitizedDetails?.normalField).toBe('Sample T-Shirt');
    expect(entry.error).toBe('Failed with key [REDACTED_KEY]');
  });

  it('redacts customer PII including emails, phone numbers, and billing details', () => {
    const entry = audit.log({
      userId: 'user_456',
      userRole: 'member',
      action: 'TOOL_INVOCATION',
      toolName: 'get_order',
      durationMs: 20,
      status: 'SUCCESS',
      details: {
        orderId: 101,
        email: 'customer@example.com',
        phone: '+1-555-0199',
        billing: { first_name: 'John', last_name: 'Doe', address_1: '123 Main St' },
        shipping: { city: 'Gotham', country: 'US' },
        notes: 'Contact customer at user.contact@example.com for delivery',
      },
      error: 'Error notifying user.contact@example.com',
    });

    expect(entry.sanitizedDetails?.email).toBe('[REDACTED]');
    expect(entry.sanitizedDetails?.phone).toBe('[REDACTED]');
    expect(entry.sanitizedDetails?.billing).toBe('[REDACTED]');
    expect(entry.sanitizedDetails?.shipping).toBe('[REDACTED]');
    expect(entry.sanitizedDetails?.notes).toBe('Contact customer at [REDACTED_EMAIL] for delivery');
    expect(entry.error).toBe('Error notifying [REDACTED_EMAIL]');
  });

  it('filters audit logs by action and status', () => {
    audit.log({ userId: 'u1', userRole: 'member', action: 'TOOL_INVOCATION', durationMs: 10, status: 'SUCCESS' });
    audit.log({ userId: 'u2', userRole: 'member', action: 'TOOL_INVOCATION', durationMs: 15, status: 'UNAUTHORIZED' });
    audit.log({ userId: 'u1', userRole: 'admin', action: 'SERVER_TOGGLE', durationMs: 5, status: 'SUCCESS' });

    const failedLogs = audit.getLogs({ status: 'UNAUTHORIZED' });
    expect(failedLogs.length).toBe(1);
    expect(failedLogs[0].userId).toBe('u2');

    const toggleLogs = audit.getLogs({ action: 'SERVER_TOGGLE' });
    expect(toggleLogs.length).toBe(1);
  });
});
