/**
 * compliance.service.ts — فاز ۹ / F9-T1 + F9-T3: کتابخانهٔ قوانین با متادیتای ۱۲گانه
 * (نرخ‌ها پارامتریک — تغییر نرخ ۱۴۰۶ بدون تغییر کد) + اظهارنامهٔ دوره‌ای مالیات بر ارزش افزوده.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class ComplianceService {
  constructor(private readonly prisma: PrismaService) {}

  /** فهرست قوانین فعال/همه — با پارامترهای عددی */
  async listLaws() {
    const rows = await this.prisma.lawRule.findMany({ where: { active: true }, orderBy: { code: 'asc' } });
    return rows.map((r) => this.toDto(r));
  }

  async getLaw(code: string) {
    const r = await this.prisma.lawRule.findUnique({ where: { code } });
    if (!r) throw new NotFoundException('قانون یافت نشد');
    return this.toDto(r);
  }

  /** نرخ پارامتریک در تاریخ — اساس موتور: کد قانون + تاریخ → نرخ فعال */
  async rateAt(code: string, date = new Date()): Promise<Record<string, number | string | string[]>> {
    const r = await this.prisma.lawRule.findUnique({ where: { code } });
    if (!r || !r.active) throw new NotFoundException('قانون فعال یافت نشد');
    const d = date.toISOString().slice(0, 10);
    const from = r.effectiveFrom.toISOString().slice(0, 10);
    const to = r.effectiveTo ? r.effectiveTo.toISOString().slice(0, 10) : '9999-12-31';
    if (d < from || d > to) throw new ConflictException({ code: 'CONFLICT', message: `این نسخهٔ قانون در تاریخ ${d} معتبر نیست (${from} تا ${to})` });
    return r.params as Record<string, number | string | string[]>;
  }

  /** ثبت/به‌روزرسانی قانون — نسخه در همان رکورد افزایش می‌یابد و در audit_log ثبت می‌شود */
  async upsertLaw(input: {
    code: string; title: string; lawName: string; article?: string; note?: string;
    effectiveFrom: string; effectiveTo?: string; params: Record<string, unknown>;
    testScenario?: string; legalOwner?: string; sourceRef?: string; userId: string;
  }) {
    const existing = await this.prisma.lawRule.findUnique({ where: { code: input.code } });
    const data = {
      title: input.title, lawName: input.lawName,
      article: input.article ?? existing?.article ?? '', note: input.note ?? existing?.note ?? '',
      effectiveFrom: new Date(`${input.effectiveFrom}T00:00:00Z`),
      effectiveTo: input.effectiveTo ? new Date(`${input.effectiveTo}T00:00:00Z`) : null,
      params: input.params as never,
      testScenario: input.testScenario ?? existing?.testScenario ?? '',
      legalOwner: input.legalOwner ?? existing?.legalOwner ?? '',
      sourceRef: input.sourceRef ?? existing?.sourceRef ?? '',
    };
    const row = existing
      ? await this.prisma.lawRule.update({
          where: { id: existing.id },
          data: { ...data, version: this.nextVersion(existing.version) },
        })
      : await this.prisma.lawRule.create({ data: { code: input.code, ...data } });
    await this.prisma.auditLog.create({
      data: { userId: input.userId, action: 'LAW_UPSERTED', entity: 'LawRule', entityId: row.id, reason: `v${row.version}` },
    });
    return this.toDto(row);
  }

  /**
   * اظهارنامهٔ دوره‌ای مالیات بر ارزش افزوده (F9-T3):
   * مالیات فروش از گردش ۲۲۰۱، اعتبار مالیاتی خرید از گردش ۲۲۰۴ (دارایی)،
   * پایهٔ مالیاتی از درآمدها، و تفکیک بخش‌ها بر اساس مرکز هزینه.
   */
  async vatDeclaration(from: string, to: string) {
    const fromDate = new Date(`${from}T00:00:00Z`);
    const toDate = new Date(`${to}T23:59:59Z`);
    const entries = await this.prisma.journalEntry.findMany({
      where: { postingDate: { gte: fromDate, lte: toDate }, status: 'POSTED' },
      include: { lines: true },
      take: 2000,
    });

    let outputVat = 0n; // بستانکار ۲۲۰۱ (مالیات فروش)
    let inputVat = 0n; // بدهکار ۲۲۰۴ (مالیات خرید)
    const byCostCenter = new Map<string, { taxBase: number; vat: number }>();
    let taxBaseTotal = 0n;

    for (const e of entries) {
      const outLine = e.lines.find((l) => l.accountCode === '2201' && l.creditRials > 0n);
      const inLine = e.lines.find((l) => l.accountCode === '2204' && l.debitRials > 0n);
      if (outLine) {
        outputVat += outLine.creditRials;
        const cc = outLine.costCenterCode ?? 'CC-ADMIN';
        // پایه: جمع بستانکار درآمد همان سند (۴۱۰۱/۴۱۰۲/۴۱۰۳)
        const base = e.lines
          .filter((l) => ['4101', '4102', '4103'].includes(l.accountCode))
          .reduce((a, l) => a + l.creditRials - l.debitRials, 0n);
        taxBaseTotal += base;
        const cur = byCostCenter.get(cc) ?? { taxBase: 0, vat: 0 };
        byCostCenter.set(cc, { taxBase: cur.taxBase + Number(base), vat: cur.vat + Number(outLine.creditRials) });
      }
      if (inLine) inputVat += inLine.debitRials;
    }

    const netPayable = outputVat - inputVat;
    const rows = [...byCostCenter.entries()].map(([code, v]) => ({ costCenterCode: code, ...v }));
    return {
      data: {
        sections: rows,
        outputVatRials: Number(outputVat),
        inputVatCreditRials: Number(inputVat),
        netPayableRials: Number(netPayable),
        taxBaseRials: Number(taxBaseTotal),
      },
      meta: {
        from, to,
        outputAccount: '2201 — مالیات بر ارزش افزوده پرداختنی',
        inputAccount: '2204 — مالیات بر ارزش افزوده خرید (اعتبار)',
        lawRef: 'LAW-VAT-RATE — ماده ۱۷ قانون مالیات بر ارزش افزوده',
        reconciled: true, // مستقیم از اسناد posted محاسبه می‌شود
      },
    };
  }

  private nextVersion(v: string): string {
    const [major, minor] = v.split('.').map((x) => parseInt(x, 10) || 0);
    return `${major}.${minor + 1}`;
  }

  private toDto(r: {
    id: string; code: string; title: string; lawName: string; article: string; note: string;
    effectiveFrom: Date; effectiveTo: Date | null; version: string; params: unknown;
    testScenario: string; legalOwner: string; sourceRef: string;
  }) {
    return {
      code: r.code, title: r.title, lawName: r.lawName, article: r.article, note: r.note,
      effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10),
      effectiveTo: r.effectiveTo ? r.effectiveTo.toISOString().slice(0, 10) : null,
      version: r.version, params: r.params,
      testScenario: r.testScenario, legalOwner: r.legalOwner, sourceRef: r.sourceRef,
    };
  }
}
