/**
 * assets.service.ts — فاز ۱۰ (موج ۱): پروندهٔ دارایی ثابت، انتقال، اسقاط/فروش و اجرای استهلاک دوره.
 * قواعد سند PHASE10-HOUSEKEEPING-ASSETS-SERVICES.md:
 * قسط خط مستقیم = (بها − اسقاط) ÷ عمر مفید ماهانه؛ سقف تا استهلاک کامل؛
 * هر (دارایی، دوره) فقط یک‌بار؛ سند با رویداد assets.depreciation.posted هم‌تراکنشی.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EVENT_NAMES, type AssetDepreciationPostedPayload } from '@hotel-erp/contracts';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma.service';

const PERIOD_RE = /^\d{4}-\d{2}$/; // '1405-09'

@Injectable()
export class AssetsService {
  constructor(private readonly prisma: PrismaService, private readonly outbox: OutboxService) {}

  async registerAsset(input: {
    nameEn: string;
    nameFa: string;
    category: string;
    acquiredAt: string;
    costRials: number;
    salvageRials?: number;
    usefulLifeMonths: number;
    glAssetAccountCode?: string;
    glAccDepAccountCode?: string;
    glDepExpenseAccountCode?: string;
    roomCode?: string | null;
    note?: string | null;
    userId?: string;
  }) {
    const cost = BigInt(input.costRials);
    const salvage = BigInt(input.salvageRials ?? 0);
    if (cost <= 0n) throw new BadRequestException('بهای تمام‌شده باید مثبت باشد');
    if (salvage >= cost) throw new BadRequestException('ارزش اسقاط باید کمتر از بهای تمام‌شده باشد');
    if (input.usefulLifeMonths < 1) throw new BadRequestException('عمر مفید حداقل یک ماه است');

    return this.prisma.$transaction(async (tx) => {
      let roomId: string | null = null;
      if (input.roomCode) {
        const room = await tx.room.findUnique({ where: { code: input.roomCode } });
        if (!room) throw new NotFoundException('اتاق یافت نشد');
        roomId = room.id;
      }
      const seq = (await tx.fixedAsset.count()) + 1;
      const asset = await tx.fixedAsset.create({
        data: {
          assetCode: `FA-${String(seq).padStart(5, '0')}`,
          nameEn: input.nameEn,
          nameFa: input.nameFa,
          category: input.category,
          acquiredAt: new Date(input.acquiredAt),
          costRials: cost,
          salvageRials: salvage,
          usefulLifeMonths: input.usefulLifeMonths,
          glAssetAccountCode: input.glAssetAccountCode ?? '1501',
          glAccDepAccountCode: input.glAccDepAccountCode ?? '1502',
          glDepExpenseAccountCode: input.glDepExpenseAccountCode ?? '5201',
          roomId,
          note: input.note ?? null,
          createdById: input.userId,
        },
      });
      return { id: asset.id, assetCode: asset.assetCode, status: asset.status };
    });
  }

  /** انتقال محل استقرار — تاریخچه در یادداشت حفظ می‌شود */
  async transferAsset(assetId: string, roomCode: string | null) {
    return this.prisma.$transaction(async (tx) => {
      const asset = await tx.fixedAsset.findUnique({ where: { id: assetId } });
      if (!asset) throw new NotFoundException('دارایی یافت نشد');
      if (asset.status !== 'ACTIVE') throw new BadRequestException('دارایی غیرفعال قابل انتقال نیست');
      let roomId: string | null = null;
      if (roomCode) {
        const room = await tx.room.findUnique({ where: { code: roomCode } });
        if (!room) throw new NotFoundException('اتاق یافت نشد');
        roomId = room.id;
      }
      await tx.fixedAsset.update({
        where: { id: asset.id },
        data: {
          roomId,
          note: `${asset.note ? asset.note + ' | ' : ''}TRANSFER: به ${roomCode ?? 'انبار مرکزی'}`,
        },
      });
      return { id: asset.id, assetCode: asset.assetCode, roomCode };
    });
  }

  /** خروج از سرویس: فروش یا اسقاط — حذف فیزیکی ممنوع (قاعدهٔ سند قطعی) */
  async disposeAsset(assetId: string, action: 'SOLD' | 'SCRAPPED', reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const asset = await tx.fixedAsset.findUnique({ where: { id: assetId } });
      if (!asset) throw new NotFoundException('دارایی یافت نشد');
      if (asset.status !== 'ACTIVE') throw new BadRequestException('این دارایی قبلاً خارج شده است');
      if (!reason || reason.trim().length < 3) throw new BadRequestException('دلیل الزامی است');
      await tx.fixedAsset.update({
        where: { id: asset.id },
        data: { status: action, note: `${asset.note ? asset.note + ' | ' : ''}${action}: ${reason}` },
      });
      return { id: asset.id, assetCode: asset.assetCode, status: action };
    });
  }

  /** اجرای استهلاک دوره برای همهٔ دارایی‌های فعال — هر (دارایی، دوره) فقط یک‌بار */
  async runDepreciation(input: { periodCode: string; userId?: string }) {
    if (!PERIOD_RE.test(input.periodCode)) throw new BadRequestException('فرمت دوره باید 1405-MM باشد');

    return this.prisma.$transaction(async (tx) => {
      const assets = await tx.fixedAsset.findMany({ where: { status: 'ACTIVE' }, orderBy: { assetCode: 'asc' } });
      const results: Array<{ assetCode: string; amountRials: number | null; skipped: string }> = [];
      for (const asset of assets) {
        const existing = await tx.assetDepreciation.findUnique({
          where: { assetId_periodCode: { assetId: asset.id, periodCode: input.periodCode } },
        });
        if (existing) {
          results.push({ assetCode: asset.assetCode, amountRials: Number(existing.amountRials), skipped: 'already_posted' });
          continue;
        }
        // استهلاک انباشته تا الان
        const prev = await tx.assetDepreciation.aggregate({
          where: { assetId: asset.id },
          _sum: { amountRials: true },
        });
        const accumulated = prev._sum.amountRials ?? 0n;
        const depreciable = asset.costRials - asset.salvageRials;
        const remaining = depreciable - accumulated;
        if (remaining <= 0n) {
          results.push({ assetCode: asset.assetCode, amountRials: null, skipped: 'fully_depreciated' });
          continue;
        }
        const monthly = depreciable / BigInt(asset.usefulLifeMonths);
        const amount = monthly < remaining ? monthly : remaining;

        const payload: AssetDepreciationPostedPayload = {
          assetId: asset.id,
          assetCode: asset.assetCode,
          periodCode: input.periodCode,
          depreciationRials: Number(amount),
          accumulatedRials: Number(accumulated + amount),
        };
        await this.outbox.enqueue(tx, {
          eventName: EVENT_NAMES.ASSET_DEPRECIATION_POSTED,
          aggregate: 'fixed_asset',
          idempotencyKey: `assets.dep.${asset.assetCode}.${input.periodCode}`,
          payload: payload as unknown as Record<string, unknown>,
          producer: 'assets',
        });

        await tx.assetDepreciation.create({
          data: {
            assetId: asset.id,
            periodCode: input.periodCode,
            amountRials: amount,
            accumulatedRials: accumulated + amount,
            idempotencyKey: `assets.dep.${asset.assetCode}.${input.periodCode}`,
          },
        });
        results.push({ assetCode: asset.assetCode, amountRials: Number(amount), skipped: '' });
      }
      return { periodCode: input.periodCode, processed: results.length, results };
    });
  }

  async listAssets(limit = 200) {
    const rows = await this.prisma.fixedAsset.findMany({
      orderBy: { assetCode: 'asc' },
      take: Math.min(limit, 500),
      include: {
        room: { select: { code: true } },
        depreciations: { orderBy: { periodCode: 'desc' }, take: 1 },
      },
    });
    return rows.map((a) => ({
      id: a.id,
      assetCode: a.assetCode,
      nameFa: a.nameFa,
      category: a.category,
      acquiredAt: a.acquiredAt.toISOString().slice(0, 10),
      costRials: Number(a.costRials),
      salvageRials: Number(a.salvageRials),
      usefulLifeMonths: a.usefulLifeMonths,
      roomCode: a.room?.code ?? null,
      status: a.status,
      accumulatedRials: a.depreciations[0] ? Number(a.depreciations[0].accumulatedRials) : 0,
      lastPeriod: a.depreciations[0]?.periodCode ?? null,
    }));
  }

  async depreciationReport(periodCode: string) {
    const rows = await this.prisma.assetDepreciation.findMany({
      where: { periodCode },
      orderBy: { assetId: 'asc' },
      include: { asset: { select: { assetCode: true, nameFa: true } } },
    });
    const total = rows.reduce((acc, r) => acc + r.amountRials, 0n);
    return {
      periodCode,
      count: rows.length,
      totalRials: Number(total),
      lines: rows.map((r) => ({
        assetCode: r.asset.assetCode,
        nameFa: r.asset.nameFa,
        amountRials: Number(r.amountRials),
        accumulatedRials: Number(r.accumulatedRials),
        journalEntryNo: r.journalEntryNo,
      })),
    };
  }
}
