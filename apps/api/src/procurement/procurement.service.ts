/**
 * procurement.service.ts — فاز ۷ (موج ۲): تأمین‌کننده، درخواست کالا، سفارش خرید و رسید خرید.
 * قواعد سند PHASE7-...: GRN جزئی/کامل با به‌روزرسانی qtyReceived سطرها و وضعیت PO؛
 * گردش IN انبار از ماژول stores (مرجع مشترک سند انبار/مالی)؛ رویدادهای
 * procurement.po.approved (غیرپولی) و procurement.grn.received (پولی) هم‌تراکنشی.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  EVENT_NAMES,
  type GrnReceivedPayload,
  type PurchaseOrderApprovedPayload,
} from '@hotel-erp/contracts';
import { Prisma } from '@prisma/client';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma.service';
import { StoresService } from '../stores/stores.service';

@Injectable()
export class ProcurementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly stores: StoresService,
  ) {}

  // ───────────── تأمین‌کننده ─────────────

  async createSupplier(input: { code: string; nameEn: string; nameFa: string; phone?: string | null; ledgerCode?: string }) {
    const row = await this.prisma.supplier.create({
      data: {
        code: input.code,
        nameEn: input.nameEn,
        nameFa: input.nameFa,
        phone: input.phone ?? null,
        ledgerCode: input.ledgerCode ?? '2101',
      },
    }).catch((e: { code?: string }) => {
      if (e.code === 'P2002') throw new BadRequestException('کد تأمین‌کننده تکراری است');
      throw e;
    });
    return { id: row.id, code: row.code, ledgerCode: row.ledgerCode };
  }

  async listSuppliers() {
    const rows = await this.prisma.supplier.findMany({ orderBy: { code: 'asc' } });
    return rows.map((s) => ({
      id: s.id,
      code: s.code,
      nameFa: s.nameFa,
      phone: s.phone,
      ledgerCode: s.ledgerCode,
      active: s.active,
    }));
  }

  // ───────────── درخواست کالا ─────────────

  async createRequisition(input: {
    items: Array<{ stockItemCode: string; qty: number; note?: string | null }>;
    note?: string | null;
    userId?: string;
  }) {
    if (!input.items.length) throw new BadRequestException('درخواست بدون قلم مجاز نیست');
    return this.prisma.$transaction(async (tx) => {
      const seq = (await tx.purchaseRequisition.count()) + 1;
      const req = await tx.purchaseRequisition.create({
        data: {
          reqNo: `REQ-${new Date().getUTCFullYear()}-${String(seq).padStart(6, '0')}`,
          requestedById: input.userId,
          note: input.note ?? null,
          lines: { create: [] },
        },
      });
      for (const l of input.items) {
        if (l.qty <= 0) throw new BadRequestException('تعداد باید مثبت باشد');
        const item = await tx.stockItem.findUnique({ where: { code: l.stockItemCode } });
        if (!item) throw new NotFoundException(`قلم انبار ${l.stockItemCode} یافت نشد`);
        await tx.purchaseRequisitionLine.create({
          data: { reqId: req.id, stockItemId: item.id, qty: l.qty, note: l.note ?? null },
        });
      }
      return { id: req.id, reqNo: req.reqNo, status: req.status };
    });
  }

  async updateRequisition(input: {
    id: string;
    status: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CONVERTED';
    userId?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "purchase_requisitions" WHERE id = ${input.id}::uuid FOR UPDATE`;
      const req = await tx.purchaseRequisition.findUnique({ where: { id: input.id } });
      if (!req) throw new NotFoundException('درخواست یافت نشد');
      const flow: Record<string, number> = { DRAFT: 0, SUBMITTED: 1, APPROVED: 2, CONVERTED: 3, REJECTED: 3 };
      if (flow[input.status] <= flow[req.status]) throw new BadRequestException('گردش وضعیت درخواست باید رو به جلو باشد');
      if (req.status === 'REJECTED') throw new BadRequestException('درخواست رد‌شده قابل تغییر نیست');
      await tx.purchaseRequisition.update({
        where: { id: req.id },
        data: { status: input.status, decidedById: input.userId, decidedAt: new Date() },
      });
      return { id: req.id, reqNo: req.reqNo, status: input.status };
    });
  }

  async listRequisitions(status?: string, limit = 50) {
    const rows = await this.prisma.purchaseRequisition.findMany({
      where: status ? { status: status as 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'CONVERTED' | 'REJECTED' } : {},
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
      include: { lines: { include: { stockItem: { select: { code: true, nameFa: true } } } } },
    });
    return rows.map((r) => ({
      id: r.id,
      reqNo: r.reqNo,
      status: r.status,
      lines: r.lines.map((l) => ({ code: l.stockItem.code, name: l.stockItem.nameFa, qty: Number(l.qty) })),
    }));
  }

  // ───────────── سفارش خرید ─────────────

  /** تبدیل درخواست تأییدشده به سفارش خرید (یا PO مستقیم) — جمع‌ها ریال صحیح */
  async createPurchaseOrder(input: {
    supplierCode: string;
    requisitionId?: string | null;
    items: Array<{ stockItemCode: string; qty: number; unitCostRials: number; taxRateBps?: number }>;
    userId?: string;
  }) {
    if (!input.items.length) throw new BadRequestException('سفارش خرید بدون قلم مجاز نیست');
    return this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findUnique({ where: { code: input.supplierCode } });
      if (!supplier || !supplier.active) throw new NotFoundException('تأمین‌کننده یافت نشد');

      if (input.requisitionId) {
        const req = await tx.purchaseRequisition.findUnique({ where: { id: input.requisitionId } });
        if (!req || req.status !== 'APPROVED') throw new BadRequestException('تبدیل فقط از درخواست تأییدشده مجاز است');
      }

      let subtotal = 0n;
      let taxSum = 0n;
      const lineData: Array<{ stockItemId: string; qtyOrdered: number; unitCostRials: bigint; taxRateBps: number }> = [];
      for (const l of input.items) {
        if (l.qty <= 0) throw new BadRequestException('تعداد باید مثبت باشد');
        if (l.unitCostRials < 0) throw new BadRequestException('بهای واحد نمی‌تواند منفی باشد');
        const item = await tx.stockItem.findUnique({ where: { code: l.stockItemCode } });
        if (!item) throw new NotFoundException(`قلم انبار ${l.stockItemCode} یافت نشد`);
        const bps = l.taxRateBps ?? 900;
        const lineNet = BigInt(l.unitCostRials) * BigInt(Math.round(l.qty));
        subtotal += lineNet;
        taxSum += (lineNet * BigInt(bps)) / 10000n;
        lineData.push({ stockItemId: item.id, qtyOrdered: l.qty, unitCostRials: BigInt(l.unitCostRials), taxRateBps: bps });
      }
      const tax = taxSum;
      const total = subtotal + tax;

      const seq = (await tx.purchaseOrder.count()) + 1;
      const po = await tx.purchaseOrder.create({
        data: {
          poNo: `PO-${new Date().getUTCFullYear()}-${String(seq).padStart(6, '0')}`,
          supplierId: supplier.id,
          requisitionId: input.requisitionId ?? null,
          subtotalRials: subtotal,
          taxRials: tax,
          totalRials: total,
          lines: { create: lineData },
        },
        include: { lines: { include: { stockItem: true } } },
      });
      return { id: po.id, poNo: po.poNo, totalRials: Number(po.totalRials), lines: po.lines.length, status: po.status };
    });
  }

  /** تأیید PO — رویداد تعهد خرید (غیرپولی) */
  async approvePurchaseOrder(poId: string, userId?: string) {
    const [po] = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "purchase_orders" WHERE id = ${poId}::uuid FOR UPDATE`;
      const row = await tx.purchaseOrder.findUnique({ where: { id: poId }, include: { supplier: true, lines: { include: { stockItem: true } } } });
      if (!row) throw new NotFoundException('سفارش خرید یافت نشد');
      if (row.status !== 'DRAFT') throw new BadRequestException('سفارش قبلاً تأیید یا لغو شده است');
      await tx.purchaseOrder.update({ where: { id: row.id }, data: { status: 'APPROVED', decidedById: userId, decidedAt: new Date() } });

      const payload: PurchaseOrderApprovedPayload = {
        poId: row.id,
        poNo: row.poNo,
        supplierCode: row.supplier.code,
        totalRials: Number(row.totalRials),
        lines: row.lines.map((l) => ({
          stockItemCode: l.stockItem.code,
          qty: Number(l.qtyOrdered),
          unitCostRials: Number(l.unitCostRials),
        })),
      };
      await this.outbox.enqueue(tx, {
        eventName: EVENT_NAMES.PURCHASE_ORDER_APPROVED,
        aggregate: 'purchase_order',
        idempotencyKey: `procurement.po.${row.poNo}`,
        payload: payload as unknown as Record<string, unknown>,
        producer: 'procurement',
      });
      return [row] as const;
    });
    return { id: po.id, poNo: po.poNo, status: 'APPROVED' as const };
  }

  async cancelPurchaseOrder(poId: string, userId?: string) {
    const po = await this.prisma.purchaseOrder.update({
      where: { id: poId },
      data: { status: 'CANCELED', decidedById: userId },
    }).catch((e: { code?: string }) => {
      if (e.code === 'P2025') throw new NotFoundException('سفارش خرید یافت نشد');
      throw e;
    });
    if (po.status === 'RECEIVED') throw new BadRequestException('سفارش کامل‌رسید قابل لغو نیست');
    return { id: po.id, poNo: po.poNo, status: po.status };
  }

  async listPurchaseOrders(status?: string, limit = 50) {
    const rows = await this.prisma.purchaseOrder.findMany({
      where: status ? { status: status as 'DRAFT' | 'APPROVED' | 'PARTIAL' | 'RECEIVED' | 'CANCELED' } : {},
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
      include: {
        supplier: { select: { code: true, nameFa: true } },
        lines: { include: { stockItem: { select: { code: true, nameFa: true } } } },
      },
    });
    return rows.map((p) => ({
      id: p.id,
      poNo: p.poNo,
      supplier: p.supplier.nameFa,
      status: p.status,
      totalRials: Number(p.totalRials),
      lines: p.lines.map((l) => ({
        code: l.stockItem.code,
        name: l.stockItem.nameFa,
        qtyOrdered: Number(l.qtyOrdered),
        qtyReceived: Number(l.qtyReceived),
        unitCostRials: Number(l.unitCostRials),
      })),
    }));
  }

  // ───────────── رسید خرید (GRN) ─────────────

  /**
   * ثبت رسید خرید — کامل یا جزئی روی سطرهای PO تأییدشده:
   * گردش IN انبار با میانگین موزون + رویداد پولی GRN (۱۳۰۱/۲۲۰۴/تأمین‌کننده).
   */
  async createGoodsReceipt(input: {
    poCode: string;
    lines: Array<{ poLineId?: string; stockItemCode?: string; qtyReceived: number; unitCostRials?: number; expiryDate?: string | null }>;
    note?: string | null;
    userId?: string;
  }) {
    if (!input.lines.length) throw new BadRequestException('رسید بدون سطر مجاز نیست');
    return this.prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({
        where: { poNo: input.poCode },
        include: { supplier: true, lines: { include: { stockItem: true } } },
      });
      if (!po) throw new NotFoundException('سفارش خرید یافت نشد');
      if (po.status !== 'APPROVED' && po.status !== 'PARTIAL') throw new BadRequestException('رسید فقط روی سفارش تأییدشده ثبت می‌شود');

      const seq = (await tx.goodsReceipt.count()) + 1;
      const grn = await tx.goodsReceipt.create({
        data: {
          grnNo: `GRN-${new Date().getUTCFullYear()}-${String(seq).padStart(6, '0')}`,
          poId: po.id,
          receivedById: input.userId,
          note: input.note ?? null,
        },
      });

      let net = 0n;
      let tax = 0n;
      const payloadLines: Array<{ stockItemCode: string; qty: number; unitCostRials: number }> = [];
      for (const l of input.lines) {
        if (l.qtyReceived <= 0) throw new BadRequestException('تعداد رسید باید مثبت باشد');
        const poLine = l.poLineId
          ? po.lines.find((p) => p.id === l.poLineId)
          : po.lines.find((p) => p.stockItem.code === l.stockItemCode);
        if (!poLine) throw new NotFoundException('سطر سفارش یافت نشد');
        const remaining = Number(poLine.qtyOrdered.minus(poLine.qtyReceived));
        if (Number(l.qtyReceived) > remaining) {
          throw new BadRequestException(`رسید ${l.qtyReceived} بیشتر از باقیماندهٔ سطر (${remaining}) است`);
        }
        const unitCost = BigInt(l.unitCostRials ?? poLine.unitCostRials);
        const lineNet = unitCost * BigInt(Math.round(Number(l.qtyReceived)));
        const lineTax = (lineNet * BigInt(poLine.taxRateBps)) / 10000n;
        net += lineNet;
        tax += lineTax;
        payloadLines.push({ stockItemCode: poLine.stockItem.code, qty: Number(l.qtyReceived), unitCostRials: Number(unitCost) });

        await tx.goodsReceiptLine.create({
          data: {
            grnId: grn.id,
            poLineId: poLine.id,
            qtyReceived: new Prisma.Decimal(l.qtyReceived),
            unitCostRials: unitCost,
            expiryDate: l.expiryDate ? new Date(l.expiryDate) : null,
          },
        });
        await tx.purchaseOrderLine.update({
          where: { id: poLine.id },
          data: { qtyReceived: { increment: new Prisma.Decimal(l.qtyReceived) } },
        });
        // گردش IN انبار به «واحد مصرف» با ضریب تبدیل (مثلاً کیلو→گرم) — بهای واحد هم به واحد مصرف گرد می‌شود
        const factor = Number(poLine.stockItem.conversionFactor) || 1;
        const unitCostUc = BigInt(Math.round(Number(unitCost) / factor));
        await this.stores.applyMovement(tx, {
          stockItemId: poLine.stockItemId,
          warehouseId: poLine.stockItem.warehouseId,
          direction: 'IN',
          qty: Number(l.qtyReceived) * factor,
          unitCostRials: unitCostUc,
          refModule: 'procurement',
          refId: grn.grnNo,
          note: `GRN ${grn.grnNo}`,
          userId: input.userId,
        });
      }

      // وضعیت PO: کامل یا جزئی
      const after = await tx.purchaseOrderLine.findMany({ where: { poId: po.id } });
      const allDone = after.every((l) => l.qtyReceived.comparedTo(l.qtyOrdered) >= 0);
      const anyReceived = after.some((l) => Number(l.qtyReceived) > 0);
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { status: allDone ? 'RECEIVED' : 'PARTIAL' },
      });
      if (po.requisitionId) {
        await tx.purchaseRequisition.update({ where: { id: po.requisitionId }, data: { status: 'CONVERTED' } });
      }

      const payload: GrnReceivedPayload = {
        grnId: grn.id,
        grnNo: grn.grnNo,
        poNo: po.poNo,
        supplierCode: po.supplier.code,
        supplierLedgerCode: po.supplier.ledgerCode,
        netRials: Number(net),
        taxRials: Number(tax),
        totalRials: Number(net + tax),
        lines: payloadLines,
      };
      await this.outbox.enqueue(tx, {
        eventName: EVENT_NAMES.GRN_RECEIVED,
        aggregate: 'goods_receipt',
        idempotencyKey: `procurement.grn.${grn.grnNo}`,
        payload: payload as unknown as Record<string, unknown>,
        producer: 'procurement',
      });

      return {
        id: grn.id,
        grnNo: grn.grnNo,
        poStatus: allDone ? 'RECEIVED' : 'PARTIAL',
        netRials: Number(net),
        taxRials: Number(tax),
        totalRials: Number(net + tax),
        anyReceived,
      };
    });
  }

  async listReceipts(limit = 50) {
    const rows = await this.prisma.goodsReceipt.findMany({
      orderBy: { receivedAt: 'desc' },
      take: Math.min(limit, 200),
      include: { lines: true },
    });
    return rows.map((g) => ({
      id: g.id,
      grnNo: g.grnNo,
      receivedAt: g.receivedAt.toISOString(),
      lineCount: g.lines.length,
      note: g.note,
    }));
  }
}
