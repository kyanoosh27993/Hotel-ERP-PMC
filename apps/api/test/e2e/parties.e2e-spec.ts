/**
 * parties.e2e-spec.ts — نیاز یکتایی کارفرما: ثبت مرکزی اشخاص/شرکت‌ها.
 * جستجوی زندهٔ زیررشته‌ای | گارد ضدتکرار 409 | اعتبارسنجی ساختاری کد ملی/شناسهٔ ملی/کد اقتصادی/کد پستی |
 * الزام فروشندهٔ حقوقی | ensure بی‌صدا | PATCH اصلاح | گیت هویتی چک‌این (رزرو→اقامت).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { authenticator } from 'otplib';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma.service';
import { AllExceptionsFilter } from '../../src/common/all-exceptions.filter';

process.env.JWT_ACCESS_SECRET ??= 'e2e-access-secret-change-me';
process.env.AUTH_CAPTCHA_REQUIRED ??= 'false';
process.env.MFA_TEST_SECRET ??= 'JBSWY3DPEHPK3PXPE2ETEST';
const MFA_SECRET = process.env.MFA_TEST_SECRET;

let app: INestApplication;
let prisma: PrismaService;
let adminToken = '';
let runTag: string;

// کدملی/شناسه‌ملی راستی‌آزمایی‌شده (scripts/verify-iran-ids.py + الگوریتم مستند)
const MELLI_OK_1 = '0499370899'; // نمونهٔ معتبر مستند
const MELLI_OK_2 = '1234567891'; // رقم کنترل محاسبه‌شده
const MELLI_FAKE_SEQ = '1234567890'; // رقم کنترل غلط
const MELLI_OK_3 = '5551234568'; // رقم کنترل محاسبه‌شده — مخصوص U6
const MELLI_SAME = '1111111111'; // ارقام یکسان
const LEGAL_OK = '10100834967'; // بانک ملت — واقعی
const LEGAL_OK_2 = '10861677542'; // بانک ملی ایران — واقعی (برای ensure مستقل از U4)
const LEGAL_FAKE = '10100834966'; // رقم کنترل دستکاری‌شده
const ECON_OK = '411158317571'; // ۱۲ رقم — کد اقتصادی واقعی بانک ملت
const ECON_OK_2 = '411158317599'; // ۱۲ رقم — برای ensure مستقل از U4
const ECON_SHORT = '411158317'; // کمتر از ۱۱ رقم

async function login(username: string, withTotp: boolean): Promise<string> {
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
  return res.body.accessToken;
}

const auth = (): string => `Bearer ${adminToken}`;

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
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // همان خط‌لوله main.ts — شکل استاندارد خطا { error: { code, message } }
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  prisma = app.get(PrismaService);
  adminToken = await login('admin', true);
  runTag = Date.now().toString(36);
  // پاکسازی اجراهای قبلی همین spec (اجرای تکراری محلی — در CI پایگاه تازه است)
  await prisma.reservation.deleteMany({ where: { idempotencyKey: { startsWith: 'uniq-gate-' } } });
  await prisma.party.deleteMany({
    where: {
      OR: [
        { nationalId: { in: [MELLI_OK_1, MELLI_OK_2, MELLI_OK_3] } },
        { natIdentifier: { in: [LEGAL_OK, LEGAL_OK_2] } },
        { economicCode: { in: [ECON_OK, ECON_OK_2] } },
      ],
    },
  });
  // اتاق‌های اشغال‌شده بدون اقامت باز → آزاد (بازگشت وضعیت از اجرای قبلی)
  const openStayRoomIds = (await prisma.stayRoom.findMany({ where: { stay: { status: 'OPEN' } } })).map((sr) => sr.roomId);
  await prisma.room.updateMany({ where: { status: 'OCCUPIED', id: { notIn: openStayRoomIds } }, data: { status: 'AVAILABLE' } });
}, 90_000);

afterAll(async () => {
  await app.close();
});

describe('نیاز یکتایی — ثبت مرکزی اشخاص/شرکت‌ها', () => {
  it('U1 — ثبت مهمان جدید + جستجوی زندهٔ زیررشته در وسط کلمه', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/parties')
      .set('Authorization', auth())
      .send({
        kind: 'GUEST',
        firstName: 'رضا',
        lastName: `احمدی${runTag}`,
        nationalId: MELLI_OK_1,
        mobile: '09135551122',
        postalCode: '7719175571',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeTruthy();
    expect(res.body.data.displayName).toContain('احمدی');
    const partyId = res.body.data.id;

    // تایپ «حمد» — زیررشتهٔ وسط نام خانوادگی → باید پیدا شود
    const s1 = await request(app.getHttpServer())
      .get(`/api/v1/parties/search?q=${encodeURIComponent('حمد')}`)
      .set('Authorization', auth());
    expect(s1.status).toBe(200);
    const hit = s1.body.data.find((p: { id: string }) => p.id === partyId);
    expect(hit).toBeTruthy();
    expect(hit.kindFa).toBe('مهمان');

    // زیررشتهٔ وسط کد ملی (۳۷۰۸) → پیدا شود
    const s2 = await request(app.getHttpServer())
      .get('/api/v1/parties/search?q=3708')
      .set('Authorization', auth());
    expect(s2.status).toBe(200);
    expect(s2.body.data.some((p: { id: string }) => p.id === partyId)).toBe(true);
  });

  it('U2 — ثبت دوباره با همان کد ملی → 409 DUPLICATE_PARTY با رکورد موجود', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/parties')
      .set('Authorization', auth())
      .send({
        kind: 'GUEST',
        firstName: 'علی',
        lastName: `احمدی${runTag}`,
        nationalId: MELLI_OK_1, // همان کد ملی U1
        mobile: '09135559999',
      });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_PARTY');
    expect(res.body.error.details.existing.id).toBeTruthy();
    expect(res.body.error.details.existing.nationalId).toBe(MELLI_OK_1);
  });

  it('U3 — کد ملی فیک/جعلی رد می‌شود (رقم کنترل و ارقام یکسان)', async () => {
    const bad1 = await request(app.getHttpServer())
      .post('/api/v1/parties')
      .set('Authorization', auth())
      .send({ kind: 'GUEST', firstName: 'تست', lastName: `فیک${runTag}`, nationalId: MELLI_FAKE_SEQ });
    expect(bad1.status).toBe(400);
    expect(bad1.body.error.message).toContain('کد ملی');

    const bad2 = await request(app.getHttpServer())
      .post('/api/v1/parties')
      .set('Authorization', auth())
      .send({ kind: 'GUEST', firstName: 'تست', lastName: `فیک${runTag}`, nationalId: MELLI_SAME });
    expect(bad2.status).toBe(400);

    // کد ملی معتبرِ دیگر → ثبت می‌شود (تمایز واقعی فیک از معتبر)
    const good = await request(app.getHttpServer())
      .post('/api/v1/parties')
      .set('Authorization', auth())
      .send({ kind: 'GUEST', firstName: 'سارا', lastName: `محمدی${runTag}`, nationalId: MELLI_OK_2 });
    expect(good.status).toBe(201);
  });

  it('U4 — شناسهٔ ملی حقوقی: بانک ملت معتبر، دستکاری‌شده رد؛ کد اقتصادی ۱۱–۱۴ رقم', async () => {
    const ok = await request(app.getHttpServer())
      .post('/api/v1/parties')
      .set('Authorization', auth())
      .send({
        kind: 'SUPPLIER',
        companyName: `شرکت پارس‌تأمین ${runTag}`,
        natIdentifier: LEGAL_OK,
        economicCode: ECON_OK,
        postalCode: '7719175572',
      });
    expect(ok.status).toBe(201);
    const legalId = ok.body.data.id;

    const bad = await request(app.getHttpServer())
      .post('/api/v1/parties')
      .set('Authorization', auth())
      .send({ kind: 'SUPPLIER', companyName: `شرکت فیک ${runTag}`, natIdentifier: LEGAL_FAKE, economicCode: ECON_OK });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toContain('شناسهٔ ملی');

    const shortEcon = await request(app.getHttpServer())
      .post('/api/v1/parties')
      .set('Authorization', auth())
      .send({ kind: 'SUPPLIER', companyName: `شرکت کوتاه ${runTag}`, natIdentifier: LEGAL_OK, economicCode: ECON_SHORT });
    expect(shortEcon.status).toBe(400);
    expect(shortEcon.body.error.message).toContain('کد اقتصادی');

    // فروشنده بدون شناسهٔ ملی/کد اقتصادی → الزام حقوقی
    const missing = await request(app.getHttpServer())
      .post('/api/v1/parties')
      .set('Authorization', auth())
      .send({ kind: 'SUPPLIER', companyName: `بدون شناسه ${runTag}` });
    expect(missing.status).toBe(400);
    expect(missing.body.error.message).toContain('الزامی');

    // اصلاح رکورد قبلی (PATCH) — ثبت دوباره ممنوع است
    const patch = await request(app.getHttpServer())
      .patch(`/api/v1/parties/${legalId}`)
      .set('Authorization', auth())
      .send({ phone: '03434445555', address: 'رفسنجان، خیابان شهید بهشتی' });
    expect(patch.status).toBe(200);
    expect(patch.body.data.phone).toBe('03434445555');
  });

  it('U5 — ensure: یافتن-یا-ایجاد بی‌صدا (دو بار → همان رکورد)', async () => {
    const p1 = await request(app.getHttpServer())
      .post('/api/v1/parties/ensure')
      .set('Authorization', auth())
      .send({ kind: 'COUNTERPARTY', companyName: `طرف‌حساب آسا ${runTag}`, natIdentifier: LEGAL_OK_2, economicCode: ECON_OK_2 });
    expect(p1.status).toBe(201);
    expect(p1.body.data.created).toBe(true);

    const p2 = await request(app.getHttpServer())
      .post('/api/v1/parties/ensure')
      .set('Authorization', auth())
      .send({ kind: 'COUNTERPARTY', companyName: `طرف‌حساب آسا ${runTag}`, natIdentifier: LEGAL_OK_2, economicCode: ECON_OK_2 });
    expect(p2.status).toBe(201);
    expect(p2.body.data.created).toBe(false);
    expect(p2.body.data.party.id).toBe(p1.body.data.party.id);
  });

  it('U6 — گیت هویتی چک‌این: رزرو→اقامت بدون کد ملی/کد پستی مسدود، پس از تکمیل مجاز', async () => {
    // مهمان بدون کدها ثبت می‌شود و رزرو با partyId ساخته می‌شود
    const party = await request(app.getHttpServer())
      .post('/api/v1/parties')
      .set('Authorization', auth())
      .send({ kind: 'GUEST', firstName: 'زینب', lastName: `کریمی${runTag}`, mobile: '09131112233' });
    expect(party.status).toBe(201);
    const partyId = party.body.data.id;

    const rts = await request(app.getHttpServer()).get('/api/v1/pms/room-types').set('Authorization', auth());
    expect(rts.status).toBe(200);

    // نوع اتاق را از اتاق آزاد واقعی می‌گیریم (بعضی انواع اتاق بدون اتاق فیزیکی‌اند)
    const map0 = await request(app.getHttpServer()).get('/api/v1/pms/rooms/map').set('Authorization', auth());
    const allRooms = (map0.body.data.floors as Array<{ rooms: Array<{ id: string; status: string; roomType: { code: string } }> }>).flatMap((f) => f.rooms);
    const freeRoom0 = allRooms.find((r) => r.status === 'AVAILABLE');
    expect(freeRoom0).toBeTruthy();
    const roomType = rts.body.data.find((t: { code: string }) => t.code === freeRoom0!.roomType.code);
    expect(roomType).toBeTruthy();

    const today = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const resv = await request(app.getHttpServer())
      .post('/api/v1/pms/reservations')
      .set('Authorization', auth())
      .send({
        roomTypeId: roomType!.id,
        guestName: `زینب کریمی${runTag}`,
        checkInDate: from,
        checkOutDate: to,
        idempotencyKey: `uniq-gate-${runTag}`,
        source: 'WALK_IN',
        partyId,
      });
    expect(resv.status).toBe(201);
    const reservationId = resv.body.data.reservationId;

    // اتاق آزاد از همین نوع
    const map = await request(app.getHttpServer()).get('/api/v1/pms/rooms/map').set('Authorization', auth());
    const floors = map.body.data.floors as Array<{ rooms: Array<{ id: string; status: string; roomType: { code: string } }> }>;
    const free = floors.flatMap((f) => f.rooms).find((r) => r.status === 'AVAILABLE' && r.roomType.code === roomType!.code);
    expect(free).toBeTruthy();

    // چک‌این باید با گیت هویتی مسدود شود (کد ملی و کد پستی ثبت نشده)
    const gate = await request(app.getHttpServer())
      .post('/api/v1/pms/stays/check-in')
      .set('Authorization', auth())
      .send({
        idempotencyKey: `uniq-gate-ci-${runTag}`,
        reservationId,
        roomIds: [free!.id],
        plannedCheckOut: to,
      });
    expect(gate.status).toBe(409);
    expect(gate.body.error.code).toBe('IDENTITY_INCOMPLETE');
    expect(gate.body.error.message).toContain('کد ملی');
    expect(gate.body.error.message).toContain('کد پستی');

    // تکمیل اطلاعات هویتی رکورد قبلی (اصلاح — نه ثبت دوباره)
    const fix = await request(app.getHttpServer())
      .patch(`/api/v1/parties/${partyId}`)
      .set('Authorization', auth())
      .send({ nationalId: MELLI_OK_3, postalCode: '7719175573' });
    expect(fix.status).toBe(200);

    // حالا چک‌این مجاز است — رزرو به اقامت تبدیل می‌شود
    const ci = await request(app.getHttpServer())
      .post('/api/v1/pms/stays/check-in')
      .set('Authorization', auth())
      .send({
        idempotencyKey: `uniq-gate-ci-${runTag}`,
        reservationId,
        roomIds: [free!.id],
        plannedCheckOut: to,
      });
    expect(ci.status).toBe(201);
    expect(ci.body.data.stayId).toBeTruthy();

    const after = await prisma.reservation.findUnique({ where: { id: reservationId } });
    expect(after?.status).toBe('CHECKED_IN');
    expect(after?.partyId).toBe(partyId);
  });
});
