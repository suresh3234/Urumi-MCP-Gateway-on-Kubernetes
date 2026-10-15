import crypto from 'crypto';
import { AuditLogEntry, AuditStatus, UserRole } from './types';

export class AuditLogger {
  private maxEntries: number;
  private logs: AuditLogEntry[] = [];

  constructor(maxEntries: number = 1000) {
    this.maxEntries = maxEntries;
  }

  public sanitizeData(data: any): any {
    if (!data) return data;

    if (typeof data === 'string') {
      // Redact potential API keys or tokens
      if (data.startsWith('ugk_') || data.startsWith('ck_') || data.startsWith('cs_') || data.startsWith('Bearer ')) {
        return '[REDACTED_SECRET]';
      }
      // Redact email addresses in free text
      if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(data)) {
        return data.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]');
      }
      return data;
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.sanitizeData(item));
    }

    if (typeof data === 'object') {
      const sanitized: Record<string, any> = {};
      const sensitiveKeys = [
        'authorization',
        'password',
        'token',
        'key',
        'secret',
        'consumer_secret',
        'consumer_key',
        'api_key',
        'credit_card',
        'card',
        'cvv',
        'cvc',
        'email',
        'phone',
        'first_name',
        'last_name',
        'billing',
        'shipping',
        'customer_id',
        'address',
      ];

      for (const [k, v] of Object.entries(data)) {
        const lowerKey = k.toLowerCase();
        if (sensitiveKeys.some((s) => lowerKey.includes(s))) {
          sanitized[k] = '[REDACTED]';
        } else {
          sanitized[k] = this.sanitizeData(v);
        }
      }
      return sanitized;
    }

    return data;
  }

  public log(entry: {
    userId: string;
    userRole: UserRole;
    action: AuditLogEntry['action'];
    toolName?: string;
    upstreamId?: string;
    durationMs: number;
    status: AuditStatus;
    error?: string;
    details?: Record<string, any>;
  }): AuditLogEntry {
    const logEntry: AuditLogEntry = {
      id: `audit_${crypto.randomBytes(8).toString('hex')}`,
      timestamp: new Date().toISOString(),
      userId: entry.userId,
      userRole: entry.userRole,
      action: entry.action,
      toolName: entry.toolName,
      upstreamId: entry.upstreamId,
      durationMs: Math.max(0, Math.round(entry.durationMs)),
      status: entry.status,
      error: entry.error
        ? entry.error
            .replace(/(ugk_|ck_|cs_)[a-zA-Z0-9_-]+/g, '[REDACTED_KEY]')
            .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]')
        : undefined,
      sanitizedDetails: this.sanitizeData(entry.details),
    };

    this.logs.unshift(logEntry);
    if (this.logs.length > this.maxEntries) {
      this.logs.pop();
    }

    console.log(
      `[Audit] action=${logEntry.action} user=${logEntry.userId}(${logEntry.userRole}) tool=${logEntry.toolName || 'none'} upstream=${logEntry.upstreamId || 'none'} status=${logEntry.status} duration=${logEntry.durationMs}ms`
    );

    return logEntry;
  }

  public getLogs(filter?: {
    userId?: string;
    action?: string;
    status?: AuditStatus;
    limit?: number;
  }): AuditLogEntry[] {
    let result = this.logs;

    if (filter?.userId) {
      result = result.filter((l) => l.userId === filter.userId);
    }
    if (filter?.action) {
      result = result.filter((l) => l.action === filter.action);
    }
    if (filter?.status) {
      result = result.filter((l) => l.status === filter.status);
    }

    const limit = filter?.limit || 100;
    return result.slice(0, limit);
  }

  public clear(): void {
    this.logs = [];
  }
}
