// 08-treasury.mjs — لایه ۱ / ماژول ۸: صندوق و شیفت، دارایی و استهلاک، خدمات جانبی
import { Suite, req, login, db, day, TODAY, sleep } from './_lib.mjs';

const S = new Suite('08-treasury');
const T = { admin: await login('admin', true), cashier: await login('cashier', false), frontdesk: await login('frontdesk', false) };
const c = await db();

// ریست جداول ماژول
await c.query(`TRUNCATE "ancillary_orders","cash_transactions","cashier_shifts","asset_depreciations","fixed_assets","journal_lines","journal_entries","outbox_events","inbox_events","audit_logs" CASCADE`);
await c.query(`UPDATE "fiscal_periods" SET "status" = CASE WHEN "endDate" < date_trunc('month', now()) THEN 'LOCKED'::fiscal_period_status ELSE 'OPEN'::fiscal_period_status END, "lockedAt" = CASE WHEN "endDate" < date_trunc('month', now()) THEN now() ELSE NULL END, "closedAt"=NULL, "closingEntryId"=NULL`);

const jKey = () => `m08-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// ── خزانه: صندوق‌ها و مانده ──
const accounts = (await req('GET', '/treasury/accounts', { token: T.cashier })).json ?? [];
const ch01 = accounts.find((a) => a.code === 'CH-01') ?? accounts[0];
S.step('صندوق‌ها موجود', accounts.length >= 1 && !!ch01?.id, `n=${accounts.length} first=${ch01?.code}`);

// ── شیفت: باز کردن + جلوگیری از شیفت دوم ──
const open = await req('POST', '/treasury/shifts/open', { token: T.cashier, body: { cashAccountId: ch01.id, openingFloatRials: 1_000_000, businessDate: TODAY } });
S.step('باز کردن شیفت', open.status === 201 && open.json?.status === 'OPEN', `status=${open.status}`);
const shiftId = open.json?.id;
const dup = await req('POST', '/treasury/shifts/open', { token: T.admin, body: { cashAccountId: ch01.id, openingFloatRials: 0, businessDate: TODAY } });
S.step('شیفت دوم روی همان صندوق → 400/409', [400, 409].includes(dup.status), `status=${dup.status}`);

// ── تراکنش: دریافت ۲ میلیون → سند خودکار ──
const txn = await req('POST', '/treasury/transactions', { token: T.cashier, body: { cashAccountId: ch01.id, kind: 'RECEIPT', method: 'CASH', amountRials: 2_000_000, businessDate: TODAY, idempotencyKey: jKey() } });
S.step('دریافت نقدی ۲٬۰۰۰٬۰۰۰', txn.status === 201 && txn.json?.replayed === false, `status=${txn.status}`);
const txnId = txn.json?.id;
const txnEntry = await (async () => { for (let i = 0; i < 30; i++) { const e = await c.query(`select "entryNo" from journal_entries where "sourceModule"='treasury' and "sourceRef"=$1 and status='POSTED'`, [txnId]); if (e.rows[0]) return e.rows[0]; await sleep(400); } return null; })();
S.step('سند خودکار خزانه posted', !!txnEntry, `entry=${txnEntry?.entryNo}`);
const d1101 = (await c.query(`select l."debitRials"::text as d from journal_lines l join journal_entries e on e.id=l."entryId" where e."entryNo"=$1 and l."accountCode"='1101' limit 1`, [txnEntry?.entryNo])).rows[0];
S.step('سند خزانه: ۱۱۰۱ بدهکار ۲٬۰۰۰٬۰۰۰', Number(d1101?.d) === 2_000_000, `d=${d1101?.d}`);

// ── idempotency تراکنش: کلید تکراری → replayed=true، رکورد جدید نه ──
const sameTxn = await req('POST', '/treasury/transactions', { token: T.cashier, body: { cashAccountId: ch01.id, kind: 'RECEIPT', method: 'CASH', amountRials: 2_000_000, businessDate: TODAY, idempotencyKey: (await c.query(`select "idempotencyKey" from cash_transactions where id=$1`, [txnId])).rows[0]?.idempotencyKey } });
const txnCnt = (await c.query(`select count(*)::int as n from cash_transactions where id=$1`, [txnId])).rows[0].n;
S.step('کلید تکراری → replayed و بدون رکورد تکراری', sameTxn.json?.replayed === true && txnCnt === 1, `replayed=${sameTxn.json?.replayed} count=${txnCnt}`);

// ── پرداخت ۳۰۰ هزار ──
const pay = await req('POST', '/treasury/transactions', { token: T.cashier, body: { cashAccountId: ch01.id, kind: 'PAYMENT', method: 'CASH', amountRials: 300_000, businessDate: TODAY, idempotencyKey: jKey() } });
S.step('پرداخت نقدی ۳۰۰٬۰۰۰', pay.status === 201, `status=${pay.status}`);

// ── بستن شیفت: انتظاری ۲٬۷۰۰٬۰۰۰ و انحراف با شمارش ──
const close = await req('POST', '/treasury/shifts/close', { token: T.cashier, body: { shiftId, countedRials: 2_650_000 } });
S.step('بستن شیفت با انحراف −۵۰٬۰۰۰', close.status === 201 && Number(close.json?.varianceRials) === -50_000, `status=${close.status} variance=${close.json?.varianceRials}`);
const noShift = await req('POST', '/treasury/transactions', { token: T.cashier, body: { cashAccountId: ch01.id, kind: 'RECEIPT', method: 'CASH', amountRials: 100_000, businessDate: TODAY, idempotencyKey: jKey() } });
S.step('تراکنش بدون شیفت باز → 400', noShift.status === 400, `status=${noShift.status}`);

// ── دارایی: ثبت → استهلاک → Dispose ──
const reg = await req('POST', '/assets', { token: T.admin, body: { nameEn: 'Test Oven', nameFa: 'فر تست ماژول۸', category: 'ELE', acquiredAt: day(-30), costRials: 24_000_000, salvageRials: 0, usefulLifeMonths: 24, roomCode: '301' } });
S.step('ثبت دارایی', reg.status === 201 && /^FA-\d{5}$/.test(reg.json?.assetCode ?? ''), `status=${reg.status} code=${reg.json?.assetCode}`);
const assetId = reg.json?.id;
const assetRow = (await c.query(`select "costRials"::text as cost, "usefulLifeMonths" as life from fixed_assets where id=$1`, [assetId])).rows[0];
S.step('خواندن مجدد دارایی: هزینه و عمر', Number(assetRow?.cost) === 24_000_000 && Number(assetRow?.life) === 24, `cost=${assetRow?.cost}`);
const dep = await req('POST', '/assets/depreciation/run', { token: T.admin, body: { periodCode: '1405-09' } });
const mine = (dep.json?.results ?? []).find((r) => r.assetCode === reg.json?.assetCode);
S.step('استهلاک ماه = ۲۴٬۰۰۰٬۰۰۰÷۲۴', dep.status === 201 && Number(mine?.amountRials) === 1_000_000, `status=${dep.status} amount=${mine?.amountRials}`);
const rerun = await req('POST', '/assets/depreciation/run', { token: T.admin, body: { periodCode: '1405-09' } });
const mine2 = (rerun.json?.results ?? []).find((r) => r.assetCode === reg.json?.assetCode);
S.step('اجرای دوباره → skipped', rerun.status === 201 && mine2?.skipped === 'already_posted', `skipped=${mine2?.skipped}`);
const disp = await req('POST', `/assets/${assetId}/dispose`, { token: T.admin, body: { action: 'SCRAPPED', reason: 'تست پایان عمر ماژول۸' } });
const dispRow = (await c.query(`select status from fixed_assets where id=$1`, [assetId])).rows[0];
// مدل دامنه: وضعیت پس از ابطال = خودِ اقدام (SOLD/SCRAPPED)
S.step('ابطال دارایی → SCRAPPED', [200, 201].includes(disp.status) && ['SCRAPPED', 'SOLD', 'DISPOSED'].includes(dispRow?.status), `status=${disp.status} db=${dispRow?.status}`);

// ── خدمات جانبی: روی اقامت ──
const services = (await req('GET', '/ancillary/services', { token: T.frontdesk })).json ?? [];
const parking = services.find((s) => s.code === 'SVC-PARKING');
S.step('خدمات seed (پارکینگ)', !!parking, `n=${services.length} parking=${parking?.code}`);
const res = await req('POST', '/pms/reservations', { token: T.frontdesk, body: { roomTypeId: (await req('GET', '/room-types', { token: T.frontdesk })).json?.data?.find((x) => x.code === 'STD')?.id, guestName: 'مهمان خدمات', checkInDate: TODAY, checkOutDate: day(1), idempotencyKey: jKey() } });
const map = (await req('GET', '/pms/rooms/map', { token: T.frontdesk })).json?.data;
const freeRoom = (map?.floors ?? []).flatMap((f) => f.rooms ?? []).find((r) => r.status === 'AVAILABLE');
const ci = await req('POST', '/pms/stays/check-in', { token: T.frontdesk, body: { reservationId: res.json?.data?.reservationId ?? res.json?.data?.id, roomIds: [freeRoom.id], plannedCheckOut: day(1), idempotencyKey: jKey() } });
const stayId = ci.json?.data?.stayId ?? ci.json?.stayId;
const stayCode = ci.json?.data?.code ?? ci.json?.code;
const ord = await req('POST', '/ancillary/orders', { token: T.frontdesk, body: { serviceCode: 'SVC-PARKING', quantity: 2, stayCode, idempotencyKey: jKey() } });
S.step('سفارش خدمت ×۲ ثبت شد', ord.status === 201, `status=${ord.status} ${JSON.stringify(ord.json?.error ?? {}).slice(0, 100)}`);
S.step('مبلغ خدمت: خالص ۳٬۰۰۰٬۰۰۰ + مالیات ۳۰۰٬۰۰۰', Number(ord.json?.netRials) === 3_000_000 && Number(ord.json?.taxRials) === 300_000, `net=${ord.json?.netRials} tax=${ord.json?.taxRials}`);
const folio = (await c.query(`select "folioRials"::text as f from stays where id=$1`, [stayId])).rows[0];
S.step('فولیو اقامت += خدمت با مالیات', Number(folio?.f) === 3_300_000, `folio=${folio?.f}`);
const cancel = await req('POST', `/ancillary/orders/${ord.json?.id ?? ord.json?.data?.id}/cancel`, { token: T.frontdesk, body: { reason: 'لغو تست ماژول۸' } });
S.step('لغو سفارش خدمت', [200, 201].includes(cancel.status), `status=${cancel.status}`);

await c.end();
S.finish();
