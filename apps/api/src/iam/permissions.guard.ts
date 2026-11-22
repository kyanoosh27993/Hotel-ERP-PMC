import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma.service';

export const PERMISSIONS_KEY = 'requiredPermissions';
export const PERMISSIONS_ANY_KEY = 'anyOfPermissions';

/** دکوراتور مجوز: @RequirePermissions(PERMISSIONS.JOURNAL_VIEW) — همهٔ مجوزها لازم است */
export const RequirePermissions = (...perms: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSIONS_KEY, perms);

/** دکوراتور مجوز «یکی از»: @RequireAnyPermissions(A, B) — حداقل یکی کافی است */
export const RequireAnyPermissions = (...perms: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSIONS_ANY_KEY, perms);

/**
 * PermissionsGuard — کنترل دسترسی سمت سرور (RBAC؛ قرارداد بخش ۵).
 * مجوزهای کاربر از پایگاه داده خوانده می‌شود (هرگز فقط UI).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService, private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const anyOf = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_ANY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if ((!required || required.length === 0) && (!anyOf || anyOf.length === 0)) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as { id: string } | undefined;
    if (!user?.id) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'No authenticated user' });

    const perms = await this.getUserPermissions(user.id);
    const okAll = !required || required.length === 0 || required.every((p) => perms.has(p));
    const okAny = !anyOf || anyOf.length === 0 || anyOf.some((p) => perms.has(p));
    if (!(okAll && okAny)) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have permission for this action' });
    return true;
  }

  async getUserPermissions(userId: string): Promise<Set<string>> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    const set = new Set<string>();
    for (const ur of userRoles) {
      for (const rp of ur.role.permissions) set.add(rp.permission.code);
    }
    return set;
  }
}
