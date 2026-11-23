/**
 * marketplace.controller.ts — موج ۵ / فاز ۱۲ (F12-T4): API Marketplace.
 * کلید API مشتریان (ذخیرهٔ SHA-256 — متن آشکار فقط یک‌بار نمایش)، محدودسازی نرخ در هر دقیقه،
 * و سه مسیر عمومی نمونه (availability / rates / reservations) با هدر x-api-key.
 */
import { BadRequestException, Controller, ForbiddenException, Get, Injectable, Module, NotFoundException, Post, Body, Param, Req, UnauthorizedException, UseGuards, SetMetadata } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createHash, randomBytes } from 'node:crypto';
import { Reflector } from '@nestjs/core';
import { AuthenticatedRequest } from '../common/authenticated.request';
import { RequirePermissions } from '../iam/permissions.guard';
import { PERMISSIONS } from '../iam/permissions';
import { PrismaService } from '../prisma.service';
import { Public } from '../common/public.decorator';
import { nextDocSeq } from '../common/doc-seq';

const MARKETPLACE_SCOPES = ['availability', 'rates', 'reservations'] as const;
export type MarketplaceScope = (typeof MARKETPLACE_SCOPES)[number];

// ── محدودسازی نرخ در حافظه (هر نمونهٔ سرویس) — پنجرهٔ ۶۰ ثانیه‌ای ──
class RateBucket {
  count = 0;
  windowStart = Date.now();
}

@Injectable()
export class MarketplaceService {
  private buckets = new Map<string, RateBucket>();

  constructor(private readonly prisma: PrismaService) {}

  static hashKey(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }

  /** ساخت کلید مشتری — متن آشکار فقط در پاسخ همین فراخوانی برمی‌گردد */
  async createClient(input: { name: string; rateLimitPerMin?: number; scopes?: string[]; userId?: string }) {
    const scopes = input.scopes ?? [...MARKETPLACE_SCOPES];
    for (const s of scopes) {
      if (!MARKETPLACE_SCOPES.includes(s as MarketplaceScope)) {
        throw new BadRequestException(`scope نامعتبر: ${s} — مجازها: ${MARKETPLACE_SCOPES.join(', ')}`);
      }
    }
    const key = 'hk_' + randomBytes(24).toString('base64url');
    const prefix = key.slice(0, 12);
    const saved = await this.prisma.apiClient.create({
      data: {
        name: input.name,
        keyPrefix: prefix,
        apiKeyHash: MarketplaceService.hashKey(key),
        scopes,
        rateLimitPerMin: input.rateLimitPerMin ?? 60,
        createdById: input.userId,
      },
    });
    await this.prisma.auditLog.create({
      data: { userId: input.userId, action: 'API_CLIENT_CREATED', entity: 'ApiClient', entityId: saved.id, reason: `${input.name} — scopes ${scopes.join('+')}` },
    });
    return {
      data: {
        id: saved.id, name: saved.name, keyPrefix: saved.keyPrefix, scopes: saved.scopes as string[],
        rateLimitPerMin: saved.rateLimitPerMin,
        apiKey: key, // ⚠️ فقط همین یک‌بار — هش ذخیره شده است
        note: 'کلید را همین‌جا ذخیره کنید؛ دوباره نمایش داده نمی‌شود.',
      },
    };
  }

  async listClients() {
    const rows = await this.prisma.apiClient.findMany({ orderBy: { createdAt: 'desc' } });
    return { data: rows.map((r) => ({ id: r.id, name: r.name, keyPrefix: r.keyPrefix, scopes: r.scopes, rateLimitPerMin: r.rateLimitPerMin, active: r.active, lastUsedAt: r.lastUsedAt })) };
  }

  async toggleClient(id: string, userId?: string) {
    const row = await this.prisma.apiClient.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('مشتری یافت نشد');
    const updated = await this.prisma.apiClient.update({ where: { id }, data: { active: !row.active } });
    await this.prisma.auditLog.create({
      data: { userId, action: updated.active ? 'API_CLIENT_ENABLED' : 'API_CLIENT_DISABLED', entity: 'ApiClient', entityId: id },
    });
    return { data: { id: updated.id, active: updated.active } };
  }

