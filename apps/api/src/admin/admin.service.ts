/**
 * admin.service.ts — مدیریت کاربران، گروه‌های کاربری و ماتریس دسترسی (نسخهٔ ۳٫۳)
 * درخواست کارفرما:
 *  ۱) گروه کاربری (نقش) بساز/ویرایش کن و کاربران را به آن اضافه/کم کن (الگوی عکس ۱ و ۲-۱).
 *  ۲) برای هر گروه، دسترسی هر جزء برنامه را جداگانه تنظیم کن (الگوی عکس ۲-۲).
 *  ۳) مشخصات هر کاربر — حتی نام کاربری و رمز عبور — قابل ویرایش باشد (الگوی عکس ۳-۱/۳-۲).
 * قواعد قرارداد: کنترل دسترسی سمت سرور، حسابرسی تغییرناپذیر، عدم قفل‌شدگی مدیر.
 */
import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuthService } from '../auth/auth.service';
import { PERMISSIONS, PERMISSION_CATALOG, MODULE_GROUPS } from '../iam/permissions';
import type {
  CreateUserDto, MemberDto, SetRolePermissionsDto, UpdateRoleDto, UpdateUserDto, CreateRoleDto,
} from './admin.dto';

/** نقش‌های سیستمی seed — حذف/تغییر نام ممنوع؛ ماتریسِ آن‌ها فقط با آگاهی (matrixOverridden) بازنویسی می‌شود */
const SYSTEM_ROLE_NAMES = Object.freeze([
  'admin', 'accountant', 'approver', 'front_desk', 'housekeeper', 'cashier', 'chef', 'storekeeper',
]);

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService, private readonly auth: AuthService) {}

  /* ── کاربران ── */

  async listUsers() {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      include: { roles: { include: { role: true } } },
    });
    return users.map((u) => this.mapUser(u));
  }

  async createUser(dto: CreateUserDto, actorId: string) {
    await this.assertUniqueUsernameEmail(dto.username, dto.email ?? undefined);
    const roles = await this.resolveRoles(dto.roleIds ?? []);
    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        passwordHash: await this.auth.hashPassword(dto.password),
        fullName: dto.fullName,
        email: dto.email ?? null,
        position: dto.position ?? null,
        roles: { create: roles.map((r) => ({ roleId: r.id })) },
      },
      include: { roles: { include: { role: true } } },
    });
    await this.audit(actorId, 'USER_CREATED', 'User', user.id, { username: user.username, roles: roles.map((r) => r.name) });
    return this.mapUser(user);
  }

  async updateUser(id: string, dto: UpdateUserDto, actorId: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, include: { roles: { include: { role: true } } } });
    if (!user) throw new NotFoundException({ code: 'NOT_FOUND', message: 'کاربر یافت نشد' });

    if (dto.email !== undefined && dto.email !== user.email) {
      const clash = dto.email && (await this.prisma.user.findFirst({ where: { email: dto.email, NOT: { id } } }));
      if (clash) throw new ConflictException({ code: 'EMAIL_TAKEN', message: 'این ایمیل برای کاربر دیگری ثبت شده است' });
    }

    const data: Record<string, unknown> = {};
    if (dto.username !== undefined && dto.username !== user.username) {
      const clash = await this.prisma.user.findUnique({ where: { username: dto.username } });
      if (clash) throw new ConflictException({ code: 'USERNAME_TAKEN', message: 'این نام کاربری قبلاً ثبت شده است' });
      data.username = dto.username;
      await this.audit(actorId, 'USER_USERNAME_CHANGED', 'User', id, { from: user.username, to: dto.username });
    }
    if (dto.fullName !== undefined) data.fullName = dto.fullName;
    if (dto.email !== undefined) data.email = dto.email ?? null;
    if (dto.position !== undefined) data.position = dto.position ?? null;
    if (dto.password !== undefined) {
      data.passwordHash = await this.auth.hashPassword(dto.password);
      await this.audit(actorId, 'USER_PASSWORD_RESET', 'User', id, { by: actorId });
    }

    // حفاظت ضدقفل‌شدگی: آخرین کاربر فعالِ گروه admin را نمی‌توان غیرفعال کرد
    if (dto.isActive === false && user.isActive) {
      if (user.id === actorId) {
        throw new BadRequestException({ code: 'SELF_DEACTIVATE', message: 'غیرفعال‌کردن حساب خودتان مجاز نیست' });
      }
      const hasAdmin = user.roles.some((ur) => ur.role.name === 'admin');
      if (hasAdmin) {
        const activeAdmins = await this.prisma.userRole.count({
          where: { role: { name: 'admin' }, user: { isActive: true } },
        });
        if (activeAdmins <= 1) {
          throw new BadRequestException({ code: 'LAST_ADMIN', message: 'این تنها کاربر فعالِ گروه «مدیر سیستم» است — ابتدا مدیر دیگری تعیین کنید' });
        }
      }
    }
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    // جایگزینی کامل گروه‌ها
    let roleNames = user.roles.map((ur) => ur.role.name);
    if (dto.roleIds !== undefined) {
      const roles = await this.resolveRoles(dto.roleIds);
      await this.prisma.userRole.deleteMany({ where: { userId: id } });
      if (roles.length) {
        await this.prisma.userRole.createMany({ data: roles.map((r) => ({ userId: id, roleId: r.id })) });
      }
      roleNames = roles.map((r) => r.name);
      await this.audit(actorId, 'USER_ROLES_CHANGED', 'User', id, { roles: roleNames });
    }

    // غیرفعال‌سازی/تغییر رمز → همهٔ نشست‌های فعال باطل می‌شود (قاعدهٔ امنیتی)
    const revokeSessions = dto.password !== undefined || dto.isActive === false;
    if (revokeSessions) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    if (dto.isActive === false) await this.audit(actorId, 'USER_DEACTIVATED', 'User', id, { by: actorId });
    else if (dto.isActive === true) await this.audit(actorId, 'USER_ACTIVATED', 'User', id, { by: actorId });

    const updated = await this.prisma.user.update({
      where: { id },
      data,
      include: { roles: { include: { role: true } } },
    });
    return this.mapUser(updated);
  }

  /** حذف = غیرفعال‌سازی (اسناد مالی/حسابرسی به کاربر ارجاع دارند — حذف فیزیکی ممنوع، قرارداد §4) */
  async deactivateUser(id: string, actorId: string) {
    return this.updateUser(id, { isActive: false }, actorId);
  }

  /* ── گروه‌های کاربری (نقش‌ها) ── */

  async listRoles() {
    const roles = await this.prisma.role.findMany({
      orderBy: { name: 'asc' },
      include: { permissions: { include: { permission: true } }, users: true },
    });
    return roles.map((r) => this.mapRole(r));
  }

  async createRole(dto: CreateRoleDto, actorId: string) {
    const clash = await this.prisma.role.findUnique({ where: { name: dto.name } });
    if (clash) throw new ConflictException({ code: 'ROLE_NAME_TAKEN', message: 'گروهی با این نام وجود دارد' });
    const perms = await this.validateCodes(dto.permissionCodes ?? []);
    const created = await this.prisma.role.create({
      data: {
        name: dto.name,
        displayNameFa: dto.displayNameFa,
        displayNameEn: dto.displayNameEn ?? dto.name,
        sensitiveMfa: dto.sensitiveMfa ?? false,
        isSystem: false,
        permissions: { create: perms.map((p) => ({ permissionId: p.id })) },
      },
    });
    const role = await this.prisma.role.findUniqueOrThrow({
      where: { id: created.id },
      include: { permissions: { include: { permission: true } }, users: true },
    });
    await this.audit(actorId, 'ROLE_CREATED', 'Role', role.id, { name: role.name, count: perms.length });
    return this.mapRole(role);
  }

  async updateRole(id: string, dto: UpdateRoleDto, actorId: string) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException({ code: 'NOT_FOUND', message: 'گروه یافت نشد' });
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined && dto.name !== role.name) {
      if (role.isSystem || SYSTEM_ROLE_NAMES.includes(role.name)) {
        throw new BadRequestException({ code: 'SYSTEM_ROLE', message: 'نام گروه سیستمی قابل تغییر نیست' });
      }
      const clash = await this.prisma.role.findUnique({ where: { name: dto.name } });
      if (clash) throw new ConflictException({ code: 'ROLE_NAME_TAKEN', message: 'گروهی با این نام وجود دارد' });
      data.name = dto.name;
    }
    if (dto.displayNameFa !== undefined) data.displayNameFa = dto.displayNameFa;
    if (dto.displayNameEn !== undefined) data.displayNameEn = dto.displayNameEn;
    if (dto.sensitiveMfa !== undefined) data.sensitiveMfa = dto.sensitiveMfa;
    const updated = await this.prisma.role.update({ where: { id }, data });
    await this.audit(actorId, 'ROLE_UPDATED', 'Role', id, { fields: Object.keys(data) });
    return this.mapRole({ ...updated, permissions: [], users: [] });
  }

  async deleteRole(id: string, actorId: string) {
    const role = await this.prisma.role.findUnique({ where: { id }, include: { users: true } });
    if (!role) throw new NotFoundException({ code: 'NOT_FOUND', message: 'گروه یافت نشد' });
    if (role.isSystem || role.name === 'admin') {
      throw new ForbiddenException({ code: 'SYSTEM_ROLE', message: 'گروه سیستمی قابل حذف نیست — برای نقش‌های سفارشی گروه بسازید' });
    }
    if (role.users.length) {
      throw new ConflictException({ code: 'ROLE_IN_USE', message: `این گروه ${role.users.length} کاربر دارد — ابتدا کاربران را منتقل کنید` });
    }
    await this.prisma.role.delete({ where: { id } });
    await this.audit(actorId, 'ROLE_DELETED', 'Role', id, { name: role.name });
    return { deleted: true, id };
  }

  /**
   * ماتریس دسترسی گروه — جایگزینی کامل مجوزها (الگوی عکس ۲-۲).
   * پس از این تغییر seed ماتریس این نقش را بازنویسی نمی‌کند (matrixOverridden=true).
   * حفاظت ضدقفل‌شدگی: گروه admin هرگز users.manage را از دست نمی‌دهد.
   */
  async setRolePermissions(id: string, dto: SetRolePermissionsDto, actorId: string) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException({ code: 'NOT_FOUND', message: 'گروه یافت نشد' });
    if (role.name === 'admin' && !dto.codes.includes(PERMISSIONS.USERS_MANAGE)) {
      throw new BadRequestException({ code: 'LOCKOUT_GUARD', message: 'گروه «مدیر سیستم» باید همیشه مجوز مدیریت کاربران را داشته باشد' });
    }
    const perms = await this.validateCodes(dto.codes);
    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleId: id } }),
      this.prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: id, permissionId: p.id })) }),
      this.prisma.role.update({ where: { id }, data: { matrixOverridden: true } }),
    ]);
    await this.audit(actorId, 'ROLE_MATRIX_CHANGED', 'Role', id, { count: perms.length, codes: dto.codes.sort() });
    const updated = await this.prisma.role.findUniqueOrThrow({
      where: { id },
      include: { permissions: { include: { permission: true } }, users: true },
    });
    return this.mapRole(updated);
  }

  async listRoleMembers(id: string) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException({ code: 'NOT_FOUND', message: 'گروه یافت نشد' });
    const members = await this.prisma.userRole.findMany({
      where: { roleId: id },
      include: { user: true },
      orderBy: { assignedAt: 'asc' },
    });
    return members.map((m) => ({
      id: m.user.id,
      username: m.user.username,
      fullName: m.user.fullName,
      isActive: m.user.isActive,
      lastLoginAt: m.user.lastLoginAt,
      assignedAt: m.assignedAt,
    }));
  }

  /** افزودن کاربر به گروه (الگوی عکس ۲-۱) */
  async addMember(roleId: string, dto: MemberDto, actorId: string) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException({ code: 'NOT_FOUND', message: 'گروه یافت نشد' });
    const user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!user) throw new NotFoundException({ code: 'NOT_FOUND', message: 'کاربر یافت نشد' });
    const existing = await this.prisma.userRole.findUnique({
      where: { userId_roleId: { userId: dto.userId, roleId } },
    });
    if (existing) return this.listRoleMembers(roleId);
    await this.prisma.userRole.create({ data: { userId: dto.userId, roleId } });
    await this.audit(actorId, 'ROLE_MEMBER_ADDED', 'Role', roleId, { user: user.username });
    return this.listRoleMembers(roleId);
  }

  async removeMember(roleId: string, userId: string, actorId: string) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException({ code: 'NOT_FOUND', message: 'گروه یافت نشد' });
    const existing = await this.prisma.userRole.findUnique({
      where: { userId_roleId: { userId, roleId } },
    });
    if (!existing) return this.listRoleMembers(roleId);
    // حفاظت ضدقفل‌شدگی: آخرین عضو فعالِ گروه admin را نمی‌توان حذف کرد
    if (role.name === 'admin') {
      const target = await this.prisma.user.findUnique({ where: { id: userId } });
      const activeAdmins = await this.prisma.userRole.count({
        where: { role: { name: 'admin' }, user: { isActive: true } },
      });
      if (target?.isActive && activeAdmins <= 1) {
        throw new BadRequestException({ code: 'LAST_ADMIN', message: 'این تنها کاربر فعالِ گروه «مدیر سیستم» است' });
      }
    }
    await this.prisma.userRole.delete({ where: { userId_roleId: { userId, roleId } } });
    await this.audit(actorId, 'ROLE_MEMBER_REMOVED', 'Role', roleId, { user: userId });
    return this.listRoleMembers(roleId);
  }

  /** کاتالوگ دسترسی‌ها گروه‌بندی‌شده بر اساس ماژول — برای ماتریس UI */
  permissionCatalog() {
    const faByCode = new Map(PERMISSION_CATALOG.map((p) => [p.code, p]));
    return MODULE_GROUPS.map((g) => ({
      key: g.key,
      fa: g.fa,
      en: g.en,
      items: g.codes.map((code) => ({
        code,
        fa: faByCode.get(code)?.fa ?? code,
        en: faByCode.get(code)?.en ?? code,
      })),
    }));
  }

  /* ── ابزار ── */

  private async validateCodes(codes: string[]) {
    const known = new Set<string>(Object.values(PERMISSIONS));
    const unknown = codes.filter((c) => !known.has(c));
    if (unknown.length) {
      throw new BadRequestException({ code: 'UNKNOWN_PERMISSION', message: 'مجوز ناشناخته: ' + unknown.join(', ') });
    }
    return this.prisma.permission.findMany({ where: { code: { in: codes } } });
  }

  private async resolveRoles(roleIds: string[]) {
    if (!roleIds.length) return [];
    const roles = await this.prisma.role.findMany({ where: { id: { in: roleIds } } });
    if (roles.length !== roleIds.length) {
      throw new BadRequestException({ code: 'UNKNOWN_ROLE', message: 'یک یا چند گروه یافت نشد' });
    }
    return roles;
  }

  private async assertUniqueUsernameEmail(username: string, email?: string) {
    const clashUser = await this.prisma.user.findUnique({ where: { username } });
    if (clashUser) throw new ConflictException({ code: 'USERNAME_TAKEN', message: 'این نام کاربری قبلاً ثبت شده است' });
    if (email) {
      const clashEmail = await this.prisma.user.findFirst({ where: { email } });
      if (clashEmail) throw new ConflictException({ code: 'EMAIL_TAKEN', message: 'این ایمیل برای کاربر دیگری ثبت شده است' });
    }
  }

  private mapUser(u: {
    id: string; username: string; fullName: string; email: string | null; position: string | null;
    isActive: boolean; mfaEnabled: boolean; lastLoginAt: Date | null; createdAt: Date;
    roles: Array<{ role: { id: string; name: string; displayNameFa: string; displayNameEn: string; sensitiveMfa: boolean } }>;
  }) {
    return {
      id: u.id,
      username: u.username,
      fullName: u.fullName,
      email: u.email,
      position: u.position,
      isActive: u.isActive,
      mfaEnabled: u.mfaEnabled,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
      roles: u.roles.map((ur) => ({
        id: ur.role.id,
        name: ur.role.name,
        displayNameFa: ur.role.displayNameFa,
        displayNameEn: ur.role.displayNameEn,
        sensitiveMfa: ur.role.sensitiveMfa,
      })),
    };
  }

  private mapRole(r: {
    id: string; name: string; displayNameFa: string; displayNameEn: string; sensitiveMfa: boolean;
    isSystem: boolean; matrixOverridden: boolean;
    permissions?: Array<{ permission: { code: string } }>;
    users?: unknown[];
  }) {
    return {
      id: r.id,
      name: r.name,
      displayNameFa: r.displayNameFa,
      displayNameEn: r.displayNameEn,
      sensitiveMfa: r.sensitiveMfa,
      isSystem: r.isSystem,
      matrixOverridden: r.matrixOverridden,
      permissionCodes: (r.permissions ?? []).map((rp) => rp.permission.code),
      memberCount: (r.users ?? []).length,
    };
  }

  private audit(userId: string, action: string, entity: string, entityId: string, meta?: Record<string, unknown>) {
    return this.prisma.auditLog.create({
      data: {
        userId,
        action,
        entity,
        entityId,
        afterJson: meta ? (meta as object) : undefined,
      },
    });
  }
}
