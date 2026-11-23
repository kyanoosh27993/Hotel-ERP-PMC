// 10-layer2.mjs — لایهٔ ۲: مسیرهای متقاطع بین ماژول‌ها (هر گام خروجی گام بعد)
// هر سناریو با محاسبهٔ مستقیم DB راستی‌آزمایی می‌شود.
import { Suite, req, login, db, day, TODAY, sleep, buildIranIban, ibanValid } from './_lib.mjs';

const S = new Suite('10-layer2 (مسیرهای متقاطع)');
const T = {
  admin: await login('admin', true),
  accountant: await login('accountant', true),
  approver: await login('approver', true),
  frontdesk: await login('frontdesk', false),
  cashier: await login('cashier', false),
  chef: await login('chef', false),
  housekeeper: await login('housekeeper', false),
  storekeeper: await login('storekeeper', false),
};
const c = await db();

// ── ریست کامل سناریوهای تراکنشی (parent/child در یک دستور — درس باگ FK) ──
await c.query(`TRUNCATE "stay_rooms","stays","night_audit_runs","reservations","waitlist_entries","kitchen_tickets","order_items","restaurant_orders","goods_receipt_lines","goods_receipts","purchase_order_lines","purchase_orders","purchase_requisition_lines","purchase_requisitions","payroll_slips","payroll_runs","ancillary_orders","cash_transactions","cashier_shifts","asset_depreciations","fixed_assets","stock_count_lines","stock_counts","stock_movements","journal_attachments","journal_lines","journal_entries","outbox_events","inbox_events","audit_logs" CASCADE`);
await c.query(`UPDATE "rooms" SET "status"='AVAILABLE', "hkStatus"='CLEAN'`);
await c.query(`UPDATE "dining_tables" SET "status"='FREE'`);
await c.query(`UPDATE "stock_items" SET "qtyOnHand"=0, "avgCostRials"=0`);
await c.query(`UPDATE "fiscal_periods" SET "status" = CASE WHEN "endDate" < date_trunc('month', now()) THEN 'LOCKED'::fiscal_period_status ELSE 'OPEN'::fiscal_period_status END, "lockedAt" = CASE WHEN "endDate" < date_trunc('month', now()) THEN now() ELSE NULL END, "closedAt"=NULL, "closingEntryId"=NULL`);

