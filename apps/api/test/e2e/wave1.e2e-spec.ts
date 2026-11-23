/**
 * wave1.e2e-spec.ts — آزمون پذیرش موج ۱ (F5-T1…T5 + F10-T1…T6) — نیازمند PostgreSQL واقعی:
 * شیفت صندوق با مغایرت | دریافت روی فولیو + سند خودکار | Idempotency | ابطال و مجوزها |
 * مغایرت‌گیری بانکی | وظیفهٔ نظافت→AVAILABLE | تعمیرات | لاندری | جامانده |
 * استهلاک دارایی با سند | خدمات جانبی با شارژ فولیو و برگشت.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { authenticator } from 'otplib';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma.service';
import { AllExceptionsFilter } from '../../src/common/all-exceptions.filter';

process.env.JWT_ACCESS_SECRET ??= 'e2e-access-secret-change-me';
process.env.MFA_TEST_SECRET ??= 'JBSWY3DPEHPK3PXPE2ETEST';
const MFA_SECRET = process.env.MFA_TEST_SECRET;

let app: INestApplication;
let prisma: PrismaService;
const tokens: Record<string, string> = {};
const state: Record<string, string> = {};

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
const dayOffset = (n: number): string => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

/** انتظار برای سند خودکار موتور حسابداری (publisher هر ثانیه تیک می‌زند) */
async function waitForJournal(sourceModule: string, sourceRef: string, timeoutMs = 15000): Promise<{ entryNo: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await prisma.journalEntry.findFirst({ where: { sourceModule, sourceRef, status: 'POSTED' } });
    if (row) return { entryNo: row.entryNo };
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`journal not posted for ${sourceModule}/${sourceRef} within ${timeoutMs}ms`);
}

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

  // پاک‌سازی جدول‌های تراکنشی موج ۱ + بازنشانی اتاق‌ها (دادهٔ مرجع seed و فازهای قبل دست‌نخورده)
  await prisma.$executeRawUnsafe(
    `TRUNCATE "cash_transactions","cashier_shifts","bank_statement_lines","reconciliation_runs",
      "asset_depreciations","ancillary_orders","room_inspections","room_tasks",
      "maintenance_requests","laundry_movements","laundry_batches","lost_and_founds","fixed_assets",
      "outbox_events","inbox_events","journal_entries","journal_lines" CASCADE`,
  );
  await prisma.$executeRawUnsafe(`UPDATE "rooms" SET "status"='AVAILABLE', "hkStatus"='CLEAN', "note"=NULL`);

  await login('admin', true);
  await login('frontdesk', false);
  await login('housekeeper', false);
  await login('cashier', false);
}, 90_000);

afterAll(async () => {
  await app.close();
});

