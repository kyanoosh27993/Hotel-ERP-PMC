/**
 * stores.service.ts — فاز ۷ (موج ۲): اقلام انبار، گردش قطعی، انبارگردانی و کاست کنترل.
 * قواعد سند PHASE7-...: موجودی فقط از گردش قطعی؛ منفی فقط با مجوز صریح؛ میانگین موزون؛
 * زنجیرهٔ مصرف: رویداد غیرپولی restaurant.order.served → گردش OUT با تبدیل واحد →
 * رویداد پولی inventory.consumption.posted → سند COGS (فقط از طریق Outbox).
 */
import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import {
  EVENT_NAMES,
  type InventoryAdjustmentPostedPayload,
  type InventoryConsumptionPostedPayload,
  type RestaurantOrderServedPayload,
} from '@hotel-erp/contracts';
import { Prisma } from '@prisma/client';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma.service';
import { nextDocSeq } from '../common/doc-seq';

type Tx = Prisma.TransactionClient;

@Injectable()
export class StoresService implements OnModuleInit {
  private readonly logger = new Logger('Stores');

  constructor(private readonly prisma: PrismaService, private readonly outbox: OutboxService) {}

  onModuleInit(): void {
    // زنجیرهٔ کاست کنترل: سرو سفارش رستوران → مصرف مواد → سند COGS
    this.outbox.on(EVENT_NAMES.RESTAURANT_ORDER_SERVED, (e) => this.consumeForOrder(e));
  }

  // ───────────── موتور گردش انبار (مرجع مشترک سند انبار/مالی) ─────────────

  /**
   * میانگین موزون — قابل تست واحد: (موجودی×میانگین + ورودی×بهای واحد) ÷ موجودی جدید
   */
  static updateAvgCost(oldQty: number, oldAvgRials: bigint, inQty: number, unitCostRials: bigint): bigint {
    const newQty = oldQty + inQty;
    if (newQty <= 0) return 0n;
    const totalValue = oldQty * Number(oldAvgRials) + inQty * Number(unitCostRials);
    return BigInt(Math.round(totalValue / newQty));
  }

  /**
   * ثبت گردش قطعی درون تراکنش — تنها راه تغییر qtyOnHand.
   * خروجی: گردش ثبت‌شده با ارزش ریالی.
   */
  async applyMovement(tx: Tx, input: {
    stockItemId: string;
    warehouseId: string | null;
    direction: 'IN' | 'OUT' | 'ADJUST_IN' | 'ADJUST_OUT' | 'WASTE';
    qty: Prisma.Decimal | number;
    unitCostRials: bigint | null;
    refModule: string;
    refId?: string | null;
    note?: string | null;
    userId?: string;
    /** منفی بدون مجوز صریح را رد می‌کند (پیش‌فرض: صرف‌نظر از allowNegative فقط برای مصرف رسپی) */
    allowNegativeOverride?: boolean;
  }) {
    const qty = new Prisma.Decimal(input.qty);
    if (Number(qty) <= 0) throw new BadRequestException('مقدار گردش باید مثبت باشد');
    const item = await tx.stockItem.findUnique({ where: { id: input.stockItemId } });
    if (!item) throw new NotFoundException('قلم انبار یافت نشد');

    const isOut = input.direction === 'OUT' || input.direction === 'ADJUST_OUT' || input.direction === 'WASTE';
    let avg = item.avgCostRials;
    if (!isOut) {
      const unitCost = input.unitCostRials ?? item.avgCostRials;
      avg = StoresService.updateAvgCost(Number(item.qtyOnHand), item.avgCostRials, Number(qty), unitCost);
    }
    const unitCost = isOut ? item.avgCostRials : (input.unitCostRials ?? item.avgCostRials);
    const value = BigInt(Math.round(Number(qty) * Number(unitCost)));

    if (isOut && !item.allowNegative && input.allowNegativeOverride !== true) {
      if (Number(item.qtyOnHand) - Number(qty) < 0) {
        throw new BadRequestException(`موجودی ${item.code} منفی می‌شود و مجوز صریح ندارد`);
      }
    }

    await tx.stockItem.update({
      where: { id: item.id },
      data: {
        qtyOnHand: isOut ? { decrement: qty } : { increment: qty },
        avgCostRials: avg,
      },
    });
    return tx.stockMovement.create({
      data: {
        stockItemId: item.id,
        warehouseId: input.warehouseId ?? item.warehouseId ?? (await this.defaultWarehouseId(tx)),
        direction: input.direction,
        qty,
        unitCostRials: unitCost,
        valueRials: value,
        refModule: input.refModule,
        refId: input.refId ?? null,
        note: input.note ?? null,
        createdById: input.userId,
      },
    });
  }

