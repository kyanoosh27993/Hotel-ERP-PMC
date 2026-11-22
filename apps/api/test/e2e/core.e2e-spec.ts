/**
 * core.e2e-spec.ts — آزمون پذیرش هسته فاز ۱ (نیازمند PostgreSQL واقعی — در CI اجرا می‌شود):
 * ورود/چرخش توکن/MFA | ماتریس دسترسی | رزرو هم‌زمان Race-safe | POS → سند خودکار |
 * Outbox بدون گم‌شدن رویداد + مصرف تکرارپذیر | قفل دوره.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { authenticator } from 'otplib';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma.service';
import { OutboxPublisher } from '../../src/outbox/outbox.publisher';
import { JournalService } from '../../src/accounting/journal.service';
import { AttendanceSimAdapter } from '../../src/integration/integration-hub.service';
import { AllExceptionsFilter } from '../../src/common/all-exceptions.filter';
import { ConflictException } from '@nestjs/common';
import { buildIranIban } from '@hotel-erp/payroll';

process.env.JWT_ACCESS_SECRET ??= 'e2e-access-secret-change-me';
process.env.MFA_TEST_SECRET ??= 'JBSWY3DPEHPK3PXPE2ETEST';
const MFA_SECRET = process.env.MFA_TEST_SECRET;

let app: INestApplication;
let prisma: PrismaService;
let publisher: OutboxPublisher;
let journal: JournalService;

const tokens: Record<string, string> = {};

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

async function drainOutbox(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    const n = await publisher.publishOnce();
    if (n === 0) break;
  }
}

beforeAll(async () => {
  try {
    // تحمل رانش ساعت در CI برای TOTP
    (authenticator as unknown as { options: Record<string, unknown> }).options = { window: [1, 1] };
  } catch {
    /* default window */
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  // همان خط‌لوله main.ts — شکل استاندارد خطا { error: { code, message } }
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  prisma = app.get(PrismaService);
  publisher = app.get(OutboxPublisher);
  journal = app.get(JournalService);

  await prisma.$executeRawUnsafe(
    `TRUNCATE "reservations","pos_orders","outbox_events","inbox_events","journal_entries","journal_lines","audit_logs","refresh_tokens","payroll_runs","payroll_slips","waitlist_entries" CASCADE`,
  );
  // پاکسازی هدفمند داده تست فاز ۲ برای idempotency (داده seed پرسنل حفظ می‌شود)
  // نکته: Prisma در هر فراخوانی خام فقط یک دستور می‌پذیرد
  await prisma.$executeRawUnsafe(`DELETE FROM "salary_decisions" WHERE "employeeId" IN (SELECT id FROM "employees" WHERE code = '901')`);
  await prisma.$executeRawUnsafe(`DELETE FROM "employees" WHERE code = '901'`);
}, 90_000);

afterAll(async () => {
  await app.close();
});