describe('فاز ۵ — صندوق، پرداخت و خزانه‌داری', () => {
  it('F5-T1: باز و بستن شیفت با مغایرت درست', async () => {
    const acc = await prisma.cashAccount.findUnique({ where: { code: 'CH-01' } });
    state.ch01 = acc!.id;

    const open = await request(app.getHttpServer())
      .post('/api/v1/treasury/shifts/open').set('Authorization', auth(tokens.cashier))
      .send({ cashAccountId: state.ch01, openingFloatRials: 1_000_000, businessDate: dayOffset(0) });
    expect(open.status).toBe(201);
    expect(open.body.status).toBe('OPEN');
    state.shift1 = open.body.id;

    // شیفت دوم روی همان صندوق ممنوع
    const dup = await request(app.getHttpServer())
      .post('/api/v1/treasury/shifts/open').set('Authorization', auth(tokens.admin))
      .send({ cashAccountId: state.ch01, openingFloatRials: 0, businessDate: dayOffset(0) });
    expect(dup.status).toBe(409);

    // دریافت نقدی روی شیفت
    state.txnKey1 = `wave1-txn-${Date.now()}`;
    const post = await request(app.getHttpServer())
      .post('/api/v1/treasury/transactions').set('Authorization', auth(tokens.cashier))
      .send({
        cashAccountId: state.ch01, kind: 'RECEIPT', method: 'CASH',
        amountRials: 2_000_000, businessDate: dayOffset(0), idempotencyKey: state.txnKey1,
      });
    expect(post.status).toBe(201);
    expect(post.body.replayed).toBe(false);
    state.txn1 = post.body.id;
    state.txnNo1 = post.body.txnNo;

    // پرداخت نقدی ۳۰۰٬۰۰۰
    const pay = await request(app.getHttpServer())
      .post('/api/v1/treasury/transactions').set('Authorization', auth(tokens.cashier))
      .send({
        cashAccountId: state.ch01, kind: 'PAYMENT', method: 'CASH',
        amountRials: 300_000, businessDate: dayOffset(0), idempotencyKey: `${state.txnKey1}-p`,
      });
    expect(pay.status).toBe(201);

    // بستن شیفت: انتظاری = ۱٬۰۰۰٬۰۰۰ + ۲٬۰۰۰٬۰۰۰ − ۳۰۰٬۰۰۰ = ۲٬۷۰۰٬۰۰۰
    const close = await request(app.getHttpServer())
      .post('/api/v1/treasury/shifts/close').set('Authorization', auth(tokens.cashier))
      .send({ shiftId: state.shift1, countedRials: 2_650_000 });
    expect(close.status).toBe(201);
    expect(close.body.varianceRials).toBe(-50_000); // کسری ۵۰٬۰۰۰

    // تراکنش نقدی بدون شیفت باز ممنوع
    const noShift = await request(app.getHttpServer())
      .post('/api/v1/treasury/transactions').set('Authorization', auth(tokens.cashier))
      .send({
        cashAccountId: state.ch01, kind: 'RECEIPT', method: 'CASH',
        amountRials: 100_000, businessDate: dayOffset(0), idempotencyKey: `${state.txnKey1}-nos`,
      });
    expect(noShift.status).toBe(400);
  });

  it('F5-T2: Idempotency — کلید تکراری همان تراکنش قبلی را می‌دهد', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/treasury/transactions').set('Authorization', auth(tokens.cashier))
      .send({
        cashAccountId: state.ch01, kind: 'RECEIPT', method: 'CASH',
        amountRials: 2_000_000, businessDate: dayOffset(0), idempotencyKey: state.txnKey1,
      });
    expect(res.status).toBe(201);
    expect(res.body.replayed).toBe(true);
    expect(res.body.txnNo).toBe(state.txnNo1);
  });

  it('F5-T3: دریافت روی فولیوی اقامت + سند خودکار دوطرفه', async () => {
    const room = await prisma.room.findUnique({ where: { code: '201' } });
    const ci = await request(app.getHttpServer())
      .post('/api/v1/pms/stays/check-in').set('Authorization', auth(tokens.frontdesk))
      .send({
        guestName: 'مهمان فاز ۵', roomIds: [room!.id], plannedCheckOut: dayOffset(2),
        idempotencyKey: `wave1-ci-${Date.now()}`,
      });
    expect(ci.status).toBe(201);
    state.stayId = ci.body.data.stayId;
    state.stayCode = ci.body.data.code;

    // شیفت تازه برای دریافت نقدی دوم
    const open = await request(app.getHttpServer())
      .post('/api/v1/treasury/shifts/open').set('Authorization', auth(tokens.cashier))
      .send({ cashAccountId: state.ch01, openingFloatRials: 0, businessDate: dayOffset(0) });
    state.shift2 = open.body.id;

    const rec = await request(app.getHttpServer())
      .post('/api/v1/treasury/transactions').set('Authorization', auth(tokens.cashier))
      .send({
        cashAccountId: state.ch01, kind: 'RECEIPT', method: 'CASH', amountRials: 5_000_000,
        stayId: state.stayId, payerName: 'مهمان فاز ۵', businessDate: dayOffset(0),
        idempotencyKey: `wave1-folio-${Date.now()}`,
      });
    expect(rec.status).toBe(201);

    const j = await waitForJournal('treasury', rec.body.id);
    expect(j.entryNo).toContain('JV-');
    const lines = await prisma.journalLine.findMany({
      where: { entry: { sourceRef: rec.body.id, sourceModule: 'treasury' } },
    });
    const debit = lines.find((l) => l.accountCode === '1101');
    const credit = lines.find((l) => l.accountCode === '1201');
    expect(debit?.debitRials).toBe(5_000_000n);
    expect(credit?.creditRials).toBe(5_000_000n);
  });

  it('F5-T4: ابطال با دلیل + مجوز (housekeeper اجازهٔ تراکنش خزانه ندارد)', async () => {
    const forbidden = await request(app.getHttpServer())
      .post('/api/v1/treasury/transactions').set('Authorization', auth(tokens.housekeeper))
      .send({
        cashAccountId: state.ch01, kind: 'RECEIPT', method: 'CASH',
        amountRials: 100_000, businessDate: dayOffset(0), idempotencyKey: `wave1-fb-${Date.now()}`,
      });
    expect(forbidden.status).toBe(403);

    const vb = await request(app.getHttpServer())
      .post(`/api/v1/treasury/transactions/${state.txn1}/void`).set('Authorization', auth(tokens.admin))
      .send({ reason: 'خطای ثبت دستی — اصلاح با سند برگشتی' });
    expect(vb.status).toBe(201);
    expect(vb.body.status).toBe('VOID');

    // ابطال دوباره ممنوع
    const again = await request(app.getHttpServer())
      .post(`/api/v1/treasury/transactions/${state.txn1}/void`).set('Authorization', auth(tokens.admin))
      .send({ reason: 'دوباره' });
    expect(again.status).toBe(400);
  });

  it('F5-T5: مغایرت‌گیری بانکی — تطبیق دقیق با شناسه پیگیری', async () => {
    const bank = await prisma.cashAccount.findUnique({ where: { code: 'BN-01' } });
    state.bn01 = bank!.id;

    const online = await request(app.getHttpServer())
      .post('/api/v1/treasury/transactions').set('Authorization', auth(tokens.admin))
      .send({
        cashAccountId: state.bn01, kind: 'TRANSFER', method: 'TRANSFER', amountRials: 7_500_000,
        traceNo: `TRC-${Date.now()}`, businessDate: dayOffset(0), idempotencyKey: `wave1-tr-${Date.now()}`,
      });
    expect(online.status).toBe(201);

    const line = await request(app.getHttpServer())
      .post('/api/v1/treasury/bank-statements').set('Authorization', auth(tokens.accountant ?? tokens.admin))
      .send({
        cashAccountId: state.bn01, valueDate: dayOffset(0),
        externalRef: online.body.traceNo, // شمارهٔ سند بانک = شناسهٔ پیگیری تراکنش
        description: 'واریز درگاه', debitRials: 0, creditRials: 7_500_000,
      });
    expect(line.status).toBe(201);

    // یک سطر بی‌قرینه
    await request(app.getHttpServer())
      .post('/api/v1/treasury/bank-statements').set('Authorization', auth(tokens.accountant ?? tokens.admin))
      .send({
        cashAccountId: state.bn01, valueDate: dayOffset(0),
        externalRef: `UNK-${Date.now()}`, description: 'ناشناس', debitRials: 1_000_000, creditRials: 0,
      });

    const run = await request(app.getHttpServer())
      .post('/api/v1/treasury/reconciliations/run').set('Authorization', auth(tokens.accountant ?? tokens.admin))
      .send({ cashAccountId: state.bn01, runDate: dayOffset(0) });
    expect(run.status).toBe(201);
    expect(run.body.matched).toBeGreaterThanOrEqual(1);
    expect(run.body.unmatched).toBeGreaterThanOrEqual(1);
    expect(run.body.totalLines).toBe(run.body.matched + run.body.unmatched);
  });
});