  /** احراز کلید + محدودسازی نرخ — برای گارد عمومی */
  async authenticate(key: string): Promise<{ id: string; name: string; scopes: string[]; rateLimitPerMin: number }> {
    if (!key || !key.startsWith('hk_')) throw new UnauthorizedException('کلید API نامعتبر است');
    const hash = MarketplaceService.hashKey(key);
    const client = await this.prisma.apiClient.findUnique({ where: { keyPrefix: key.slice(0, 12) } });
    if (!client || client.apiKeyHash !== hash) throw new UnauthorizedException('کلید API نامعتبر است');
    if (!client.active) throw new ForbiddenException('کلید غیرفعال است');
    const b = this.buckets.get(client.id) ?? new RateBucket();
    const now = Date.now();
    if (now - b.windowStart > 60_000) { b.windowStart = now; b.count = 0; }
    b.count++;
    this.buckets.set(client.id, b);
    if (b.count > client.rateLimitPerMin) {
      throw new BadRequestException({
        code: 'RATE_LIMITED',
        message: `بیش از حد مجاز ${client.rateLimitPerMin} درخواست در دقیقه — بعداً تلاش کنید`,
      });
    }
    await this.prisma.apiClient.update({ where: { id: client.id }, data: { lastUsedAt: new Date() } });
    return { id: client.id, name: client.name, scopes: client.scopes as string[], rateLimitPerMin: client.rateLimitPerMin };
  }
}

// ── گارد کلید API + برچسب scope لازم ──
export const API_SCOPE_KEY = 'marketplace:scope';

@Injectable()
export class ApiKeyGuard {
  constructor(private readonly svc: MarketplaceService, private readonly reflector: Reflector) {}

  async canActivate(ctx: any): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const scope = this.reflector.get<string>(API_SCOPE_KEY, ctx.getHandler());
    const key = req.headers['x-api-key'];
    const client = await this.svc.authenticate(String(key ?? ''));
    if (scope && !client.scopes.includes(scope)) {
      throw new ForbiddenException(`کلید شما scope «${scope}» ندارد`);
    }
    (req as any).apiClient = client;
    return true;
  }
}

@Controller('marketplace/clients')
@ApiTags('marketplace')
@ApiBearerAuth()
export class MarketplaceController {
  constructor(private readonly svc: MarketplaceService) {}

  private uid(req: AuthenticatedRequest): string | undefined {
    return req.user?.id;
  }

  @Post()
  @RequirePermissions(PERMISSIONS.MARKETPLACE_MANAGE)
  async create(@Body() dto: { name?: string; rateLimitPerMin?: number; scopes?: string[] }, @Req() req: AuthenticatedRequest) {
    if (!dto.name || dto.name.trim().length < 2) throw new BadRequestException('نام مشتری لازم است');
    return this.svc.createClient({ name: dto.name.trim(), rateLimitPerMin: dto.rateLimitPerMin, scopes: dto.scopes, userId: this.uid(req) });
  }

  @Get()
  @RequirePermissions(PERMISSIONS.MARKETPLACE_MANAGE)
  list(@Req() req: AuthenticatedRequest) {
    void this.uid(req);
    return this.svc.listClients();
  }

  @Post(':id/toggle')
  @RequirePermissions(PERMISSIONS.MARKETPLACE_MANAGE)
  toggle(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.svc.toggleClient(id, this.uid(req));
  }
}

// ── مسیرهای عمومی نمونه (کلید مشتری — بدون JWT) ──
@Controller('public-api/v1')
@ApiTags('public-api')
@Public() // احراز این مسیرها با x-api-key است نه JWT — گارد سراسری معاف می‌شود
@UseGuards(ApiKeyGuard)
export class PublicApiController {
  constructor(private readonly svc: MarketplaceService, private readonly prisma: PrismaService) {}