const jKey = () => `l2-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const waitEntry = async (sourceRef, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await c.query(`select "entryNo" from journal_entries where "sourceRef"=$1 and status='POSTED' limit 1`, [sourceRef]);
    if (r.rows[0]) return r.rows[0].entryNo;
    await sleep(400);
  }
  return null;
};
const linesOf = async (entryNo) => (await c.query(`select l."accountCode", l."debitRials"::text d, l."creditRials"::text cr from journal_lines l where l."entryId"=(select id from journal_entries where "entryNo"=$1) order by l."lineNo"`, [entryNo])).rows;
const balanced = (lines) => lines.reduce((a, l) => a + BigInt(l.d) - BigInt(l.cr), 0n) === 0n;
const accBal = async (code) => Number((await c.query(`select coalesce(sum(l."debitRials"-l."creditRials"),0)::text v from journal_lines l join journal_entries e on e.id=l."entryId" where l."accountCode"=$1 and e.status='POSTED'`, [code])).rows[0].v);

// ═══ سناریو ۱ — مسیر مهمان: رزرو→پذیرش→روم‌سرویس→شب‌گردی→چک‌اوت→خانه‌داری ═══
const rtStd = (await req('GET', '/room-types', { token: T.frontdesk })).json?.data?.find((x) => x.code === 'STD');
const nightly = Number(rtStd.baseRateRials);
const res1 = await req('POST', '/pms/reservations', { token: T.frontdesk, body: { roomTypeId: rtStd.id, guestName: 'لایه۲ مهمان', checkInDate: TODAY, checkOutDate: day(2), idempotencyKey: jKey() } });
const res1Id = res1.json?.data?.reservationId;
const map = (await req('GET', '/pms/rooms/map', { token: T.frontdesk })).json?.data;
const room101 = (map?.floors ?? []).flatMap((f) => f.rooms ?? []).find((r) => r.code === '101');
const ci1 = await req('POST', '/pms/stays/check-in', { token: T.frontdesk, body: { reservationId: res1Id, roomIds: [room101.id], plannedCheckOut: day(2), idempotencyKey: jKey() } });
const stay1Id = ci1.json?.data?.stayId;
const stay1Code = ci1.json?.data?.code;
S.step('S1: رزرو و پذیرش اتاق ۱۰۱', res1.status === 201 && ci1.status === 201 && !!stay1Code, `stay=${stay1Code}`);

// روم‌سرویس: کباب×۲ (خالص ۹٬۰۰۰٬۰۰۰ + مالیات ۸۱۰٬۰۰۰)
const rs = await req('POST', '/restaurant/orders', { token: T.frontdesk, body: { outletCode: 'REST-MAIN', mode: 'ROOM_SERVICE', stayCode: stay1Code, items: [{ menuItemCode: 'MI-KABAB', qty: 2 }], idempotencyKey: jKey() } });
const rsId = rs.json?.id ?? rs.json?.data?.id;
const rsLines = (await req('GET', `/restaurant/orders/${rsId}`, { token: T.frontdesk })).json?.items ?? [];
for (const it of rsLines) await req('POST', `/restaurant/orders/${rsId}/items/${it.id}/send`, { token: T.frontdesk, body: {} });
await req('POST', `/restaurant/orders/${rsId}/serve`, { token: T.frontdesk, body: {} });
const folioAfterService = Number((await c.query(`select "folioRials"::text f from stays where id=$1`, [stay1Id])).rows[0].f);
S.step('S1: روم‌سرویس به فولیو نشست (۹٬۰۰۰٬۰۰۰+۱۰٪)', folioAfterService === 9_900_000, `folio=${folioAfterService}`);

// شب‌گردی امروز → +۱ شب
const na = await req('POST', '/pms/night-audit', { token: T.frontdesk, body: { businessDate: TODAY } });
const folioAfterAudit = Number((await c.query(`select "folioRials"::text f from stays where id=$1`, [stay1Id])).rows[0].f);
S.step('S1: شب‌گردی ۱ شب شارژ کرد', [200, 201].includes(na.status) && folioAfterAudit === 9_900_000 + nightly, `folio=${folioAfterAudit} (انتظار ${9_900_000 + nightly})`);
const naEntry = await waitEntry(`pms.night.${TODAY}`);
const naLines = naEntry ? await linesOf(naEntry) : [];
S.step('S1: سند شب‌گردی متوازن ۱۲۰۱/۴۱۰۱', naLines.length >= 2 && balanced(naLines) && naLines.some((l) => l.accountCode === '1201') && naLines.some((l) => l.accountCode === '4101'), `${naLines.map((l) => `${l.accountCode}:${l.d}/${l.cr}`).join(' ')}`);

// چک‌اوت → فولیو کامل حفظ شود (باگ #۷) + سند تسویه
const co1 = await req('POST', `/pms/stays/${stay1Id}/check-out`, { token: T.frontdesk, body: {} });
const coFolio = Number(co1.json?.data?.folioRials ?? 0);
S.step('S1: چک‌اوت فولیو = خدمات + شب‌های سپری‌شده (باگ #۷ رفع)', coFolio === 9_900_000 + nightly, `folio=${coFolio} (انتظار ${9_900_000 + nightly})`);
const settleEntry = await waitEntry(`checkout:${stay1Id}`);
const settleLines = settleEntry ? await linesOf(settleEntry) : [];
const d1101 = settleLines.find((l) => l.accountCode === '1101');
const c1201 = settleLines.find((l) => l.accountCode === '1201');
S.step('S1: سند تسویهٔ فولیو ۱۱۰۱/۱۲۰۱ متوازن', balanced(settleLines) && Number(d1101?.d) === coFolio && Number(c1201?.cr) === coFolio, `${settleLines.map((l) => `${l.accountCode}:${l.d}/${l.cr}`).join(' ')}`);

// خانه‌داری: وظیفهٔ نظافت → انجام → اتاق CLEAN/AVAILABLE
const task = await req('POST', '/housekeeping/tasks', { token: T.housekeeper, body: { roomCode: '101', kind: 'CLEANING', scheduledDate: TODAY } });
const taskId = task.json?.data?.id ?? task.json?.id;
await req('POST', `/housekeeping/tasks/${taskId}/start`, { token: T.housekeeper, body: {} });
const done = await req('POST', `/housekeeping/tasks/${taskId}/complete`, { token: T.housekeeper, body: { note: 'لایه۲' } });
const roomAfter = (await c.query(`select status, "hkStatus" from rooms where id=$1`, [room101.id])).rows[0];
S.step('S1: نظافت کامل → اتاق CLEAN و فروش‌پذیر', [200, 201].includes(done.status) && roomAfter?.hkStatus === 'CLEAN' && roomAfter?.status === 'AVAILABLE', `room=${roomAfter?.status}/${roomAfter?.hkStatus}`);

// ═══ سناریو ۲ — خرید→مصرف رسپی→فروش→اظهارنامهٔ VAT ═══
const po2 = await req('POST', '/procurement/orders', { token: T.approver, body: { supplierCode: 'SUP-001', items: [{ stockItemCode: 'STK-RICE', qty: 40, unitCostRials: 140_000 }] } });
const po2Id = po2.json?.id ?? po2.json?.data?.id;
await req('POST', `/procurement/orders/${po2Id}/approve`, { token: T.approver, body: {} });
const grn2 = await req('POST', '/procurement/receipts', { token: T.storekeeper, body: { poCode: po2.json?.poNo ?? po2.json?.data?.poNo, lines: [{ stockItemCode: 'STK-RICE', qtyReceived: 40 }] } });
// رسپی کباب: برنج ۲۵۰g + گوشت ۳۰۰g به‌ازای هر سهم (سنجش از DB) — S1 دو کباب مصرف کرده
const portions = (await c.query(`select s.code item, rl."qtyPerPortion"::float8 q from recipes r join recipe_lines rl on rl."recipeId"=r.id join stock_items s on s.id=rl."stockItemId" where r.code='RCP-KABAB'`)).rows;
const ricePortion = Number(portions.find((x) => x.item === 'STK-RICE')?.q ?? 0);
const beefPortion = Number(portions.find((x) => x.item === 'STK-BEEF')?.q ?? 0);
const riceAfterGRN = 40000 - ricePortion * 2; // مصرف S1 قبل از رسید
const rice2 = (await c.query(`select "qtyOnHand"::text q, "avgCostRials"::text a from stock_items where code='STK-RICE'`)).rows[0];
S.step('S2: رسید ۴۰کیلو با میانگین موزون (منهای مصرف S1)', grn2.status === 201 && Number(rice2?.q) === riceAfterGRN && Math.abs(Number(rice2?.a) - 142) <= 1, `qty=${rice2?.q} (انتظار ${riceAfterGRN}) avg=${rice2?.a}`);

const ord2 = await req('POST', '/restaurant/orders', { token: T.frontdesk, body: { outletCode: 'REST-MAIN', tableCode: 'T2', mode: 'DINE_IN', items: [{ menuItemCode: 'MI-KABAB', qty: 3 }], idempotencyKey: jKey() } });
const ord2Id = ord2.json?.id ?? ord2.json?.data?.id;
const ord2Lines = (await req('GET', `/restaurant/orders/${ord2Id}`, { token: T.frontdesk })).json?.items ?? [];
for (const it of ord2Lines) await req('POST', `/restaurant/orders/${ord2Id}/items/${it.id}/send`, { token: T.frontdesk, body: {} });
await req('POST', `/restaurant/orders/${ord2Id}/serve`, { token: T.frontdesk, body: {} });
// مصرف async است — تا ثبت دو حرکت (برنج/گوشت) سفارش دوم صبر می‌کنیم
let rice3 = null, beef3 = null;
for (let i = 0; i < 25; i++) {
  rice3 = (await c.query(`select "qtyOnHand"::text q from stock_items where code='STK-RICE'`)).rows[0];
  beef3 = (await c.query(`select "qtyOnHand"::text q from stock_items where code='STK-BEEF'`)).rows[0];
  if (Number(rice3?.q) === riceAfterGRN - ricePortion * 3) break;
  await sleep(400);
}
S.step('S2: مصرف رسپی ۳×رسپی از همان GRN (برنج)', Number(rice3?.q) === riceAfterGRN - ricePortion * 3, `rice=${rice3?.q} (انتظار ${riceAfterGRN - ricePortion * 3})`);
S.step('S2: مصرف گوشت بدون GRN (منفی مجاز آشپزخانه)', Number(beef3?.q) === -(beefPortion * 5), `beef=${beef3?.q} (انتظار ${-(beefPortion * 5)})`);
const saleEntry = await waitEntry(ord2Id);
const saleLines = saleEntry ? await linesOf(saleEntry) : [];
const saleNet = Number(ord2.json?.netRials ?? ord2.json?.data?.netRials);
const saleTax = Number(ord2.json?.taxRials ?? ord2.json?.data?.taxRials);
S.step('S2: سند فروش متوازن با درآمد/مالیات', balanced(saleLines) && saleLines.some((l) => l.accountCode === '4102' && Number(l.cr) === saleNet) && saleLines.some((l) => l.accountCode === '2201' && Number(l.cr) === saleTax), `4102=${saleNet} 2201=${saleTax}`);
const decl = await req('GET', `/compliance/vat/declaration?from=${TODAY}&to=${TODAY}`, { token: T.accountant });
const outDb = (await c.query(`select coalesce(sum(l."creditRials"),0)::text v from journal_lines l join journal_entries e on e.id=l."entryId" where l."accountCode"='2201' and e.status='POSTED' and e."postingDate"::date=current_date`)).rows[0];
S.step('S2: اظهارنامهٔ VAT شامل مالیات همین فروش', Number(decl.json?.data?.outputVatRials) === Number(outDb.v) && Number(outDb.v) >= saleTax, `decl=${decl.json?.data?.outputVatRials} db=${outDb.v} tax=${saleTax}`);

// ═══ سناریو ۳ — حقوق→خزانه→داشبورد مالی ═══
const run3 = await req('POST', '/payroll/runs', { token: T.accountant, body: { periodCode: '1405-09' } });
const run3Id = run3.json?.data?.id;
const run3Detail = (await req('GET', `/payroll/runs/${run3Id}`, { token: T.accountant })).json?.data;
const netTotal = run3Detail?.slips?.reduce((a, s) => a + BigInt(s.net), 0n) ?? 0n;
S.step('S3: دورهٔ حقوق با فیش‌ها', run3.status === 201 && (run3Detail?.slips?.length ?? 0) >= 10, `slips=${run3Detail?.slips?.length} net=${netTotal}`);
await req('POST', `/payroll/runs/${run3Id}/approve`, { token: T.approver, body: {} });
const payEntry = await waitEntry(run3Id, 20000);
const payLines = payEntry ? await linesOf(payEntry) : [];
S.step('S3: سند حقوق متوازن ۵سطری', payLines.length === 5 && balanced(payLines), `${payLines.length} lines`);

const accounts = (await req('GET', '/treasury/accounts', { token: T.cashier })).json ?? [];
const ch01 = accounts.find((a) => a.code === 'CH-01') ?? accounts[0];
const cashBefore = await accBal('1101');
const shift3 = await req('POST', '/treasury/shifts/open', { token: T.cashier, body: { cashAccountId: ch01.id, openingFloatRials: Number(netTotal) + 10_000_000, businessDate: TODAY } });
const shift3Id = shift3.json?.id;
const pay3 = await req('POST', '/treasury/transactions', { token: T.cashier, body: { cashAccountId: ch01.id, kind: 'PAYMENT', method: 'CASH', amountRials: Number(netTotal), businessDate: TODAY, idempotencyKey: jKey() } });
S.step('S3: پرداخت حقوق از صندوق', pay3.status === 201 && pay3.json?.replayed === false, `status=${pay3.status}`);
const payEntry3 = await waitEntry(pay3.json?.id);
S.step('S3: سند پرداخت posted', !!payEntry3, `entry=${payEntry3}`);
const cashAfter = await accBal('1101');
S.step('S3: ماندهٔ صندوق دقیقاً خالص حقوق کم شد', cashBefore - cashAfter === Number(netTotal), `delta=${cashBefore - cashAfter} net=${netTotal}`);
// شمارش صندوق = ماندهٔ منطقی شیفت (افتتاح − پرداخت) → انحراف صفر
const close3 = await req('POST', '/treasury/shifts/close', { token: T.cashier, body: { shiftId: shift3Id, countedRials: Number(netTotal) + 10_000_000 - Number(netTotal) } });
S.step('S3: بستن شیفت بدون انحراف', [200, 201].includes(close3.status) && Number(close3.json?.varianceRials) === 0, `variance=${close3.json?.varianceRials}`);
const fin = (await req('GET', '/dashboards/finance', { token: T.accountant })).json?.data;
S.step('S3: داشبورد مالی = ماندهٔ ۱۱۰۱ DB', Number(fin?.cashBoxes?.[0]?.balanceRials) === cashAfter, `api=${fin?.cashBoxes?.[0]?.balanceRials} db=${cashAfter}`);

// ═══ سناریو ۴ — رزرو→لغو→سند معکوس→دریافتنی صفر ═══
const res4 = await req('POST', '/pms/reservations', { token: T.frontdesk, body: { roomTypeId: rtStd.id, guestName: 'لایه۲ لغو', checkInDate: day(9), checkOutDate: day(11), idempotencyKey: jKey() } });
const res4Id = res4.json?.data?.reservationId;
const bookEntry = await waitEntry(res4Id);
const bookLines = bookEntry ? await linesOf(bookEntry) : [];
const res4Total = Number((await c.query(`select "totalRials"::text v from reservations where id=$1`, [res4Id])).rows[0].v);
S.step('S4: سند رزرو ۱۲۰۱/۴۱۰۱ متوازن', balanced(bookLines) && Number(bookLines.find((l) => l.accountCode === '1201')?.d) === res4Total, `1201=${res4Total}`);
const cancel4 = await req('POST', `/pms/reservations/${res4Id}/cancel`, { token: T.frontdesk, body: {} });
const revEntry = await waitEntry(`cancel:${res4Id}`);
const revLines = revEntry ? await linesOf(revEntry) : [];
S.step('S4: سند معکوس لغو متوازن', [200, 201].includes(cancel4.status) && balanced(revLines), `entry=${revEntry}`);
const net1201 = bookLines.reduce((a, l) => a + (l.accountCode === '1201' ? BigInt(l.d) - BigInt(l.cr) : 0n), 0n)
  + revLines.reduce((a, l) => a + (l.accountCode === '1201' ? BigInt(l.d) - BigInt(l.cr) : 0n), 0n);
S.step('S4: اثر خالص رزرو لغوشده روی دریافتنی = صفر', net1201 === 0n, `net1201=${net1201}`);

// ═══ سناریو ۵ — دارایی→استهلاک→تراز آزمایشی ═══
const asset5 = await req('POST', '/assets', { token: T.admin, body: { nameEn: 'L2 Oven', nameFa: 'فر لایه۲', category: 'ELE', acquiredAt: day(-30), costRials: 12_000_000, salvageRials: 0, usefulLifeMonths: 12, roomCode: '101' } });
const dep5 = await req('POST', '/assets/depreciation/run', { token: T.admin, body: { periodCode: '1405-09' } });
const mine5 = (dep5.json?.results ?? []).find((r) => r.assetCode === asset5.json?.assetCode);
S.step('S5: استهلاک ماه = هزینه ÷ عمر', dep5.status === 201 && Number(mine5?.amountRials) === 1_000_000, `amount=${mine5?.amountRials}`);
let depEntryNo = null;
for (let i = 0; i < 30; i++) { const e = await c.query(`select "entryNo" from journal_entries where "sourceModule"='assets' and status='POSTED' order by "createdAt" desc limit 1`); if (e.rows[0]) { depEntryNo = e.rows[0].entryNo; break; } await sleep(400); }
const depLines = depEntryNo ? await linesOf(depEntryNo) : [];
S.step('S5: سند استهلاک متوازن', balanced(depLines) && depLines.some((l) => Number(l.d) === 1_000_000), `${depLines.map((l) => `${l.accountCode}:${l.d}/${l.cr}`).join(' ')}`);
const tb = await req('GET', `/journal-entries/trial-balance?from=${TODAY}&to=${TODAY}`, { token: T.accountant });
S.step('S5: تراز آزمایشی بعد از همهٔ اسناد متوازن', tb.json?.meta?.balanced === true, `balanced=${tb.json?.meta?.balanced}`);

// ═══ سناریو ۶ — خدمت جانبی→لغو→اثر معکوس فولیو ═══
const res6 = await req('POST', '/pms/reservations', { token: T.frontdesk, body: { roomTypeId: rtStd.id, guestName: 'لایه۲ خدمت', checkInDate: TODAY, checkOutDate: day(1), idempotencyKey: jKey() } });
const res6Id = res6.json?.data?.reservationId;
const map6 = (await req('GET', '/pms/rooms/map', { token: T.frontdesk })).json?.data;
const free6 = (map6?.floors ?? []).flatMap((f) => f.rooms ?? []).find((r) => r.status === 'AVAILABLE' && r.code !== '101');
const ci6 = await req('POST', '/pms/stays/check-in', { token: T.frontdesk, body: { reservationId: res6.json?.data?.reservationId, roomIds: [free6.id], plannedCheckOut: day(1), idempotencyKey: jKey() } });
const stay6Id = ci6.json?.data?.stayId;
const stay6Code = ci6.json?.data?.code;
const ord6 = await req('POST', '/ancillary/orders', { token: T.frontdesk, body: { serviceCode: 'SVC-PARKING', quantity: 2, stayCode: stay6Code, idempotencyKey: jKey() } });
const folio6a = Number((await c.query(`select "folioRials"::text f from stays where id=$1`, [stay6Id])).rows[0].f);
S.step('S6: خدمت پارکینگ به فولیو (۳٬۳۰۰٬۰۰۰)', ord6.status === 201 && folio6a === 3_300_000, `folio=${folio6a}`);
const cancel6 = await req('POST', `/ancillary/orders/${ord6.json?.id ?? ord6.json?.data?.id}/cancel`, { token: T.frontdesk, body: { reason: 'لغو لایه۲' } });
const folio6b = Number((await c.query(`select "folioRials"::text f from stays where id=$1`, [stay6Id])).rows[0].f);
S.step('S6: لغو خدمت فولیو را برمی‌گرداند', [200, 201].includes(cancel6.status) && folio6b === 0, `folio=${folio6b} (انتظار ۰)`);

// ═══ سناریو ۷ — داشبورد مدیرعامل پس از همهٔ رویدادها ═══
// اسناد async (رزروها) باید قبل از مقایسه posted شده باشند
await waitEntry(res1Id);
await waitEntry(res6Id);
await sleep(1500);
const occupiedDb = (await c.query(`select count(*)::int n from rooms where status='OCCUPIED'`)).rows[0].n;
const ceo = (await req('GET', '/dashboards/ceo', { token: T.admin })).json?.data;
S.step('S7: اشغال CEO = اتاق‌های اشغال DB (باگ #۶ رفع)', ceo?.occupancy?.occupiedUnits === occupiedDb, `api=${ceo?.occupancy?.occupiedUnits} db=${occupiedDb}`);
// تعریف داشبورد: درآمد اتاق (۴۱۰۱) + رستوران (۴۱۰۲)
const revDb = (await c.query(`select coalesce(sum(l."creditRials"-l."debitRials"),0)::text v from journal_lines l join journal_entries e on e.id=l."entryId" where l."accountCode" in ('4101','4102') and e.status='POSTED' and e."entryDate"::date=current_date`)).rows[0];
S.step('S7: درآمد امروز CEO = DB', Number(ceo?.revenueTodayRials) === Number(revDb.v), `api=${ceo?.revenueTodayRials} db=${revDb.v}`);
const cashDb = await accBal('1101');
S.step('S7: جریان نقد CEO = ماندهٔ ۱۱۰۱', Number(ceo?.cashBalanceRials) === cashDb, `api=${ceo?.cashBalanceRials} db=${cashDb}`);

await c.end();
S.finish();
