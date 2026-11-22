/**
 * jwt-auth.guard.ts — گارد دستی JWT (بدون passport): هدر Bearer → verify → req.user
 */
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { IS_PUBLIC_KEY } from '../common/public.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers['authorization'];
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Missing bearer token' });
    }
    const token = header.slice(7).trim();
    let payload: { sub: string; username: string; roles: string[]; typ?: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Invalid or expired token' });
    }
    if (payload.typ && payload.typ !== 'access') {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Wrong token type' });
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, username: true, isActive: true },
    });
    if (!user?.isActive) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'User is inactive' });
    }
    request.user = { id: user.id, username: user.username, roles: payload.roles ?? [] };
    return true;
  }
}