  /** مستندات عمومی — بدون شمارش نرخ هم می‌آید ولی برای یکدستی داخل گارد است */
  @Get('_docs')
  @SetMetadata(API_SCOPE_KEY, 'availability')
  docs() {
    return {
      data: {
        name: 'Hotel ERP Public API',
        version: '1.0',
        auth: 'هدر x-api-key با کلید مشتری (از /marketplace/clients)',
        rateLimit: 'به‌ازای کلید — پیش‌فرض ۶۰ درخواست در دقیقه',
        endpoints: [
          { method: 'GET', path: '/api/v1/public-api/v1/availability', scope: 'availability', desc: 'وضعیت اتاق‌ها به تفکیک status' },
          { method: 'GET', path: '/api/v1/public-api/v1/rates', scope: 'rates', desc: 'انواع اتاق و نرخ پایهٔ شب' },
          { method: 'POST', path: '/api/v1/public-api/v1/reservations', scope: 'reservations', desc: 'ثبت رزرو تلفنی {guestName, roomTypeId, from, to, nights}' },
        ],
      },
    };
  }

  @Get('availability')
  @SetMetadata(API_SCOPE_KEY, 'availability')
  async availability() {
    const rows = await this.prisma.room.groupBy({ by: ['status'], _count: { _all: true } });
    return { data: { rooms: rows.map((r) => ({ status: r.status, count: r._count._all })) } };
  }

  @Get('rates')
  @SetMetadata(API_SCOPE_KEY, 'rates')
  async rates() {
    const rows = await this.prisma.roomType.findMany({ select: { code: true, nameFa: true, nameEn: true, baseRateRials: true } });
    return { data: rows.map((r) => ({ code: r.code, nameFa: r.nameFa, nameEn: r.nameEn, baseNightRateRials: r.baseRateRials.toString() })) };
  }

  @Post('reservations')
  @SetMetadata(API_SCOPE_KEY, 'reservations')
  async reserve(@Body() dto: { guestName?: string; roomTypeId?: string; from?: string; nights?: number }, @Req() req: any) {
    if (!dto.guestName || !dto.roomTypeId || !dto.from || !dto.nights) {
      throw new BadRequestException('guestName، roomTypeId، from و nights لازم است');
    }
    const type = await this.prisma.roomType.findUnique({ where: { id: dto.roomTypeId } });
    if (!type) throw new NotFoundException('نوع اتاق یافت نشد');
    const nights = Math.max(1, Math.min(30, dto.nights));
    const checkIn = new Date(dto.from + 'T00:00:00.000Z');
    const checkOut = new Date(checkIn);
    checkOut.setUTCDate(checkOut.getUTCDate() + nights);
    // همان قواعد پذیرش — رزرو تأییدشده با منبع ONLINE و ردپای کلید مشتری
    const created = await this.prisma.$transaction(async (tx) => {
      const seq = await nextDocSeq(tx, 'reservation');
      return tx.reservation.create({
        data: {
          code: `RSV-${new Date().getUTCFullYear()}-${String(seq).padStart(6, '0')}`,
          roomTypeId: dto.roomTypeId!,
          guestName: dto.guestName!.slice(0, 120),
          checkIn,
          checkOut,
          nights,
          totalRials: type.baseRateRials * BigInt(nights),
          status: 'CONFIRMED',
          source: 'ONLINE',
          idempotencyKey: `public-api-${randomBytes(12).toString('hex')}`,
        },
      });
    });
    await this.prisma.auditLog.create({
      data: { action: 'API_RESERVATION_CREATED', entity: 'Reservation', entityId: created.id, reason: `client:${req.apiClient.name}` },
    });
    return { data: { id: created.id, code: created.code, status: created.status, roomType: type.code, totalRials: created.totalRials.toString() } };
  }
}

@Module({
  controllers: [MarketplaceController, PublicApiController],
  providers: [MarketplaceService, ApiKeyGuard],
  exports: [MarketplaceService],
})
export class MarketplaceModule {}
