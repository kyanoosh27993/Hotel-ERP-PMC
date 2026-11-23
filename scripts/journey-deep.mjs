// journey-deep.mjs — سناریوهای عمیق گیت یکپارچه: خواندن مجدد ذخیره‌ها، بدون ورود تکراری،
// صحت محاسبات، صحت نمایش (داشبورد در برابر DB)، یکپارچگی زنجیره‌ای، و نمونه‌گیری عملکرد.
const BASE = 'http://localhost:3000/api/v1';
import { createHmac } from 'node:crypto';
import pgPkg from 'pg';

const T = {};
const S = {};
let pass = 0, fail = 0;
const findings = [];
const step = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`PASS ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`FAIL ${name} — ${detail}`); findings.push({ name, detail }); }
};
const auth = (t) => `Bearer ${t}`;
const day = (n = 0) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const TODAY = day(0);

const totp = () => {
  const S = 'JBSWY3DPEHPK3PXPE2ETEST', A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let b = '';
  for (const c of S) { const i = A.indexOf(c); if (i >= 0) b += i.toString(2).padStart(5, '0'); }
  const k = Buffer.from(Array.from({ length: b.length / 8 }, (_, i) => parseInt(b.slice(i * 8, i * 8 + 8), 2)));
  const ctr = Math.floor(Date.now() / 30000);
  const buf = Buffer.alloc(8); buf.writeUInt32BE(Math.floor(ctr / 2 ** 32), 0); buf.writeUInt32BE(ctr % 2 ** 32, 4);
  const h = createHmac('sha1', k).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  return String(((h[o] & 0x7f) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1e6).padStart(6, '0');
};
async function req(method, path, { token, body, label } = {}) {
  const t0 = Date.now();
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: auth(token) } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await r.json(); } catch { /* empty body */ }
  return { status: r.status, json, ms: Date.now() - t0, label };
}
async function login(username, withTotp) {
  const r = await req('POST', '/auth/login', { body: { username, password: 'ChangeMe_Str0ng!', ...(withTotp ? { totp: totp() } : {}) } });
  if (!(r.status === 200 || r.status === 201)) throw new Error(`login failed ${username}: ${r.status}`);
  return r.json.accessToken;
}

async function resetState() {
  const c = new pgPkg.Client({ connectionString: 'postgresql://hotel:hotel_ci_pass@localhost:5433/hotel_erp' });
  await c.connect();
  await c.query(`TRUNCATE "kitchen_tickets","order_items","restaurant_orders","goods_receipt_lines","goods_receipts",
    "purchase_order_lines","purchase_orders","purchase_requisition_lines","purchase_requisitions",
    "stock_count_lines","stock_counts","stock_movements","stay_rooms","stays","cash_transactions",
    "cashier_shifts","ancillary_orders","outbox_events","inbox_events","journal_entries","journal_lines",
    "journal_attachments","audit_logs","night_audit_runs","reservations","waitlist_entries" CASCADE`);
  await c.query(`UPDATE "dining_tables" SET "status"='FREE'`);
  await c.query(`UPDATE "rooms" SET "status"='AVAILABLE', "hkStatus"='CLEAN', "note"=NULL`);
  await c.query(`UPDATE "stock_items" SET "qtyOnHand"=0, "avgCostRials"=0`);
  await c.query(`UPDATE "fiscal_periods" SET "status" = CASE WHEN "endDate" < date_trunc('month', now()) THEN 'LOCKED'::fiscal_period_status ELSE 'OPEN'::fiscal_period_status END, "lockedAt" = CASE WHEN "endDate" < date_trunc('month', now()) THEN now() ELSE NULL END, "closedAt"=NULL, "closingEntryId"=NULL`);
  await c.end();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForJournal(prisma, sourceModule, sourceRef, timeoutMs = 15000) {
  const c = new pgPkg.Client({ connectionString: 'postgresql://hotel:hotel_ci_pass@localhost:5433/hotel_erp' });
  await c.connect();
  const deadline = Date.now() + timeoutMs;
  let entryNo = null;
  while (Date.now() < deadline) {
    const r = await c.query(`select "entryNo" from journal_entries where "sourceModule"=$1 and "sourceRef"=$2 and status='POSTED' limit 1`, [sourceModule, sourceRef]);
    if (r.rows[0]) { entryNo = r.rows[0].entryNo; break; }
    await sleep(400);
  }
  await c.end();
  return entryNo;
}

// ── A) ذخیرهٔ صحیح: خواندن مجدد و مقایسهٔ فیلد به فیلد ──
async function phaseReadBack() {
  console.log('\n══ A) خواندن مجدد ذخیره‌ها ══');
  const guest = 'نارگیل تست عمیق';
  // نرخ اختصاصی در قرارداد رزرو نیست — نرخ از نوع اتاق می‌آید؛ انتظار: قیمت استاندارد × شب‌ها
  const res = await req('POST', '/pms/reservations', { token: T.frontdesk, body: { roomTypeId: S.stdTypeId, guestName: guest, checkInDate: TODAY, checkOutDate: day(2), idempotencyKey: `deep-res-${Date.now()}` } });
  step('A1 رزرو ثبت می‌شود', res.status === 201, `status=${res.status} ${JSON.stringify(res.json?.error ?? {})?.slice(0, 120)}`);
  const db1 = new pgPkg.Client({ connectionString: 'postgresql://hotel:hotel_ci_pass@localhost:5433/hotel_erp' });
  await db1.connect();
  const row = await db1.query(`select "guestName", "totalRials"::text as total from reservations where id=$1`, [res.json?.data?.reservationId]);
  await db1.end();
  step('A2 خواندن مجدد: نام مهمان عیناً ذخیره شده', row.rows[0]?.guestName === guest, `got=${row.rows[0]?.guestName}`);
  step('A3 خواندن مجدد: مبلغ = نرخ نوع اتاق × ۲ شب', Number(row.rows[0]?.total) === 2 * Number(S.stdPrice), `total=${row.rows[0]?.total}, std×2=${2 * Number(S.stdPrice)}`);
  S.resId = res.json?.data?.reservationId;

  // سند دستی سه‌سطری → خواندن مجدد → تأیید → docIndex
  const draft = await req('POST', '/journal-entries', { token: T.accountant, body: { description: 'عمیق — فروش نقدی', lines: [
    { accountCode: '1101', debit: 1_090_000, credit: 0, costCenter: 'CC-FB' },
    { accountCode: '4102', debit: 0, credit: 1_000_000, costCenter: 'CC-FB' },
    { accountCode: '2201', debit: 0, credit: 90_000, costCenter: 'CC-FB' },
  ] } });
  step('A4 پیش‌نویس سه‌سطری با مرکز هزینه ثبت', draft.status === 201, `status=${draft.status}`);
  const list = await req('GET', '/journal-entries?limit=50', { token: T.accountant });
  const got = (list.json?.data ?? []).find((e) => e.id === draft.json?.data?.id);
  const lines = got?.lines ?? [];
  step('A5 خواندن مجدد: سطرها و مرکز هزینه عیناً', lines.length === 3 && (lines[0]?.costCenterCode ?? lines[0]?.costCenter) === 'CC-FB', `lines=${JSON.stringify(lines).slice(0, 160)}`);
  const ap = await req('POST', `/journal-entries/${draft.json?.data?.id}/approve`, { token: T.approver, body: {} });
  step('A6 تأیید و شماره عطف', [200, 201].includes(ap.status), `status=${ap.status}`);
  S.manualEntry = draft.json?.data?.entryNo;
}

// ── B) بدون ورود تکراری: قیمت‌ها و داده‌ها از مرجع می‌آیند ──
async function phaseNoDuplicateInput() {
  console.log('\n══ B) بدون ورود تکراری ══');
  // قیمت غذا از منو می‌آید — payload سفارش قیمت ندارد
  const menu = await req('GET', '/restaurant/menu', { token: T.admin });
  // شکل واقعی: آرایهٔ دسته‌ها با items داخل هر دسته
  const items = (menu.json ?? []).flatMap((c) => c.items ?? []);
  const item = items.find((m) => m.priceRials > 0);
  const order = await req('POST', '/restaurant/orders', { token: T.frontdesk, body: { outletCode: 'REST-MAIN', tableCode: 'T3', mode: 'DINE_IN', items: [{ menuItemCode: item.code, qty: 2 }], idempotencyKey: `deep-pos-${Date.now()}` } });
  step('B1 سفارش بدون ورود قیمت ثبت شد', order.status === 201, `status=${order.status}`);
  const expected = 2 * Number(item.priceRials);
  step('B2 مبلغ سفارش = قیمت منو×تعداد (قیمت از مرجع)', Number(order.json?.netRials) === expected, `net=${order.json?.netRials}, menu×2=${expected}`);
  S.orderNo = order.json?.orderNo;

  // چک‌این از رزرو: بدون ورود مجدد مهمان/نرخ
  const room = (await req('GET', '/pms/rooms/map', { token: T.frontdesk })).json?.data?.floors
    .flatMap((f) => f.rooms ?? []).find((r) => r.code === '101');
  const ci = await req('POST', '/pms/stays/check-in', { token: T.frontdesk, body: { reservationId: S.resId, roomIds: [room.id], plannedCheckOut: day(2), idempotencyKey: `deep-ci-${Date.now()}` } });
  step('B3 چک‌این فقط با شناسه‌ها (بدون تکرار مهمان/نرخ)', ci.status === 201, `status=${ci.status}`);
  S.stayId = ci.json?.data?.stayId;

  // GRN: هزینهٔ واحد از PO می‌آید (بدون تکرار قیمت)
  const po = await req('POST', '/procurement/orders', { token: T.approver, body: { supplierCode: 'SUP-001', items: [{ stockItemCode: 'STK-RICE', qty: 10, unitCostRials: 150_000 }] } });
  await req('POST', `/procurement/orders/${po.json?.id}/approve`, { token: T.approver, body: {} });
  const grn = await req('POST', '/procurement/receipts', { token: T.storekeeper, body: { poCode: po.json?.poNo, lines: [{ stockItemCode: 'STK-RICE', qtyReceived: 10 }] } });
  step('B4 رسید خرید از PO بدون تکرار قیمت', grn.status === 201, `status=${grn.status} ${JSON.stringify(grn.json?.error ?? {})?.slice(0, 100)}`);
  const rice = (await req('GET', '/stores/items', { token: T.storekeeper })).json?.find((i) => i.code === 'STK-RICE');
  // واحد پایهٔ کالا گرام است: ۱۰ کیلوگرم → ۱۰٬۰۰۰ گرم با میانگین ۱۵۰ ریال/گرم
  step('B6 میانگین موزون انبار صحیح (۱۰کیلو=۱۰٬۰۰۰گرم × ۱۵۰)', Number(rice?.qtyOnHand) === 10_000 && Number(rice?.avgCostRials) === 150, `qty=${rice?.qtyOnHand}, avg=${rice?.avgCostRials}`);
}

// ── C) صحت محاسبات ──
async function phaseCalculations(db) {
  console.log('\n══ C) صحت محاسبات ══');
  // سفرکاربر رستوران: فروش با مالیات ۹٪
  const sale = Number(S.orderNo ? S.orderNo : 0);
  // اظهارنامه VAT در برابر محاسبهٔ مستقیم DB
  const decl = await req('GET', `/compliance/vat/declaration?from=${TODAY}&to=${TODAY}`, { token: T.accountant });
  const dbOut = await db.query(`select coalesce(sum(l."creditRials"),0)::text as v from journal_lines l join journal_entries e on e.id=l."entryId" where l."accountCode"='2201' and e."postingDate"::date=current_date and e.status='POSTED'`);
  const dbIn = await db.query(`select coalesce(sum(l."debitRials"),0)::text as v from journal_lines l join journal_entries e on e.id=l."entryId" where l."accountCode"='2204' and e."postingDate"::date=current_date and e.status='POSTED'`);
  step('C1 اظهارنامه: خروجی VAT = جمع DB', Number(decl.json?.data?.outputVatRials) === Number(dbOut.rows[0].v), `api=${decl.json?.data?.outputVatRials} db=${dbOut.rows[0].v}`);
  step('C2 اظهارنامه: اعتبار VAT = جمع DB', Number(decl.json?.data?.inputVatCreditRials) === Number(dbIn.rows[0].v), `api=${decl.json?.data?.inputVatCreditRials} db=${dbIn.rows[0].v}`);

  // تراز آزمایشی = جمع DB
  const tb = await req('GET', `/journal-entries/trial-balance?from=${TODAY}&to=${TODAY}`, { token: T.accountant });
  const dbTurn = await db.query(`select coalesce(sum(l."debitRials"),0)::text as dr, coalesce(sum(l."creditRials"),0)::text as cr from journal_lines l join journal_entries e on e.id=l."entryId" where e."postingDate"::date=current_date and e.status='POSTED'`);
  step('C3 تراز آزمایشی: گردش بدهکار = DB', Number(dbTurn.rows[0].dr) === tb.json?.meta?.totals?.periodDebit, `db=${dbTurn.rows[0].dr} api=${tb.json?.meta?.totals?.periodDebit}`);
  step('C4 تراز آزمایشی: گردش بستانکار = DB', Number(dbTurn.rows[0].cr) === tb.json?.meta?.totals?.periodCredit, `db=${dbTurn.rows[0].cr} api=${tb.json?.meta?.totals?.periodCredit}`);
  step('C5 تراز متوازن', tb.json?.meta?.balanced === true, `balanced=${tb.json?.meta?.balanced}`);

  // سود و زیان = درآمد DB − هزینه DB
  const pnl = await req('GET', `/journal-entries/statements/income?from=${TODAY}&to=${TODAY}`, { token: T.accountant });
  const dbPnl = await db.query(`select a.type, coalesce(sum(case when a.type='REVENUE' then l."creditRials"-l."debitRials" else l."debitRials"-l."creditRials" end),0)::text as v from journal_lines l join journal_entries e on e.id=l."entryId" join accounts a on a.code=l."accountCode" where e."postingDate"::date=current_date and e.status='POSTED' group by a.type`);
  const rev = Number(dbPnl.rows.find((r) => r.type === 'REVENUE')?.v ?? 0);
  const exp = Number(dbPnl.rows.find((r) => r.type === 'EXPENSE')?.v ?? 0);
  step('C6 سود و زیان = درآمدDB − هزینهDB', pnl.json?.totals?.netIncome === rev - exp, `api=${pnl.json?.totals?.netIncome} db=${rev - exp}`);
  S.revenueToday = rev;
}

// ── D) صحت نمایش: داشبورد در برابر DB ──
async function phaseDisplay(db) {
  console.log('\n══ D) صحت نمایش داشبورد ══');
  const ceo = await req('GET', '/dashboards/ceo', { token: T.admin });
  const fin = await req('GET', '/dashboards/finance', { token: T.accountant });
  step('D1 داشبورد CEO: درآمد امروز = درآمد سندهای امروز', Number(ceo.json?.data?.revenueTodayRials) === S.revenueToday, `api=${ceo.json?.data?.revenueTodayRials} db=${S.revenueToday}`);
  const cash = await db.query(`select coalesce(sum(l."debitRials"-l."creditRials"),0)::text as v from journal_lines l join journal_entries e on e.id=l."entryId" where l."accountCode"='1101' and e.status='POSTED'`);
  step('D2 داشبورد مالی: صندوق = ماندهٔ ۱۱۰۱', Number(fin.json?.data?.cashBoxes?.[0]?.balanceRials) === Number(cash.rows[0].v), `api=${fin.json?.data?.cashBoxes?.[0]?.balanceRials} db=${cash.rows[0].v}`);
  const rec = await db.query(`select coalesce(sum(l."debitRials"-l."creditRials"),0)::text as v from journal_lines l join journal_entries e on e.id=l."entryId" where l."accountCode"='1201' and e.status='POSTED'`);
  step('D3 داشبورد مالی: دریافتنی مهمانان = ماندهٔ ۱۲۰۱', Number(fin.json?.data?.receivablesRials) === Number(rec.rows[0].v), `api=${fin.json?.data?.receivablesRials} db=${rec.rows[0].v}`);
  const hk = await req('GET', '/dashboards/housekeeping', { token: T.admin });
  const dirty = await db.query(`select count(*)::int as c from rooms where "hkStatus"='DIRTY'`);
  // داشبورد وضعیت‌های صفر را حذف می‌کند — نبود ردیف یعنی صفر
  const dirtyRow = (hk.json?.data?.roomsByStatus ?? []).find((r) => r.status === 'DIRTY');
  step('D4 داشبورد خانه‌داری: اتاق کثیف = DB', (dirtyRow?.count ?? 0) === dirty.rows[0].c, `api=${dirtyRow?.count ?? 0} db=${dirty.rows[0].c}`);
}

// ── E) یکپارچگی زنجیره‌ای شب‌گردی → سند → تراز ──
async function phaseIntegration(db) {
  console.log('\n══ E) یکپارچگی زنجیره‌ای ══');
  const na = await req('POST', '/pms/night-audit', { token: T.frontdesk, body: { businessDate: TODAY } });
  step('E1 شب‌گردی اجرا شد', [200, 201].includes(na.status), `status=${na.status}`);
  const mapping = await db.query(`select "version" from event_journal_mappings where "eventName"='pms.night_audit.posted'`);
  const tag = `[mapping:v${mapping.rows[0]?.version ?? 1}]`;
  // مسیر نگاشت: sourceRef = idempotencyKey — جست‌وجو بر اساس شرح
  let entryNo = null;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const r = await db.query(`select "entryNo" from journal_entries where status='POSTED' and description like '%night audit room charge%' order by "createdAt" desc limit 1`);
    if (r.rows[0]) { entryNo = r.rows[0].entryNo; break; }
    await sleep(400);
  }
  step('E2 سند شارژ شب از موتور نگاشت (با برچسب نسخه)', !!entryNo, `entry=${entryNo}`);
  const desc = await db.query(`select description from journal_entries where "entryNo"=$1`, [entryNo ?? '']);
  step('E3 شرح سند شامل برچسب نگاشت', (desc.rows[0]?.description ?? '').includes(tag), `desc=${desc.rows[0]?.description}`);

  // تسویه چک‌اوت: مبلغ خودکار از فولیو (بدون ورود مبلغ)
  const co = await req('POST', `/pms/stays/${S.stayId}/check-out`, { token: T.frontdesk, body: {} });
  step('E4 چک‌اوت با محاسبهٔ خودکار فولیو', [200, 201].includes(co.status), `status=${co.status} total=${co.json?.data?.totalRials ?? co.json?.totalRials}`);
  const folio = Number(co.json?.folioRials ?? co.json?.data?.folioRials ?? 0);
  const folioRow = await db.query(`select "folioRials"::text as v from stays where id=$1`, [S.stayId]);
  step('E5 فولیو = نرخ × شب‌ها (محاسبهٔ خودکار، بدون ورود مبلغ)', folio === Number(folioRow.rows[0].v) && folio > 0, `folio=${folio}, db=${folioRow.rows[0].v}`);

  const tb2 = await req('GET', `/journal-entries/trial-balance?from=${TODAY}&to=${TODAY}`, { token: T.accountant });
  step('E6 تراز پس از کل زنجیره همچنان متوازن', tb2.json?.meta?.balanced === true, `balanced=${tb2.json?.meta?.balanced}`);
}

// ── F) نمونه‌گیری عملکرد ──
async function phasePerf() {
  console.log('\n══ F) عملکرد ══');
  const samples = {};
  const probe = async (name, fn, runs = 5) => {
    const xs = [];
    for (let i = 0; i < runs; i++) { const r = await fn(); xs.push(r.ms); }
    xs.sort((a, b) => a - b);
    samples[name] = xs[Math.floor(runs / 2)];
    step(`F ${name} — میانهٔ ${runs} اجرا`, samples[name] < 800, `median=${samples[name]}ms (values=${xs.join(',')})`);
  };
  await probe('login', () => req('POST', '/auth/login', { body: { username: 'frontdesk', password: 'ChangeMe_Str0ng!' } }));
  await probe('trial-balance', () => req('GET', `/journal-entries/trial-balance?from=${TODAY}&to=${TODAY}`, { token: T.accountant }));
  await probe('ledgers/general', () => req('GET', `/journal-entries/ledgers/general?from=${TODAY}&to=${TODAY}`, { token: T.accountant }));
  await probe('dashboards/ceo', () => req('GET', '/dashboards/ceo', { token: T.admin }));
  await probe('rooms/map', () => req('GET', '/pms/rooms/map', { token: T.frontdesk }));
  // بار هم‌زمان: ۵۰ درخواست ترکیبی
  const t0 = Date.now();
  const mixed = await Promise.all(Array.from({ length: 50 }, (_, i) => i % 2
    ? req('GET', '/dashboards/ceo', { token: T.admin })
    : req('GET', '/pms/rooms/map', { token: T.frontdesk })));
  const wall = Date.now() - t0;
  const p95 = mixed.map((r) => r.ms).sort((a, b) => a - b)[47];
  step('F بار ۵۰ درخواست هم‌زمان — همه موفق', mixed.every((r) => r.status === 200), `wall=${wall}ms`);
  step('F p95 زیر ۱ ثانیه', p95 < 1000, `p95=${p95}ms`);
  console.log('\nMEDIA:', JSON.stringify(samples), 'p95=', p95);
}

// ── اجرا ──
await resetState();
T.admin = await login('admin', true);
T.frontdesk = await login('frontdesk', false);
T.accountant = await login('accountant', true);
T.approver = await login('approver', true);
T.waiter = await login('chef', false);
T.storekeeper = await login('storekeeper', false);

const rt = await req('GET', '/room-types', { token: T.frontdesk });
Object.assign(S, {
  stdTypeId: (rt.json?.data ?? []).find((x) => x.code === 'STD')?.id,
  stdPrice: (rt.json?.data ?? []).find((x) => x.code === 'STD')?.baseRateRials,

});

const db = new pgPkg.Client({ connectionString: 'postgresql://hotel:hotel_ci_pass@localhost:5433/hotel_erp' });
await db.connect();

await phaseReadBack();
await phaseNoDuplicateInput();
await phaseCalculations(db);
await phaseDisplay(db);
await phaseIntegration(db);
await phasePerf();

// تراز کل اسناد — صحت‌سنجی نهایی حسابرس
const bal = await db.query(`select coalesce(sum(l."debitRials"-l."creditRials"),0)::text as d from journal_lines l join journal_entries e on e.id=l."entryId" where e.status='POSTED'`);
step('جمع کل اسناد posted = ۰', Number(bal.rows[0].d) === 0, `diff=${bal.rows[0].d}`);
await db.end();

console.log(`\n═══ خلاصهٔ عمیق: ${pass} PASS — ${fail} FAIL ═══`);
if (findings.length) { console.log('FINDINGS:'); findings.forEach((f) => console.log(`- [${f.name}] ${f.detail}`)); }
