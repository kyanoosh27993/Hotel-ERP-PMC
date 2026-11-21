import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** CurrentUser() — تزریق کاربر احرازشده از req.user (تنظیم‌شده توسط JwtAuthGuard) */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): { id: string; username: string; roles: string[] } | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
