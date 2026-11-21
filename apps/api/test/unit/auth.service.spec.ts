/**
 * auth.service.spec.ts — Argon2id + چرخش refresh با تشخیص استفاده مجدد + MFA (بدون DB واقعی).
 */
import { AuthService } from '../../src/auth/auth.service';
import { authenticator } from 'otplib';
import type { PrismaService } from '../../src/prisma.service';
import type { JwtService } from '@nestjs/jwt';

function makePrismaMock() {
  const refreshTokens: Array<{ id: number; userId: string; tokenHash: string; expiresAt: Date; revokedAt: Date | null }> = [];
  let rtSeq = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    refreshToken: {
      create: jest.fn(async ({ data }: { data: { userId: string; tokenHash: string; expiresAt: Date } }) => {
        rtSeq += 1;
        refreshTokens.push({ id: rtSeq, userId: data.userId, tokenHash: data.tokenHash, expiresAt: data.expiresAt, revokedAt: null });
        return { id: rtSeq, ...data };
      }),
      findUnique: jest.fn(async ({ where }: { where: { tokenHash: string } }) => {
        const t = refreshTokens.find((x) => x.tokenHash === where.tokenHash);
        // include user همان‌طور که سرویس انتظار دارد (include: { user: {...roles} })
        return t ? { ...t, user: ADMIN } : null;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: number }; data: { revokedAt: Date } }) => {
        const t = refreshTokens.find((x) => x.id === where.id);
        if (t) t.revokedAt = data.revokedAt;
        return t;
      }),
      updateMany: jest.fn(async ({ where, data }: { where: { userId?: string; revokedAt: null }; data: { revokedAt: Date } }) => {
        for (const t of refreshTokens) {
          if (where.userId && t.userId === where.userId && t.revokedAt === null) t.revokedAt = data.revokedAt;
          if (!where.userId && where.revokedAt === null && t.tokenHash === (where as { tokenHash?: string }).tokenHash) t.revokedAt = data.revokedAt;
        }
        return { count: 1 };
      }),
    },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  // $transaction بعد از ساخت آبجکت (جلوگیری از مرجع حلقوی در initializer)
  prisma.$transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
  return { prisma, refreshTokens };
}

function makeJwtMock() {
  return {
    signAsync: jest.fn(async (payload: object) => `jwt.${JSON.stringify(payload)}`),
    verifyAsync: jest.fn(),
  };
}

const ADMIN = {
  id: 'u-1',
  username: 'admin',
  passwordHash: '', // در beforeEach با Argon2id واقعی پر می‌شود
  fullName: 'Admin',
  isActive: true,
  mfaSecret: 'JBSWY3DPEHPK3PXP',
  mfaEnabled: true,
  roles: [{ role: { id: 'r1', name: 'admin', sensitiveMfa: true } }],
};

describe('AuthService — ورود و چرخش توکن', () => {
  let service: AuthService;
  let prismaMock: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prismaMock = makePrismaMock();
    const svc = new AuthService(prismaMock.prisma as unknown as PrismaService, makeJwtMock() as unknown as JwtService);
    ADMIN.passwordHash = await svc.hashPassword('ChangeMe_Str0ng!');
    service = svc;
    // توجه: jest.clearAllMocks() اینجا نباید صدا شود — mockها در هر تست تازه‌اند و clear پیاده‌سازی‌ها را می‌زد
    prismaMock.prisma.user.findUnique.mockImplementation(async ({ where }: { where: { username?: string } }) =>
      where.username === 'admin' ? ADMIN : null);
  });

  it('Argon2id: هش و صحت‌سنجی گذرواژه', async () => {
    expect(ADMIN.passwordHash.startsWith('$argon2')).toBe(true);
    expect(await service.verifyPassword(ADMIN.passwordHash, 'ChangeMe_Str0ng!')).toBe(true);
    expect(await service.verifyPassword(ADMIN.passwordHash, 'wrong-password')).toBe(false);
  });

  it('ورود موفق با TOTP صحیح → access + refresh', async () => {
    const totp = authenticator.generate(ADMIN.mfaSecret as string);
    const result = await service.login('admin', 'ChangeMe_Str0ng!', totp);
    expect(result.user.roles).toContain('admin');
    expect(result.refreshToken).toBeTruthy();
  });

  it('گذرواژه نادرست → UNAUTHORIZED (پیام عمومی بدون افشای وجود کاربر)', async () => {
    const totp = authenticator.generate(ADMIN.mfaSecret as string);
    await expect(service.login('admin', 'wrong-password', totp)).rejects.toMatchObject({
      response: { code: 'UNAUTHORIZED' },
    });
    expect(prismaMock.prisma.auditLog.create).toHaveBeenCalled();
  });

  it('نقش حساس بدون TOTP → MFA_REQUIRED', async () => {
    await expect(service.login('admin', 'ChangeMe_Str0ng!')).rejects.toMatchObject({
      response: { code: 'MFA_REQUIRED' },
    });
  });

  it('TOTP نادرست → MFA_INVALID و ثبت در حسابرسی', async () => {
    await expect(service.login('admin', 'ChangeMe_Str0ng!', '000000')).rejects.toMatchObject({
      response: { code: 'MFA_INVALID' },
    });
    expect(prismaMock.prisma.auditLog.create).toHaveBeenCalled();
  });

  it('چرخش refresh: توکن جدید صادر و توکن قبلی باطل می‌شود', async () => {
    const totp = authenticator.generate(ADMIN.mfaSecret as string);
    const first = await service.login('admin', 'ChangeMe_Str0ng!', totp);
    const rotated = await service.rotateRefreshToken(first.refreshToken);
    expect(rotated.refreshToken).not.toBe(first.refreshToken);

    // استفاده مجدد از توکن قدیمی → تشخیص سرقت و ابطال کل زنجیره
    await expect(service.rotateRefreshToken(first.refreshToken)).rejects.toMatchObject({
      response: { code: 'UNAUTHORIZED' },
    });
    const allRevoked = prismaMock.refreshTokens.every((t) => t.revokedAt !== null);
    expect(allRevoked).toBe(true);
  });

  it('refresh ناموجود → UNAUTHORIZED', async () => {
    await expect(service.rotateRefreshToken('nonexistent.token.value')).rejects.toMatchObject({
      response: { code: 'UNAUTHORIZED' },
    });
  });
});
