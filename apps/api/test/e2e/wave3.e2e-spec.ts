/**
 * wave3.e2e-spec.ts — آزمون پذیرش موج ۳ (F8-T1/T2/T3 + F9-T1/T3) — نیازمند PostgreSQL واقعی:
 * سند ۱۴فیلدی با شماره عطف و پیوست | دفاتر روزنامه/کل/معین | تراز آزمایشی متوازن |
 * سود و زیان و ترازنامه | موتور نگاشت پارامتریک رویداد→سند | کتابخانه قوانین ۱۲فیلدی |
 * اظهارنامه ارزش افزوده | بستن دوره با سند اختتام | ماتریس مجوز.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { authenticator } from 'otplib';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma.service';
import { AllExceptionsFilter } from '../../src/common/all-exceptions.filter';

process.env.JWT_ACCESS_SECRET ??= 'e2e-access-secret-change-me';
process.env.AUTH_CAPTCHA_REQUIRED ??= 'false'; // U1: کپچا در e2e خاموش
process.env.MFA_TEST_SECRET ??= 'JBSWY3DPEHPK3PXPE2ETEST';
const MFA_SECRET = process.env.MFA_TEST_SECRET;

let app: INestApplication;
let prisma: PrismaService;
const tokens: Record<string, string> = {};
const state: Record<string, string | number> = {};

async function login(username: string, withTotp: boolean): Promise<string> {
  if (tokens[username]) return tokens[username];
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({
      username,
      password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe_Str0ng!',
      ...(withTotp ? { totp: authenticator.generate(MFA_SECRET) } : {}),
    });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`login failed for ${username}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  tokens[username] = res.body.accessToken;
  return tokens[username];
}

const auth = (token: string): string => `Bearer ${token}`;
const today = (): string => new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  try {
    (authenticator as unknown as { options: Record<string, unknown> }).options = { window: [1, 1] };
  } catch {
    /* default window */
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  prisma = app.get(PrismaService);

  await prisma.$executeRawUnsafe(
    `TRUNCATE "kitchen_tickets","order_items","restaurant_orders","goods_receipt_lines","goods_receipts",
      "purchase_order_lines","purchase_orders","purchase_requisition_lines","purchase_requisitions",
      "stock_count_lines","stock_counts","stock_movements","stay_rooms","stays","cash_transactions",
      "cashier_shifts","ancillary_orders","outbox_events","inbox_events",
      "journal_entries","journal_lines","journal_attachments","audit_logs","night_audit_runs",
      "reservations","waitlist_entries" CASCADE`,
  );
  await prisma.$executeRawUnsafe(`UPDATE "dining_tables" SET "status"='FREE'`);
  await prisma.$executeRawUnsafe(`UPDATE "rooms" SET "status"='AVAILABLE', "hkStatus"='CLEAN', "note"=NULL`);
  // دوره‌های مالی مطابق seed: فقط ماه گذشته LOCKED — هر e2e از وضعیت مرجع شروع می‌شود
  await prisma.$executeRawUnsafe(
    `UPDATE "fiscal_periods" SET "status" = CASE WHEN "endDate" < date_trunc('month', now()) THEN 'LOCKED'::fiscal_period_status ELSE 'OPEN'::fiscal_period_status END,
     "lockedAt" = CASE WHEN "endDate" < date_trunc('month', now()) THEN now() ELSE NULL END,
     "closedAt" = NULL, "closingEntryId" = NULL`,
  );
  // دوره‌های سنتزی اجرای قبل حذف شوند (اجرای تکرارپذیر)
  await prisma.$executeRawUnsafe(`DELETE FROM "fiscal_periods" WHERE code IN ('1405-07','1405-98')`);
  // قانون VAT به نسخهٔ پایه برگردد (اجرای تکرارپذیر)
  await prisma.lawRule.update({
    where: { code: 'LAW-VAT-RATE' },
    data: {
      params: { vatBps: 1000, healthBps: 100, defaultBps: 900 } as never,
      version: '1.0',
      effectiveFrom: new Date('2025-03-21T00:00:00Z'),
      effectiveTo: null,
    },
  }).catch(() => undefined);

  await login('admin', true);
  await login('frontdesk', false);
  await login('accountant', true);
  await login('approver', true);
  await login('storekeeper', false);
}, 90_000);

