/**
 * pms.e2e-spec.ts — آزمون پذیرش فاز ۴ (F4-T1…T3 + T7 + T8) — نیازمند PostgreSQL واقعی:
 * نقشه اتاق | ماتریس دسترسی پذیرش/خانه‌داری | قواعد وضعیت اتاق | رزرو توسعه‌یافته |
 * لیست انتظار | ورود/خروج اقامت چنداتاقه | خانه‌داری CLEAN→AVAILABLE | حسابرسی شبانه.
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
/** وضعیت مشترک بین سناریوها */
const pmsState: Record<string, string> = {};

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

const dayOffset = (n: number): string => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const auth = (token: string): string => `Bearer ${token}`;
let runTag: string; // یکتا در هر اجرا — برای idempotencyKey و تاریخ حسابرسی

interface RoomRow { id: string; code: string; floor: number; status: string; hkStatus: string }

async function floor3Rooms(): Promise<RoomRow[]> {
  const res = await request(app.getHttpServer()).get('/api/v1/pms/rooms/map').set('Authorization', auth(tokens.admin));
  expect(res.status).toBe(200);
  const f3 = res.body.data.floors.find((f: { floor: number }) => f.floor === 3);
  return f3.rooms as RoomRow[];
}

async function roomByCode(code: string): Promise<RoomRow> {
  const all = await floor3Rooms();
  return all.find((r) => r.code === code) as RoomRow;
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

  await prisma.$executeRawUnsafe(
    `TRUNCATE "stay_rooms","stays","waitlist_entries","night_audit_runs","reservations","pos_orders","outbox_events","inbox_events","journal_entries","journal_lines" CASCADE`,
  );
  await prisma.$executeRawUnsafe(`UPDATE "rooms" SET "status"='AVAILABLE', "hkStatus"='CLEAN', "note"=NULL`);

  runTag = `${Date.now()}`;
  await login('admin', true);
  await login('frontdesk', false);
  await login('housekeeper', false);
  await login('accountant', true);
}, 90_000);

afterAll(async () => {
  await app.close();
});

