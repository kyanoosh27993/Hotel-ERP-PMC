/**
 * pos.service.ts — PoC فروش رستوران: سفارش → رویداد pos.order.served در همان تراکنش
 * → موتور سند خودکار. مالیات با عدد صحیح (permille) محاسبه می‌شود.
 */
import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { OutboxService } from '../outbox/outbox.service';
import { EVENT_NAMES } from '@hotel-erp/contracts';
import { addRials, mulRial } from '@hotel-erp/shared';
import { nextDocSeq } from '../common/doc-seq';

export interface ServeLineInput {
  itemName: string;
  qty: number;
  unitPriceRials: bigint;
}

export interface ServeOrderInput {
  outletId: string;
  lines: ServeLineInput[];
  taxRatePermille: number; // مثال: 90 = ۹٪
  folioId: string | null;
  idempotencyKey: string;
  servedByUserId: string;
}

@Injectable()
export class PosService {
  constructor(private readonly prisma: PrismaService, private readonly outbox: OutboxService) {}

  /** محاسبه خالص — قابل تست واحد: جمع + مالیات صحیح */
  static computeTotals(lines: ServeLineInput[], taxRatePermille: number): { total: bigint; tax: bigint; net: bigint } {
    if (lines.length === 0) throw new ConflictException({ code: 'VALIDATION', message: 'Order must have at least one line' });
    for (const l of lines) {
      if (!Number.isInteger(l.qty) || l.qty < 1) throw new ConflictException({ code: 'VALIDATION', message: 'qty must be a positive integer' });
    }
    const total = addRials(...lines.map((l) => mulRial(l.unitPriceRials, l.qty)));
    const tax = (total * BigInt(taxRatePermille)) / 1000n;
    return { total, tax, net: total - tax };
  }

  async serveOrder(input: ServeOrderInput): Promise<{ orderId: string; orderNo: string; replayed: boolean }> {
    const existing = await this.prisma.posOrder.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return { orderId: existing.id, orderNo: existing.code, replayed: true };

    const outlet = await this.prisma.posOutlet.findUnique({ where: { id: input.outletId } });
    if (!outlet) throw new ConflictException({ code: 'NOT_FOUND', message: 'Outlet not found' });

    const { total, tax } = PosService.computeTotals(input.lines, input.taxRatePermille);

    return this.prisma.$transaction(async (tx) => {
      const seq = await nextDocSeq(tx, 'pos_order');
      const orderNo = `ORD-${new Date().getUTCFullYear()}-${String(seq).padStart(6, '0')}`;

      const order = await tx.posOrder.create({
        data: {
          code: orderNo,
          outletId: input.outletId,
          totalRials: total,
          taxRials: tax,
          status: 'SERVED',
          linesJson: input.lines.map((l) => ({
            itemName: l.itemName,
            qty: l.qty,
            unitPriceRials: l.unitPriceRials.toString(),
            lineTotalRials: mulRial(l.unitPriceRials, l.qty).toString(),
          })) as unknown as import('@prisma/client').Prisma.InputJsonValue,
          folioId: input.folioId,
          idempotencyKey: input.idempotencyKey,
          servedById: input.servedByUserId === 'system:engine' ? null : input.servedByUserId,
        },
      });

      await this.outbox.enqueue(tx, {
        eventName: EVENT_NAMES.POS_ORDER_SERVED,
        aggregate: 'pos_order',
        idempotencyKey: order.id,
        producer: 'pos',
        payload: {
          orderId: order.id,
          outletId: input.outletId,
          orderNo,
          totalAmountRials: Number(total),
          taxAmountRials: Number(tax),
          lines: input.lines.map((l) => ({
            itemName: l.itemName,
            qty: l.qty,
            unitPriceRials: Number(l.unitPriceRials),
            lineTotalRials: Number(mulRial(l.unitPriceRials, l.qty)),
          })),
          folioId: input.folioId,
        },
      });

      return { orderId: order.id, orderNo, replayed: false };
    });
  }
}