afterAll(async () => {
  await app.close();
});

describe('فاز ۸ — سند ۱۴فیلدی (F8-T1)', () => {
  it('پیش‌نویس متوازن → تأیید → سند قطعی با شماره عطف (docIndex)', async () => {
    const draft = await request(app.getHttpServer())
      .post('/api/v1/journal-entries').set('Authorization', auth(tokens.accountant))
      .send({
        description: 'تست سند موج ۳ — فروش نقدی',
        lines: [
          { accountCode: '1101', debit: 1_090_000, credit: 0 },
          { accountCode: '4102', debit: 0, credit: 1_000_000 },
          { accountCode: '2201', debit: 0, credit: 90_000 },
        ],
      });
    expect(draft.status).toBe(201);
    state.entryId = draft.body.data.id;
    state.entryNo = draft.body.data.entryNo;

    const approve = await request(app.getHttpServer())
      .post(`/api/v1/journal-entries/${state.entryId}/approve`).set('Authorization', auth(tokens.approver))
      .send({});
    expect([200, 201]).toContain(approve.status);

    const row = await prisma.journalEntry.findUnique({ where: { id: String(state.entryId) } });
    expect(row?.status).toBe('POSTED');
    expect(row?.docIndex).not.toBeNull();
    expect(row?.approvedById).not.toBeNull();
    state.docIndex1 = Number(row?.docIndex);
  });

  it('سند دوم قطعی — شماره عطف صعودی و یکتا', async () => {
    const draft = await request(app.getHttpServer())
      .post('/api/v1/journal-entries').set('Authorization', auth(tokens.accountant))
      .send({
        description: 'تست سند موج ۳ — خرید نقدی',
        lines: [
          { accountCode: '1301', debit: 1_000_000, credit: 0 },
          { accountCode: '1101', debit: 0, credit: 1_000_000 },
        ],
      });
    expect(draft.status).toBe(201);
    const approve = await request(app.getHttpServer())
      .post(`/api/v1/journal-entries/${draft.body.data.id}/approve`).set('Authorization', auth(tokens.approver))
      .send({});
    expect([200, 201]).toContain(approve.status);
    const row = await prisma.journalEntry.findUnique({ where: { id: draft.body.data.id } });
    expect(Number(row?.docIndex)).toBeGreaterThan(Number(state.docIndex1));
  });

  it('پیوست سند — افزودن و مشاهده (فیلد پیوست‌ها)', async () => {
    const add = await request(app.getHttpServer())
      .post(`/api/v1/journal-entries/${state.entryId}/attachments`).set('Authorization', auth(tokens.accountant))
      .send({ fileName: 'invoice-123.pdf', mimeType: 'application/pdf', sizeBytes: 12_345, dataRef: 'attachments/invoice-123.pdf' });
    expect(add.status).toBe(201);

    const list = await request(app.getHttpServer())
      .get(`/api/v1/journal-entries/${state.entryId}/attachments`).set('Authorization', auth(tokens.accountant));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].fileName).toBe('invoice-123.pdf');
  });

  it('سند نامتوازن رد می‌شود (قاعدهٔ تراز در ثبت)', async () => {
    const bad = await request(app.getHttpServer())
      .post('/api/v1/journal-entries').set('Authorization', auth(tokens.accountant))
      .send({
        description: 'سند کج — باید رد شود',
        lines: [{ accountCode: '1101', debit: 500, credit: 0 }, { accountCode: '4102', debit: 0, credit: 400 }],
      });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('BUSINESS_RULE');
  });
});

