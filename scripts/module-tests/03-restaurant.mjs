// 03-restaurant.mjs — لایه ۱ / ماژول ۳: منو، سفارش POS، KDS، سند فروش، مصرف رسپی، سرویس اتاق
import { Suite, req, login, db, TODAY, sleep, ensureParty } from './_lib.mjs';

const S = new Suite('03-restaurant');
const T = { admin: await login('admin', true), frontdesk: await login('frontdesk', false), chef: await login('chef', false) };
const c = await db();

// ریست جداول ماژول رستوران + وضعیت میزها + انبار صفر (مصرف رسپی باید دقیق حساب شود)
await c.query(`TRUNCATE "kitchen_tickets","order_items","restaurant_orders","outbox_events","inbox_events","journal_entries","journal_lines","audit_logs" CASCADE`);
await c.query(`UPDATE "dining_tables" SET "status"='FREE'`);
await c.query(`UPDATE "stock_items" SET "qtyOnHand"=0, "avgCostRials"=0`);
await c.query(`UPDATE "fiscal_periods" SET "status" = CASE WHEN "endDate" < date_trunc('month', now()) THEN 'LOCKED'::fiscal_period_status ELSE 'OPEN'::fiscal_period_status END, "lockedAt" = CASE WHEN "endDate" < date_trunc('month', now()) THEN now() ELSE NULL END, "closedAt"=NULL, "closingEntryId"=NULL`);

// موجودی اولیه برای سنجش دقیق مصرف رسپی
await c.query(`UPDATE "stock_items" SET "qtyOnHand"=30000 WHERE code='STK-RICE'`);
await c.query(`UPDATE "stock_items" SET "qtyOnHand"=20000 WHERE code='STK-BEEF'`);
await c.query(`UPDATE "stock_items" SET "qtyOnHand"=50000 WHERE code='STK-SODA'`);

// ── منو ──
const menu = (await req('GET', '/restaurant/menu', { token: T.admin })).json ?? [];
const items = menu.flatMap((cat) => cat.items ?? []);
const kabab = items.find((i) => i.code === 'MI-KABAB');
const soda = items.find((i) => i.code === 'MI-SODA');
S.step('منو seed شده (کباب و نوشابه)', !!kabab && !!soda, `kabab=${kabab?.priceRials} soda=${soda?.priceRials}`);