  private async defaultWarehouseId(tx: Tx): Promise<string> {
    const w = await tx.warehouse.findFirst({ where: { active: true }, orderBy: { code: 'asc' } });
    if (!w) throw new BadRequestException('انباری تعریف نشده است');
    return w.id;
  }

  // ───────────── اقلام و گردش ─────────────

  async createStockItem(input: {
    code: string;
    nameEn: string;
    nameFa: string;
    category?: string;
    unitPurchase?: string;
    unitConsumption?: string;
    conversionFactor?: number;
    minQty?: number;
    warehouseCode?: string | null;
    allowNegative?: boolean;
  }) {
    let warehouseId: string | null = null;
    if (input.warehouseCode) {
      const w = await this.prisma.warehouse.findUnique({ where: { code: input.warehouseCode } });
      if (!w) throw new NotFoundException('انبار یافت نشد');
      warehouseId = w.id;
    }
    const row = await this.prisma.stockItem.create({
      data: {
        code: input.code,
        nameEn: input.nameEn,
        nameFa: input.nameFa,
        category: input.category ?? 'OTHER',
        unitPurchase: input.unitPurchase ?? 'عدد',
        unitConsumption: input.unitConsumption ?? 'عدد',
        conversionFactor: new Prisma.Decimal(input.conversionFactor ?? 1),
        minQty: new Prisma.Decimal(input.minQty ?? 0),
        warehouseId,
        allowNegative: input.allowNegative ?? true,
      },
    }).catch((e: { code?: string }) => {
      if (e.code === 'P2002') throw new BadRequestException('کد قلم تکراری است');
      throw e;
    });
    return { id: row.id, code: row.code };
  }

