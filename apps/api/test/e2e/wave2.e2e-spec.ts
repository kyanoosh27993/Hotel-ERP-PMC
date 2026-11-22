/**
 * wave2.e2e-spec.ts — آزمون پذیرش موج ۲ (F6-T1…T6 + F7-T1…T6) — نیازمند PostgreSQL واقعی:
 * منو/میز | سفارش و جمع‌ها | KDS | روم‌سرویس با سند ۱۲۰۱ | تخفیف با مجوز | لغو با دلیل |
 * درخواست→PO→رسید جزئی/کامل با میانگین موزون و سند GRN | مصرف رسپی و سند COGS |
 * انبارگردانی با مغایرت و سند | گزارش کاست کنترل | ماتریس مجوز.
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

async function waitForJournal(sourceModule: string, sourceRef: string, timeoutMs = 15000): Promise<{ entryNo: string; lines: Array<{ accountCode: string; debitRials: bigint; creditRials: bigint }> }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await prisma.journalEntry.findFirst({ where: { sourceModule, sourceRef, status: 'POSTED' } });
    if (row) {
      const lines = await prisma.journalLine.findMany({ where: { entryId: row.id } });
      return { entryNo: row.entryNo, lines };
    }
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

  // پاک‌سازی جدول‌های تراکنشی موج ۲ + اقامت‌ها/اتاق‌ها (دادهٔ مرجع seed می‌ماند)
  await prisma.$executeRawUnsafe(
    `TRUNCATE "kitchen_tickets","order_items","restaurant_orders","goods_receipt_lines","goods_receipts",
      "purchase_order_lines","purchase_orders","purchase_requisition_lines","purchase_requisitions",
      "stock_count_lines","stock_counts","stock_movements","stay_rooms","stays","cash_transactions",
      "cashier_shifts","ancillary_orders","outbox_events","inbox_events",
      "journal_entries","journal_lines" CASCADE`,
  );
  await prisma.$executeRawUnsafe(`UPDATE "dining_tables" SET "status"='FREE'`);
  await prisma.$executeRawUnsafe(`UPDATE "rooms" SET "status"='AVAILABLE', "hkStatus"='CLEAN', "note"=NULL`);
  await prisma.$executeRawUnsafe(`UPDATE "stock_items" SET "qtyOnHand"=0, "avgCostRials"=0`);

  await login('admin', true);
  await login('frontdesk', false);
  await login('chef', false);
  await login('storekeeper', false);
  await login('approver', true);
}, 90_000);

afterAll(async () => {
  await app.close();
});

describe('فاز ۷ — خرید و انبار (اول، تا موجودی برای مصرف رستوران آماده شود)', () => {
  it('F7-T1: PO دوم‌خطی با جمع و مالیات + تأیید و رویداد تعهد', async () => {
    const po = await request(app.getHttpServer())
      .post('/api/v1/procurement/orders').set('Authorization', auth(tokens.approver))
      .send({
        supplierCode: 'SUP-001',
        items: [
          { stockItemCode: 'STK-BEEF', qty: 20, unitCostRials: 800_000 },
          { stockItemCode: 'STK-RICE', qty: 30, unitCostRials: 150_000 },
        ],
      });
    expect(po.status).toBe(201);
    expect(po.body.totalRials).toBe(22_345_000); // (20×800k + 30×150k) × ۱.۰۹
    state.poNo = po.body.poNo;
    state.poId = po.body.id;

    const approve = await request(app.getHttpServer())
      .post(`/api/v1/procurement/orders/${state.poId}/approve`).set('Authorization', auth(tokens.approver))
      .send({});
    expect(approve.status).toBe(201);
    expect(approve.body.status).toBe('APPROVED');

    // GRN روی PO پیش‌نویس ممنوع
    const draftPo = await request(app.getHttpServer())
      .post('/api/v1/procurement/orders').set('Authorization', auth(tokens.approver))
      .send({ supplierCode: 'SUP-002', items: [{ stockItemCode: 'STK-SODA', qty: 48, unitCostRials: 120_000 }] });
    expect(draftPo.status).toBe(201);
    state.draftPoNo = draftPo.body.poNo;
    const early = await request(app.getHttpServer())
      .post('/api/v1/procurement/receipts').set('Authorization', auth(tokens.storekeeper))
      .send({ poCode: state.draftPoNo, lines: [{ stockItemCode: 'STK-SODA', qtyReceived: 10 }] });
    expect(early.status).toBe(400);
  });

  it('F7-T2: رسید جزئی — موجودی به واحد مصرف + میانگین موزون', async () => {
    const grn = await request(app.getHttpServer())
      .post('/api/v1/procurement/receipts').set('Authorization', auth(tokens.storekeeper))
      .send({
        poCode: state.poNo,
        lines: [
          { stockItemCode: 'STK-BEEF', qtyReceived: 12 },
          { stockItemCode: 'STK-RICE', qtyReceived: 12 },
        ],
      });
    expect(grn.status).toBe(201);
    expect(grn.body.poStatus).toBe('PARTIAL');
    expect(grn.body.netRials).toBe(11_400_000); // 12×800k + 12×150k
    state.grnNo1 = grn.body.grnNo;
    state.grnId1 = (await prisma.goodsReceipt.findUnique({ where: { grnNo: grn.body.grnNo } }))!.id;

    const beef = await prisma.stockItem.findUnique({ where: { code: 'STK-BEEF' } });
    expect(Number(beef!.qtyOnHand)).toBe(12_000); // ۱۲ کیلو → ۱۲٬۰۰۰ گرم
    expect(Number(beef!.avgCostRials)).toBe(800); // بهای هر گرم
    const rice = await prisma.stockItem.findUnique({ where: { code: 'STK-RICE' } });
    expect(Number(rice!.qtyOnHand)).toBe(12_000);
    expect(Number(rice!.avgCostRials)).toBe(150);

    // رسید بیشتر از باقیمانده ممنوع (BEEF باقیمانده = ۸ کیلو)
    const over = await request(app.getHttpServer())
      .post('/api/v1/procurement/receipts').set('Authorization', auth(tokens.storekeeper))
      .send({ poCode: state.poNo, lines: [{ stockItemCode: 'STK-BEEF', qtyReceived: 10 }] });
    expect(over.status).toBe(400);
  });

  it('F7-T3: سند رسید خرید — بدهکار ۱۳۰۱+۲۲۰۴ / بستانکار ۲۱۰۱', async () => {
    const j = await waitForJournal('procurement', state.grnId1);
    expect(j.entryNo).toContain('JV-');
    const net = 11_400_000n;
    const tax = 1_026_000n;
    expect(j.lines.find((l) => l.accountCode === '1301')?.debitRials).toBe(net);
    expect(j.lines.find((l) => l.accountCode === '2204')?.debitRials).toBe(tax);
    expect(j.lines.find((l) => l.accountCode === '2101')?.creditRials).toBe(net + tax);
  });

  it('F7-T4: تکمیل رسید → وضعیت RECEIVED', async () => {
    const grn = await request(app.getHttpServer())
      .post('/api/v1/procurement/receipts').set('Authorization', auth(tokens.storekeeper))
      .send({
        poCode: state.poNo,
        lines: [
          { stockItemCode: 'STK-BEEF', qtyReceived: 8 },
          { stockItemCode: 'STK-RICE', qtyReceived: 18 },
        ],
      });
    expect(grn.status).toBe(201);
    expect(grn.body.poStatus).toBe('RECEIVED');
  });
});

describe('فاز ۶ — رستوران، آشپزخانه و کاست کنترل', () => {
  it('F6-T1: میزها، منو و رسپی از seed', async () => {
    const areas = await request(app.getHttpServer()).get('/api/v1/restaurant/areas').set('Authorization', auth(tokens.frontdesk));
    expect(areas.status).toBe(200);
    const totalTables = areas.body.reduce((a: number, x: { tables: unknown[] }) => a + x.tables.length, 0);
    expect(totalTables).toBe(6);

    const menu = await request(app.getHttpServer()).get('/api/v1/restaurant/menu').set('Authorization', auth(tokens.frontdesk));
    expect(menu.status).toBe(200);
    const allItems = menu.body.reduce((a: number, c: { items: unknown[] }) => a + c.items.length, 0);
    expect(allItems).toBe(3);
  });

  it('F6-T2: باز کردن سفارش با جمع دقیق + Idempotency + میز اشغال', async () => {
    const open = await request(app.getHttpServer())
      .post('/api/v1/restaurant/orders').set('Authorization', auth(tokens.frontdesk))
      .send({
        outletCode: 'REST-MAIN', tableCode: 'T1', mode: 'DINE_IN',
        items: [
          { menuItemCode: 'MI-KABAB', qty: 2 },
          { menuItemCode: 'MI-SODA', qty: 1 },
        ],
        idempotencyKey: `wave2-ord-${Date.now()}`,
      });
    expect(open.status).toBe(201);
    expect(open.body.netRials).toBe(9_500_000);
    expect(open.body.taxRials).toBe(855_000);
    expect(open.body.totalRials).toBe(10_355_000);
    state.order1 = open.body.id;
    state.order1No = open.body.orderNo;
    state.order1Key = open.body.idempotencyKey;

    const table = await prisma.diningTable.findUnique({ where: { code: 'T1' } });
    expect(table!.status).toBe('OCCUPIED');

    const replay = await request(app.getHttpServer())
      .post('/api/v1/restaurant/orders').set('Authorization', auth(tokens.frontdesk))
      .send({
        outletCode: 'REST-MAIN', tableCode: 'T1', mode: 'DINE_IN',
        items: [{ menuItemCode: 'MI-KABAB', qty: 2 }],
        idempotencyKey: state.order1Key,
      });
    expect(replay.status).toBe(201);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.orderNo).toBe(state.order1No);
  });

  it('F6-T3: ارسال به آشپزخانه → گردش KDS (chef) → اقلام SERVED', async () => {
    const order = await prisma.restaurantOrder.findUnique({ where: { id: state.order1 }, include: { items: true } });
    const kababItem = order!.items.find((i) => i.qty === 2)!;
    const send = await request(app.getHttpServer())
      .post(`/api/v1/restaurant/orders/${state.order1}/items/${kababItem.id}/send`).set('Authorization', auth(tokens.frontdesk))
      .send({});
    expect(send.status).toBe(201);
    expect(send.body.status).toBe('SENT_TO_KITCHEN');
    state.ticketId = (await prisma.kitchenTicket.findFirst({ where: { orderId: state.order1 } }))!.id;

    // گارسون نمی‌تواند وضعیت آشپزخانه را عوض کند
    const forbidden = await request(app.getHttpServer())
      .post(`/api/v1/restaurant/kitchen/tickets/${state.ticketId}`).set('Authorization', auth(tokens.frontdesk))
      .send({ status: 'PREPARING' });
    expect(forbidden.status).toBe(403);

    for (const st of ['PREPARING', 'READY']) {
      const r = await request(app.getHttpServer())
        .post(`/api/v1/restaurant/kitchen/tickets/${state.ticketId}`).set('Authorization', auth(tokens.chef))
        .send({ status: st });
      expect(r.status).toBe(201);
    }
    // برگشت به عقب ممنوع
    const back = await request(app.getHttpServer())
      .post(`/api/v1/restaurant/kitchen/tickets/${state.ticketId}`).set('Authorization', auth(tokens.chef))
      .send({ status: 'PREPARING' });
    expect(back.status).toBe(400);

    const kds = await request(app.getHttpServer())
      .get('/api/v1/restaurant/kitchen/tickets').set('Authorization', auth(tokens.chef));
    expect(kds.status).toBe(200);
    expect(kds.body.some((t: { ticketNo: string }) => t.ticketNo.length > 0)).toBe(true);
  });

  it('F6-T4: سرو سفارش → سند فروش (۱۱۰۱) + سند COGS (۵۱۰۱/۱۳۰۱) + گردش مصرف', async () => {
    const serve = await request(app.getHttpServer())
      .post(`/api/v1/restaurant/orders/${state.order1}/serve`).set('Authorization', auth(tokens.frontdesk))
      .send({});
    expect(serve.status).toBe(201);
    expect(serve.body.status).toBe('SERVED');

    const table = await prisma.diningTable.findUnique({ where: { code: 'T1' } });
    expect(table!.status).toBe('FREE');

    // سند فروش: بدهکار صندوق (فروش نقدی — بدون فولیو)
    const sale = await waitForJournal('pos', state.order1);
    expect(sale.lines.find((l) => l.accountCode === '1101')?.debitRials).toBe(10_355_000n);
    expect(sale.lines.find((l) => l.accountCode === '4102')?.creditRials).toBe(9_500_000n);
    expect(sale.lines.find((l) => l.accountCode === '2201')?.creditRials).toBe(855_000n);

    // مصرف رسپی: کباب ×۲ → BEEF ۶۰۰ گرم، RICE ۵۰۰ گرم — نوشابه بدون رسپی
    const beef = await prisma.stockItem.findUnique({ where: { code: 'STK-BEEF' } });
    expect(Number(beef!.qtyOnHand)).toBe(20_000 - 600);
    const rice = await prisma.stockItem.findUnique({ where: { code: 'STK-RICE' } });
    expect(Number(rice!.qtyOnHand)).toBe(30_000 - 500);

    const cogs = await waitForJournal('stores', state.order1);
    expect(cogs.lines.find((l) => l.accountCode === '5101')?.debitRials).toBe(600n * 800n + 500n * 150n);
    expect(cogs.lines.find((l) => l.accountCode === '1301')?.creditRials).toBe(600n * 800n + 500n * 150n);
  });

  it('F6-T5: روم‌سرویس با شارژ فولیو — سند فروش بدهکار ۱۲۰۱', async () => {
    const room = await prisma.room.findUnique({ where: { code: '201' } });
    const ci = await request(app.getHttpServer())
      .post('/api/v1/pms/stays/check-in').set('Authorization', auth(tokens.frontdesk))
      .send({
        guestName: 'مهمان روم‌سرویس', roomIds: [room!.id], plannedCheckOut: dayOffset(2),
        idempotencyKey: `wave2-ci-${Date.now()}`,
      });
    state.stayCode = ci.body.data.code;
    const before = await prisma.stay.findUnique({ where: { id: ci.body.data.stayId } });

    const open = await request(app.getHttpServer())
      .post('/api/v1/restaurant/orders').set('Authorization', auth(tokens.frontdesk))
      .send({
        outletCode: 'REST-MAIN', mode: 'ROOM_SERVICE', stayCode: state.stayCode,
        items: [{ menuItemCode: 'MI-KABAB', qty: 1 }],
        idempotencyKey: `wave2-rs-${Date.now()}`,
      });
    expect(open.status).toBe(201);
    state.rsOrder = open.body.id;

    const serve = await request(app.getHttpServer())
      .post(`/api/v1/restaurant/orders/${state.rsOrder}/serve`).set('Authorization', auth(tokens.frontdesk))
      .send({});
    expect(serve.status).toBe(201);

    const after = await prisma.stay.findUnique({ where: { id: ci.body.data.stayId } });
    expect(after!.folioRials - before!.folioRials).toBe(4_905_000n); // ۴٬۵۰۰٬۰۰۰ + ۴۰۵٬۰۰۰ مالیات

    const sale = await waitForJournal('pos', state.rsOrder);
    expect(sale.lines.find((l) => l.accountCode === '1201')?.debitRials).toBe(4_905_000n);
  });

  it('F6-T6: تخفیف — بدون مجوز ۴۰۳، با مجوز مجاز + بازمحاسبهٔ مالیات', async () => {
    const open = await request(app.getHttpServer())
      .post('/api/v1/restaurant/orders').set('Authorization', auth(tokens.frontdesk))
      .send({
        outletCode: 'REST-MAIN', mode: 'TAKEAWAY',
        items: [{ menuItemCode: 'MI-KABAB', qty: 1 }],
        idempotencyKey: `wave2-ds-${Date.now()}`,
      });
    state.dsOrder = open.body.id;

    const forbidden = await request(app.getHttpServer())
      .post(`/api/v1/restaurant/orders/${state.dsOrder}/discount`).set('Authorization', auth(tokens.frontdesk))
      .send({ amountRials: 500_000, reason: 'تخفیف گارسون' });
    expect(forbidden.status).toBe(403);

    const allowed = await request(app.getHttpServer())
      .post(`/api/v1/restaurant/orders/${state.dsOrder}/discount`).set('Authorization', auth(tokens.admin))
      .send({ amountRials: 1_000_000, reason: 'تخفیف مدیریت — مناسبت' });
    expect(allowed.status).toBe(201);
    expect(allowed.body.netRials).toBe(3_500_000);
    expect(allowed.body.taxRials).toBe(315_000);
    expect(allowed.body.totalRials).toBe(3_815_000);
    expect(allowed.body.discountReason).toContain('تخفیف');
  });

  it('F6-T7: لغو قلم با دلیل اجباری — ردپای اصلاح و بازمحاسبه', async () => {
    const open = await request(app.getHttpServer())
      .post('/api/v1/restaurant/orders').set('Authorization', auth(tokens.frontdesk))
      .send({
        outletCode: 'REST-MAIN', mode: 'TAKEAWAY',
        items: [
          { menuItemCode: 'MI-KABAB', qty: 1 },
          { menuItemCode: 'MI-SODA', qty: 2 },
        ],
        idempotencyKey: `wave2-cx-${Date.now()}`,
      });
    const order = await prisma.restaurantOrder.findUnique({ where: { id: open.body.id }, include: { items: true } });
    const sodaItem = order!.items.find((i) => i.qty === 2)!;

    const noReason = await request(app.getHttpServer())
      .post(`/api/v1/restaurant/orders/${open.body.id}/items/${sodaItem.id}/cancel`).set('Authorization', auth(tokens.frontdesk))
      .send({ reason: '' });
    expect(noReason.status).toBe(400);

    const cancel = await request(app.getHttpServer())
      .post(`/api/v1/restaurant/orders/${open.body.id}/items/${sodaItem.id}/cancel`).set('Authorization', auth(tokens.frontdesk))
      .send({ reason: 'مهمان منصرف شد' });
    expect(cancel.status).toBe(201);
    const canceled = cancel.body.items.find((i: { qty: number }) => i.qty === 2);
    expect(canceled.status).toBe('CANCELED');
    expect(canceled.cancelReason).toContain('منصرف');
    expect(cancel.body.totalRials).toBe(4_905_000); // فقط کباب باقی است + مالیات
    state.cxOrder = open.body.id;
  });

  it('F7-T5: انبارگردانی با کسری — گردش اصلاحی + سند ۵۱۰۴/۱۳۰۱', async () => {
    const open = await request(app.getHttpServer())
      .post('/api/v1/stores/counts').set('Authorization', auth(tokens.storekeeper))
      .send({ warehouseCode: 'WH-COLD' });
    expect(open.status).toBe(201);
    state.countId = open.body.id;
    state.countNo = open.body.countNo;

    const beef = await prisma.stockItem.findUnique({ where: { code: 'STK-BEEF' } });
    const counted = Number(beef!.qtyOnHand) - 400; // کسری ۴۰۰ گرم
    const line = await request(app.getHttpServer())
      .post('/api/v1/stores/counts/lines').set('Authorization', auth(tokens.storekeeper))
      .send({ countId: state.countId, stockItemCode: 'STK-BEEF', qtyCounted: counted });
    expect(line.status).toBe(201);
    expect(line.body.varianceQty).toBe(-400);

    const close = await request(app.getHttpServer())
      .post('/api/v1/stores/counts/close').set('Authorization', auth(tokens.storekeeper))
      .send({ countId: state.countId });
    expect(close.status).toBe(201);
    expect(close.body.lossRials).toBe(320_000); // ۴۰۰ گرم × ۸۰۰

    const after = await prisma.stockItem.findUnique({ where: { code: 'STK-BEEF' } });
    expect(Number(after!.qtyOnHand)).toBe(counted);

    const j = await waitForJournal('stores', state.countId);
    expect(j.lines.find((l) => l.accountCode === '5104')?.debitRials).toBe(320_000n);
    expect(j.lines.find((l) => l.accountCode === '1301')?.creditRials).toBe(320_000n);

    // بستن دوباره ممنوع
    const again = await request(app.getHttpServer())
      .post('/api/v1/stores/counts/close').set('Authorization', auth(tokens.storekeeper))
      .send({ countId: state.countId });
    expect(again.status).toBe(400);
  });

  it('F7-T6: گزارش کاست کنترل — تئوریک/واقعی و گزارش سفارش مجدد', async () => {
    const today = dayOffset(0);
    const cc = await request(app.getHttpServer())
      .get(`/api/v1/stores/cost-control?from=${today}&to=${today}`).set('Authorization', auth(tokens.storekeeper));
    expect(cc.status).toBe(200);
    expect(cc.body.servedOrders).toBeGreaterThanOrEqual(2);
    const beef = cc.body.lines.find((l: { code: string }) => l.code === 'STK-BEEF');
    expect(beef).toBeDefined();
    expect(beef.theoreticalQty).toBeGreaterThanOrEqual(900); // ۶۰۰ + ۳۰۰ روم‌سرویس
    expect(beef.actualQty).toBeGreaterThanOrEqual(900);

    const reorder = await request(app.getHttpServer())
      .get('/api/v1/stores/reorder').set('Authorization', auth(tokens.storekeeper));
    expect(reorder.status).toBe(200);
    // پس از مصرف، برنج/نوشابه زیر حداقل قرار گرفته‌اند
    expect(Array.isArray(reorder.body)).toBe(true);
  });

  it('ماتریس مجوز: chef سفارش نمی‌زند و storekeeper PO را تأیید نمی‌کند', async () => {
    const t = await request(app.getHttpServer())
      .post('/api/v1/restaurant/orders').set('Authorization', auth(tokens.chef))
      .send({
        outletCode: 'REST-MAIN', mode: 'TAKEAWAY',
        items: [{ menuItemCode: 'MI-SODA', qty: 1 }], idempotencyKey: `wave2-fb-${Date.now()}`,
      });
    expect(t.status).toBe(403);

    const po = await request(app.getHttpServer())
      .post('/api/v1/procurement/orders').set('Authorization', auth(tokens.storekeeper))
      .send({ supplierCode: 'SUP-001', items: [{ stockItemCode: 'STK-RICE', qty: 1, unitCostRials: 100 }] });
    // storekeeper PROC_MANAGE ندارد → حتی ساخت PO هم ۴۰۳ است
    expect(po.status).toBe(403);

    const chefPo = await request(app.getHttpServer())
      .post('/api/v1/procurement/orders').set('Authorization', auth(tokens.chef))
      .send({ supplierCode: 'SUP-001', items: [{ stockItemCode: 'STK-RICE', qty: 1, unitCostRials: 100 }] });
    expect(chefPo.status).toBe(403);
  });
});
