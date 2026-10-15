import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { ApiKeyRecord, AuthenticatedUser, UserRole } from './types';

export class AuthManager {
  private keySalt: string;
  private apiKeys: Map<string, ApiKeyRecord> = new Map(); // keyId -> record

  constructor(keySalt: string) {
    this.keySalt = keySalt;
  }

  public hashKey(rawKey: string): string {
    return crypto.createHmac('sha256', this.keySalt).update(rawKey).digest('hex');
  }

  public createApiKey(name: string, role: UserRole, customRawKey?: string): { record: ApiKeyRecord; rawKey: string } {
    const rawKey = customRawKey || `ugk_${role}_${crypto.randomBytes(24).toString('hex')}`;
    const keyHash = this.hashKey(rawKey);
    const id = `key_${crypto.randomBytes(8).toString('hex')}`;
    const prefix = rawKey.substring(0, 10) + '...';

    const record: ApiKeyRecord = {
      id,
      name,
      keyHash,
      prefix,
      role,
      createdAt: new Date().toISOString(),
      status: 'active',
    };

    this.apiKeys.set(id, record);
    return { record, rawKey };
  }

  public authenticateKey(rawKey: string): AuthenticatedUser | null {
    if (!rawKey || typeof rawKey !== 'string') {
      return null;
    }

    const incomingHash = this.hashKey(rawKey);
    const incomingBuf = Buffer.from(incomingHash, 'hex');

    for (const record of this.apiKeys.values()) {
      if (record.status !== 'active') continue;

      const recordBuf = Buffer.from(record.keyHash, 'hex');
      if (incomingBuf.length === recordBuf.length && crypto.timingSafeEqual(incomingBuf, recordBuf)) {
        record.lastUsedAt = new Date().toISOString();
        return {
          keyId: record.id,
          name: record.name,
          role: record.role,
        };
      }
    }

    return null;
  }

  public listKeys(): Omit<ApiKeyRecord, 'keyHash'>[] {
    return Array.from(this.apiKeys.values()).map(({ keyHash, ...rest }) => rest);
  }

  public revokeKey(id: string): boolean {
    const record = this.apiKeys.get(id);
    if (!record) return false;
    record.status = 'revoked';
    return true;
  }

  public canExecuteTool(role: UserRole, toolName: string): boolean {
    if (role === 'admin') {
      return true;
    }

    // Role 'member' can execute read/calculation tools, but cannot execute mutating tools
    const actionPart = toolName.includes('__') ? toolName.split('__')[1] : toolName;
    const writePrefixes = ['create_', 'update_', 'delete_', 'set_', 'add_'];
    const isMutating = writePrefixes.some((prefix) => actionPart.startsWith(prefix));

    return !isMutating;
  }

  public getAuthMiddleware(requiredRole?: UserRole) {
    return (req: Request, res: Response, next: NextFunction): void => {
      const authHeader = req.headers.authorization;
      const customHeader = req.headers['x-api-key'];

      let rawKey = '';
      if (authHeader && authHeader.startsWith('Bearer ')) {
        rawKey = authHeader.substring(7).trim();
      } else if (typeof customHeader === 'string') {
        rawKey = customHeader.trim();
      }

      if (!rawKey) {
        res.status(401).json({
          error: true,
          code: 'UNAUTHORIZED',
          message: 'Missing API key. Provide Authorization: Bearer <key> or X-API-Key header.',
        });
        return;
      }

      const user = this.authenticateKey(rawKey);
      if (!user) {
        res.status(401).json({
          error: true,
          code: 'INVALID_KEY',
          message: 'Invalid or revoked API key.',
        });
        return;
      }

      if (requiredRole && requiredRole === 'admin' && user.role !== 'admin') {
        res.status(403).json({
          error: true,
          code: 'FORBIDDEN',
          message: 'Insufficient permissions. Admin role required.',
        });
        return;
      }

      (req as any).user = user;
      next();
    };
  }
}