describe('فاز ۱۰ — خانه‌داری، تعمیرات، لاندری، جامانده، دارایی، خدمات جانبی', () => {
  it('F10-T1: وظیفهٔ نظافت اتاق کثیف → CLEAN/AVAILABLE', async () => {
    const room = await prisma.room.findUnique({ where: { code: '301' } });
    await prisma.room.update({ where: { id: room!.id }, data: { status: 'DIRTY', hkStatus: 'DIRTY' } });

    const t = await request(app.getHttpServer())
      .post('/api/v1/housekeeping/tasks').set('Authorization', auth(tokens.housekeeper))
      .send({ roomCode: '301', kind: 'CLEANING', scheduledDate: dayOffset(0) });
    expect(t.status).toBe(201);
    state.taskId = t.body.id;

    await request(app.getHttpServer())
      .post(`/api/v1/housekeeping/tasks/${state.taskId}/start`).set('Authorization', auth(tokens.housekeeper))
      .send({});

    const done = await request(app.getHttpServer())
      .post(`/api/v1/housekeeping/tasks/${state.taskId}/complete`).set('Authorization', auth(tokens.housekeeper))
      .send({});
    expect(done.status).toBe(201);

    const after = await prisma.room.findUnique({ where: { code: '301' } });
    expect(after!.hkStatus).toBe('CLEAN');
    expect(after!.status).toBe('AVAILABLE');

    // دوباره انجام دادن ممنوع
    const twice = await request(app.getHttpServer())
      .post(`/api/v1/housekeeping/tasks/${state.taskId}/complete`).set('Authorization', auth(tokens.housekeeper))
      .send({});
    expect(twice.status).toBe(400);
  });

  it('F10-T2: گردش کار تعمیرات با هزینهٔ نهایی', async () => {
    const create = await request(app.getHttpServer())
      .post('/api/v1/housekeeping/maintenance').set('Authorization', auth(tokens.housekeeper))
      .send({ roomCode: '302', title: 'نشتی شیر آب', description: 'شیر وان چکه می‌کند', priority: 'HIGH' });
    expect(create.status).toBe(201);
    expect(create.body.requestNo).toMatch(/^MNT-\d{4}-\d{6}$/);
    state.mntId = create.body.id;

    await request(app.getHttpServer())
      .post(`/api/v1/housekeeping/maintenance/${state.mntId}`).set('Authorization', auth(tokens.admin))
      .send({ status: 'IN_PROGRESS' });

    const close = await request(app.getHttpServer())
      .post(`/api/v1/housekeeping/maintenance/${state.mntId}`).set('Authorization', auth(tokens.admin))
      .send({ status: 'DONE', resolutionNote: 'وارینگ تعویض شد', costRials: 850_000 });
    expect(close.status).toBe(201);
    expect(close.body.status).toBe('DONE');
    expect(close.body.costRials).toBe(850_000);

    // بستن دوباره ممنوع
    const again = await request(app.getHttpServer())
      .post(`/api/v1/housekeeping/maintenance/${state.mntId}`).set('Authorization', auth(tokens.admin))
      .send({ status: 'DONE' });
    expect(again.status).toBe(400);
  });

  it('F10-T3: بچ لاندری خروج با اقلام و بستن', async () => {
    const batch = await request(app.getHttpServer())
      .post('/api/v1/housekeeping/laundry/batches').set('Authorization', auth(tokens.housekeeper))
      .send({ direction: 'OUT_WASH' });
    expect(batch.status).toBe(201);
    state.ldyId = batch.body.id;

    const move = await request(app.getHttpServer())
      .post('/api/v1/housekeeping/laundry/movements').set('Authorization', auth(tokens.housekeeper))
      .send({ batchId: state.ldyId, linenCode: 'LIN-BED', qty: 12 });
    expect(move.status).toBe(201);
    expect(move.body.qty).toBe(12);

    const upd = await request(app.getHttpServer())
      .post('/api/v1/housekeeping/laundry/movements').set('Authorization', auth(tokens.housekeeper))
      .send({ batchId: state.ldyId, linenCode: 'LIN-BED', qty: 14 });
    expect(upd.status).toBe(201);
    expect(upd.body.qty).toBe(14); // upsert جایگزین

    const close = await request(app.getHttpServer())
      .post('/api/v1/housekeeping/laundry/batches/close').set('Authorization', auth(tokens.housekeeper))
      .send({ batchId: state.ldyId });
    expect(close.status).toBe(201);
  });

  it('F10-T4: شیء جامانده — ثبت و تحویل با نام گیرنده', async () => {
    const reg = await request(app.getHttpServer())
      .post('/api/v1/housekeeping/lost-found').set('Authorization', auth(tokens.frontdesk))
      .send({ roomCode: '303', itemDesc: 'شارژر گوشی سیاه', storageLocation: 'صندوق پذیرش' });
    expect(reg.status).toBe(201);
    expect(reg.body.code).toMatch(/^LNF-\d{4}-\d{6}$/);

    const ret = await request(app.getHttpServer())
      .post(`/api/v1/housekeeping/lost-found/${reg.body.id}/resolve`).set('Authorization', auth(tokens.frontdesk))
      .send({ action: 'RETURNED', returnedTo: 'آقای کریمی' });
    expect(ret.status).toBe(201);
    expect(ret.body.status).toBe('RETURNED');
  });

  it('F10-T5: استهلاک دارایی — قسط درست، دورهٔ تکراری ممنوع، سند دوطرفه', async () => {
    const reg = await request(app.getHttpServer())
      .post('/api/v1/assets').set('Authorization', auth(tokens.admin))
      .send({
        nameEn: 'Laundry Machine', nameFa: 'ماشین لباسشویی صنعتی', category: 'ELE',
        acquiredAt: dayOffset(-30), costRials: 24_000_000, salvageRials: 0, usefulLifeMonths: 24,
        roomCode: '301',
      });
    expect(reg.status).toBe(201);
    expect(reg.body.assetCode).toMatch(/^FA-\d{5}$/);
    state.assetId = reg.body.id;

    const run = await request(app.getHttpServer())
      .post('/api/v1/assets/depreciation/run').set('Authorization', auth(tokens.admin))
      .send({ periodCode: '1405-10' });
    expect(run.status).toBe(201);
    const mine = run.body.results.find((r: { assetCode: string }) => r.assetCode === reg.body.assetCode);
    expect(mine.amountRials).toBe(1_000_000); // (24,000,000 − 0) ÷ 24

    const rerun = await request(app.getHttpServer())
      .post('/api/v1/assets/depreciation/run').set('Authorization', auth(tokens.admin))
      .send({ periodCode: '1405-10' });
    expect(rerun.status).toBe(201);
    const mine2 = rerun.body.results.find((r: { assetCode: string }) => r.assetCode === reg.body.assetCode);
    expect(mine2.skipped).toBe('already_posted');

    const j = await waitForJournal('assets', `${reg.body.assetCode}:1405-10`);
    expect(j.entryNo).toContain('JV-');

    const rpt = await request(app.getHttpServer())
      .get('/api/v1/assets/depreciation?periodCode=1405-10').set('Authorization', auth(tokens.admin));
    expect(rpt.status).toBe(200);
    expect(rpt.body.totalRials).toBeGreaterThanOrEqual(1_000_000);
  });

  it('F10-T6: سفارش خدمت جانبی با شارژ فولیو + سند سه‌خطی + برگشت در لغو', async () => {
    const room = await prisma.room.findUnique({ where: { code: '202' } });
    const ci = await request(app.getHttpServer())
      .post('/api/v1/pms/stays/check-in').set('Authorization', auth(tokens.frontdesk))
      .send({
        guestName: 'مهمان خدمات جانبی', roomIds: [room!.id], plannedCheckOut: dayOffset(2),
        idempotencyKey: `wave1-ci2-${Date.now()}`,
      });
    state.stay2 = ci.body.data.stayId;
    state.stay2code = ci.body.data.code;

    const before = await prisma.stay.findUnique({ where: { id: state.stay2 } });

    // SVC-PARKING: ۲×۱٬۵۰۰٬۰۰۰ = ۳٬۰۰۰٬۰۰۰ خالص + ۲۷۰٬۰۰۰ مالیات = ۳٬۲۷۰٬۰۰۰
    const ord = await request(app.getHttpServer())
      .post('/api/v1/ancillary/orders').set('Authorization', auth(tokens.frontdesk))
      .send({
        serviceCode: 'SVC-PARKING', quantity: 2, stayCode: state.stay2code,
        idempotencyKey: `wave1-svc-${Date.now()}`,
      });
    expect(ord.status).toBe(201);
    expect(ord.body.netRials).toBe(3_000_000);
    expect(ord.body.taxRials).toBe(300_000);
    expect(ord.body.totalRials).toBe(3_300_000);
    state.svcOrderId = ord.body.id;

    const after = await prisma.stay.findUnique({ where: { id: state.stay2 } });
    expect(after!.folioRials - before!.folioRials).toBe(3_300_000n);

    const j = await waitForJournal('ancillary', ord.body.id);
    expect(j.entryNo).toContain('JV-');
    const lines = await prisma.journalLine.findMany({
      where: { entry: { sourceRef: ord.body.id, sourceModule: 'ancillary' } },
    });
    expect(lines.find((l) => l.accountCode === '1201')?.debitRials).toBe(3_300_000n);
    expect(lines.find((l) => l.accountCode === '4103')?.creditRials).toBe(3_000_000n);
    expect(lines.find((l) => l.accountCode === '2201')?.creditRials).toBe(300_000n);

    // لغو → برگشت فولیو
    const cancel = await request(app.getHttpServer())
      .post(`/api/v1/ancillary/orders/${state.svcOrderId}/cancel`).set('Authorization', auth(tokens.frontdesk))
      .send({ reason: 'اشتباه در ثبت' });
    expect(cancel.status).toBe(201);
    const reverted = await prisma.stay.findUnique({ where: { id: state.stay2 } });
    expect(reverted!.folioRials).toBe(before!.folioRials);
  });

  it('ماتریس مجوز: housekeeper اجازهٔ ثبت تراکنش خزانه و cashier اجازهٔ وظیفه ندارد', async () => {
    const t = await request(app.getHttpServer())
      .post('/api/v1/housekeeping/tasks').set('Authorization', auth(tokens.cashier))
      .send({ roomCode: '101', kind: 'CLEANING', scheduledDate: dayOffset(0) });
    expect(t.status).toBe(403);

    const x = await request(app.getHttpServer())
      .get('/api/v1/assets').set('Authorization', auth(tokens.housekeeper));
    expect(x.status).toBe(403);
  });
});
