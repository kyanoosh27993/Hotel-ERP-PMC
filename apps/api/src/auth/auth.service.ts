/**
 * auth.service.ts — Argon2id + JWT دسترسی کوتاه‌عمر + Refresh چرخشی با تشخیص استفاده مجدد
 * (قواعد امنیتی بخش ۵) + MFA توت‌پ نقش‌های حساس.
 */
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { authenticator } from 'otplib';
import { PrismaService } from '../prisma.service';

export interface AuthenticatedUser {
  id: string;
  username: string;
  roles: string[];
  mfaEnabled: boolean;
}

const ACCESS_TTL_SECONDS = 900; // ۱۵ دقیقه
const REFRESH_TTL_DAYS = 14;

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService) {}

  /* ── گذرواژه ── */

  async hashPassword(plain: string): Promise<string> {
    return hash(plain); // @node-rs/argon2 → Argon2id پیش‌فرض
  }

  async verifyPassword(digest: string, plain: string): Promise<boolean> {
    return verify(digest, plain);
  }

  /* ── ورود ── */

  async login(username: string, password: string, totpCode?: string): Promise<{ accessToken: string; refreshToken: string; user: AuthenticatedUser }> {
    const user = await this.prisma.user.findUnique({
      where: { username },
      include: { roles: { include: { role: true } } },
    });
    const genericFail = { code: 'UNAUTHORIZED', message: 'Invalid username or password' };
    if (!user || !user.isActive) {
      await this.audit(null, 'LOGIN_FAILED', 'User', username);
      throw new UnauthorizedException(genericFail);
    }
    const ok = await this.verifyPassword(user.passwordHash, password);
    if (!ok) {
      await this.audit(user.id, 'LOGIN_FAILED', 'User', username);
      throw new UnauthorizedException(genericFail);
    }

    const roles = user.roles.map((ur) => ur.role);
    const needsMfa = roles.some((r) => r.sensitiveMfa);
    if (needsMfa) {
      if (!user.mfaEnabled || !totpCode) {
        throw new UnauthorizedException({ code: 'MFA_REQUIRED', message: 'Second factor (TOTP) required for this role' });
      }
      const valid = authenticator.verify({ token: totpCode, secret: user.mfaSecret ?? '' });
      if (!valid) {
        await this.audit(user.id, 'MFA_INVALID', 'User', username);
        throw new UnauthorizedException({ code: 'MFA_INVALID', message: 'Invalid TOTP code' });
      }
    }

    const accessToken = await this.issueAccessToken(user.id, user.username, roles.map((r) => r.name));
    const refreshToken = await this.issueRefreshToken(user.id);
    await this.audit(user.id, 'LOGIN', 'User', user.id);
    return {
      accessToken,
      refreshToken,
      user: { id: user.id, username: user.username, roles: roles.map((r) => r.name), mfaEnabled: user.mfaEnabled },
    };
  }

  /* ── توکن‌ها ── */

  async issueAccessToken(userId: string, username: string, roles: string[]): Promise<string> {
    return this.jwt.signAsync({ sub: userId, username, roles, typ: 'access' }, { expiresIn: ACCESS_TTL_SECONDS });
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  async issueRefreshToken(userId: string): Promise<string> {
    const raw = randomUUID() + '.' + randomUUID();
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: this.sha256(raw), expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 86400_000) },
    });
    return raw;
  }

  /**
   * چرخش Refresh: توکن قدیمی باطل و توکن جدید صادر می‌شود.
   * استفاده مجدد از توکن باطل‌شده = نشانه سرقت → کل زنجیره باطل و خطا.
   */
  async rotateRefreshToken(rawToken: string): Promise<{ accessToken: string; refreshToken: string; user: AuthenticatedUser }> {
    const tokenHash = this.sha256(rawToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: { include: { roles: { include: { role: true } } } } } });
    if (!stored) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Invalid refresh token' });

    if (stored.revokedAt) {
      // تشخیص استفاده مجدد: همه توکن‌های فعال این کاربر باطل می‌شوند (قانون امنیتی)
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit(stored.userId, 'REFRESH_REUSE_DETECTED', 'RefreshToken', stored.id);
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Refresh token reuse detected — session revoked' });
    }
    if (stored.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Refresh token expired' });
    }

    const user = stored.user;
    if (!user.isActive) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'User is inactive' });

    // اتمیک: باطل کردن قدیمی + صدور جدید
    const newRaw = randomUUID() + '.' + randomUUID();
    await this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
      await tx.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: this.sha256(newRaw),
          expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 86400_000),
        },
      });
    });

    const roles = user.roles.map((ur) => ur.role);
    const accessToken = await this.issueAccessToken(user.id, user.username, roles.map((r) => r.name));
    return {
      accessToken,
      refreshToken: newRaw,
      user: { id: user.id, username: user.username, roles: roles.map((r) => r.name), mfaEnabled: user.mfaEnabled },
    };
  }

  async logout(rawToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.sha256(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /* ── MFA (TOTP) ── */

  async setupMfa(userId: string): Promise<{ otpauthUrl: string }> {
    const secret = authenticator.generateSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { mfaSecret: secret } });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return { otpauthUrl: authenticator.keyuri(user.username, 'Hotel ERP', secret) };
  }

  async verifyMfa(userId: string, code: string): Promise<{ mfaEnabled: boolean }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.mfaSecret) throw new UnauthorizedException({ code: 'MFA_INVALID', message: 'MFA not set up' });
    const valid = authenticator.verify({ token: code, secret: user.mfaSecret });
    if (!valid) throw new UnauthorizedException({ code: 'MFA_INVALID', message: 'Invalid TOTP code' });
    await this.prisma.user.update({ where: { id: userId }, data: { mfaEnabled: true } });
    return { mfaEnabled: true };
  }

  /* ── حسابرسی ── */

  async audit(userId: string | null, action: string, entity: string, entityId?: string, ip?: string): Promise<void> {
    await this.prisma.auditLog.create({
      data: { userId, action, entity, entityId, ip, userAgent: undefined },
    });
  }
}