  async listStockItems(includeInactive = false) {
    const rows = await this.prisma.stockItem.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { code: 'asc' },
      include: { warehouse: { select: { code: true, nameFa: true } } },
    });
    return rows.map((i) => ({
      id: i.id,
      code: i.code,
      nameFa: i.nameFa,
      category: i.category,
      unitPurchase: i.unitPurchase,
      unitConsumption: i.unitConsumption,
      conversionFactor: Number(i.conversionFactor),
      qtyOnHand: Number(i.qtyOnHand),
      minQty: Number(i.minQty),
      avgCostRials: Number(i.avgCostRials),
      warehouse: i.warehouse?.code ?? null,
      allowNegative: i.allowNegative,
      reorderNeeded: Number(i.qtyOnHand) <= Number(i.minQty),
    }));
  }

  async listMovements(stockItemCode?: string, limit = 100) {
    const rows = await this.prisma.stockMovement.findMany({
      where: stockItemCode ? { stockItem: { code: stockItemCode } } : {},
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 500),
      include: { stockItem: { select: { code: true, nameFa: true } }, warehouse: { select: { code: true } } },
    });
    return rows.map((m) => ({
      id: m.id,
      stockItemCode: m.stockItem.code,
      name: m.stockItem.nameFa,
      warehouse: m.warehouse.code,
      direction: m.direction,
      qty: Number(m.qty),
      unitCostRials: Number(m.unitCostRials),
      valueRials: Number(m.valueRials),
      refModule: m.refModule,
      refId: m.refId,
      createdAt: m.createdAt.toISOString(),
    }));
  }

  /** حوالهٔ انتقال بین انبارها — OUT + IN با بهای میانگین */
  async transfer(input: { stockItemCode: string; fromWarehouseCode: string; toWarehouseCode: string; qty: number; userId?: string }) {
    if (input.fromWarehouseCode === input.toWarehouseCode) throw new BadRequestException('مبدأ و مقصد یکسان است');
    if (input.qty <= 0) throw new BadRequestException('مقدار باید مثبت باشد');
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.stockItem.findUnique({ where: { code: input.stockItemCode } });
      if (!item) throw new NotFoundException('قلم انبار یافت نشد');
      const from = await tx.warehouse.findUnique({ where: { code: input.fromWarehouseCode } });
      const to = await tx.warehouse.findUnique({ where: { code: input.toWarehouseCode } });
      if (!from || !to) throw new NotFoundException('انبار مبدأ/مقصد یافت نشد');
      const out = await this.applyMovement(tx, {
        stockItemId: item.id, warehouseId: from.id, direction: 'OUT',
        qty: input.qty, unitCostRials: item.avgCostRials,
        refModule: 'stores', refId: `transfer:${from.code}->${to.code}`, userId: input.userId,
        allowNegativeOverride: item.allowNegative,
      });
      await this.applyMovement(tx, {
        stockItemId: item.id, warehouseId: to.id, direction: 'IN',
        qty: input.qty, unitCostRials: item.avgCostRials,
        refModule: 'stores', refId: `transfer:${from.code}->${to.code}`, userId: input.userId,
      });
      return { movedQty: input.qty, valueRials: Number(out.valueRials) };
    });
  }

  /** اصلاح موجودی دستی (ADJUST) — فقط با مجوز stores.manage؛ منفی با allowNegative */
  async adjust(input: { stockItemCode: string; direction: 'ADJUST_IN' | 'ADJUST_OUT' | 'WASTE'; qty: number; note: string; userId?: string }) {
    if (!input.note || input.note.trim().length < 3) throw new BadRequestException('دلیل اصلاح الزامی است');
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.stockItem.findUnique({ where: { code: input.stockItemCode } });
      if (!item) throw new NotFoundException('قلم انبار یافت نشد');
      const mv = await this.applyMovement(tx, {
        stockItemId: item.id,
        warehouseId: item.warehouseId,
        direction: input.direction,
        qty: input.qty,
        unitCostRials: item.avgCostRials,
        refModule: 'stores',
        refId: null,
        note: input.note,
        userId: input.userId,
      });
      return { id: mv.id, direction: mv.direction, qty: Number(mv.qty), valueRials: Number(mv.valueRials) };
    });
  }

  // ───────────── انبارگردانی ─────────────

  async openCount(input: { warehouseCode: string; userId?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const w = await tx.warehouse.findUnique({ where: { code: input.warehouseCode } });
      if (!w) throw new NotFoundException('انبار یافت نشد');
      const open = await tx.stockCount.findFirst({ where: { warehouseId: w.id, status: 'OPEN' } });
      if (open) throw new BadRequestException('شمارش باز روی این انبار وجود دارد');
      const seq = await nextDocSeq(tx, 'stock_count');
      const count = await tx.stockCount.create({
        data: {
          countNo: `CNT-${new Date().getUTCFullYear()}-${String(seq).padStart(6, '0')}`,
          warehouseId: w.id,
          countedById: input.userId,
        },
      });
      // snapshot سیستم برای همهٔ اقلام فعال انبار
      const items = await tx.stockItem.findMany({ where: { active: true, warehouseId: w.id } });
      for (const it of items) {
        await tx.stockCountLine.create({
          data: { countId: count.id, stockItemId: it.id, qtySystem: it.qtyOnHand, qtyCounted: it.qtyOnHand, varianceQty: new Prisma.Decimal(0) },
        });
      }
      return { id: count.id, countNo: count.countNo, lines: items.length };
    });
  }

  async setCountLine(input: { countId: string; stockItemCode: string; qtyCounted: number }) {
    if (input.qtyCounted < 0) throw new BadRequestException('شمارش نمی‌تواند منفی باشد');
    return this.prisma.$transaction(async (tx) => {
      const count = await tx.stockCount.findUnique({ where: { id: input.countId } });
      if (!count) throw new NotFoundException('شمارش یافت نشد');
      if (count.status !== 'OPEN') throw new BadRequestException('شمارش بسته شده است');
      const item = await tx.stockItem.findUnique({ where: { code: input.stockItemCode } });
      if (!item) throw new NotFoundException('قلم انبار یافت نشد');
      const line = await tx.stockCountLine.findUnique({
        where: { countId_stockItemId: { countId: count.id, stockItemId: item.id } },
      });
      if (!line) throw new NotFoundException('این قلم در snapshot انبار نیست');
      const variance = new Prisma.Decimal(input.qtyCounted).minus(line.qtySystem);
      await tx.stockCountLine.update({
        where: { id: line.id },
        data: { qtyCounted: new Prisma.Decimal(input.qtyCounted), varianceQty: variance },
      });
      return { countNo: count.countNo, stockItemCode: item.code, varianceQty: Number(variance) };
    });
  }

  /** بستن شمارش — گردش‌های ADJUST + رویداد پولی مغایرت → سند */
  async closeCount(input: { countId: string; userId?: string }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "stock_counts" WHERE id = ${input.countId}::uuid FOR UPDATE`;
      const count = await tx.stockCount.findUnique({
        where: { id: input.countId },
        include: { lines: { include: { stockItem: true } }, warehouse: true },
      });
      if (!count) throw new NotFoundException('شمارش یافت نشد');
      if (count.status !== 'OPEN') throw new BadRequestException('این شمارش قبلاً بسته شده است');

      let loss = 0n;
      let gain = 0n;
      for (const line of count.lines) {
        if (Number(line.varianceQty) === 0) continue;
        const value = BigInt(Math.round(Math.abs(Number(line.varianceQty)) * Number(line.stockItem.avgCostRials)));
        if (Number(line.varianceQty) < 0) {
          loss += value;
          await this.applyMovement(tx, {
            stockItemId: line.stockItemId,
            warehouseId: count.warehouseId,
            direction: 'ADJUST_OUT',
            qty: line.varianceQty.abs(),
            unitCostRials: line.stockItem.avgCostRials,
            refModule: 'stores',
            refId: count.countNo,
            note: `کسری انبارگردانی ${count.countNo}`,
            userId: input.userId,
            allowNegativeOverride: true,
          });
        } else {
          gain += value;
          await this.applyMovement(tx, {
            stockItemId: line.stockItemId,
            warehouseId: count.warehouseId,
            direction: 'ADJUST_IN',
            qty: line.varianceQty,
            unitCostRials: line.stockItem.avgCostRials,
            refModule: 'stores',
            refId: count.countNo,
            note: `اضافهٔ انبارگردانی ${count.countNo}`,
            userId: input.userId,
          });
        }
      }

      await tx.stockCount.update({
        where: { id: count.id },
        data: { status: 'CLOSED', closedById: input.userId, closedAt: new Date() },
      });

      if (loss > 0n || gain > 0n) {
        const payload: InventoryAdjustmentPostedPayload = {
          countId: count.id,
          countNo: count.countNo,
          warehouseCode: count.warehouse.code,
          lossRials: Number(loss),
          gainRials: Number(gain),
        };
        await this.outbox.enqueue(tx, {
          eventName: EVENT_NAMES.INVENTORY_ADJUSTMENT_POSTED,
          aggregate: 'stock_count',
          idempotencyKey: `stores.count.${count.countNo}`,
          payload: payload as unknown as Record<string, unknown>,
          producer: 'stores',
        });
      }
      return { countNo: count.countNo, lossRials: Number(loss), gainRials: Number(gain) };
    });
  }

  async listCounts(limit = 30) {
    const rows = await this.prisma.stockCount.findMany({
      orderBy: { countedAt: 'desc' },
      take: Math.min(limit, 100),
      include: { warehouse: { select: { code: true, nameFa: true } }, lines: { include: { stockItem: { select: { code: true } } } } },
    });
    return rows.map((c) => ({
      id: c.id,
      countNo: c.countNo,
      warehouse: c.warehouse.nameFa,
      status: c.status,
      lines: c.lines.map((l) => ({
        code: l.stockItem.code,
        qtySystem: Number(l.qtySystem),
        qtyCounted: Number(l.qtyCounted),
        varianceQty: Number(l.varianceQty),
      })),
    }));
  }

  // ───────────── زنجیرهٔ مصرف منو (کاست کنترل ۷.۶) ─────────────

  /** مصرف‌کنندهٔ restaurant.order.served: گردش OUT با تبدیل واحد + رویداد پولی COGS */
  private async consumeForOrder(envelope: { idempotencyKey: string; payload: Record<string, unknown> }): Promise<void> {
    const payload = envelope.payload as unknown as RestaurantOrderServedPayload;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const consumedLines: Array<{ stockItemCode: string; qty: number; unitCostRials: number; valueRials: number }> = [];
        let total = 0n;
        for (const line of payload.lines) {
          if (!line.recipeCode) continue; // سیاست مصرف مشخص — مصرف انبار ندارد
          const recipe = await tx.recipe.findUnique({
            where: { code: line.recipeCode },
            include: { recipeLines: { include: { stockItem: true } } },
          });
          if (!recipe) {
            this.logger.warn(`recipe ${line.recipeCode} missing — consumption skipped for ${payload.orderNo}`);
            continue;
          }
          for (const rl of recipe.recipeLines) {
            // مقدار مصرف = تعداد سهم × مقدار هر سهم × (۱ + افت) — qtyPerPortion در واحد مصرف است
            const gross = Number(rl.qtyPerPortion) * line.qty * (1 + rl.wasteFactorBps / 10000);
            const mv = await this.applyMovement(tx, {
              stockItemId: rl.stockItemId,
              warehouseId: rl.stockItem.warehouseId,
              direction: 'OUT',
              qty: gross,
              unitCostRials: rl.stockItem.avgCostRials,
              refModule: 'restaurant',
              refId: payload.orderNo,
              note: `مصرف منو ${payload.orderNo} (${line.menuItemCode})`,
              // مصرف آشپزخانه با مجوز صریح سیاستی: منفی مجاز حتی اگر قلم اجازه نداشته باشد، ثبت و در واریانس دیده می‌شود
              allowNegativeOverride: true,
            });
            total += mv.valueRials;
            consumedLines.push({
              stockItemCode: rl.stockItem.code,
              qty: Number(mv.qty),
              unitCostRials: Number(mv.unitCostRials),
              valueRials: Number(mv.valueRials),
            });
          }
        }
        if (total > 0n) {
          const moneyPayload: InventoryConsumptionPostedPayload = {
            orderId: payload.orderId,
            orderNo: payload.orderNo,
            consumedRials: Number(total),
            lines: consumedLines,
          };
          await this.outbox.enqueue(tx, {
            eventName: EVENT_NAMES.INVENTORY_CONSUMPTION_POSTED,
            aggregate: 'stock_movement',
            idempotencyKey: `stores.consume.${payload.orderNo}`,
            payload: moneyPayload as unknown as Record<string, unknown>,
            producer: 'stores',
          });
        }
        return { consumedRials: Number(total), lines: consumedLines.length };
      });
      if (result.consumedRials > 0) this.logger.log(`consumption posted for ${payload.orderNo}: ${result.consumedRials} (${result.lines} lines)`);
    } catch (e) {
      // زنجیرهٔ مصرف نباید رویداد اصلی را شکست دهد — ثبت و ردیابی
      this.logger.error(`consumption failed for ${payload.orderNo}: ${(e as Error).message}`);
      throw e; // publisher retry/dlq خودش را دارد
    }
  }

  // ───────────── گزارش‌های کاست کنترل ─────────────

  /** مقایسهٔ تئوریک/واقعی: تئوریک از سفارش‌های سرو‌شده × فرمول رسپی؛ واقعی از گردش‌های مصرف */
  async costControl(fromDate: string, toDate: string) {
    const from = new Date(`${fromDate}T00:00:00Z`);
    const to = new Date(`${toDate}T23:59:59Z`);
    const orders = await this.prisma.restaurantOrder.findMany({
      where: { status: 'SERVED', servedAt: { gte: from, lte: to } },
      include: { items: { include: { menuItem: { include: { recipe: { include: { recipeLines: { include: { stockItem: true } } } } } } } } },
    });
    const theoretical = new Map<string, { name: string; qty: number; value: number }>();
    for (const o of orders) {
      for (const it of o.items) {
        if (it.status === 'CANCELED' || !it.menuItem.recipe) continue;
        for (const rl of it.menuItem.recipe.recipeLines) {
          const gross = Number(rl.qtyPerPortion) * it.qty * (1 + rl.wasteFactorBps / 10000);
          const prev = theoretical.get(rl.stockItem.code) ?? { name: rl.stockItem.nameFa, qty: 0, value: 0 };
          prev.qty += gross;
          prev.value += Math.round(gross * Number(rl.stockItem.avgCostRials));
          theoretical.set(rl.stockItem.code, prev);
        }
      }
    }
    const actualRows = await this.prisma.stockMovement.findMany({
      where: { refModule: 'restaurant', direction: 'OUT', createdAt: { gte: from, lte: to } },
      include: { stockItem: { select: { code: true, nameFa: true } } },
    });
    const actual = new Map<string, { name: string; qty: number; value: number }>();
    for (const m of actualRows) {
      const prev = actual.get(m.stockItem.code) ?? { name: m.stockItem.nameFa, qty: 0, value: 0 };
      prev.qty += Number(m.qty);
      prev.value += Number(m.valueRials);
      actual.set(m.stockItem.code, prev);
    }
    const codes = new Set([...theoretical.keys(), ...actual.keys()]);
    return {
      fromDate,
      toDate,
      servedOrders: orders.length,
      lines: [...codes].sort().map((code) => {
        const t = theoretical.get(code) ?? { name: '', qty: 0, value: 0 };
        const a = actual.get(code) ?? { name: '', qty: 0, value: 0 };
        return {
          code,
          name: t.name || a.name,
          theoreticalQty: Math.round(t.qty * 1000) / 1000,
          actualQty: Math.round(a.qty * 1000) / 1000,
          varianceQty: Math.round((a.qty - t.qty) * 1000) / 1000,
          actualValueRials: a.value,
        };
      }),
    };
  }

  async reorderReport() {
    const items = await this.listStockItems();
    return items.filter((i) => i.reorderNeeded);
  }
}