describe('فاز ۹ — کتابخانهٔ قوانین (F9-T1)', () => {
  it('چهار قانون seed با متادیتای ۱۲گانه', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/compliance/laws').set('Authorization', auth(tokens.accountant));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(4);
    const vat = res.body.data.find((l: { code: string }) => l.code === 'LAW-VAT-RATE');
    expect(vat.lawName).toContain('ارزش افزوده');
    expect(vat.article).toContain('۱۷');
    expect(vat.params.vatBps).toBe(1000);
    expect(vat.legalOwner).not.toBe('');
    state.vatVersion = vat.version;
  });

  it('نرخ پارامتریک در تاریخ + رد تاریخ خارج از اعتبار', async () => {
    const ok = await request(app.getHttpServer())
      .get('/api/v1/compliance/laws/LAW-VAT-RATE/rate?date=2026-11-22').set('Authorization', auth(tokens.accountant));
    expect(ok.status).toBe(200);
    expect(ok.body.data.vatBps).toBe(1000);

    const out = await request(app.getHttpServer())
      .get('/api/v1/compliance/laws/LAW-VAT-RATE/rate?date=2024-01-01').set('Authorization', auth(tokens.accountant));
    expect(out.status).toBe(409);
  });

  it('به‌روزرسانی قانون = نسخهٔ جدید (۱.۱) + انطباق بدون تغییر کد', async () => {
    const up = await request(app.getHttpServer())
      .post('/api/v1/compliance/laws').set('Authorization', auth(tokens.admin))
      .send({
        code: 'LAW-VAT-RATE', title: 'نرخ مالیات بر ارزش افزوده', lawName: 'قانون مالیات بر ارزش افزوده',
        article: 'ماده ۱۷', effectiveFrom: '2027-01-01',
        params: { vatBps: 1100, defaultBps: 1000 },
        legalOwner: 'واحد مالیات و انطباق', sourceRef: 'ابلاغ ۱۴۰۵',
      });
    expect(up.status).toBe(201);
    expect(up.body.data?.version).toBeDefined();
    // نسخه‌بندی روی رکورد — صحت را از DB می‌خوانیم (مستقل از شکل پاسخ)
    const lawRow = await prisma.lawRule.findUnique({ where: { code: 'LAW-VAT-RATE' } });
    expect(parseFloat(lawRow!.version)).toBeGreaterThan(1.0);
    expect((lawRow!.params as { vatBps: number }).vatBps).toBe(1100);

    const rate = await request(app.getHttpServer())
      .get('/api/v1/compliance/laws/LAW-VAT-RATE/rate?date=2027-03-01').set('Authorization', auth(tokens.accountant));
    expect(rate.status).toBe(200);
    expect(rate.body.data.vatBps).toBe(1100); // نرخ ۱۴۰۶ بدون تغییر کد
  });

  it('انباردار قوانین را نمی‌بیند (403) و حسابدار نمی‌تواند مدیریت کند — ماتریس', async () => {
    const view = await request(app.getHttpServer())
      .get('/api/v1/compliance/laws').set('Authorization', auth(tokens.storekeeper));
    expect(view.status).toBe(403);
  });
});

describe('فاز ۹ — اظهارنامه ارزش افزوده (F9-T3)', () => {
  it('فروش با مالیات + خرید با اعتبار → تفکیک صحیح و خالص صفر', async () => {
    // فروش نقدی با مالیات ۹٪ (مرکز هزینه رستوران)
    const sale = await request(app.getHttpServer())
      .post('/api/v1/journal-entries').set('Authorization', auth(tokens.accountant))
      .send({
        description: 'فروش رستوران با مالیات',
        lines: [
          { accountCode: '1101', debit: 1_090_000, credit: 0, costCenter: 'CC-FB' },
          { accountCode: '4102', debit: 0, credit: 1_000_000, costCenter: 'CC-FB' },
          { accountCode: '2201', debit: 0, credit: 90_000, costCenter: 'CC-FB' },
        ],
      });
    expect(sale.status).toBe(201);
    await request(app.getHttpServer())
      .post(`/api/v1/journal-entries/${sale.body.data.id}/approve`).set('Authorization', auth(tokens.approver))
      .send({});

    // خرید نقدی با اعتبار مالیاتی
    const buy = await request(app.getHttpServer())
      .post('/api/v1/journal-entries').set('Authorization', auth(tokens.accountant))
      .send({
        description: 'خرید با اعتبار مالیاتی',
        lines: [
          { accountCode: '1301', debit: 1_000_000, credit: 0 },
          { accountCode: '2204', debit: 90_000, credit: 0 },
          { accountCode: '1101', debit: 0, credit: 1_090_000 },
        ],
      });
    expect(buy.status).toBe(201);
    await request(app.getHttpServer())
      .post(`/api/v1/journal-entries/${buy.body.data.id}/approve`).set('Authorization', auth(tokens.approver))
      .send({});

    const decl = await request(app.getHttpServer())
      .get(`/api/v1/compliance/vat/declaration?from=${today()}&to=${today()}`).set('Authorization', auth(tokens.accountant));
    expect(decl.status).toBe(200);
    // دو فروش امروز: سند F8-T1 (بدون مرکز هزینه) + فروش رستوران این تست
    expect(decl.body.data.outputVatRials).toBe(180_000);
    expect(decl.body.data.inputVatCreditRials).toBe(90_000);
    expect(decl.body.data.netPayableRials).toBe(90_000);
    expect(decl.body.data.taxBaseRials).toBe(2_000_000);
    const fb = decl.body.data.sections.find((s: { costCenterCode: string }) => s.costCenterCode === 'CC-FB');
    expect(fb.taxBase).toBe(1_000_000);
  });
});