const jKey = () => `m03-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// ── سفارش سالن: بدون ورود قیمت ──
const ord = await req('POST', '/restaurant/orders', { token: T.frontdesk, body: { outletCode: 'REST-MAIN', tableCode: 'T1', mode: 'DINE_IN', items: [{ menuItemCode: 'MI-KABAB', qty: 2 }, { menuItemCode: 'MI-SODA', qty: 1 }], idempotencyKey: jKey() } });
S.step('ثبت سفارش بدون قیمت (قیمت از منو)', ord.status === 201, `status=${ord.status} ${JSON.stringify(ord.json?.error ?? {}).slice(0, 100)}`);
const orderId = ord.json?.id ?? ord.json?.data?.id;
const gross = Number(kabab.priceRials) * 2 + Number(soda.priceRials);
const tax = Math.round((gross * Number(kabab.taxRateBps ?? 900)) / 10000);
S.step('مبلغ خالص = جمع منو×تعداد', Number(ord.json?.netRials ?? ord.json?.data?.netRials) === gross, `net=${ord.json?.netRials} (انتظار ${gross})`);

// ── میز اشغال می‌شود ──
const t1 = (await c.query(`select status from dining_tables where code='T1'`)).rows[0];
S.step('میز T1 پس از سفارش OCCUPIED', t1?.status === 'OCCUPIED', `db=${t1?.status}`);

// ── آشپزخانه: ارسال و جریان وضعیت ──
// ارسال به آشپزخانه per-item است (قرارداد واقعی)
const orderLines = (await req('GET', `/restaurant/orders/${orderId}`, { token: T.frontdesk })).json?.data?.items
  ?? (await req('GET', `/restaurant/orders/${orderId}`, { token: T.frontdesk })).json?.items ?? [];
let sendOk = orderLines.length > 0;
for (const it of orderLines) {
  const r = await req('POST', `/restaurant/orders/${orderId}/items/${it.id}/send`, { token: T.frontdesk, body: {} });
  if (![200, 201].includes(r.status)) { sendOk = false; }
}
S.step('ارسال به آشپزخانه (هر آیتم)', sendOk, `items=${orderLines.length}`);
let ticketId = null;
for (let i = 0; i < 20; i++) {
  const k = (await req('GET', '/restaurant/kitchen/tickets', { token: T.chef })).json ?? [];
  const t = k.find((x) => x.orderNo === ord.json?.orderNo) ?? k[0];
  if (t) { ticketId = t.id; break; }
  await sleep(400);
}
S.step('تیکت KDS ساخته شد', !!ticketId, `ticket=${ticketId}`);
const forbidden = await req('POST', `/restaurant/kitchen/tickets/${ticketId}`, { token: T.frontdesk, body: { status: 'PREPARING' } });
S.step('پیش‌ Reception اجازه تغییر KDS ندارد → 403', forbidden.status === 403, `status=${forbidden.status}`);
const p1 = await req('POST', `/restaurant/kitchen/tickets/${ticketId}`, { token: T.chef, body: { status: 'PREPARING' } });
const p2 = await req('POST', `/restaurant/kitchen/tickets/${ticketId}`, { token: T.chef, body: { status: 'READY' } });
S.step('جریان PREPARING→READY', [200, 201].includes(p1.status) && [200, 201].includes(p2.status), `${p1.status}/${p2.status}`);
const back = await req('POST', `/restaurant/kitchen/tickets/${ticketId}`, { token: T.chef, body: { status: 'PREPARING' } });
S.step('برگشت به عقب → 400', back.status === 400, `status=${back.status}`);

// ── سرو → سند فروش + مصرف رسپی ──
const serve = await req('POST', `/restaurant/orders/${orderId}/serve`, { token: T.frontdesk, body: {} });
S.step('سرو سفارش', [200, 201].includes(serve.status), `status=${serve.status}`);
const t1after = (await c.query(`select status from dining_tables where code='T1'`)).rows[0];
S.step('میز پس از سرو FREE', t1after?.status === 'FREE', `db=${t1after?.status}`);
let saleEntry = null;
for (let i = 0; i < 30; i++) { const e = await c.query(`select "entryNo" from journal_entries where "sourceModule"='pos' and "sourceRef"=$1 and status='POSTED'`, [orderId]); if (e.rows[0]) { saleEntry = e.rows[0]; break; } await sleep(400); }
S.step('سند فروش posted', !!saleEntry, `entry=${saleEntry?.entryNo}`);
const saleLines = (await c.query(`select l."accountCode", l."debitRials"::text as d, l."creditRials"::text as cr from journal_lines l join journal_entries e on e.id=l."entryId" where e."entryNo"=$1`, [saleEntry?.entryNo])).rows;
const d1101 = saleLines.find((l) => l.accountCode === '1101');
const c4102 = saleLines.find((l) => l.accountCode === '4102');
const c2201 = saleLines.find((l) => l.accountCode === '2201');
const taxExpected = Math.round(gross * 0.10);
S.step('سند فروش: صندوق = خالص+مالیات', Number(d1101?.d) === gross + taxExpected, `1101=${d1101?.d} (انتظار ${gross + taxExpected})`);
S.step('سند فروش: درآمد و مالیات', Number(c4102?.cr) === gross && Number(c2201?.cr) === taxExpected, `4102=${c4102?.cr} 2201=${c2201?.cr}`);
const rice = (await c.query(`select "qtyOnHand"::text as q from stock_items where code='STK-RICE'`)).rows[0];
const beef = (await c.query(`select "qtyOnHand"::text as q from stock_items where code='STK-BEEF'`)).rows[0];
const sodaAfter = (await c.query(`select "qtyOnHand"::text as q from stock_items where code='STK-SODA'`)).rows[0];
S.step('مصرف رسپی: برنج ۳۰۰۰۰−۵۰۰ و گوشت ۲۰۰۰۰−۶۰۰', Number(rice?.q) === 30000 - 500 && Number(beef?.q) === 20000 - 600, `rice=${rice?.q} beef=${beef?.q}`);
S.step('نوشابه بدون رسپی: بدون مصرف (۵۰۰۰۰ ثابت)', Number(sodaAfter?.q) === 50000, `soda=${sodaAfter?.q}`);

// ── سرویس اتاق: شارژ فولیو اقامت ──
const res = await req('POST', '/pms/reservations', { token: T.frontdesk, body: { roomTypeId: (await req('GET', '/room-types', { token: T.frontdesk })).json?.data?.find((x) => x.code === 'STD')?.id, guestName: 'مهمان سرویس اتاق', checkInDate: TODAY, checkOutDate: `${new Date(Date.now() + 86400000).toISOString().slice(0, 10)}`, idempotencyKey: jKey() } });
const resId = res.json?.data?.reservationId ?? res.json?.data?.id;
const map2 = (await req('GET', '/pms/rooms/map', { token: T.frontdesk })).json?.data;
const freeRoom = (map2?.floors ?? []).flatMap((f) => f.rooms ?? []).find((r) => r.status === 'AVAILABLE');
const ci = await req('POST', '/pms/stays/check-in', { token: T.frontdesk, body: { reservationId: resId, roomIds: [freeRoom.id], plannedCheckOut: `${new Date(Date.now() + 86400000).toISOString().slice(0, 10)}`, idempotencyKey: jKey(), partyId: await ensureParty(T.frontdesk, 'مهمان رستوران') } });
const stayCode = ci.json?.data?.code ?? ci.json?.code;
const rs = await req('POST', '/restaurant/orders', { token: T.frontdesk, body: { outletCode: 'REST-MAIN', mode: 'ROOM_SERVICE', stayCode, items: [{ menuItemCode: 'MI-KABAB', qty: 1 }], idempotencyKey: jKey() } });
S.step('سفارش سرویس اتاق ثبت شد', rs.status === 201, `status=${rs.status} ${JSON.stringify(rs.json?.error ?? {}).slice(0, 100)}`);
const rsId = rs.json?.id ?? rs.json?.data?.id;
const rsServe = await req('POST', `/restaurant/orders/${rsId}/serve`, { token: T.frontdesk, body: {} });
S.step('سرو سرویس اتاق', [200, 201].includes(rsServe.status), `status=${rsServe.status}`);
const folio = (await c.query(`select "folioRials"::text as f from stays where id=$1`, [ci.json?.data?.stayId ?? ci.json?.stayId])).rows[0];
const kababNet = Number(kabab.priceRials);
const kababTax = Math.round(kababNet * 0.10);
S.step('فولیو اقامت = کباب + مالیات', Number(folio?.f) === kababNet + kababTax, `folio=${folio?.f} (انتظار ${kababNet + kababTax})`);

await c.end();
S.finish();
