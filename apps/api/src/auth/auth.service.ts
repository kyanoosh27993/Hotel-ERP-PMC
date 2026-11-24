/**
 * auth.service.ts — Argon2id + JWT دسترسی کوتاه‌عمر + Refresh چرخشی با تشخیص استفاده مجدد
 * (قواعد امنیتی بخش ۵) + MFA توت‌پ نقش‌های حساس.
 */
import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'node:crypto';
import { randomBytes } from 'crypto';
import { argon2id, argon2Verify } from 'hash-wasm';
import { authenticator } from 'otplib';
import { PrismaService } from '../prisma.service';
import { CaptchaService } from './captcha.service';

export interface AuthenticatedUser {
  id: string;
  username: string;
  fullName: string;
  photoUrl?: string | null;
  position?: string | null;
  roles: string[];
  mfaEnabled: boolean;
}

/** وضعیت ورود: توکن‌ها + اطلاعات آخرین ورود برای کادر صفحهٔ ورود آسا */
export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: AuthenticatedUser;
  lastLogin: { at: Date | null; ip: string | null } | null;
}

const ACCESS_TTL_SECONDS = 900; // ۱۵ دقیقه
const REFRESH_TTL_DAYS = 14;
/** قفل‌شدگی پس از تلاش‌های ناموفق (مطابق پیام‌های آسا) */
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60_000;

@Injectable()
export class AuthService {
  /** نقشهٔ تلاش‌های ناموفق per username — حافظهٔ فرآیند (یک نمونه‌استقرار) */
  private failedAttempts = new Map<string, { count: number; lockedUntil: number }>();

  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService, private readonly captcha: CaptchaService) {}

  /* ── گذرواژه ── */

  /** Argon2id با پارامترهای OWASP — خروجی PHC استاندارد (سازگار با اعداد قبلی) */
  async hashPassword(plain: string): Promise<string> {
    return argon2id({
      password: plain,
      salt: randomBytes(16),
      parallelism: 1,
      iterations: 3,
      memorySize: 19456,
      hashLength: 32,
      outputType: 'encoded',
    });
  }

  async verifyPassword(digest: string, plain: string): Promise<boolean> {
    try {
      return await argon2Verify({ password: plain, hash: digest });
    } catch {
      return false; // هش ناسازگار/خراب → عدم تطابق
    }
  }

  /* ── ورود ── */

  async login(
    username: string,
    password: string,
    totpCode?: string,
    ctx?: { captchaId?: string; captchaText?: string; ip?: string },
  ): Promise<LoginResult> {
    // حالت تست (e2e): کپچا و قفل‌شدگی خاموش — در تولید پیش‌فرض روشن است
    const captchaEnabled = process.env.AUTH_CAPTCHA_REQUIRED !== 'false';

    if (captchaEnabled) {
      const lock = this.failedAttempts.get(username);
      if (lock && lock.lockedUntil > Date.now()) {
        await this.audit(null, 'LOGIN_LOCKED', 'User', username);
        throw new UnauthorizedException({
          code: 'LOCKED',
          message: 'دسترسی شما به این سامانه موقتاً مسدود شده است. لطفاً با مدیر سیستم تماس بگیرید.',
        });
      }
      try {
        this.captcha.verify(ctx?.captchaId ?? '', ctx?.captchaText ?? '');
      } catch {
        await this.recordFail(username);
        throw new BadRequestException({ code: 'CAPTCHA_MISMATCH', message: 'حروف امنیتی مطابقت ندارند.' });
      }
    }

    const user = await this.prisma.user.findUnique({
      where: { username },
      include: { roles: { include: { role: true } } },
    });
    const genericFail = { code: 'UNAUTHORIZED', message: 'Invalid username or password' };
    if (!user || !user.isActive) {
      await this.recordFail(username, captchaEnabled);
      await this.audit(null, 'LOGIN_FAILED', 'User', username);
      throw new UnauthorizedException(genericFail);
    }
    const ok = await this.verifyPassword(user.passwordHash, password);
    if (!ok) {
      await this.recordFail(username, captchaEnabled);
      await this.audit(user.id, 'LOGIN_FAILED', 'User', username);
      throw new UnauthorizedException(genericFail);
    }
    if (captchaEnabled) this.failedAttempts.delete(username);

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

    // U1 — ثبت «آخرین ورود» پیش‌تر از به‌روزرسانی، تا کادر صفحهٔ ورود نمایش داده شود
    const lastLogin = user.lastLoginAt ? { at: user.lastLoginAt, ip: user.lastLoginIp ?? null } : null;
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), lastLoginIp: ctx?.ip ?? null },
    });

    await this.audit(user.id, 'LOGIN', 'User', user.id);
    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        photoUrl: user.photoUrl,
        position: user.position,
        roles: roles.map((r) => r.name),
        mfaEnabled: user.mfaEnabled,
      },
      lastLogin,
    };
  }

  private async recordFail(username: string, enabled = true): Promise<void> {
    if (!enabled) return;
    const now = Date.now();
    const prev = this.failedAttempts.get(username);
    // ریست شمارنده فقط وقتی قفل قبلی تمام شده باشد (lockedUntil>0 و منقضی) — نه برای حالت شمارش عادی
    const expiredLock = !!prev && prev.lockedUntil > 0 && prev.lockedUntil < now;
    const count = expiredLock ? 1 : (prev?.count ?? 0) + 1;
    if (count >= MAX_FAILED_ATTEMPTS) {
      this.failedAttempts.set(username, { count, lockedUntil: now + LOCKOUT_MS });
    } else {
      this.failedAttempts.set(username, { count, lockedUntil: 0 });
    }
  }

  /** پروفایل نوار کاربر (نام کامل/عکس/سمت) برای GET /auth/me */
  async profile(userId: string): Promise<{ fullName: string; photoUrl?: string | null; position?: string | null }> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true, photoUrl: true, position: true },
    });
    return { fullName: u?.fullName ?? '', photoUrl: u?.photoUrl ?? null, position: u?.position ?? null };
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
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        photoUrl: user.photoUrl,
        position: user.position,
        roles: roles.map((r) => r.name),
        mfaEnabled: user.mfaEnabled,
      },
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