describe('فاز ۴ — PMS', () => {
  it('F4-T1: نقشه اتاق ۱۵ اتاق در ۳ طبقه با خلاصه وضعیت', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/pms/rooms/map').set('Authorization', auth(tokens.admin));
    expect(res.status).toBe(200);
    expect(res.body.data.floors).toHaveLength(3);
    const total = res.body.data.floors.reduce((a: number, f: { rooms: unknown[] }) => a + f.rooms.length, 0);
    expect(total).toBe(15);
    expect(res.body.data.summary).toHaveProperty('AVAILABLE');
    expect(res.body.data.summary.AVAILABLE).toBe(15);
  });

  it('ماتریس دسترسی: خانه‌دار فقط نظافت؛ accountant نقشه را نمی‌بیند؛ خانه‌دار پذیرش نمی‌تواند', async () => {
    const room = await roomByCode('301');
    const patch = await request(app.getHttpServer())
      .patch(`/api/v1/pms/rooms/${room.id}`)
      .set('Authorization', auth(tokens.housekeeper))
      .send({ hkStatus: 'IN_PROGRESS' });
    expect(patch.status).toBe(200);
    expect(patch.body.data.hkStatus).toBe('IN_PROGRESS');

    const forbiddenMap = await request(app.getHttpServer())
      .get('/api/v1/pms/rooms/map').set('Authorization', auth(tokens.accountant));
    expect(forbiddenMap.status).toBe(403);

    const forbiddenCheckin = await request(app.getHttpServer())
      .post('/api/v1/pms/stays/check-in').set('Authorization', auth(tokens.housekeeper))
      .send({ idempotencyKey: `x-${runTag}`, roomIds: [room.id], plannedCheckOut: dayOffset(2) });
    expect(forbiddenCheckin.status).toBe(403);
  });

  it('قاعده: اشغال مستقیم اتاق ممنوع — فقط از مسیر پذیرش', async () => {
    const room = await roomByCode('301');
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/pms/rooms/${room.id}`)
      .set('Authorization', auth(tokens.frontdesk))
      .send({ status: 'OCCUPIED' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BUSINESS_RULE');
  });

  it('F4-T2: رزرو توسعه‌یافته OTA/گروهی با نرخ توافقی + لیست با فیلتر تاریخ', async () => {
    const ci = dayOffset(1), co = dayOffset(3);
    const roomType = await prisma.roomType.findFirst({ where: { code: 'STD' } });
    const res = await request(app.getHttpServer())
      .post('/api/v1/pms/reservations').set('Authorization', auth(tokens.frontdesk))
      .send({
        roomTypeId: roomType?.id, guestName: 'گروه تجاری آریا', checkInDate: ci, checkOutDate: co,
        idempotencyKey: `pms-res-${runTag}`, source: 'OTA', groupName: 'Aria Group',
        adults: 2, children: 1, rateOverrideRials: '3000000', note: 'کانال آنلاین',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.code).toMatch(/^RSV-\d{4}-\d{6}$/);
    expect(res.body.data.replayed).toBe(false);

    const list = await request(app.getHttpServer())
      .get(`/api/v1/pms/reservations?date=${ci}`).set('Authorization', auth(tokens.admin));
    expect(list.status).toBe(200);
    const row = list.body.data.find((r: { code: string }) => r.code === res.body.data.code);
    expect(row).toBeTruthy();
    expect(row.source).toBe('OTA');
    expect(row.groupName).toBe('Aria Group');
    expect(row.totalRials).toBe('6000000'); // ۳٬۰۰۰٬۰۰۰ × ۲ شب
  });

  it('کنترل ظرفیت بدون Overbooking: پرشدن ۱۵ اتاق STD → رزرو بعدی 409', async () => {
    const roomType = await prisma.roomType.findFirst({ where: { code: 'STD' } });
    const ci = dayOffset(2), co = dayOffset(4);
    // یک رزرو هم‌پوشان (۱→۳) از سناریوی قبلی موجود است؛ ظرفیت ۱۵ اتاق → ۱۴ رزرو دیگر تا تکمیل
    for (let i = 0; i < 14; i += 1) {
      const ok = await request(app.getHttpServer())
        .post('/api/v1/pms/reservations').set('Authorization', auth(tokens.frontdesk))
        .send({
          roomTypeId: roomType?.id, guestName: `ظرفیت ${i + 1}`, checkInDate: ci, checkOutDate: co,
          idempotencyKey: `pms-cap-${runTag}-${i}`,
        });
      expect(ok.status).toBe(201);
    }
    const full = await request(app.getHttpServer())
      .post('/api/v1/pms/reservations').set('Authorization', auth(tokens.frontdesk))
      .send({
        roomTypeId: roomType?.id, guestName: 'بیش از ظرفیت', checkInDate: ci, checkOutDate: co,
        idempotencyKey: `pms-cap-${runTag}-full`,
      });
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('CONFLICT');
  });

  it('F4-T2: چرخه لیست انتظار WAITING→OFFERED', async () => {
    const roomType = await prisma.roomType.findFirst({ where: { code: 'JUN' } });
    const create = await request(app.getHttpServer())
      .post('/api/v1/pms/waitlist').set('Authorization', auth(tokens.frontdesk))
      .send({
        guestName: 'مهمان انتظار', phone: '09120000000', roomTypeId: roomType?.id,
        fromDate: dayOffset(5), toDate: dayOffset(7), note: 'در صورت لغو اطلاع داده شود',
      });
    expect(create.status).toBe(201);
    expect(create.body.data.status).toBe('WAITING');

    const offer = await request(app.getHttpServer())
      .patch(`/api/v1/pms/waitlist/${create.body.data.id}`).set('Authorization', auth(tokens.frontdesk))
      .send({ status: 'OFFERED' });
    expect(offer.status).toBe(200);
    expect(offer.body.data.status).toBe('OFFERED');

    const list = await request(app.getHttpServer())
      .get('/api/v1/pms/waitlist').set('Authorization', auth(tokens.frontdesk));
    expect(list.body.data.some((w: { id: string }) => w.id === create.body.data.id)).toBe(true);
  });

  it('F4-T3: پذیرش مهمان رزروشده با اتاق مشخص → اتاق OCCUPIED، رزرو CHECKED_IN', async () => {
    const roomType = await prisma.roomType.findFirst({ where: { code: 'STD' } });
    const ci = dayOffset(0), co = dayOffset(2);
    const resv = await request(app.getHttpServer())
      .post('/api/v1/pms/reservations').set('Authorization', auth(tokens.frontdesk))
      .send({ roomTypeId: roomType?.id, guestName: 'مهمان پذیرش', checkInDate: ci, checkOutDate: co, idempotencyKey: `pms-ci-res-${runTag}`, source: 'PHONE' });
    expect(resv.status).toBe(201);

    const room = await roomByCode('302');
    const checkin = await request(app.getHttpServer())
      .post('/api/v1/pms/stays/check-in').set('Authorization', auth(tokens.frontdesk))
      .send({
        reservationId: resv.body.data.reservationId, roomIds: [room.id],
        plannedCheckOut: co, idempotencyKey: `pms-stay-${runTag}`,
      });
    expect(checkin.status).toBe(201);
    expect(checkin.body.data.code).toMatch(/^STY-\d{4}-\d{6}$/);
    expect(checkin.body.data.rooms).toEqual(['302']);
    pmsState.stayId = checkin.body.data.stayId;
    pmsState.stayReservationId = resv.body.data.reservationId;
    pmsState.stayRoomId = room.id;

    const after = await roomByCode('302');
    expect(after.status).toBe('OCCUPIED');

    const replay = await request(app.getHttpServer())
      .post('/api/v1/pms/stays/check-in').set('Authorization', auth(tokens.frontdesk))
      .send({
        reservationId: resv.body.data.reservationId, roomIds: [room.id],
        plannedCheckOut: co, idempotencyKey: `pms-stay-${runTag}`,
      });
    expect(replay.status).toBe(201);
    expect(replay.body.data.replayed).toBe(true);
    expect(replay.body.data.stayId).toBe(checkin.body.data.stayId);
  });

  it('پذیرش روی اتاق اشغال → 409', async () => {
    const room = await roomByCode('302');
    const res = await request(app.getHttpServer())
      .post('/api/v1/pms/stays/check-in').set('Authorization', auth(tokens.frontdesk))
      .send({ guestName: 'دوم', roomIds: [room.id], plannedCheckOut: dayOffset(2), idempotencyKey: `pms-double-${runTag}` });
    expect(res.status).toBe(409);
  });

  it('F4-T7: اتاق با وضعیت نظافت ناتمام پذیرش نمی‌شود (پیوند خانه‌داری و پذیرش)', async () => {
    const room = await roomByCode('303');
    // وضعیت فروش AVAILABLE ولی نظافت هنوز DIRTY است → پذیرش باید با قاعده کسب‌وکار رد کند
    await request(app.getHttpServer())
      .patch(`/api/v1/pms/rooms/${room.id}`)
      .set('Authorization', auth(tokens.housekeeper))
      .send({ hkStatus: 'DIRTY' });
    const res = await request(app.getHttpServer())
      .post('/api/v1/pms/stays/check-in').set('Authorization', auth(tokens.frontdesk))
      .send({ guestName: 'بدون نظافت', roomIds: [room.id], plannedCheckOut: dayOffset(1), idempotencyKey: `pms-dirty-${runTag}` });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BUSINESS_RULE');
    expect(res.body.error.message).toContain('not cleaned');
  });

  it('F4-T3: خروج مهمان → فاکتور اتاق، اتاق DIRTY، رزرو CHECKED_OUT', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/pms/stays/${pmsState.stayId}/check-out`)
      .set('Authorization', auth(tokens.frontdesk));
    expect(res.status).toBe(201);
    expect(res.body.data.folioRials).toBe('2500000'); // STD ۲٬۵۰۰٬۰۰۰ × حداقل ۱ شب
    expect(res.body.data.rooms).toEqual(['302']);

    const room = await roomByCode('302');
    expect(room.status).toBe('DIRTY');
    expect(room.hkStatus).toBe('DIRTY');

    const resv = await request(app.getHttpServer())
      .get('/api/v1/pms/reservations').set('Authorization', auth(tokens.admin));
    const row = resv.body.data.find((r: { id: string }) => r.id === pmsState.stayReservationId);
    expect(row.status).toBe('CHECKED_OUT');

    pmsState.dirtyRoomId = room.id;
  });

  it('F4-T7: نظافت کامل CLEAN → اتاق دوباره قابل فروش (AVAILABLE)', async () => {
    const clean = await request(app.getHttpServer())
      .patch(`/api/v1/pms/rooms/${pmsState.dirtyRoomId}`)
      .set('Authorization', auth(tokens.housekeeper))
      .send({ hkStatus: 'CLEAN' });
    expect(clean.status).toBe(200);
    expect(clean.body.data.hkStatus).toBe('CLEAN');
    expect(clean.body.data.status).toBe('AVAILABLE');
  });

  it('F4-T3: پذیرش حضوری بدون رزرو (Walk-in)', async () => {
    const room = await roomByCode('304');
    const res = await request(app.getHttpServer())
      .post('/api/v1/pms/stays/check-in').set('Authorization', auth(tokens.frontdesk))
      .send({ guestName: 'مهمان حضوری', roomIds: [room.id], plannedCheckOut: dayOffset(1), idempotencyKey: `pms-walkin-${runTag}` });
    expect(res.status).toBe(201);
    pmsState.walkinStayId = res.body.data.stayId;
  });

  it('F4-T8: حسابرسی شبانه با استثنا + اجرای دوباره → 409', async () => {
    // رزرو رسیده ولی پذیرش‌نشده برای تاریخ حسابرسی
    const roomType = await prisma.roomType.findFirst({ where: { code: 'STD' } });
    const auditDate = dayOffset(-1 - (Date.now() % 400));
    await request(app.getHttpServer())
      .post('/api/v1/pms/reservations').set('Authorization', auth(tokens.frontdesk))
      .send({
        roomTypeId: roomType?.id, guestName: 'رسیده بی‌پذیرش', checkInDate: auditDate,
        checkOutDate: dayOffset(1), idempotencyKey: `pms-arr-${runTag}`,
      });

    const run = await request(app.getHttpServer())
      .post('/api/v1/pms/night-audit').set('Authorization', auth(tokens.admin))
      .send({ businessDate: auditDate });
    expect(run.status).toBe(201);
    expect(run.body.data.status).toBe('WITH_EXCEPTIONS');
    expect(run.body.data.openStays).toBeGreaterThanOrEqual(1); // اقامت حضوری باز
    expect(run.body.data.arrivalsNotCheckedIn).toBeGreaterThanOrEqual(1);

    const rerun = await request(app.getHttpServer())
      .post('/api/v1/pms/night-audit').set('Authorization', auth(tokens.admin))
      .send({ businessDate: auditDate });
    expect(rerun.status).toBe(409);

    const list = await request(app.getHttpServer())
      .get('/api/v1/pms/night-audit').set('Authorization', auth(tokens.admin));
    expect(list.status).toBe(200);
    expect(list.body.data.some((a: { businessDate: string }) => a.businessDate === auditDate)).toBe(true);
  });
});
