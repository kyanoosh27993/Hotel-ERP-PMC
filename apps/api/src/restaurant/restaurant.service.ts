/**
 * restaurant.service.ts — فاز ۶ (موج ۲): سالن/میز، منو، سفارش قلم‌محور، آشپزخانه (KDS).
 * قواعد سند PHASE6-RESTAURANT-POS.md: وضعیت ثبت/ارسال/آماده‌سازی/تحویل/پرداخت جدا؛
 * تغییر پس از ارسال فقط با ردپای اصلاح (لغو با دلیل اجباری)؛ snapshot نرخ قلم؛
 * پول فقط BigInt ریال؛ رویدادها با Outbox هم‌تراکنشی (pos.order.served پولی +
 * restaurant.order.served غیرپولی برای زنجیرهٔ مصرف انبار فاز ۷).
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EVENT_NAMES, type PosOrderServedPayload, type RestaurantOrderServedPayload, type KitchenTicketCreatedPayload } from '@hotel-erp/contracts';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma.service';
import { nextDocSeq } from '../common/doc-seq';

const OPEN_ITEM_STATUSES = new Set(['NEW', 'SENT_TO_KITCHEN', 'PREPARING', 'READY', 'SERVED']);

@Injectable()
export class RestaurantService {
  constructor(private readonly prisma: PrismaService, private readonly outbox: OutboxService) {}

  // ───────────── سالن، میز و منو ─────────────

  async listAreas() {
    const rows = await this.prisma.diningArea.findMany({
      orderBy: { nameFa: 'asc' },
      include: { tables: { orderBy: { code: 'asc' } } },
    });
    return rows.map((a) => ({
      id: a.id,
      outletId: a.outletId,
      nameFa: a.nameFa,
      tables: a.tables.map((t) => ({ id: t.id, code: t.code, seats: t.seats, status: t.status })),
    }));
  }

  async createArea(input: { outletCode: string; nameEn: string; nameFa: string }) {
    const outlet = await this.prisma.posOutlet.findUnique({ where: { code: input.outletCode } });
    if (!outlet) throw new NotFoundException('مرکز فروش یافت نشد');
    const area = await this.prisma.diningArea.create({
      data: { outletId: outlet.id, nameEn: input.nameEn, nameFa: input.nameFa },
    });
    return { id: area.id, nameFa: area.nameFa };
  }

  async createTable(input: { areaId: string; code: string; seats: number }) {
    if (input.seats < 1) throw new BadRequestException('ظرفیت میز حداقل ۱ نفر است');
    const row = await this.prisma.diningTable.create({
      data: { areaId: input.areaId, code: input.code, seats: input.seats },
    }).catch((e: { code?: string }) => {
      if (e.code === 'P2002') throw new BadRequestException('کد میز تکراری است');
      throw e;
    });
    return { id: row.id, code: row.code, seats: row.seats };
  }

  async listMenu() {
    const cats = await this.prisma.menuCategory.findMany({
      orderBy: { sortOrder: 'asc' },
      include: { items: { where: { active: true }, orderBy: { nameFa: 'asc' } } },
    });
    return cats.map((c) => ({
      code: c.code,
      nameFa: c.nameFa,
      items: c.items.map((i) => ({
        id: i.id,
        code: i.code,
        nameFa: i.nameFa,
        priceRials: Number(i.priceRials),
        taxRateBps: i.taxRateBps,
        hasRecipe: i.recipeId != null,
      })),
    }));
  }

  async createMenuItem(input: {
    categoryCode: string;
    code: string;
    nameEn: string;
    nameFa: string;
    priceRials: number;
    recipeCode?: string | null;
    taxRateBps?: number;
  }) {
    if (input.priceRials <= 0) throw new BadRequestException('نرخ باید مثبت باشد');
    const cat = await this.prisma.menuCategory.findUnique({ where: { code: input.categoryCode } });
    if (!cat) throw new NotFoundException('دستهٔ منو یافت نشد');
    let recipeId: string | null = null;
    if (input.recipeCode) {
      const recipe = await this.prisma.recipe.findUnique({ where: { code: input.recipeCode } });
      if (!recipe) throw new NotFoundException('رسپی یافت نشد');
      recipeId = recipe.id;
    }
    const row = await this.prisma.menuItem.create({
      data: {
        categoryId: cat.id,
        code: input.code,
        nameEn: input.nameEn,
        nameFa: input.nameFa,
        priceRials: BigInt(input.priceRials),
        taxRateBps: input.taxRateBps ?? 900,
        recipeId,
      },
    }).catch((e: { code?: string }) => {
      if (e.code === 'P2002') throw new BadRequestException('کد آیتم تکراری است');
      throw e;
    });
    return { id: row.id, code: row.code, priceRials: Number(row.priceRials) };
  }

  async createRecipe(input: {
    code: string;
    nameEn: string;
    nameFa: string;
    yieldPortions?: number;
    version?: number;
    lines: Array<{ stockItemCode: string; qtyPerPortion: number; wasteFactorBps?: number }>;
  }) {
    if (!input.lines.length) throw new BadRequestException('رسپی بدون مواد مجاز نیست');
    return this.prisma.$transaction(async (tx) => {
      const stocks = new Map<string, string>();
      for (const l of input.lines) {
        const item = await tx.stockItem.findUnique({ where: { code: l.stockItemCode } });
        if (!item) throw new NotFoundException(`قلم انبار ${l.stockItemCode} یافت نشد`);
        if (l.qtyPerPortion <= 0) throw new BadRequestException('مقدار هر سهم باید مثبت باشد');
        stocks.set(l.stockItemCode, item.id);
      }
      const recipe = await tx.recipe.create({
        data: {
          code: input.code,
          nameEn: input.nameEn,
          nameFa: input.nameFa,
          version: input.version ?? 1,
          yieldPortions: input.yieldPortions ?? 1,
          recipeLines: {
            create: input.lines.map((l) => ({
              stockItemId: stocks.get(l.stockItemCode)!,
              qtyPerPortion: l.qtyPerPortion,
              wasteFactorBps: l.wasteFactorBps ?? 0,
            })),
          },
        },
        include: { recipeLines: true },
      }).catch((e: { code?: string }) => {
        if (e.code === 'P2002') throw new BadRequestException('کد رسپی تکراری است');
        throw e;
      });
      return { id: recipe.id, code: recipe.code, version: recipe.version, lines: recipe.recipeLines.length };
    });
  }

  // ───────────── سفارش ─────────────

  /** باز کردن سفارش با اقلام — Idempotent؛ میز → OCCUPIED؛ روم‌سرویس نیازمند اقامت باز */
  async openOrder(input: {
    outletCode: string;
    tableCode?: string | null;
    mode: 'DINE_IN' | 'TAKEAWAY' | 'ROOM_SERVICE';
    stayCode?: string | null;
    guestName?: string | null;
    items: Array<{ menuItemCode: string; qty: number; note?: string | null }>;
    idempotencyKey: string;
    userId?: string;
  }) {
    if (!input.items.length) throw new BadRequestException('سفارش بدون قلم مجاز نیست');
    if (input.mode === 'ROOM_SERVICE' && !input.stayCode) {
      throw new BadRequestException('روم‌سرویس نیازمند کد اقامت است');
    }

    const replay = await this.prisma.restaurantOrder.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { items: { include: { menuItem: true } } },
    });
    if (replay) {
      return { ...this.mapOrder(replay), replayed: true };
    }

    return this.prisma.$transaction(async (tx) => {
      const outlet = await tx.posOutlet.findUnique({ where: { code: input.outletCode } });
      if (!outlet) throw new NotFoundException('مرکز فروش یافت نشد');

      let tableId: string | null = null;
      let areaId: string | null = null;
      if (input.tableCode) {
        const table = await tx.diningTable.findUnique({ where: { code: input.tableCode } });
        if (!table) throw new NotFoundException('میز یافت نشد');
        if (table.status === 'OCCUPIED') throw new ConflictException('میز اشغال است');
        tableId = table.id;
        areaId = table.areaId;
        await tx.diningTable.update({ where: { id: table.id }, data: { status: 'OCCUPIED' } });
      }

      let stayId: string | null = null;
      if (input.stayCode) {
        const stay = await tx.stay.findUnique({ where: { code: input.stayCode } });
        if (!stay || stay.status !== 'OPEN') throw new BadRequestException('اقامت باز یافت نشد');
        stayId = stay.id;
      }

      const seq = await nextDocSeq(tx, 'rest_order');
      const order = await tx.restaurantOrder.create({
        data: {
          orderNo: `RORD-${new Date().getUTCFullYear()}-${String(seq).padStart(6, '0')}`,
          outletId: outlet.id,
          areaId,
          tableId,
          mode: input.mode,
          stayId,
          guestName: input.guestName ?? null,
          idempotencyKey: input.idempotencyKey,
          openedById: input.userId,
        },
      });

      let subtotal = 0n;
      let taxSum = 0n;
      for (const l of input.items) {
        if (!Number.isInteger(l.qty) || l.qty < 1) throw new BadRequestException('تعداد باید صحیح مثبت باشد');
        const mi = await tx.menuItem.findUnique({ where: { code: l.menuItemCode } });
        if (!mi || !mi.active) throw new NotFoundException(`آیتم منو ${l.menuItemCode} یافت نشد`);
        const lineNet = mi.priceRials * BigInt(l.qty);
        const lineTax = (lineNet * BigInt(mi.taxRateBps)) / 10000n;
        subtotal += lineNet;
        taxSum += lineTax;
        await tx.orderItem.create({
          data: {
            orderId: order.id,
            menuItemId: mi.id,
            qty: l.qty,
            unitPriceRials: mi.priceRials,
            lineNetRials: lineNet,
            note: l.note ?? null,
          },
        });
      }
      const net = subtotal - order.discountRials;
      const tax = this.discountedTax(subtotal, taxSum, net);
      const updated = await tx.restaurantOrder.update({
        where: { id: order.id },
        data: { netRials: net, taxRials: tax, totalRials: net + tax },
        include: { items: { include: { menuItem: true } } },
      });
      return { ...this.mapOrder(updated), replayed: false };
    });
  }

  /** مالیات پس از تخفیف: به نسبت خالص به ناخالص (مبنای مالکیتی تخفیف کاهش پایهٔ مالیاتی است) */
  private discountedTax(subtotal: bigint, taxSum: bigint, net: bigint): bigint {
    if (subtotal <= 0n) return 0n;
    if (net >= subtotal) return taxSum;
    return (taxSum * net) / subtotal;
  }

  private async recalcTotals(tx: import('@prisma/client').Prisma.TransactionClient, orderId: string) {
    // include نرخ مالیاتی هر قلم — بدون N+1 در حلقه
    const order = await tx.restaurantOrder.findUnique({
      where: { id: orderId },
      include: { items: { include: { menuItem: { select: { taxRateBps: true } } } } },
    });
    if (!order) throw new NotFoundException('سفارش یافت نشد');
    let subtotal = 0n;
    let taxSum = 0n;
    for (const it of order.items) {
      if (!OPEN_ITEM_STATUSES.has(it.status)) continue;
      subtotal += it.lineNetRials;
      taxSum += (it.lineNetRials * BigInt(it.menuItem?.taxRateBps ?? 900)) / 10000n;
    }
    const net = subtotal - order.discountRials;
    const tax = this.discountedTax(subtotal, taxSum, net);
    return tx.restaurantOrder.update({
      where: { id: orderId },
      data: { netRials: net, taxRials: tax, totalRials: net + tax },
      include: { items: { include: { menuItem: true } } },
    });
  }

  /** افزودن قلم به سفارش باز */
  async addItems(orderId: string, items: Array<{ menuItemCode: string; qty: number; note?: string | null }>) {
    if (!items.length) throw new BadRequestException('قلمی ارسال نشده است');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "restaurant_orders" WHERE id = ${orderId}::uuid FOR UPDATE`;
      const order = await tx.restaurantOrder.findUnique({ where: { id: orderId } });
      if (!order) throw new NotFoundException('سفارش یافت نشد');
      if (order.status !== 'OPEN') throw new BadRequestException('سفارش سرو‌شده/لغوشده قابل تغییر نیست');
      for (const l of items) {
        if (!Number.isInteger(l.qty) || l.qty < 1) throw new BadRequestException('تعداد باید صحیح مثبت باشد');
        const mi = await tx.menuItem.findUnique({ where: { code: l.menuItemCode } });
        if (!mi || !mi.active) throw new NotFoundException(`آیتم منو ${l.menuItemCode} یافت نشد`);
        const lineNet = mi.priceRials * BigInt(l.qty);
        await tx.orderItem.create({
          data: {
            orderId,
            menuItemId: mi.id,
            qty: l.qty,
            unitPriceRials: mi.priceRials,
            lineNetRials: lineNet,
            note: l.note ?? null,
          },
        });
      }
      const updated = await this.recalcTotals(tx, orderId);
      return this.mapOrder(updated);
    });
  }

  /** ارسال قلم به آشپزخانه — بلیت جدید با snapshot اقلام + رویداد KDS */
  async sendItemToKitchen(orderId: string, itemId: string, _userId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.orderItem.findUnique({ where: { id: itemId }, include: { menuItem: true, order: true } });
      if (!item || item.orderId !== orderId) throw new NotFoundException('قلم یافت نشد');
      if (item.status !== 'NEW') throw new BadRequestException('این قلم قبلاً ارسال شده یا لغو شده است');
      if (item.order.status !== 'OPEN') throw new BadRequestException('سفارش سرو‌شده قابل ارسال نیست');

      const sent = await tx.orderItem.update({
        where: { id: itemId },
        data: { status: 'SENT_TO_KITCHEN', sentAt: new Date() },
      });

      const seq = await nextDocSeq(tx, 'kitchen_ticket');
      const ticket = await tx.kitchenTicket.create({
        data: {
          ticketNo: `KDS-${new Date().getUTCFullYear()}-${String(seq).padStart(6, '0')}`,
          orderId,
          tableLabel: item.order.tableId
            ? (await tx.diningTable.findUnique({ where: { id: item.order.tableId } }))?.code ?? null
            : (item.order.guestName ?? item.order.orderNo),
          itemsJson: [{ name: item.menuItem.nameFa, qty: sent.qty, note: sent.note }] as unknown as import('@prisma/client').Prisma.InputJsonValue,
        },
      });

      const payload: KitchenTicketCreatedPayload = {
        ticketId: ticket.id,
        ticketNo: ticket.ticketNo,
        orderId,
        orderNo: item.order.orderNo,
        tableLabel: ticket.tableLabel,
        items: [{ name: item.menuItem.nameFa, qty: sent.qty, note: sent.note }],
      };
      await this.outbox.enqueue(tx, {
        eventName: EVENT_NAMES.KITCHEN_TICKET_CREATED,
        aggregate: 'kitchen_ticket',
        idempotencyKey: `restaurant.ticket.${ticket.ticketNo}`,
        payload: payload as unknown as Record<string, unknown>,
        producer: 'restaurant',
      });
      return { itemId: sent.id, status: sent.status, ticketNo: ticket.ticketNo };
    });
  }

  /** لغو قلم با دلیل اجباری — ردپای اصلاح، حذف فیزیکی ممنوع */
  async cancelItem(orderId: string, itemId: string, reason: string) {
    if (!reason || reason.trim().length < 3) throw new BadRequestException('دلیل لغو الزامی است');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "order_items" WHERE id = ${itemId}::uuid FOR UPDATE`;
      const item = await tx.orderItem.findUnique({ where: { id: itemId }, include: { order: true } });
      if (!item || item.orderId !== orderId) throw new NotFoundException('قلم یافت نشد');
      if (item.status === 'CANCELED') throw new BadRequestException('این قلم قبلاً لغو شده است');
      if (item.status === 'SERVED') throw new BadRequestException('قلم سرو‌شده قابل لغو نیست — اصلاح با سند حسابداری');
      if (item.order.status !== 'OPEN') throw new BadRequestException('سفارش سرو‌شده قابل تغییر نیست');
      await tx.orderItem.update({
        where: { id: itemId },
        data: { status: 'CANCELED', cancelReason: reason },
      });
      const updated = await this.recalcTotals(tx, orderId);
      return this.mapOrder(updated);
    });
  }

  /** تخفیف سفارش — فقط با مجوز pos.discount (کنترل در کنترلر) */
  async applyDiscount(orderId: string, amountRials: number, reason: string) {
    if (!reason || reason.trim().length < 3) throw new BadRequestException('دلیل تخفیف الزامی است');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "restaurant_orders" WHERE id = ${orderId}::uuid FOR UPDATE`;
      const order = await tx.restaurantOrder.findUnique({ where: { id: orderId } });
      if (!order) throw new NotFoundException('سفارش یافت نشد');
      if (order.status !== 'OPEN') throw new BadRequestException('سفارش سرو‌شده قابل تخفیف نیست');
      if (amountRials < 0) throw new BadRequestException('تخفیف نمی‌تواند منفی باشد');
      await tx.restaurantOrder.update({
        where: { id: orderId },
        data: { discountRials: BigInt(amountRials), discountReason: reason },
      });
      const updated = await this.recalcTotals(tx, orderId);
      return this.mapOrder(updated);
    });
  }

  /** سرو قطعی سفارش — رویداد پولی فروش + رویداد مصرف انبار؛ آزادسازی میز */
  async serveOrder(orderId: string, _userId?: string) {
    const [order] = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "restaurant_orders" WHERE id = ${orderId}::uuid FOR UPDATE`;
      const ord = await tx.restaurantOrder.findUnique({
        where: { id: orderId },
        include: { items: { include: { menuItem: { include: { recipe: true } } } }, outlet: true, stay: { select: { code: true } } },
      });
      if (!ord) throw new NotFoundException('سفارش یافت نشد');
      if (ord.status !== 'OPEN') throw new BadRequestException('سفارش قبلاً سرو یا لغو شده است');
      const active = ord.items.filter((i) => OPEN_ITEM_STATUSES.has(i.status) && i.status !== 'CANCELED');
      if (active.length === 0) throw new BadRequestException('سفارش بدون قلم فعال قابل سرو نیست');

      // اقلام در وضعیت NEW هنگام سرو مستقیم: ارسال کوتاه‌راه (بیرون‌بر بدون آشپزخانه)
      for (const it of ord.items) {
        if (it.status === 'NEW') {
          await tx.orderItem.update({ where: { id: it.id }, data: { status: 'SERVED' } });
        } else {
          await tx.orderItem.update({ where: { id: it.id }, data: { status: 'SERVED' } });
        }
      }
      await tx.kitchenTicket.updateMany({
        where: { orderId, status: { not: 'SERVED' } },
        data: { status: 'SERVED', servedAt: new Date() },
      });

      let served = ord;
      // شارژ فولیوی اقامت در روم‌سرویس — همان قاعدهٔ خدمات جانبی
      if (ord.stayId) {
        await tx.stay.update({
          where: { id: ord.stayId },
          data: { folioRials: { increment: ord.totalRials } },
        });
      }
      if (ord.mode === 'DINE_IN' && ord.tableId) {
        await tx.diningTable.update({ where: { id: ord.tableId }, data: { status: 'FREE' } });
      }
      served = await tx.restaurantOrder.update({
        where: { id: orderId },
        data: { status: 'SERVED', servedAt: new Date() },
        include: { items: { include: { menuItem: { include: { recipe: true } } } }, outlet: true, stay: { select: { code: true } } },
      });

      // رویداد پولی فروش (قرارداد موجود) — folioId برای سند بدهکار ۱۲۰۱
      const moneyPayload: PosOrderServedPayload = {
        orderId: served.id,
        outletId: served.outletId,
        orderNo: served.orderNo,
        totalAmountRials: Number(served.totalRials),
        taxAmountRials: Number(served.taxRials),
        lines: served.items.filter((i) => OPEN_ITEM_STATUSES.has(i.status)).map((i) => ({
          itemName: i.menuItem.nameFa,
          qty: i.qty,
          unitPriceRials: Number(i.unitPriceRials),
          lineTotalRials: Number(i.lineNetRials),
        })),
        folioId: served.stayId,
      };
      await this.outbox.enqueue(tx, {
        eventName: EVENT_NAMES.POS_ORDER_SERVED,
        aggregate: 'restaurant_order',
        idempotencyKey: `restaurant.served.${served.orderNo}`,
        payload: moneyPayload as unknown as Record<string, unknown>,
        producer: 'restaurant',
      });

      // رویداد غیرپولی مصرف — زنجیرهٔ انبار فاز ۷
      const consumePayload: RestaurantOrderServedPayload = {
        orderId: served.id,
        orderNo: served.orderNo,
        outletCode: served.outlet.code,
        mode: served.mode,
        stayCode: served.stay?.code ?? null,
        lines: served.items
          .filter((i) => OPEN_ITEM_STATUSES.has(i.status))
          .map((i) => ({
            orderItemId: i.id,
            menuItemCode: i.menuItem.code,
            recipeCode: i.menuItem.recipe?.code ?? null,
            qty: i.qty,
          })),
      };
      await this.outbox.enqueue(tx, {
        eventName: EVENT_NAMES.RESTAURANT_ORDER_SERVED,
        aggregate: 'restaurant_order',
        idempotencyKey: `restaurant.consume.${served.orderNo}`,
        payload: consumePayload as unknown as Record<string, unknown>,
        producer: 'restaurant',
      });
      return [served] as const;
    });
    return this.mapOrder(order as unknown as Parameters<RestaurantService['mapOrder']>[0]);
  }

  async listOrders(limit = 50) {
    const rows = await this.prisma.restaurantOrder.findMany({
      orderBy: { openedAt: 'desc' },
      take: Math.min(limit, 200),
      include: { items: { include: { menuItem: true } }, outlet: { select: { code: true } } },
    });
    return rows.map((o) => this.mapOrder(o));
  }

  async getOrder(orderId: string) {
    const row = await this.prisma.restaurantOrder.findUnique({
      where: { id: orderId },
      include: { items: { include: { menuItem: true } } },
    });
    if (!row) throw new NotFoundException('سفارش یافت نشد');
    return this.mapOrder(row);
  }

  // ───────────── آشپزخانه (KDS) ─────────────

  async listKitchenTickets(status?: string, limit = 30) {
    const rows = await this.prisma.kitchenTicket.findMany({
      where: status ? { status: status as 'QUEUED' | 'PREPARING' | 'READY' | 'SERVED' } : { status: { not: 'SERVED' } },
      orderBy: { openedAt: 'asc' },
      take: Math.min(limit, 100),
      include: { order: { select: { orderNo: true } } },
    });
    return rows.map((t) => ({
      id: t.id,
      ticketNo: t.ticketNo,
      orderNo: t.order.orderNo,
      status: t.status,
      tableLabel: t.tableLabel,
      items: t.itemsJson as Array<{ name: string; qty: number; note: string | null }>,
      openedAt: t.openedAt.toISOString(),
      waitingMinutes: Math.floor((Date.now() - t.openedAt.getTime()) / 60000),
    }));
  }

  /** گردش وضعیت بلیت: QUEUED→PREPARING→READY→SERVED — اقلام سفارش هم‌گام می‌شوند */
  async updateTicketStatus(ticketId: string, status: 'PREPARING' | 'READY' | 'SERVED') {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "kitchen_tickets" WHERE id = ${ticketId}::uuid FOR UPDATE`;
      const ticket = await tx.kitchenTicket.findUnique({ where: { id: ticketId } });
      if (!ticket) throw new NotFoundException('بلیت یافت نشد');
      const flow: Record<string, number> = { QUEUED: 0, PREPARING: 1, READY: 2, SERVED: 3 };
      if (flow[status] <= flow[ticket.status]) throw new BadRequestException('گردش وضعیت بلیت باید رو به جلو باشد');
      const data: Record<string, unknown> = { status };
      if (status === 'PREPARING') data.readyAt = null;
      if (status === 'READY') data.readyAt = new Date();
      if (status === 'SERVED') data.servedAt = new Date();
      const updated = await tx.kitchenTicket.update({ where: { id: ticketId }, data });

      const itemStatus = status === 'PREPARING' ? 'PREPARING' : status === 'READY' ? 'READY' : 'SERVED';
      await tx.orderItem.updateMany({
        where: { orderId: ticket.orderId, status: { in: ['SENT_TO_KITCHEN', 'PREPARING', 'READY'] } },
        data: { status: itemStatus },
      });
      return { id: updated.id, ticketNo: updated.ticketNo, status: updated.status };
    });
  }

  private mapOrder(o: {
    id: string;
    orderNo: string;
    idempotencyKey?: string;
    outletId?: string;
    outlet?: { code: string };
    mode: string;
    status: string;
    guestName: string | null;
    discountRials: bigint;
    discountReason: string | null;
    netRials: bigint;
    taxRials: bigint;
    totalRials: bigint;
    stayId: string | null;
    openedAt: Date;
    servedAt: Date | null;
    items?: Array<{ id: string; qty: number; status: string; cancelReason: string | null; note: string | null; lineNetRials: bigint; menuItem: { code: string; nameFa: string } }>;
  }) {
    return {
      id: o.id,
      orderNo: o.orderNo,
      idempotencyKey: o.idempotencyKey ?? null,
      outletCode: o.outlet?.code ?? null,
      mode: o.mode,
      status: o.status,
      guestName: o.guestName,
      discountRials: Number(o.discountRials),
      discountReason: o.discountReason,
      netRials: Number(o.netRials),
      taxRials: Number(o.taxRials),
      totalRials: Number(o.totalRials),
      openedAt: o.openedAt.toISOString(),
      servedAt: o.servedAt ? o.servedAt.toISOString() : null,
      items: (o.items ?? []).map((i) => ({
        id: i.id,
        menuItemCode: i.menuItem.code,
        name: i.menuItem.nameFa,
        qty: i.qty,
        lineNetRials: Number(i.lineNetRials),
        status: i.status,
        cancelReason: i.cancelReason,
        note: i.note,
      })),
    };
  }
}
