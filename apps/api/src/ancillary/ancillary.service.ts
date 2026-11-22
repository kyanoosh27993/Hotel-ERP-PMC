/**
 * ancillary.service.ts — فاز ۱۰ (موج ۱): کاتالوگ خدمات جانبی و سفارش/شارژ (نقشه ۷.۱۰).
 * الگوی مشترک: کاتالوگ → سفارش → تأیید → شارژ فولیوی اقامت یا فاکتور مستقل؛
 * مالیات basis point (پیش‌فرض ۹۰۰ = ۹٪)؛ مبلغ‌ها ریال صحیح BigInt؛
 * رویداد ancillary.order.confirmed با Outbox هم‌تراکنشی → سند سه‌خطی خودکار.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AncillaryCategory } from '@prisma/client';
import { EVENT_NAMES, type AncillaryOrderConfirmedPayload } from '@hotel-erp/contracts';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma.service';

@Injectable()
export class AncillaryService {
  constructor(private readonly prisma: PrismaService, private readonly outbox: OutboxService) {}

  async listServices(activeOnly = true) {
    const rows = await this.prisma.ancillaryService.findMany({
      where: activeOnly ? { active: true } : {},
      orderBy: { code: 'asc' },
    });
    return rows.map((s) => ({
      id: s.id,
      code: s.code,
      nameFa: s.nameFa,
      category: s.category,
      unitPriceRials: Number(s.unitPriceRials),
      taxRateBps: s.taxRateBps,
      active: s.active,
    }));
  }

  async createService(input: {
    code: string;
    nameEn: string;
    nameFa: string;
    category: AncillaryCategory;
    unitPriceRials: number;
    taxRateBps?: number;
    glRevenueAccountCode?: string;
  }) {
    if (input.unitPriceRials <= 0) throw new BadRequestException('نرخ واحد باید مثبت باشد');
    const taxRateBps = input.taxRateBps ?? 900;
    if (taxRateBps < 0 || taxRateBps > 10000) throw new BadRequestException('نرخ مالیات باید بین ۰ و ۱۰۰۰۰ basis point باشد');
    const row = await this.prisma.ancillaryService.create({
      data: {
        code: input.code,
        nameEn: input.nameEn,
        nameFa: input.nameFa,
        category: input.category,
        unitPriceRials: BigInt(input.unitPriceRials),
        taxRateBps,
        glRevenueAccountCode: input.glRevenueAccountCode ?? '4103',
      },
    }).catch((e: { code?: string }) => {
      if (e.code === 'P2002') throw new BadRequestException('کد خدمت تکراری است');
      throw e;
    });
    return { id: row.id, code: row.code, active: row.active };
  }

  /** تأیید سفارش خدمت: محاسبهٔ خالص/مالیات/کل، شارژ فولیو، رویداد هم‌تراکنشی */
  async confirmOrder(input: {
    serviceCode: string;
    quantity: number;
    stayCode?: string | null;
    guestName?: string | null;
    note?: string | null;
    idempotencyKey: string;
    userId?: string;
  }) {
    if (input.quantity <= 0) throw new BadRequestException('تعداد باید مثبت باشد');

    const replay = await this.prisma.ancillaryOrder.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (replay) return { ...this.mapOrder(replay), replayed: true };

    const order = await this.prisma.$transaction(async (tx) => {
      const service = await tx.ancillaryService.findUnique({ where: { code: input.serviceCode } });
      if (!service || !service.active) throw new NotFoundException('خدمت یافت نشد یا غیرفعال است');

      let stayId: string | null = null;
      let stayCode: string | null = null;
      if (input.stayCode) {
        const stay = await tx.stay.findUnique({ where: { code: input.stayCode } });
        if (!stay || stay.status !== 'OPEN') throw new BadRequestException('اقامت باز برای شارژ فولیو یافت نشد');
        stayId = stay.id;
        stayCode = stay.code;
      }

      const unitPrice = service.unitPriceRials;
      const net = unitPrice * BigInt(input.quantity);
      // مالیات: گرد کردن به نزدیک‌ترین ریال صحیح
      const tax = (net * BigInt(service.taxRateBps) + 5000n) / 10000n;
      const total = net + tax;

      const seq = (await tx.ancillaryOrder.count()) + 1;
      const row = await tx.ancillaryOrder.create({
        data: {
          orderNo: `SVC-${new Date().getUTCFullYear()}-${String(seq).padStart(6, '0')}`,
          serviceId: service.id,
          quantity: input.quantity,
          unitPriceRials: unitPrice,
          netRials: net,
          taxRials: tax,
          totalRials: total,
          stayId,
          guestName: input.guestName ?? null,
          servedById: input.userId,
          idempotencyKey: input.idempotencyKey,
          note: input.note ?? null,
        },
      });

      // شارژ فولیوی اقامت (جمع شارژ اتاق/خدمات) — قاعدهٔ فاز ۴
      if (stayId) {
        await tx.stay.update({
          where: { id: stayId },
          data: { folioRials: { increment: total } },
        });
      }

      const payload: AncillaryOrderConfirmedPayload = {
        orderId: row.id,
        orderNo: row.orderNo,
        category: service.category,
        quantity: row.quantity,
        netRials: Number(net),
        taxRials: Number(tax),
        totalRials: Number(total),
        stayCode,
      };
      await this.outbox.enqueue(tx, {
        eventName: EVENT_NAMES.ANCILLARY_ORDER_CONFIRMED,
        aggregate: 'ancillary_order',
        idempotencyKey: `ancillary.order.${input.idempotencyKey}`,
        payload: payload as unknown as Record<string, unknown>,
        producer: 'ancillary',
      });
      return row;
    });
    return { ...this.mapOrder(order), replayed: false };
  }

  async cancelOrder(orderId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.ancillaryOrder.findUnique({ where: { id: orderId } });
      if (!order) throw new NotFoundException('سفارش یافت نشد');
      if (order.status !== 'CONFIRMED') throw new BadRequestException('سفارش قابل لغو نیست');
      if (!reason || reason.trim().length < 3) throw new BadRequestException('دلیل لغو الزامی است');
      // برگشت شارژ فولیو در صورت اتصال به اقامت
      if (order.stayId) {
        await tx.stay.update({
          where: { id: order.stayId },
          data: { folioRials: { decrement: order.totalRials } },
        });
      }
      const updated = await tx.ancillaryOrder.update({
        where: { id: order.id },
        data: { status: 'CANCELED', note: `${order.note ? order.note + ' | ' : ''}CANCELED: ${reason}` },
      });
      return { id: updated.id, orderNo: updated.orderNo, status: updated.status };
    });
  }

  async listOrders(limit = 100) {
    const rows = await this.prisma.ancillaryOrder.findMany({
      orderBy: { servedAt: 'desc' },
      take: Math.min(limit, 300),
      include: {
        service: { select: { code: true, nameFa: true, category: true } },
        stay: { select: { code: true, guestName: true } },
      },
    });
    return rows.map((r) => ({
      ...this.mapOrder(r),
      service: r.service.code,
      serviceName: r.service.nameFa,
      category: r.service.category,
      stayCode: r.stay?.code ?? null,
      guestName: r.stay?.guestName ?? r.guestName,
    }));
  }

  private mapOrder(r: { id: string; orderNo: string; quantity: number; unitPriceRials: bigint; netRials: bigint; taxRials: bigint; totalRials: bigint; status: string; servedAt: Date; note: string | null }) {
    return {
      id: r.id,
      orderNo: r.orderNo,
      quantity: r.quantity,
      unitPriceRials: Number(r.unitPriceRials),
      netRials: Number(r.netRials),
      taxRials: Number(r.taxRials),
      totalRials: Number(r.totalRials),
      status: r.status,
      servedAt: r.servedAt.toISOString(),
      note: r.note,
    };
  }
}