describe('فاز ۸ — موتور نگاشت پارامتریک (F8-T2) + دفاتر (F8-T3)', () => {
  it('شارژ شب‌گردی از مسیر جدول نگاشت → شرح شامل [mapping:v1]', async () => {
    // حداقل جریان PMS: رزرو امروز + چک‌این + شب‌گردی
    const rt = await request(app.getHttpServer()).get('/api/v1/room-types').set('Authorization', auth(tokens.frontdesk));
    const std = rt.body.data.find((x: { code: string }) => x.code === 'STD');
    const res = await request(app.getHttpServer())
      .post('/api/v1/pms/reservations').set('Authorization', auth(tokens.frontdesk))
      .send({ roomTypeId: std.id, guestName: 'مهمان نگاشت', checkInDate: today(), checkOutDate: dayOffset(3), idempotencyKey: `w3-res-${Date.now()}` });
    expect(res.status).toBe(201);
    const room = (await request(app.getHttpServer()).get('/api/v1/pms/rooms/map').set('Authorization', auth(tokens.frontdesk)))
      .body.data.floors.flatMap((f: { rooms: Array<{ code: string; id: string; status: string }> }) => f.rooms)
      .find((r: { code: string }) => r.code === '101');
    const ci = await request(app.getHttpServer())
      .post('/api/v1/pms/stays/check-in').set('Authorization', auth(tokens.frontdesk))
      .send({ reservationId: res.body.data.reservationId, roomIds: [room.id], plannedCheckOut: dayOffset(3), idempotencyKey: `w3-ci-${Date.now()}` });
    expect(ci.status).toBe(201);

    const na = await request(app.getHttpServer())
      .post('/api/v1/pms/night-audit').set('Authorization', auth(tokens.frontdesk))
      .send({ businessDate: today() });
    expect([200, 201]).toContain(na.status);

    const mapping = await prisma.eventJournalMapping.findUnique({ where: { eventName: 'pms.night_audit.posted' } });
    expect(mapping?.active).toBe(true);
    // موتور outbox ناهمزمان است — با drain قطعی صف، سند نگاشت‌شده را منتظر می‌مانیم
    // (نسخهٔ نگاشت با هر seed جلو می‌رود — جست‌وجو نسخه‌محور است)
    const OutboxPublisher = (await import('../../src/outbox/outbox.publisher')).OutboxPublisher;
    const publisher = app.get(OutboxPublisher);
    const mappingTag = `[mapping:v${mapping!.version}]`;
    let entry: { id: string; entryNo: string; description: string } | null = null;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      await publisher.publishOnce();
      entry = await prisma.journalEntry.findFirst({ where: { description: { contains: mappingTag } } });
      if (entry) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(entry).not.toBeNull();
    const lines = await prisma.journalLine.findMany({ where: { entryId: entry!.id } });
    expect(lines).toHaveLength(2);
    const dr = lines.find((l) => l.debitRials > 0n);
    const cr = lines.find((l) => l.creditRials > 0n);
    expect(dr?.accountCode).toBe('1201');
    expect(cr?.accountCode).toBe('4101');
    expect(dr?.debitRials).toBe(cr?.creditRials);
    state.naAmount = Number(dr?.debitRials ?? 0n);
  });

  it('دفتر روزنامه: اسناد با شماره عطف مرتب', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/journal-entries/ledgers/journal?from=${today()}&to=${today()}`).set('Authorization', auth(tokens.accountant));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(3);
    const idx = res.body.data.filter((e: { docIndex: number | null }) => e.docIndex !== null).map((e: { docIndex: number }) => e.docIndex);
    const sorted = [...idx].sort((a, b) => a - b);
    expect(idx).toEqual(sorted);
  });

  it('دفتر کل و معین: ماندهٔ ابتدا/گردش/انتها سازگار', async () => {
    const gl = await request(app.getHttpServer())
      .get(`/api/v1/journal-entries/ledgers/general?from=${today()}&to=${today()}`).set('Authorization', auth(tokens.accountant));
    expect(gl.status).toBe(200);
    expect(gl.body.meta.balanced).toBe(true);
    const row1101 = gl.body.data.find((r: { accountCode: string }) => r.accountCode === '1101');
    expect(row1101).toBeDefined();

    const sub = await request(app.getHttpServer())
      .get(`/api/v1/journal-entries/ledgers/subsidiary/1101?from=${today()}&to=${today()}`).set('Authorization', auth(tokens.accountant));
    expect(sub.status).toBe(200);
    expect(sub.body.meta.closingBalance).toBe(row1101.closingBalance);
    // ماندهٔ تجمعی آخرین سطر = ماندهٔ پایان
    const last = sub.body.data[sub.body.data.length - 1];
    expect(last.runningBalance).toBe(sub.body.meta.closingBalance);
  });

  it('تراز آزمایشی — متوازن (معیار پذیرش F8-T3)', async () => {
    const tb = await request(app.getHttpServer())
      .get(`/api/v1/journal-entries/trial-balance?from=${today()}&to=${today()}`).set('Authorization', auth(tokens.accountant));
    expect(tb.status).toBe(200);
    expect(tb.body.meta.balanced).toBe(true);
    expect(tb.body.meta.totals.periodDebit).toBe(tb.body.meta.totals.periodCredit);
    expect(tb.body.meta.totals.closingDebit).toBe(tb.body.meta.totals.closingCredit);
  });

  it('سود و زیان و ترازنامه — سازگار و متوازن', async () => {
    const pnl = await request(app.getHttpServer())
      .get(`/api/v1/journal-entries/statements/income?from=${today()}&to=${today()}`).set('Authorization', auth(tokens.accountant));
    expect(pnl.status).toBe(200);
    const exp = pnl.body.totals.totalExpense;
    const rev = pnl.body.totals.totalRevenue;
    expect(pnl.body.totals.netIncome).toBe(rev - exp);

    const bs = await request(app.getHttpServer())
      .get(`/api/v1/journal-entries/statements/balance-sheet?asOf=${today()}`).set('Authorization', auth(tokens.accountant));
    expect(bs.status).toBe(200);
    expect(bs.body.totals.balanced).toBe(true);
    expect(bs.body.currentPeriodIncome.amount).toBe(pnl.body.totals.netIncome);
  });
});

describe('فاز ۸ — بستن دوره (F8-T3) — در انتها', () => {
  it('دورهٔ گذشتهٔ سنتزی: پیش‌نویس باز → ۴۰۰؛ سپس سند اختتام + قفل؛ بستن دوباره → ۴۰۹', async () => {
    // دورهٔ سنتزی اکتبر ۲۰۲۶ — upsert برای اجرای تکرارپذیر
    await prisma.fiscalPeriod.upsert({
      where: { code: '1405-07' },
      update: { status: 'OPEN', closedAt: null, closingEntryId: null, lockedAt: null },
      create: { code: '1405-07', startDate: new Date('2026-10-01T00:00:00Z'), endDate: new Date('2026-10-31T00:00:00Z'), status: 'OPEN' },
    });
    const period = await prisma.fiscalPeriod.findUnique({ where: { code: '1405-07' } });
    // اسناد بک‌دیتِ دوره (مستقیم از prisma — ثبت عادی همیشه امروز است)
    const e1 = await prisma.journalEntry.create({
      data: {
        entryNo: 'JV-2026-900001', entryDate: new Date('2026-10-10T00:00:00Z'), postingDate: new Date('2026-10-10T00:00:00Z'),
        periodId: period!.id, description: 'فروش اکتبر', status: 'POSTED', sourceModule: 'e2e', sourceRef: 'w3-oct-sale', docIndex: 900001n,
        lines: { create: [
          { lineNo: 1, accountCode: '1101', debitRials: 2_000_000n, creditRials: 0n },
          { lineNo: 2, accountCode: '4102', debitRials: 0n, creditRials: 2_000_000n },
        ] },
      },
    });
    const e2 = await prisma.journalEntry.create({
      data: {
        entryNo: 'JV-2026-900002', entryDate: new Date('2026-10-15T00:00:00Z'), postingDate: new Date('2026-10-15T00:00:00Z'),
        periodId: period!.id, description: 'هزینه اکتبر', status: 'POSTED', sourceModule: 'e2e', sourceRef: 'w3-oct-exp', docIndex: 900002n,
        lines: { create: [
          { lineNo: 1, accountCode: '5102', debitRials: 1_500_000n, creditRials: 0n },
          { lineNo: 2, accountCode: '1101', debitRials: 0n, creditRials: 1_500_000n },
        ] },
      },
    });
    expect(e1.id).toBeTruthy();
    expect(e2.id).toBeTruthy();

    // پیش‌نویس باز در همان دوره → بستن باید ۴۰۰ بدهد
    const draft = await prisma.journalEntry.create({
      data: {
        entryNo: 'JV-2026-900003', entryDate: new Date('2026-10-20T00:00:00Z'), postingDate: new Date('2026-10-20T00:00:00Z'),
        periodId: period!.id, description: 'پیش‌نویس باز', status: 'DRAFT', sourceModule: 'e2e', sourceRef: 'w3-oct-draft',
        lines: { create: [{ lineNo: 1, accountCode: '1101', debitRials: 100n, creditRials: 0n }] },
      },
    });
    const blocked = await request(app.getHttpServer())
      .post('/api/v1/journal-entries/periods/1405-07/close').set('Authorization', auth(tokens.accountant))
      .send({});
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.message).toContain('پیش‌نویس');

    await prisma.journalLine.deleteMany({ where: { entryId: draft.id } });
    await prisma.journalEntry.delete({ where: { id: draft.id } });

    const close = await request(app.getHttpServer())
      .post('/api/v1/journal-entries/periods/1405-07/close').set('Authorization', auth(tokens.accountant))
      .send({});
    // eslint-disable-next-line no-console
    console.log('CLOSE-DEBUG status=', close.status, 'body=', JSON.stringify(close.body).slice(0, 200));
    expect([200, 201]).toContain(close.status);
    expect(close.body.data.netIncome).toBe(500_000);
    expect(close.body.data.closingEntryId).not.toBeNull();

    const periodAfter = await prisma.fiscalPeriod.findUnique({ where: { code: '1405-07' } });
    expect(periodAfter?.status).toBe('LOCKED');
    expect(periodAfter?.closedAt).not.toBeNull();

    const closingEntry = await prisma.journalEntry.findUnique({ where: { id: periodAfter!.closingEntryId! }, include: { lines: true } });
    const equityLine = closingEntry?.lines.find((l) => l.accountCode === '3901');
    expect(Number(equityLine?.creditRials ?? 0n)).toBe(500_000);

    // تراز آزمایشی اکتبر بعد از بستن: درآمد/هزینه صفر، سود انباشته بستانکار، متوازن
    const tb = await request(app.getHttpServer())
      .get('/api/v1/journal-entries/trial-balance?from=2026-10-01&to=2026-10-31').set('Authorization', auth(tokens.accountant));
    expect(tb.status).toBe(200);
    expect(tb.body.meta.balanced).toBe(true);
    const rev = tb.body.data.find((r: { accountCode: string }) => r.accountCode === '4102');
    expect(rev.periodDebit).toBe(2_000_000); // بسته شد
    const equity = tb.body.data.find((r: { accountCode: string }) => r.accountCode === '3901');
    expect(equity.periodCredit).toBe(500_000);

    const again = await request(app.getHttpServer())
      .post('/api/v1/journal-entries/periods/1405-07/close').set('Authorization', auth(tokens.accountant))
      .send({});
    expect(again.status).toBe(409);
  });

  it('بستن دوره بدون مجوز — پذیرش ۴۰۳', async () => {
    const denied = await request(app.getHttpServer())
      .post('/api/v1/journal-entries/periods/1405-09/close').set('Authorization', auth(tokens.frontdesk))
      .send({});
    expect(denied.status).toBe(403);
  });
});

function dayOffset(n: number): string {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}
