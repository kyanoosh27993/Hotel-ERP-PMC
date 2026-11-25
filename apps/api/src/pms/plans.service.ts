/**
 * plans.service.ts — نسخهٔ ۳٫۴: پلان تور/شرکت (الگوی «لیست انواع پلانی هتل» مرجع کارفرما)
 * کدینگ درآمدی + قلم پلان (سهم میهمان / تور-شرکت) + تفکیک فولیو + فاکتور رسمی به نام هر طرف.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service';

export const CHARGE_GUEST = 'GUEST';
export const CHARGE_COMPANY = 'COMPANY';

@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  /* ── کدینگ درآمدی (دیکشنری مشترک) ── */

  async listRevenueCodes() {
    const rows = await this.prisma.revenueCode.findMany({ orderBy: { code: 'asc' } });
    return rows.map((r) => ({ id: r.id, code: r.code, nameFa: r.nameFa, nameEn: r.nameEn, isActive: r.isActive }));
  }

  async createRevenueCode(input: { code?: number; nameFa: string; nameEn?: string }) {
    let code = input.code;
    if (code === undefined) {
      const max = await this.prisma.revenueCode.aggregate({ _max: { code: true } });
      code = (max._max.code ?? 0) + 1;
    }
    const dup = await this.prisma.revenueCode.findUnique({ where: { code } });
    if (dup) throw new ConflictException({ code: 'VALIDATION', message: `کد درآمدی ${code} قبلاً ثبت شده است` });
    const r = await this.prisma.revenueCode.create({ data: { code, nameFa: input.nameFa, nameEn: input.nameEn ?? null } });
    return { id: r.id, code: r.code, nameFa: r.nameFa, nameEn: r.nameEn, isActive: r.isActive };
  }

  async updateRevenueCode(id: string, patch: { nameFa?: string; nameEn?: string; isActive?: boolean }) {
    const r = await this.prisma.revenueCode.findUnique({ where: { id } });
    if (!r) throw new NotFoundException({ code: 'NOT_FOUND', message: 'کد درآمدی یافت نشد' });
    const data: Record<string, unknown> = {};
    if (patch.nameFa !== undefined) data.nameFa = patch.nameFa;
    if (patch.nameEn !== undefined) data.nameEn = patch.nameEn || null;
    if (patch.isActive !== undefined) data.isActive = patch.isActive;
    const u = await this.prisma.revenueCode.update({ where: { id }, data });
    return { id: u.id, code: u.code, nameFa: u.nameFa, nameEn: u.nameEn, isActive: u.isActive };
  }

  /** حذف کد درآمدی — اگر در پلان یا فولیو استفاده شده ممنوع (حفرهٔ کدها در مرجع از همین قاعده می‌آید) */
  async deleteRevenueCode(id: string) {
    const r = await this.prisma.revenueCode.findUnique({
      where: { id },
      include: { _count: { select: { planItems: true, folioItems: true } } },
    });
    if (!r) throw new NotFoundException({ code: 'NOT_FOUND', message: 'کد درآمدی یافت نشد' });
    if (r._count.planItems > 0 || r._count.folioItems > 0) {
      throw new ConflictException({ code: 'BUSINESS_RULE', message: `این کد در ${r._count.planItems} قلم پلان و ${r._count.folioItems} قلم فولیو استفاده شده — فقط غیرفعال می‌شود` });
    }
    await this.prisma.revenueCode.delete({ where: { id } });
    return { deleted: true, code: r.code };
  }

  /* ── پلان‌ها ── */

  async listPlans() {
    const rows = await this.prisma.plan.findMany({
      orderBy: { code: 'asc' },
      include: { _count: { select: { items: true, reservations: true, stays: true } } },
    });
    return rows.map((p) => ({
      id: p.id,
      code: p.code,
      nameFa: p.nameFa,
      nameLatin: p.nameLatin,
      isActive: p.isActive,
      createdAt: p.createdAt.toISOString(),
      itemsCount: p._count.items,
      reservationsCount: p._count.reservations,
      staysCount: p._count.stays,
    }));
  }

  async createPlan(input: { code?: number; nameFa: string; nameLatin?: string; isActive?: boolean; createdById?: string }) {
    let code = input.code;
    if (code === undefined) {
      const max = await this.prisma.plan.aggregate({ _max: { code: true } });
      code = (max._max.code ?? 0) + 1;
    }
    const dup = await this.prisma.plan.findUnique({ where: { code } });
    if (dup) throw new ConflictException({ code: 'VALIDATION', message: `کد پلان ${code} قبلاً ثبت شده است` });
    const p = await this.prisma.plan.create({
      data: {
        code,
        nameFa: input.nameFa,
        nameLatin: input.nameLatin ?? null,
        isActive: input.isActive ?? true,
        createdById: input.createdById ?? null,
      },
    });
    return { id: p.id, code: p.code, nameFa: p.nameFa, nameLatin: p.nameLatin, isActive: p.isActive, itemsCount: 0 };
  }

  async updatePlan(id: string, patch: { nameFa?: string; nameLatin?: string; isActive?: boolean }) {
    const p = await this.prisma.plan.findUnique({ where: { id } });
    if (!p) throw new NotFoundException({ code: 'NOT_FOUND', message: 'پلان یافت نشد' });
    const data: Record<string, unknown> = {};
    if (patch.nameFa !== undefined) data.nameFa = patch.nameFa;
    if (patch.nameLatin !== undefined) data.nameLatin = patch.nameLatin || null;
    if (patch.isActive !== undefined) data.isActive = patch.isActive;
    const u = await this.prisma.plan.update({ where: { id }, data });
    return { id: u.id, code: u.code, nameFa: u.nameFa, nameLatin: u.nameLatin, isActive: u.isActive };
  }

  /** حذف پلان — اگر رزرو/اقامت از آن استفاده می‌کند ممنوع (شبیه «ردیف» حفره‌دار مرجع) */
  async deletePlan(id: string) {
    const p = await this.prisma.plan.findUnique({
      where: { id },
      include: { _count: { select: { reservations: true, stays: true } } },
    });
    if (!p) throw new NotFoundException({ code: 'NOT_FOUND', message: 'پلان یافت نشد' });
    if (p._count.reservations > 0 || p._count.stays > 0) {
      throw new ConflictException({ code: 'BUSINESS_RULE', message: `این پلان در ${p._count.reservations} رزرو و ${p._count.stays} اقامت استفاده شده — غیرفعال کنید` });
    }
    await this.prisma.plan.delete({ where: { id } });
    return { deleted: true, code: p.code };
  }

  /* ── اقلام پلان («جزئيات پلان» مرجع) ── */

  async listPlanItems(planId: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException({ code: 'NOT_FOUND', message: 'پلان یافت نشد' });
    const items = await this.prisma.planItem.findMany({
      where: { planId },
      include: { revenueCode: true },
      orderBy: { revenueCode: { code: 'asc' } },
    });
    // نمایش تفکیکی مثل مرجع: اول سهم میهمان، بعد سهم تور/شرکت
    const guest = items.filter((i) => i.chargeTo === CHARGE_GUEST);
    const company = items.filter((i) => i.chargeTo === CHARGE_COMPANY);
    const map = (i: typeof items[number]) => ({
      id: i.id,
      revenueCodeId: i.revenueCodeId,
      code: i.revenueCode.code,
      nameFa: i.revenueCode.nameFa,
      nameEn: i.revenueCode.nameEn,
      chargeTo: i.chargeTo,
    });
    return {
      plan: { id: plan.id, code: plan.code, nameFa: plan.nameFa, nameLatin: plan.nameLatin },
      guest: guest.map(map),
      company: company.map(map),
    };
  }

  /** نمایش تفکیکی پلان — دو ستون مرجع */
  async planSplit(planId: string) {
    return this.listPlanItems(planId);
  }

  async addPlanItem(planId: string, input: { revenueCodeId: string; chargeTo?: string; createdById?: string }) {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException({ code: 'NOT_FOUND', message: 'پلان یافت نشد' });
    const rc = await this.prisma.revenueCode.findUnique({ where: { id: input.revenueCodeId } });
    if (!rc) throw new NotFoundException({ code: 'NOT_FOUND', message: 'کد درآمدی یافت نشد' });
    const chargeTo = this.validChargeTo(input.chargeTo);
    const existing = await this.prisma.planItem.findUnique({
      where: { planId_revenueCodeId: { planId, revenueCodeId: input.revenueCodeId } },
    });
    if (existing) {
      // idempotent مثل مرجع: قلم تکراری فقط سهمش به‌روز می‌شود
      const u = await this.prisma.planItem.update({ where: { id: existing.id }, data: { chargeTo } });
      return { id: u.id, revenueCodeId: u.revenueCodeId, chargeTo: u.chargeTo, updated: true };
    }
    const item = await this.prisma.planItem.create({
      data: { planId, revenueCodeId: input.revenueCodeId, chargeTo, createdById: input.createdById ?? null },
    });
    return { id: item.id, revenueCodeId: item.revenueCodeId, chargeTo: item.chargeTo, updated: false };
  }

  async updatePlanItem(itemId: string, patch: { chargeTo?: string }) {
    const item = await this.prisma.planItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException({ code: 'NOT_FOUND', message: 'قلم پلان یافت نشد' });
    const data: Record<string, unknown> = {};
    if (patch.chargeTo !== undefined) data.chargeTo = this.validChargeTo(patch.chargeTo);
    const u = await this.prisma.planItem.update({ where: { id: itemId }, data });
    return { id: u.id, revenueCodeId: u.revenueCodeId, chargeTo: u.chargeTo };
  }

  async deletePlanItem(itemId: string) {
    const item = await this.prisma.planItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException({ code: 'NOT_FOUND', message: 'قلم پلان یافت نشد' });
    await this.prisma.planItem.delete({ where: { id: itemId } });
    return { deleted: true, id: itemId };
  }

  private validChargeTo(v?: string): string {
    if (v === undefined || v === null || v === '') return CHARGE_GUEST;
    if (v === CHARGE_GUEST || v === CHARGE_COMPANY) return v;
    throw new ConflictException({ code: 'VALIDATION', message: 'مسیر صورت‌حساب فقط «GUEST» یا «COMPANY» است' });
  }

  /* ── مسیریابی فولیو بر اساس پلان اقامت ── */

  /**
   * تعیین مسیر قلم فولیو: اگر اقامت پلان دارد و کد درآمدی در پلان هست → سهم همان قلم؛
   * کد بدون قلم در پلان → میهمان (رفتار مرجع: کدهای افزوده‌شدهٔ بعدی پیش‌فرض میهمان‌اند)؛
   * بدون کد/بدون پلان → میهمان.
   */
  async resolveChargeTo(stayId: string, revenueCodeId?: string): Promise<string> {
    if (!revenueCodeId) return CHARGE_GUEST;
    const stay = await this.prisma.stay.findUnique({ where: { id: stayId }, select: { planId: true, reservation: { select: { planId: true } } } });
    const planId = stay?.planId ?? stay?.reservation?.planId ?? null;
    if (!planId) return CHARGE_GUEST;
    const item = await this.prisma.planItem.findUnique({
      where: { planId_revenueCodeId: { planId, revenueCodeId } },
    });
    return item?.chargeTo ?? CHARGE_GUEST;
  }

  /** تفکیک فولیو اقامت به دو صورت‌حساب: میهمان و تور/شرکت («نمایش تفکیکی» مرجع) */
  async folioSplit(stayId: string) {
    const stay = await this.prisma.stay.findUnique({
      where: { id: stayId },
      include: { folioItems: { orderBy: { postedAt: 'desc' }, include: { revenue: true } } },
    });
    if (!stay) throw new NotFoundException({ code: 'NOT_FOUND', message: 'اقامت یافت نشد' });
    const map = (f: typeof stay.folioItems[number]) => ({
      id: f.id,
      desc: f.desc,
      qty: f.qty,
      unitRials: f.unitRials.toString(),
      totalRials: f.totalRials.toString(),
      postedAt: f.postedAt.toISOString(),
      revenueCode: f.revenue ? { id: f.revenue.id, code: f.revenue.code, nameFa: f.revenue.nameFa } : null,
      chargeTo: f.chargeTo ?? CHARGE_GUEST,
    });
    const guest = stay.folioItems.filter((f) => (f.chargeTo ?? CHARGE_GUEST) === CHARGE_GUEST).map(map);
    const company = stay.folioItems.filter((f) => f.chargeTo === CHARGE_COMPANY).map(map);
    const sum = (arr: typeof guest) => arr.reduce((acc, x) => acc + BigInt(x.totalRials), 0n);
    return {
      stay: { id: stay.id, code: stay.code, guestName: stay.guestName, status: stay.status, planId: stay.planId },
      guest: { items: guest, totalRials: sum(guest).toString() },
      company: { items: company, totalRials: sum(company).toString() },
    };
  }

  /**
   * صدور فاکتور رسمی به نام یک طرف (میهمان یا تور/شرکت) از تفکیک فولیو —
   * خروجی: صورتحساب DRAFT مؤدیان با ردیف‌های همان طرف؛ ارسال از مسیر موجود
   * POST /compliance/moadian/invoices/:id/retry انجام می‌شود.
   */
  async issueInvoice(stayId: string, debtor: 'GUEST' | 'COMPANY', input: { buyerTaxId?: string; buyerName?: string; userId?: string }) {
    const split = await this.folioSplit(stayId);
    const side = debtor === 'COMPANY' ? split.company : split.guest;
    if (!side.items.length) {
      throw new ConflictException({ code: 'BUSINESS_RULE', message: debtor === 'COMPANY' ? 'هیچ قلمی بر عهدهٔ تور/شرکت نیست' : 'هیچ قلمی بر عهدهٔ میهمان نیست' });
    }
    const stay = await this.prisma.stay.findUnique({ where: { id: stayId } });
    if (!stay) throw new NotFoundException({ code: 'NOT_FOUND', message: 'اقامت یافت نشد' });
    const buyerName = input.buyerName ?? (debtor === 'COMPANY' ? split.stay.guestName : stay.guestName);
    const inv = await this.prisma.moadianInvoice.create({
      data: {
        invoiceNumber: `DRAFT-FOLIO-${split.stay.code}-${debtor}-${Date.now().toString(36)}`,
        journalEntryId: randomUUID(), // سند تسویه در لحظهٔ خروج صادر می‌شود؛ پیش‌نویس به اقامت گره می‌خورد
        sellerTaxId: process.env.MOADIAN_SELLER_TAX_ID ?? '',
        buyerTaxId: input.buyerTaxId ?? '',
        buyerName: buyerName ?? '',
        issueDate: new Date(),
        status: 'DRAFT',
        header: JSON.parse(JSON.stringify({ source: 'FOLIO_SPLIT', stayCode: split.stay.code, debtor })),
        body: side.items.map((it, idx) => ({
          row: idx + 1,
          desc: it.desc,
          revenueCode: it.revenueCode?.code ?? null,
          qty: it.qty,
          unitRials: it.unitRials,
          totalRials: it.totalRials,
        })),
        totalRials: BigInt(side.totalRials),
        vatRials: 0n, // مالیات ارزش افزوده از سند فروش تسویه محاسبه می‌شود — پیش‌نویس صفر
        discountRials: 0n,
        idempotencyKey: `stay:${split.stay.id}:${debtor}:draft:${Date.now().toString(36)}`,
        lastResponse: { note: 'پیش‌نویس از تفکیک فولیو اقامت — پس از تسویه به سند فروش گره می‌خورد' },
      },
    });
    return { id: inv.id, invoiceNumber: inv.invoiceNumber, debtor, buyerName: inv.buyerName, totalRials: inv.totalRials.toString(), status: inv.status, rows: (inv.body as unknown[]).length };
  }
}