describe('فاز ۱ — هسته', () => {
  it('health عمومی سبز است', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.db).toBe('up');
  });

  it('ورود پذیرش بدون MFA + مسیر me', async () => {
    const token = await login('frontdesk', false);
    const me = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.data.username).toBe('frontdesk');
  });

  it('ورود مدیر (نقش حساس) بدون TOTP → MFA_REQUIRED؛ با TOTP → موفق', async () => {
    const noTotp = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe_Str0ng!' });
    expect(noTotp.status).toBe(401);
    expect(noTotp.body.error.code).toBe('MFA_REQUIRED');

    const token = await login('admin', true);
    expect(token).toBeTruthy();
  });

  it('گذرواژه نادرست → 401 با پیام عمومی', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: 'frontdesk', password: 'totally-wrong-pass' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid username or password');
  });

  it('چرخش refresh + تشخیص استفاده مجدد → ابطال زنجیره', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: 'frontdesk', password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe_Str0ng!' });
    const { refreshToken, accessToken } = loginRes.body;

    const first = await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refreshToken });
    expect(first.status).toBe(200);
    expect(first.body.refreshToken).not.toBe(refreshToken);

    // استفاده مجدد از توکن باطل‌شده = نشانه سرقت
    const reuse = await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refreshToken });
    expect(reuse.status).toBe(401);

    // حتی توکن تازه‌ی زنجیره هم باطل شده است
    const chained = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.body.refreshToken });
    expect(chained.status).toBe(401);

    // access توکن قبلی هنوز تا انقضا معتبر است ولی refresh زنجیره مرده است
    expect(accessToken).toBeTruthy();
  });

  let roomTypeId: string;

  it('رزرو: ثبت موفق + idempotency همان کلید = همان رزرو (بدون اثر جانبی)', async () => {
    const rt = await request(app.getHttpServer())
      .get('/api/v1/room-types')
      .set('Authorization', `Bearer ${await login('frontdesk', false)}`);
    expect(rt.status).toBe(200);
    roomTypeId = rt.body.data.find((r: { code: string }) => r.code === 'STD').id;
    expect(roomTypeId).toBeTruthy();

    const body = {
      roomTypeId,
      guestName: 'Ali Rezaei',
      checkInDate: '2026-12-01',
      checkOutDate: '2026-12-03',
      idempotencyKey: 'e2e-rsv-1',
    };
    const first = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${await login('frontdesk', false)}`)
      .send(body);
    expect(first.status).toBe(201);
    expect(first.body.data.replayed).toBe(false);

    const second = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${await login('frontdesk', false)}`)
      .send(body);
    expect(second.status).toBe(201);
    expect(second.body.data.replayed).toBe(true);
    expect(second.body.data.reservationId).toBe(first.body.data.reservationId);
  });

  it('رزرو هم‌زمان روی همان نوع اتاق: دقیقاً یکی موفق و یکی 409 (Race-safe)', async () => {
    const auth = `Bearer ${await login('frontdesk', false)}`;
    // فاز ۴: ظرفیت واقعی = ۱۵ اتاق STD؛ دو رزرو هم‌زمانِ ۸ واحدی → ۱۶ > ۱۵ → دقیقاً یکی ۴۰۹
    const make = (key: string) =>
      request(app.getHttpServer())
        .post('/api/v1/reservations')
        .set('Authorization', auth)
        .send({
          roomTypeId,
          guestName: 'Concurrent Guest',
          checkInDate: '2026-12-10',
          checkOutDate: '2026-12-12',
          units: 8,
          idempotencyKey: key,
        });
    const [a, b] = await Promise.allSettled([make('e2e-rsv-c1'), make('e2e-rsv-c2')]);
    // هر دو درخواست باید پاسخ HTTP کامل بگیرند (نه خطای سطح سرور)
    expect(a.status).toBe('fulfilled');
    expect(b.status).toBe('fulfilled');
    type Res = { status: number; body: { error?: { message: string } } };
    const statuses = [a, b].map((r) => (r as PromiseFulfilledResult<Res>).value.status);
    expect([...statuses].sort()).toEqual([201, 409]);
    const loser = [a, b].map((r) => (r as PromiseFulfilledResult<Res>).value).find((v) => v.status === 409);
    expect(loser?.body.error?.message).toContain('not available');
  });

  it('پذیرش اجازه ثبت سند ندارد (ماتریس دسترسی)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/journal-entries')
      .set('Authorization', `Bearer ${await login('frontdesk', false)}`)
      .send({ description: 'should be forbidden', lines: [{ accountCode: '1101', debit: 1000, credit: 0 }] });
    expect(res.status).toBe(403);
  });

  it('حسابدار: پیش‌نویس ✓ / تأییر ✗ — تأییدکننده: تأییر ✓ (خودتأییری ممنوع)', async () => {
    const draft = await request(app.getHttpServer())
      .post('/api/v1/journal-entries')
      .set('Authorization', `Bearer ${await login('accountant', true)}`)
      .send({
        description: 'Manual adjustment — cleaning fine',
        lines: [
          { accountCode: '1101', debit: 150_000, credit: 0 },
          { accountCode: '4101', debit: 0, credit: 150_000 },
        ],
      });
    expect(draft.status).toBe(201);
    const entryId = draft.body.data.id;

    const selfApprove = await request(app.getHttpServer())
      .post(`/api/v1/journal-entries/${entryId}/approve`)
      .set('Authorization', `Bearer ${await login('accountant', true)}`);
    expect(selfApprove.status).toBe(403);

    const approve = await request(app.getHttpServer())
      .post(`/api/v1/journal-entries/${entryId}/approve`)
      .set('Authorization', `Bearer ${await login('approver', true)}`);
    expect(approve.status).toBe(201);
    expect(approve.body.data.status).toBe('POSTED');
  });

  it('POS → Outbox → سند خودکار: فروش با مالیات، سند متوازن با درآمد و ارزش افزوده', async () => {
    const auth = `Bearer ${await login('frontdesk', false)}`;
    const outlets = await request(app.getHttpServer()).get('/api/v1/room-types').set('Authorization', auth);
    void outlets;

    // outlet id از DB مستقیم (فهرست outlet اندپوینت در فاز ۵)
    const outlet = await prisma.posOutlet.findUniqueOrThrow({ where: { code: 'REST-MAIN' } });

    const order = await request(app.getHttpServer())
      .post('/api/v1/pos/orders')
      .set('Authorization', auth)
      .send({
        outletId: outlet.id,
        lines: [
          { itemName: 'Chelo Kabab', qty: 2, unitPriceRials: 850000 },
          { itemName: 'Doogh', qty: 2, unitPriceRials: 60000 },
        ],
        taxRatePermille: 90,
        idempotencyKey: 'e2e-pos-1',
      });
    expect(order.status).toBe(201);
    const orderId = order.body.data.orderId;

    await drainOutbox();

    const entries = await prisma.journalEntry.findMany({ where: { sourceRef: orderId }, include: { lines: true } });
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.status).toBe('POSTED');
    expect(entry.sourceModule).toBe('pos');
    const debit = entry.lines.reduce((s, l) => s + l.debitRials, 0n);
    const credit = entry.lines.reduce((s, l) => s + l.creditRials, 0n);
    expect(debit).toBe(1_820_000n);
    expect(credit).toBe(1_820_000n);
    const vat = entry.lines.find((l) => l.accountCode === '2201');
    expect(vat?.creditRials).toBe(163_800n);

    // تکرار همان سفارش با همان idempotencyKey → همان سفارش، سند جدید نمی‌سازد
    const replay = await request(app.getHttpServer())
      .post('/api/v1/pos/orders')
      .set('Authorization', auth)
      .send({
        outletId: outlet.id,
        lines: [
          { itemName: 'Chelo Kabab', qty: 2, unitPriceRials: 850000 },
          { itemName: 'Doogh', qty: 2, unitPriceRials: 60000 },
        ],
        taxRatePermille: 90,
        idempotencyKey: 'e2e-pos-1',
      });
    expect(replay.status).toBe(201);
    expect(replay.body.data.replayed).toBe(true);
    expect(replay.body.data.orderId).toBe(orderId);
    await drainOutbox();
    expect(await prisma.journalEntry.count({ where: { sourceRef: orderId } })).toBe(1);
  });

  it('شکست مصنوعی: رویداد رزرو بدون انتشار → پس از publishOnce سند می‌سازد؛ اجرای دوباره = همان یک سند', async () => {
    // ثبت رزرو (رویداد در Outbox درج می‌شود ولی هنوز منتشر نشده)
    const res = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${await login('frontdesk', false)}`)
      .send({
        roomTypeId,
        guestName: 'Crash Replay Guest',
        checkInDate: '2026-12-20',
        checkOutDate: '2026-12-22',
        idempotencyKey: 'e2e-rsv-crash',
      });
    expect(res.status).toBe(201);
    const reservationId = res.body.data.reservationId;

    // ── کرش: هنوز publisher اجرا نشده ──
    expect(await prisma.journalEntry.count({ where: { sourceRef: reservationId } })).toBe(0);

    // ── بازیابی: انتشار ──
    await drainOutbox();
    expect(await prisma.journalEntry.count({ where: { sourceRef: reservationId } })).toBe(1);

    // ── اجرای دوباره ناشر: inbox مانع از سند دوم می‌شود ──
    await publisher.publishOnce();
    await publisher.publishOnce();
    expect(await prisma.journalEntry.count({ where: { sourceRef: reservationId } })).toBe(1);
  });

  it('قفل دوره: ثبت سند در دوره قفل‌شده → 409 (قواعد مالی)', async () => {
    // ماه گذشته در seed قفل شده است
    const now = new Date();
    const locked = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
    await expect(
      journal.postEntryFromEvent(
        `e2e-locked-${Date.now()}`,
        [
          { accountCode: '1101', debitRials: 1000n, creditRials: 0n },
          { accountCode: '4101', debitRials: 0n, creditRials: 1000n },
        ],
        {
          description: 'entry into locked period',
          sourceModule: 'test',
          sourceRef: 'locked-period-test',
          createdByUserId: 'system:engine',
          entryDate: locked,
        },
      ),
    ).rejects.toMatchObject({ response: { code: 'BUSINESS_RULE' } });
  });

  it('سند نامتوازن → رد (قواعد مالی)', async () => {
    await expect(
      journal.postEntryFromEvent(
        `e2e-unbalanced-${Date.now()}`,
        [
          { accountCode: '1101', debitRials: 5000n, creditRials: 0n },
          { accountCode: '4101', debitRials: 0n, creditRials: 4000n },
        ],
        {
          description: 'unbalanced must fail',
          sourceModule: 'test',
          sourceRef: 'unbalanced-test',
          createdByUserId: 'system:engine',
        },
      ),
    ).rejects.toMatchObject({ response: { code: 'BUSINESS_RULE' } });
  });

  it('Integration Hub: سلامت Adapter ساعت‌زنی و رفتار degrade در قطعی', async () => {
    const token = await login('admin', true);
    const list = await request(app.getHttpServer()).get('/api/v1/integrations').set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    const sim = list.body.data.find((x: { id: string }) => x.id === 'attendance-sim');
    expect(sim.health).toBe('healthy');

    // قطعی شبیه‌سازی‌شده → degraded ولی بدون خطای ۵۰۰
    const adapter = app.get(AttendanceSimAdapter);
    adapter.setConnected(false);
    const degraded = await request(app.getHttpServer()).get('/api/v1/integrations/attendance-sim/health').set('Authorization', `Bearer ${token}`);
    expect(degraded.status).toBe(200);
    expect(degraded.body.data.health).toBe('degraded');
    adapter.setConnected(true);
  });

  it('حسابرسی: لاگ ورود/تأیید ثبت شده (Audit Trail)', async () => {
    const logs = await prisma.auditLog.findMany({ where: { action: { in: ['LOGIN', 'JOURNAL_APPROVED', 'JOURNAL_DRAFT_CREATED'] } } });
    expect(logs.length).toBeGreaterThanOrEqual(3);
  });

  it('ConflictException کد استاندارد دارد', () => {
    const e = new ConflictException({ code: 'CONFLICT', message: 'x' });
    expect(e.getResponse()).toMatchObject({ code: 'CONFLICT' });
  });
});

describe('فاز ۲ — حقوق و دستمزد (F2-T1…T4)', () => {
  let newEmployeeId: string;
  let newDecisionId: string;
  let runId: string;

  it('پذیرش اجازه ثبت پرسنل ندارد (ماتریس دسترسی فاز ۲)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/payroll/employees')
      .set('Authorization', `Bearer ${await login('frontdesk', false)}`)
      .send({ code: '999', firstName: 'x', lastName: 'y', marital: false, dependents: 0 });
    expect(res.status).toBe(403);
  });

  it('حسابدار: کارمند جدید + حکم پیش‌نویس ثبت می‌کند؛ شبا نامعتبر رد می‌شود', async () => {
    const auth = `Bearer ${await login('accountant', true)}`;
    const badIban = await request(app.getHttpServer())
      .post('/api/v1/payroll/employees')
      .set('Authorization', auth)
      .send({ code: '901', firstName: 'بد', lastName: 'شبا', marital: true, dependents: 1, iban: 'IR1201700000012345678901234' });
    expect(badIban.status).toBe(400);

    const created = await request(app.getHttpServer())
      .post('/api/v1/payroll/employees')
      .set('Authorization', auth)
      .send({
        code: '901',
        firstName: 'تست',
        lastName: 'پذیرش',
        marital: true,
        dependents: 2,
        iban: buildIranIban('0170000000012345678901'),
      });
    expect(created.status).toBe(201);
    newEmployeeId = created.body.data.id;

    const decision = await request(app.getHttpServer())
      .post('/api/v1/payroll/decisions')
      .set('Authorization', auth)
      .send({
        employeeId: newEmployeeId,
        baseSalary: '210000000',
        seniority: '5000000',
        housing: '30000000',
        effectiveFrom: '2025-03-21',
        note: 'e2e decision',
      });
    expect(decision.status).toBe(201);
    newDecisionId = decision.body.data.id;
    expect(decision.body.data.status).toBe('DRAFT');
  });

  it('حسابدار اجازه تأیید حکم ندارد؛ تأییدکننده تأیید می‌کند', async () => {
    const selfApprove = await request(app.getHttpServer())
      .post(`/api/v1/payroll/decisions/${newDecisionId}/approve`)
      .set('Authorization', `Bearer ${await login('accountant', true)}`);
    expect(selfApprove.status).toBe(403);

    const approve = await request(app.getHttpServer())
      .post(`/api/v1/payroll/decisions/${newDecisionId}/approve`)
      .set('Authorization', `Bearer ${await login('approver', true)}`);
    expect(approve.status).toBe(201);
    expect(approve.body.data.status).toBe('APPROVED');
  });

  it('محاسبه دوره ۱۴۰۵-۰۹: کارمندان seed + کارمند جدید = ۱۱ فیش؛ جمع فیش‌ها = جمع دوره', async () => {
    const calc = await request(app.getHttpServer())
      .post('/api/v1/payroll/runs')
      .set('Authorization', `Bearer ${await login('accountant', true)}`)
      .send({ periodCode: '1405-09' });
    expect(calc.status).toBe(201);
    runId = calc.body.data.id;
    expect(calc.body.data.employeeCount).toBe(11);
    expect(calc.body.data.status).toBe('DRAFT');
    expect(calc.body.data.paramsVersion).toBeTruthy();

    // خالص هر فیش = ناخالص − بیمه کارگر − مالیات (فرمول قرارداد روی داده API)
    const runDetail = await request(app.getHttpServer())
      .get(`/api/v1/payroll/runs/${runId}`)
      .set('Authorization', `Bearer ${await login('accountant', true)}`);
    expect(runDetail.status).toBe(200);
    for (const s of runDetail.body.data.slips) {
      expect(BigInt(s.net)).toBe(BigInt(s.gross) - BigInt(s.ins) - BigInt(s.tax));
    }
  });

  it('بازمحاسبه دوره پیش‌نویس مجاز است (بدون دوباره‌سازی)', async () => {
    const recalc = await request(app.getHttpServer())
      .post('/api/v1/payroll/runs')
      .set('Authorization', `Bearer ${await login('accountant', true)}`)
      .send({ periodCode: '1405-09' });
    expect(recalc.status).toBe(201);
    expect(recalc.body.data.id).toBe(runId);
    expect(recalc.body.data.employeeCount).toBe(11);
  });

  it('سه لیست رسمی: مالیات/بیمه/بانک — تعداد سطرها و تراز بیمه', async () => {
    const auth = `Bearer ${await login('accountant', true)}`;
    const tax = await request(app.getHttpServer()).get(`/api/v1/payroll/runs/${runId}/lists/tax`).set('Authorization', auth);
    const ins = await request(app.getHttpServer()).get(`/api/v1/payroll/runs/${runId}/lists/insurance`).set('Authorization', auth);
    const bank = await request(app.getHttpServer()).get(`/api/v1/payroll/runs/${runId}/lists/bank`).set('Authorization', auth);
    expect([tax.status, ins.status, bank.status]).toEqual([200, 200, 200]);
    expect(tax.body.data).toHaveLength(11);
    expect(ins.body.data).toHaveLength(11);
    expect(bank.body.data).toHaveLength(11);
    for (const row of ins.body.data) {
      expect(row.total).toBe(row.employee7 + row.employer23);
    }
    for (const row of bank.body.data) {
      expect(row.iban).toMatch(/^IR\d{24}$/);
    }
    // لیست مالیات: هر سطر مالیات صحیح
    for (const row of tax.body.data) {
      expect(Number.isInteger(row.tax)).toBe(true);
    }
  });

  it('حسابدار اجازه تأیید دوره ندارد؛ تأییدکننده تأیید می‌کند → سند خودکار متوازن حقوق', async () => {
    const selfApprove = await request(app.getHttpServer())
      .post(`/api/v1/payroll/runs/${runId}/approve`)
      .set('Authorization', `Bearer ${await login('accountant', true)}`);
    expect(selfApprove.status).toBe(403);

    const approve = await request(app.getHttpServer())
      .post(`/api/v1/payroll/runs/${runId}/approve`)
      .set('Authorization', `Bearer ${await login('approver', true)}`);
    expect(approve.status).toBe(201);
    expect(approve.body.data.status).toBe('APPROVED');

    await drainOutbox();

    // سند حقوق: بدهکار 5102+5103 / بستانکار 2202+2203+2102 — متوازن و قابل ردیابی به دوره
    const entries = await prisma.journalEntry.findMany({ where: { sourceRef: runId, sourceModule: 'payroll' }, include: { lines: true } });
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    const debit = entry.lines.reduce((s, l) => s + l.debitRials, 0n);
    const credit = entry.lines.reduce((s, l) => s + l.creditRials, 0n);
    expect(debit).toBe(credit);
    const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
    expect(entry.lines.find((l) => l.accountCode === '5102')?.debitRials).toBe(run.grossRials);
    expect(entry.lines.find((l) => l.accountCode === '2102')?.creditRials).toBe(run.netRials);
    expect(entry.lines.find((l) => l.accountCode === '2202')?.creditRials).toBe(run.insEmployeeRials + run.insEmployerRials);
    expect(run.journalEntryId).toBe(entry.id);

    // دوره تأییدشده تغییرناپذیر: بازمحاسبه → 409
    const recalc = await request(app.getHttpServer())
      .post('/api/v1/payroll/runs')
      .set('Authorization', `Bearer ${await login('accountant', true)}`)
      .send({ periodCode: '1405-09' });
    expect(recalc.status).toBe(409);
  });
});

describe('فاز ۳ — داشبوردها (F3-T1…T3 — همه اعداد از کوئری واقعی)', () => {
  const iso = (d: Date): string => d.toISOString().slice(0, 10);
  const today = new Date();
  const todayStr = iso(today);
  const plusDays = (n: number): string => iso(new Date(today.getTime() + n * 24 * 3600 * 1000));

  const ceoOf = async (): Promise<Record<string, unknown>> => {
    const r = await request(app.getHttpServer())
      .get('/api/v1/dashboards/ceo')
      .set('Authorization', `Bearer ${await login('admin', true)}`);
    expect(r.status).toBe(200);
    return r.body.data;
  };
  const financeOf = async (): Promise<Record<string, unknown>> => {
    const r = await request(app.getHttpServer())
      .get('/api/v1/dashboards/finance')
      .set('Authorization', `Bearer ${await login('accountant', true)}`);
    expect(r.status).toBe(200);
    return r.body.data;
  };

  it('ماتریس دسترسی پنل‌ها: پذیرش/حسابدار CEO را نمی‌بینند؛ حسابدار مالی ✓؛ حسابدار رستوران ✗', async () => {
    const fdCeo = await request(app.getHttpServer())
      .get('/api/v1/dashboards/ceo')
      .set('Authorization', `Bearer ${await login('frontdesk', false)}`);
    expect(fdCeo.status).toBe(403);
    const accCeo = await request(app.getHttpServer())
      .get('/api/v1/dashboards/ceo')
      .set('Authorization', `Bearer ${await login('accountant', true)}`);
    expect(accCeo.status).toBe(403); // نمونه الزامی قرارداد: حسابدار داشبورد مدیرعامل ندارد
    const accFin = await request(app.getHttpServer())
      .get('/api/v1/dashboards/finance')
      .set('Authorization', `Bearer ${await login('accountant', true)}`);
    expect(accFin.status).toBe(200);
    const accRest = await request(app.getHttpServer())
      .get('/api/v1/dashboards/restaurant')
      .set('Authorization', `Bearer ${await login('accountant', true)}`);
    expect(accRest.status).toBe(403);
    const fdHk = await request(app.getHttpServer())
      .get('/api/v1/dashboards/housekeeping')
      .set('Authorization', `Bearer ${await login('frontdesk', false)}`);
    expect(fdHk.status).toBe(200);
  });

  it('F3-T1 مدیرعامل: رزرو امروز → دلتای درآمد روز/ماه و اشغال دقیقاً برابر رزرو', async () => {
    const before = await ceoOf();
    const rt = await prisma.roomType.findFirstOrThrow({ where: { code: 'STD' } });
    const rsv = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', `Bearer ${await login('frontdesk', false)}`)
      .send({
        roomTypeId: rt.id,
        guestName: 'Dash Ceo Guest',
        checkInDate: todayStr,
        checkOutDate: plusDays(2),
        idempotencyKey: 'e2e-rsv-d3',
      });
    expect(rsv.status).toBe(201);
    const reservation = await prisma.reservation.findUniqueOrThrow({ where: { id: rsv.body.data.reservationId } });
    await drainOutbox();

    const after = await ceoOf();
    expect(BigInt(after.revenueTodayRials as string) - BigInt(before.revenueTodayRials as string)).toBe(reservation.totalRials);
    expect(BigInt(after.revenueMonthRials as string) - BigInt(before.revenueMonthRials as string)).toBe(reservation.totalRials);
    expect((after.occupancy as { occupiedUnits: number }).occupiedUnits).toBe(
      (before.occupancy as { occupiedUnits: number }).occupiedUnits + 1,
    );
    // تاریخ گزارش شمسی است (قوانین ۱۳/۱۴)
    expect(after.asOf).toMatch(/۱۴۰۵|1405/);
  });

  it('F3-T3 رستوران: سفارش امروز → دلتای فروش/تعداد دقیق؛ CEO درآمد = رزرو + خالص فروش', async () => {
    const restBefore = await request(app.getHttpServer())
      .get('/api/v1/dashboards/restaurant')
      .set('Authorization', `Bearer ${await login('frontdesk', false)}`);
    expect(restBefore.status).toBe(200);
    const ceoBefore = await ceoOf();

    const outlet = await prisma.posOutlet.findUniqueOrThrow({ where: { code: 'REST-MAIN' } });
    const order = await request(app.getHttpServer())
      .post('/api/v1/pos/orders')
      .set('Authorization', `Bearer ${await login('frontdesk', false)}`)
      .send({
        outletId: outlet.id,
        lines: [
          { itemName: 'Dash Kabab', qty: 1, unitPriceRials: 900_000 },
          { itemName: 'Dash Tea', qty: 2, unitPriceRials: 50_000 },
        ],
        taxRatePermille: 90,
        idempotencyKey: 'e2e-pos-d3',
      });
    expect(order.status).toBe(201);
    await drainOutbox();

    const restAfter = await request(app.getHttpServer())
      .get('/api/v1/dashboards/restaurant')
      .set('Authorization', `Bearer ${await login('frontdesk', false)}`);
    const b = restBefore.body.data;
    const a = restAfter.body.data;
    // 900000 + 2×50000 = 1,000,000 — مالیات ۹۰‰ = 90,000
    expect(a.todayOrders - b.todayOrders).toBe(1);
    expect(BigInt(a.todaySalesRials) - BigInt(b.todaySalesRials)).toBe(1_000_000n);
    expect(BigInt(a.todayNetRials) - BigInt(b.todayNetRials)).toBe(910_000n);
    expect(a.waste.note).toContain('فاز ۷'); // KPI ضایعات صادقانه صفر واقعی است

    const ceoAfter = await ceoOf();
    // دلتای درآمد امروز = فقط خالص فروش ۹۱۰٬۰۰۰ (۴۱۰۲) — رزرو قبلاً در ceoBefore شمرده شده
    expect(
      BigInt(ceoAfter.revenueTodayRials as string) - BigInt(ceoBefore.revenueTodayRials as string),
    ).toBe(910_000n);
  });

  it('F3-T2 مالی: مطالبات/صندوق دلتای دقیق؛ سند پیش‌نویس معلق >۷ روز → هشدار اقلام معلق', async () => {
    const finBefore = await financeOf();
    const staleDate = new Date(today.getTime() - 10 * 24 * 3600 * 1000);
    await prisma.journalEntry.create({
      data: {
        entryNo: 'JV-TEST-STALE-1',
        entryDate: staleDate,
        postingDate: staleDate,
        description: 'stale draft for e2e',
        status: 'DRAFT',
        sourceModule: 'manual',
        sourceRef: 'e2e-stale',
        lines: {
          create: [
            { lineNo: 1, accountCode: '1101', debitRials: 77_000n, creditRials: 0n },
            { lineNo: 2, accountCode: '4101', debitRials: 0n, creditRials: 77_000n },
          ],
        },
      },
    });

    const finAfter = await financeOf();
    expect((finAfter.staleItems as Array<{ entryNo: string }>).map((s) => s.entryNo)).toContain('JV-TEST-STALE-1');
    expect(finAfter.alertsCount).toBe((finAfter.staleItems as unknown[]).length);
    expect((finAfter.staleItems as Array<{ messageFa: string }>)[0].messageFa).toContain('معلق');
    // صندوق/مطالبات: مقادیر رشته‌ای ریال — کوئری واقعی
    expect(typeof (finAfter.cashBoxes as Array<{ balanceRials: string }>)[0].balanceRials).toBe('string');
    expect(typeof finAfter.receivablesRials).toBe('string');
    // این تست هیچ بدهکار مطالبات جدیدی نمی‌سازد (پیش‌نویس معلق قطعی نیست) → مطالبات تغییری نمی‌کند
    expect(BigInt(finAfter.receivablesRials as string)).toBe(BigInt(finBefore.receivablesRials as string));
    // اثبات کوئری واقعی: مطالبات = جمع رزروهای مؤثر (همه CONFIRMED بدون تسویه)
    const confirmed = await prisma.reservation.findMany({ where: { status: 'CONFIRMED' }, select: { totalRials: true } });
    const expectedReceivables = confirmed.reduce((acc, r) => acc + r.totalRials, 0n);
    expect(BigInt(finAfter.receivablesRials as string)).toBe(expectedReceivables);
  });

  it('F3-T3 خانه‌داری: ورود امروز = رزرو امروز؛ وضعیت اتاق‌ها از کوئری واقعی', async () => {
    const r = await request(app.getHttpServer())
      .get('/api/v1/dashboards/housekeeping')
      .set('Authorization', `Bearer ${await login('frontdesk', false)}`);
    expect(r.status).toBe(200);
    const hk = r.body.data;
    const roomsCount = await prisma.room.count();
    // فاز ۴: ظرفیت فعال = اتاق‌های خارج از سرویس‌نشده (تعمیرات لحظه‌ای روی اشغال اثر دارد)
    const activeRooms = await prisma.room.count({ where: { status: { not: 'OUT_OF_SERVICE' } } });
    expect(hk.totalRooms).toBe(activeRooms);
    const sumStatus = (hk.roomsByStatus as Array<{ count: number }>).reduce((acc, x) => acc + x.count, 0);
    expect(sumStatus).toBe(roomsCount);
    expect(hk.arrivalsToday).toBeGreaterThanOrEqual(1);
    const std = (hk.occupancyByType as Array<{ roomType: string; occupied: number }>).find((t) => t.occupied > 0);
    expect(std).toBeTruthy();
  });
});

describe('فاز ۴ — نقشه اتاق، ظرفیت واقعی، چک‌این/چک‌اوت، لیست انتظار (F4-T1…T3)', () => {
  const iso = (d: Date): string => d.toISOString().slice(0, 10);
  const today = new Date();
  const plusDays = (n: number): string => iso(new Date(today.getTime() + n * 24 * 3600 * 1000));
  const fd = async () => `Bearer ${await login('frontdesk', false)}`;

  it('F4-T1 نقشه اتاق: فهرست با فیلتر + تغییر وضعیت لحظه‌ای (تعمیرات با دلیل) + حسابرسی', async () => {
    const auth = await fd();
    const list = await request(app.getHttpServer()).get('/api/v1/rooms').set('Authorization', auth);
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBe(await prisma.room.count());
    const room = list.body.data[0];

    const dirty = await request(app.getHttpServer())
      .patch(`/api/v1/rooms/${room.id}/status`)
      .set('Authorization', auth)
      .send({ status: 'DIRTY' });
    expect(dirty.status).toBe(200);
    expect(dirty.body.data.status).toBe('DIRTY');

    // خارج از سرویس بدون دلیل → ممنوع؛ با دلیل → ثبت + حسابرسی
    const noNote = await request(app.getHttpServer())
      .patch(`/api/v1/rooms/${room.id}/status`)
      .set('Authorization', auth)
      .send({ status: 'OUT_OF_SERVICE' });
    expect(noNote.status).toBe(400);
    const oos = await request(app.getHttpServer())
      .patch(`/api/v1/rooms/${room.id}/status`)
      .set('Authorization', auth)
      .send({ status: 'OUT_OF_SERVICE', note: 'نقاشی و تعویض فرش' });
    expect(oos.status).toBe(200);
    const audits = await prisma.auditLog.findMany({ where: { entity: 'Room', entityId: room.id, action: 'ROOM_STATUS_CHANGED' } });
    expect(audits.length).toBeGreaterThanOrEqual(2);

    // حسابدار اجازه تغییر وضعیت ندارد (ماتریس)
    const acc = await request(app.getHttpServer())
      .patch(`/api/v1/rooms/${room.id}/status`)
      .set('Authorization', `Bearer ${await login('accountant', true)}`)
      .send({ status: 'AVAILABLE' });
    expect(acc.status).toBe(403);
  });

  it('F4-T1 لحظه‌ای: اتاق خارج از سرویس → ظرفیت رزرو همان لحظه کم می‌شود (بدون Overbooking)', async () => {
    const auth = await fd();
    const rt = await prisma.roomType.findFirstOrThrow({ where: { code: 'STD' } });
    const before = await request(app.getHttpServer())
      .get('/api/v1/dashboards/ceo').set('Authorization', `Bearer ${await login('admin', true)}`);
    const capBefore = (before.body.data.occupancy.byType as Array<{ roomType: string; total: number }>).find((t) => t.roomType.includes('استاندارد'));

    // یک اتاق دیگر را خارج از سرویس می‌کنیم
    const freeRoom = await prisma.room.findFirstOrThrow({ where: { roomTypeId: rt.id, status: 'AVAILABLE' }, orderBy: { code: 'asc' } });
    await request(app.getHttpServer())
      .patch(`/api/v1/rooms/${freeRoom.id}/status`)
      .set('Authorization', auth)
      .send({ status: 'OUT_OF_SERVICE', note: 'e2e تعمیر' });

    const after = await request(app.getHttpServer())
      .get('/api/v1/dashboards/ceo').set('Authorization', `Bearer ${await login('admin', true)}`);
    const capAfter = (after.body.data.occupancy.byType as Array<{ roomType: string; total: number }>).find((t) => t.roomType.includes('استاندارد'));
    expect((capAfter?.total ?? 0) + 1).toBe(capBefore?.total ?? 0);

    // برگرداندن اتاق به سرویس
    await request(app.getHttpServer())
      .patch(`/api/v1/rooms/${freeRoom.id}/status`)
      .set('Authorization', auth)
      .send({ status: 'AVAILABLE' });
  });

  it('F4-T2 رزرو گروهی با تعرفه ویژه + ظرفیت: ۱۰ واحد ✓ / ۱۰ واحد دیگر → ۴۰۹', async () => {
    const auth = await fd();
    const rt = await prisma.roomType.findFirstOrThrow({ where: { code: 'STD' } });
    const g1 = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', auth)
      .send({
        roomTypeId: rt.id,
        guestName: 'Group Tour A',
        checkInDate: '2027-01-10',
        checkOutDate: '2027-01-13',
        units: 10,
        source: 'WALK_IN',
        ratePerNightRials: '2000000',
        idempotencyKey: 'e2e-group-a',
      });
    expect(g1.status).toBe(201);
    const rsv = await prisma.reservation.findUniqueOrThrow({ where: { id: g1.body.data.reservationId } });
    expect(rsv.source).toBe('WALK_IN');
    expect(rsv.units).toBe(10);
    // ۳ شب × ۱۰ واحد × ۲٬۰۰۰٬۰۰۰ = ۶۰٬۰۰۰٬۰۰۰
    expect(rsv.totalRials).toBe(60_000_000n);

    const g2 = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', auth)
      .send({
        roomTypeId: rt.id,
        guestName: 'Group Tour B',
        checkInDate: '2027-01-10',
        checkOutDate: '2027-01-13',
        units: 10,
        source: 'PHONE',
        idempotencyKey: 'e2e-group-b',
      });
    expect(g2.status).toBe(409); // ۱۰+۱۰ > ۱۵ → بدون Overbooking
  });

  it('F4-T3 چک‌این با تخصیص خودکار → اتاق OCCUPIED؛ چک‌اوت → اتاق DIRTY + داشبورد لحظه‌ای', async () => {
    const auth = await fd();
    const rt = await prisma.roomType.findFirstOrThrow({ where: { code: 'STD' } });
    const rsv = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set('Authorization', auth)
      .send({
        roomTypeId: rt.id,
        guestName: 'Walkin Guest P4',
        checkInDate: plusDays(0),
        checkOutDate: plusDays(2),
        source: 'WALK_IN',
        idempotencyKey: 'e2e-p4-ci',
      });
    expect(rsv.status).toBe(201);
    const rid = rsv.body.data.reservationId;

    // حسابدار اجازه چک‌این ندارد
    const accCi = await request(app.getHttpServer())
      .post(`/api/v1/reservations/${rid}/check-in`)
      .set('Authorization', `Bearer ${await login('accountant', true)}`);
    expect(accCi.status).toBe(403);

    const ci = await request(app.getHttpServer())
      .post(`/api/v1/reservations/${rid}/check-in`)
      .set('Authorization', auth);
    expect(ci.status).toBe(201);
    expect(ci.body.data.status).toBe('CHECKED_IN');
    expect(ci.body.data.assignedRooms.length).toBe(1);
    const roomCode = ci.body.data.assignedRooms[0] as string;

    const room = await prisma.room.findUniqueOrThrow({ where: { code: roomCode } });
    expect(room.status).toBe('OCCUPIED');

    // داشبورد خانه‌داری همین لحظه اتاق اشغال را نشان می‌دهد (کوئری واقعی)
    const hk = await request(app.getHttpServer())
      .get('/api/v1/dashboards/housekeeping')
      .set('Authorization', auth);
    const occ = (hk.body.data.roomsByStatus as Array<{ status: string; count: number }>).find((x) => x.status === 'OCCUPIED');
    expect(occ?.count ?? 0).toBeGreaterThanOrEqual(1);

    // چک‌اوت → DIRTY
    const co = await request(app.getHttpServer())
      .post(`/api/v1/reservations/${rid}/check-out`)
      .set('Authorization', auth);
    expect(co.status).toBe(201);
    expect(co.body.data.roomStatus).toBe('DIRTY');
    const roomAfter = await prisma.room.findUniqueOrThrow({ where: { code: roomCode } });
    expect(roomAfter.status).toBe('DIRTY');

    // چک‌اوت دوباره → خطا
    const co2 = await request(app.getHttpServer())
      .post(`/api/v1/reservations/${rid}/check-out`)
      .set('Authorization', auth);
    expect(co2.status).toBe(409);
  });

  it('F4-T2 لیست انتظار: ثبت → تبدیل به رزرو واقعی → لغو مورد دیگر', async () => {
    const auth = await fd();
    // JUN در seed اتاقی ندارد (ظرفیت صفر) — لیست انتظار روی STD با ظرفیت واقعی ۱۵
    const rt = await prisma.roomType.findFirstOrThrow({ where: { code: 'STD' } });
    const add = await request(app.getHttpServer())
      .post('/api/v1/waiting-list')
      .set('Authorization', auth)
      .send({
        guestName: 'Waitlist Guest ۱',
        phone: '09121234567',
        roomTypeId: rt.id,
        fromDate: '2027-02-01',
        toDate: '2027-02-03',
        note: 'درخواست تلفنی',
      });
    expect(add.status).toBe(201);

    const list = await request(app.getHttpServer()).get('/api/v1/waiting-list').set('Authorization', auth);
    expect(list.status).toBe(200);
    const mine = (list.body.data as Array<Record<string, unknown>>).find((x) => x.id === add.body.data.id);
    expect(mine?.status).toBe('WAITING');
    expect(mine?.roomTypeFa).toBeTruthy(); // کوئری واقعی با نام فارسی نوع اتاق

    const conv = await request(app.getHttpServer())
      .post(`/api/v1/waiting-list/${add.body.data.id}/convert`)
      .set('Authorization', auth);
    expect(conv.status).toBe(201);
    expect(conv.body.data.waitlistStatus).toBe('CONVERTED');
    const wEntry = await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: add.body.data.id } });
    expect(wEntry.convertedReservationId).toBeTruthy();

    // مورد دوم برای لغو
    const add2 = await request(app.getHttpServer())
      .post('/api/v1/waiting-list')
      .set('Authorization', auth)
      .send({ guestName: 'Waitlist Guest ۲', roomTypeId: rt.id, fromDate: '2027-02-05', toDate: '2027-02-06' });
    expect(add2.status).toBe(201);
    const cancel = await request(app.getHttpServer())
      .patch(`/api/v1/waiting-list/${add2.body.data.id}/cancel`)
      .set('Authorization', auth);
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.status).toBe('CANCELLED');
  });
});
