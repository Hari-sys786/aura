/**
 * Aura Dashboard — Multi-user Auth
 * - Users stored in SQLite (collection: 'users')
 * - Passwords hashed with bcrypt
 * - JWT sessions (7d expiry)
 * - Each user has a userId — all data is scoped by userId
 *   (for now Aura is single-instance, so first registered user is 'owner')
 */

import { createHmac, timingSafeEqual } from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { SQLiteStore } from '../core/storage/sqlite.js';

const JWT_SECRET = process.env['JWT_SECRET']
  || createHmac('sha256', 'aura-auth-secret').update('aura2026').digest('hex');
const JWT_EXPIRY = '7d';
const BCRYPT_ROUNDS = 10;

export interface User {
  id: string;
  username: string;
  email?: string;
  passwordHash: string;
  role: 'owner' | 'viewer';
  createdAt: string;
  lastLogin?: string;
}

export interface AuthResult {
  ok: boolean;
  token?: string;
  user?: { id: string; username: string; email?: string; role: string };
  error?: string;
}

export class AuthManager {
  constructor(private db: SQLiteStore) {
    this.ensureSchema();
  }

  // ─── Schema ──────────────────────────────────────────────────────────────

  private ensureSchema() {
    // Users stored as kv entries: collection='users', key=userId
    // Index by username stored as: collection='users-index', key=username → userId
  }

  // ─── User count ──────────────────────────────────────────────────────────

  getUserCount(): number {
    return this.db.list('users').length;
  }

  // ─── Register ────────────────────────────────────────────────────────────

  async register(username: string, password: string, email?: string): Promise<AuthResult> {
    username = username.trim().toLowerCase();

    // Validation
    if (!username || username.length < 3) return { ok: false, error: 'Username must be at least 3 characters' };
    if (!password || password.length < 8) return { ok: false, error: 'Password must be at least 8 characters' };
    if (!/^[a-z0-9_.-]+$/.test(username)) return { ok: false, error: 'Username can only contain letters, numbers, dots, underscores, hyphens' };

    // Check if username taken
    const existing = this.db.get<string>('users-index', username);
    if (existing) return { ok: false, error: 'Username already taken' };

    // First user is owner, rest are viewers
    const isFirst = this.getUserCount() === 0;
    const role: User['role'] = isFirst ? 'owner' : 'viewer';

    const id = `u_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const user: User = {
      id,
      username,
      email: email?.trim() || undefined,
      passwordHash,
      role,
      createdAt: new Date().toISOString(),
    };

    // Store user
    this.db.set('users', id, user);
    this.db.set('users-index', username, id);

    const token = this.generateToken(user);
    return {
      ok: true,
      token,
      user: { id: user.id, username: user.username, email: user.email, role: user.role },
    };
  }

  // ─── Login ───────────────────────────────────────────────────────────────

  async login(username: string, password: string): Promise<AuthResult> {
    username = username.trim().toLowerCase();
    if (!username || !password) return { ok: false, error: 'Username and password required' };

    const userId = this.db.get<string>('users-index', username);
    if (!userId) {
      // Constant-time fake compare to prevent timing attacks
      await bcrypt.compare(password, '$2a$10$fakehashforfakeuserXXXXXXXXXXXXXXXXXXXXXXXXXX');
      return { ok: false, error: 'Invalid username or password' };
    }

    const user = this.db.get<User>('users', userId);
    if (!user) return { ok: false, error: 'User not found' };

    const passOk = await bcrypt.compare(password, user.passwordHash);
    if (!passOk) return { ok: false, error: 'Invalid username or password' };

    // Update last login
    this.db.set('users', user.id, { ...user, lastLogin: new Date().toISOString() });

    const token = this.generateToken(user);
    return {
      ok: true,
      token,
      user: { id: user.id, username: user.username, email: user.email, role: user.role },
    };
  }

  // ─── Verify token ────────────────────────────────────────────────────────

  verify(token: string): { id: string; username: string; role: string } | null {
    try {
      return jwt.verify(token, JWT_SECRET) as { id: string; username: string; role: string };
    } catch {
      return null;
    }
  }

  // ─── List users (owner only) ─────────────────────────────────────────────

  listUsers(): Array<Omit<User, 'passwordHash'>> {
    return this.db.list('users').map(r => {
      const u = JSON.parse(r.value) as User;
      const { passwordHash: _, ...safe } = u;
      return safe;
    });
  }

  // ─── Delete user ─────────────────────────────────────────────────────────

  deleteUser(userId: string, requesterRole: string): { ok: boolean; error?: string } {
    if (requesterRole !== 'owner') return { ok: false, error: 'Only owner can delete users' };
    const user = this.db.get<User>('users', userId);
    if (!user) return { ok: false, error: 'User not found' };
    if (user.role === 'owner') return { ok: false, error: 'Cannot delete owner account' };
    this.db.delete('users', userId);
    this.db.delete('users-index', user.username);
    return { ok: true };
  }

  // ─── Change password ─────────────────────────────────────────────────────

  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
    const user = this.db.get<User>('users', userId);
    if (!user) return { ok: false, error: 'User not found' };
    const passOk = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!passOk) return { ok: false, error: 'Current password incorrect' };
    if (!newPassword || newPassword.length < 8) return { ok: false, error: 'New password must be at least 8 characters' };
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    this.db.set('users', userId, { ...user, passwordHash });
    return { ok: true };
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private generateToken(user: User): string {
    return jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    );
  }
}
