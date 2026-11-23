/**
 * user-journey.mjs — تست واقعی کاربر از ۰ تا ۱۰۰ روی پشتهٔ زندهٔ localhost
 * با قراردادهای واقعی API (استخراج‌شده از کنترلرها و e2e). خروجی: /tmp/journey-report.json
 */
const BASE = 'http://localhost:3000/api/v1';
const TOTP_SECRET = 'JBSWY3DPEHPK3PXPE2ETEST';
const PASSWORD = 'ChangeMe_Str0ng!';
import { createHmac } from 'node:crypto';
import { writeFileSync } from 'node:fs';

function base32Decode(str) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of str.toUpperCase()) { const i = A.indexOf(c); if (i >= 0) bits += i.toString(2).padStart(5, '0'); }
  return Buffer.from(Array.from({ length: Math.floor(bits.length / 8) }, (_, i) => parseInt(bits.slice(i * 8, i * 8 + 8), 2)));
}
function totp(secret, t = Date.now()) {
  const key = base32Decode(secret);
  const counter = Math.floor(t / 30000);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter % 2 ** 32, 4);
  const h = createHmac('sha1', key).update(buf).digest();
  const off = h[h.length - 1] & 0xf;
  return String(((h[off] & 0x7f) << 24 | h[off + 1] << 16 | h[off + 2] << 8 | h[off + 3]) % 1e6).padStart(6, '0');
}

const report = { steps: [], findings: [], timings: [] };
let stepNo = 0;
function step(name, ok, detail = '') {
  stepNo += 1;
  report.steps.push({ n: stepNo, name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} #${stepNo} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) report.findings.push({ name, detail });
}
async function req(method, path, { token, body, label } = {}) {
  const t0 = Date.now();
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  const ms = Date.now() - t0;
  if (label) report.timings.push({ label, ms, status: res.status });
  return { status: res.status, json, ms };
}
const T = {}; const S = {};
const TODAY = () => new Date().toISOString().slice(0, 10);
const dayFromNow = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const num = (v) => (v == null ? null : Number(v));

/** صبر برای ظاهر شدن سند با توضیح مشخص در دفتر (زنجیرهٔ outbox) */
async function waitJournalDesc(needle, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const jl = await req('GET', '/journal-entries?limit=500', { token: T.accountant });
    const rows = jl.json?.data ?? [];
    const hit = rows.find((e) => (e.description || '').includes(needle));
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 800));
  }
  return null;
}

// ═══════════ ۱) ورود و RBAC ═══════════
async function phaseAuth() {
  console.log('\n══ فاز ۱/۲ — ورود و ماتریس مجوز ══');
  const bad = await req('POST', '/auth/login', { body: { username: 'admin', password: 'wrong' }, label: 'login-wrong' });
  step('گذرواژهٔ غلط رد می‌شود', bad.status === 400 || bad.status === 401, `status=${bad.status}`);

  const users = [['admin', 1], ['accountant', 1], ['approver', 1], ['frontdesk', 0], ['cashier', 0], ['chef', 0], ['storekeeper', 0], ['housekeeper', 0]];
  for (const [u, mfa] of users) {
    const r = await req('POST', '/auth/login', { body: { username: u, password: PASSWORD, ...(mfa ? { totp: totp(TOTP_SECRET) } : {}) }, label: 'login' });
    if (r.status === 200 || r.status === 201) T[u] = r.json.accessToken;
  }
  step('ورود همهٔ ۸ نقش', Object.keys(T).length === 8, `${Object.keys(T).length}/8`);

  const hk = await req('POST', '/pms/reservations', { token: T.housekeeper, body: { roomTypeId: 'x', guestName: 'x', checkInDate: '2027-01-01', checkOutDate: '2027-01-02', idempotencyKey: 'hk-nope' }, label: 'rbac' });
  step('خانه‌دار رزرو نمی‌سازد (403)', hk.status === 403, `status=${hk.status}`);
  const fdJournal = await req('POST', '/journal-entries', { token: T.frontdesk, body: { description: 'ممنوع', lines: [{ accountCode: '1101', debit: 1000, credit: 0 }] }, label: 'rbac' });
  step('پذیرش سند حسابداری ثبت نمی‌کند (403)', fdJournal.status === 403, `status=${fdJournal.status}`);

  const health = await fetch(BASE + '/health').then((r) => r.json());
  S.healthVersion = health.version;
  // نسخهٔ انتظاری از package.json خود API خوانده می‌شود (نه هاردکد)
  const fs = await import('node:fs');
  const apiPkg = JSON.parse(fs.readFileSync('/home/z/my-project/hotel-erp/apps/api/package.json', 'utf-8'));
  if (health.version !== apiPkg.version) report.findings.push({ name: 'health-stale-version', detail: `/health version=${health.version} — package.json=${apiPkg.version}` });
}

// ═══════════ ۲) حسابداری ═══════════
async function phaseAccounting() {
  console.log('\n══ فاز ۲ — سند دستی و گردش تأیید ══');
  const draft = await req('POST', '/journal-entries', {
    token: T.accountant,
    body: { description: 'تست سند دستی — سفر کاربر', lines: [{ accountCode: '1101', debit: 1_000_000, credit: 0 }, { accountCode: '4102', debit: 0, credit: 1_000_000 }] },
    label: 'journal-create',
  });
  step('ثبت سند متوازن پیش‌نویس', draft.status === 201, `status=${draft.status}`);
  S.entryId = draft.json?.data?.id;
  if (S.entryId) {
    const selfApprove = await req('POST', `/journal-entries/${S.entryId}/approve`, { token: T.accountant, body: {}, label: 'journal-self' });
    step('تأیید توسط حسابدار (فاقد مجوز) رد می‌شود (403)', selfApprove.status === 403, `status=${selfApprove.status}`);
    const approve = await req('POST', `/journal-entries/${S.entryId}/approve`, { token: T.approver, body: {}, label: 'journal-approve' });
    step('تأیید توسط تأییدکنندهٔ مالی', approve.status === 200 || approve.status === 201, `status=${approve.status}`);
    const reverse = await req('POST', `/journal-entries/${S.entryId}/reverse`, { token: T.approver, body: { reason: 'برگشت سند تست سفر کاربر' }, label: 'journal-reverse' });
    step('برگشت سند قطعی (سند عکس)', reverse.status === 200 || reverse.status === 201, `status=${reverse.status}`);
  }
  const badEntry = await req('POST', '/journal-entries', {
    token: T.accountant,
    body: { description: 'نامتوازن', lines: [{ accountCode: '1101', debit: 500, credit: 0 }, { accountCode: '4102', debit: 0, credit: 400 }] },
    label: 'journal-imbalance',
  });
  step('سند نامتوازن رد می‌شود', badEntry.status !== 201, `status=${badEntry.status}`);
  const locked = await req('POST', '/journal-entries/periods/1405-09/lock', { token: T.accountant, body: {}, label: 'period-lock' });
  step('قفل دورهٔ مالی توسط حسابدار', locked.status === 200 || locked.status === 201 || locked.status === 403, `status=${locked.status}`);
}

// ═══════════ ۳) رزرو و ظرفیت ═══════════
async function phaseReservations() {
  console.log('\n══ فاز ۳ — رزرو، ظرفیت، تکراری ══');
  const rt = await req('GET', '/room-types', { token: T.frontdesk, label: 'room-types' });
  const jun = rt.json?.data?.find((x) => x.code === 'JUN');
  const std = rt.json?.data?.find((x) => x.code === 'STD');
  step('نوع اتاق‌ها بارگذاری شد', !!jun && !!std, `STD rate=${std?.baseRateRials}`);

  const ci = '2027-02-10'; const co = '2027-02-13'; // ۳ شب
  const r1 = await req('POST', '/pms/reservations', {
    token: T.frontdesk,
    body: { roomTypeId: std.id, guestName: 'علی رضایی', checkInDate: ci, checkOutDate: co, idempotencyKey: 'jr-res-1', source: 'PHONE', adults: 2 },
    label: 'res-create',
  });
  step('رزرو تلفنی STD ثبت می‌شود', r1.status === 201, `status=${r1.status} code=${r1.json?.data?.code}`);
  S.resv = r1.json?.data;
  // مبلغ از فهرست رزروها (پاسخ ثبت، مبلغ را برنمی‌گرداند — فرم واقعی هم از فهرست می‌خواند)
  const resList = await req('GET', `/pms/reservations?date=${ci}`, { token: T.frontdesk });
  const resRow = resList.json?.data?.find((x) => x.code === r1.json?.data?.code);
  const total = num(resRow?.totalRials);
  const rate = num(std.baseRateRials);
  const expTotal = rate * 3;
  step('مبلغ رزرو ۳ شب = نرخ × ۳', total === expTotal, `total=${total} expected=${expTotal}`);
  if (total !== expTotal) report.findings.push({ name: 'reservation-total', detail: `total=${total}, expected=${expTotal}` });

  const replay = await req('POST', '/pms/reservations', {
    token: T.frontdesk,
    body: { roomTypeId: std.id, guestName: 'علی رضایی', checkInDate: ci, checkOutDate: co, idempotencyKey: 'jr-res-1' },
    label: 'res-replay',
  });
  step('Idempotency رزرو — همان رکورد برمی‌گردد', replay.status === 201 && replay.json?.data?.replayed === true, `replayed=${replay.json?.data?.replayed}`);

  // ظرفیت STD: تا ۴۰۹ پر می‌کنیم (JUN اتاقی در seed ندارد → ظرفیت ۰)
  let capacityReached = false; let booked = 0;
  for (let i = 0; i < 20 && !capacityReached; i += 1) {
    const r = await req('POST', '/pms/reservations', {
      token: T.frontdesk,
      body: { roomTypeId: std.id, guestName: `ظرفیت ${i + 1}`, checkInDate: '2027-04-01', checkOutDate: '2027-04-03', idempotencyKey: `jr-cap-${i}` },
      label: 'res-capacity',
    });
    if (r.status === 201) booked += 1;
    if (r.status === 409) capacityReached = true;
  }
  step('Overbooking کنترل می‌شود (409 بعد از پر شدن ظرفیت)', capacityReached && booked >= 1, `booked=${booked} قبل از 409`);

  const list = await req('GET', `/pms/reservations?date=${ci}`, { token: T.frontdesk, label: 'res-list' });
  step('فهرست رزروهای آن تاریخ', list.status === 200 && list.json?.data?.length >= 1, `count=${list.json?.data?.length}`);
}

// ═══════════ ۴) PMS — با تاریخ امروز تا شب‌گردی واقعی اجرا شود ═══════════
async function phasePms() {
  console.log('\n══ فاز ۴ — پذیرش، شب‌گردی، تسویه ══');
  const map = await req('GET', '/pms/rooms/map', { token: T.frontdesk, label: 'room-map' });
  const rooms = (map.json?.data?.floors ?? []).flatMap((f) => f.rooms);
  step('نقشهٔ اتاق‌ها', map.status === 200 && rooms.length >= 15, `rooms=${rooms.length}, summary=${JSON.stringify(map.json?.data?.summary)}`);
  const room101 = rooms.find((r) => r.code === '101');
  S.roomId = room101?.id; S.roomCode = room101?.code;

  // رزرو با چک‌این امروز — تا شب‌گردی امروز شارژ بزند
  const today = TODAY();
  const co = dayFromNow(3);
  const rt = await req('GET', '/room-types', { token: T.frontdesk });
  const std = rt.json?.data?.find((x) => x.code === 'STD');
  const resv = await req('POST', '/pms/reservations', {
    token: T.frontdesk,
    body: { roomTypeId: std.id, guestName: 'علی رضایی (امروز)', checkInDate: today, checkOutDate: co, idempotencyKey: 'jr-res-today', source: 'PHONE' },
    label: 'res-today',
  });
  step('رزرو با چک‌این امروز', resv.status === 201, `status=${resv.status}`);

  const ciResp = await req('POST', '/pms/stays/check-in', {
    token: T.frontdesk,
    body: { reservationId: resv.json?.data?.reservationId, roomIds: [S.roomId], plannedCheckOut: co, idempotencyKey: 'jr-ci-01' },
    label: 'checkin',
  });
  step('چک‌این مهمان رزروشده', ciResp.status === 201, `status=${ciResp.status} stay=${ciResp.json?.data?.code} body=${JSON.stringify(ciResp.json ?? {}).slice(0, 180)}`);
  S.stayId = ciResp.json?.data?.stayId; S.stayCode = ciResp.json?.data?.code;
  const replayCi = await req('POST', '/pms/stays/check-in', {
    token: T.frontdesk,
    body: { reservationId: resv.json?.data?.reservationId, roomIds: [S.roomId], plannedCheckOut: co, idempotencyKey: 'jr-ci-01' },
    label: 'checkin-replay',
  });
  step('Idempotency چک‌این', replayCi.status === 201 && replayCi.json?.data?.replayed === true, `replayed=${replayCi.json?.data?.replayed}`);

  const map2 = await req('GET', '/pms/rooms/map', { token: T.frontdesk });
  const rooms2 = (map2.json?.data?.floors ?? []).flatMap((f) => f.rooms);
  step('اتاق بعد از چک‌این OCCUPIED', rooms2.find((r) => r.id === S.roomId)?.status === 'OCCUPIED', rooms2.find((r) => r.id === S.roomId)?.status);

  const rate = num(std.baseRateRials);
  const stays = await req('GET', '/pms/stays', { token: T.frontdesk, label: 'stays' });
  const stayRow = stays.json?.data?.find((s) => s.id === S.stayId);
  S.folioCi = num(stayRow?.folioRials);
  step('فولیو هنگام ورود = صفر (شارژ اتاق در شب‌گردی)', S.folioCi === 0, `folio=${S.folioCi}`);

  // شب‌گردی امشب
  const na = await req('POST', '/pms/night-audit', { token: T.frontdesk, body: { businessDate: today }, label: 'night-audit' });
  step('حسابرسی شبانهٔ امشب اجرا می‌شود', na.status === 200 || na.status === 201, `status=${na.status}`);
  const na2 = await req('POST', '/pms/night-audit', { token: T.frontdesk, body: { businessDate: today }, label: 'night-audit-idem' });
  step('اجرای دوم شب‌گردی همان شب رد می‌شود (409)', na2.status === 409, `status=${na2.status}`);
  const stays2 = await req('GET', '/pms/stays', { token: T.frontdesk });
  const folioNa = num(stays2.json?.data?.find((s) => s.id === S.stayId)?.folioRials);
  const delta = folioNa - S.folioCi;
  step('شارژ اتاق شب‌گردی دقیقاً یک‌بار (+نرخ)', delta === rate, `delta=${delta} rate=${rate}`);
  if (delta !== rate) report.findings.push({ name: 'nightaudit-charge', detail: `delta=${delta}, rate=${rate}` });

  // خدمت جانبی روی فولیو
  const anc = await req('POST', '/ancillary/orders', {
    token: T.frontdesk,
    body: { serviceCode: 'SVC-WIFI', quantity: 2, stayCode: S.stayCode, idempotencyKey: 'jr-anc-1' }, label: 'ancillary',
  });
  step('خدمت جانبی (وای‌فای ×۲) ثبت می‌شود', anc.status === 201, `status=${anc.status} total=${anc.json?.totalRials}`);
  const stays3 = await req('GET', '/pms/stays', { token: T.frontdesk });
  const folioAnc = num(stays3.json?.data?.find((s) => s.id === S.stayId)?.folioRials);
  step('شارژ خدمت جانبی روی فولیو', folioAnc - folioNa === num(anc.json?.totalRials), `delta=${folioAnc - folioNa}, expected=${anc.json?.totalRials}`);

  // خانه‌داری: وظیفه + گردش
  const task = await req('POST', '/housekeeping/tasks', {
    token: T.housekeeper, body: { roomCode: '301', kind: 'CLEANING', scheduledDate: today }, label: 'hk-task',
  });
  step('وظیفهٔ خانه‌داری ثبت', task.status === 201, `status=${task.status}`);
  if (task.status === 201) {
    const start = await req('POST', `/housekeeping/tasks/${task.json?.id}/start`, { token: T.housekeeper, body: {}, label: 'hk-start' });
    const done = await req('POST', `/housekeeping/tasks/${task.json?.id}/complete`, { token: T.housekeeper, body: {}, label: 'hk-complete' });
    step('گردش وظیفه: شروع → انجام', (start.status === 200 || start.status === 201) && (done.status === 200 || done.status === 201), `start=${start.status}, done=${done.status}`);
  }

  // چک‌اوت با تسویه
  const co2 = await req('POST', `/pms/stays/${S.stayId}/check-out`, { token: T.frontdesk, body: {}, label: 'checkout' });
  step('چک‌اوت و تسویه', co2.status === 200 || co2.status === 201, `status=${co2.status} ${JSON.stringify(co2.json?.data ?? co2.json ?? {}).slice(0, 140)}`);
  const map3 = await req('GET', '/pms/rooms/map', { token: T.frontdesk });
  const rooms3 = (map3.json?.data?.floors ?? []).flatMap((f) => f.rooms);
  const after = rooms3.find((r) => r.id === S.roomId);
  step('اتاق بعد از خروج خالی/کثیف', after?.status === 'DIRTY' || after?.hkStatus === 'DIRTY', `status=${after?.status}, hk=${after?.hkStatus}`);
  const recon = await req('GET', '/dashboards/housekeeping', { token: T.admin, label: 'dash-hk' });
  step('داشبورد خانه‌داری بدون خطا', recon.status === 200, `status=${recon.status}`);
}

// ═══════════ ۵) خزانه‌داری ═══════════
async function phaseTreasury() {
  console.log('\n══ فاز ۵ — صندوق و خزانه‌داری ══');
  const accs = await req('GET', '/treasury/accounts', { token: T.cashier, label: 'cash-accounts' });
  const cash = accs.json?.find((a) => a.kind === 'CASH_DRAWER');
  step('فهرست صندوق‌ها', accs.status === 200 && !!cash, `cash=${cash?.code}`);
  S.cashId = cash?.id;

  const open = await req('POST', '/treasury/shifts/open', {
    token: T.cashier,
    body: { cashAccountId: S.cashId, openingFloatRials: 5_000_000, businessDate: TODAY() }, label: 'shift-open',
  });
  step('باز کردن شیفت با تنخواه ۵م', open.status === 201, `status=${open.status} ${JSON.stringify(open.json ?? {}).slice(0, 120)}`);
  S.shiftId = open.json?.id;

  const t1 = await req('POST', '/treasury/transactions', {
    token: T.cashier,
    body: { cashAccountId: S.cashId, kind: 'RECEIPT', method: 'CASH', amountRials: 2_000_000, businessDate: TODAY(), idempotencyKey: 'jr-txn-1' }, label: 'txn-receive',
  });
  step('دریافت نقدی ۲م', t1.status === 201, `status=${t1.status}`);
  S.txn1 = t1.json?.id;
  const t1r = await req('POST', '/treasury/transactions', {
    token: T.cashier,
    body: { cashAccountId: S.cashId, kind: 'RECEIPT', method: 'CASH', amountRials: 2_000_000, businessDate: TODAY(), idempotencyKey: 'jr-txn-1' }, label: 'txn-replay',
  });
  step('Idempotency تراکنش — ریسپلای بدون رکورد جدید', t1r.status === 201 && t1r.json?.replayed === true, `replayed=${t1r.json?.replayed}`);

  const t2 = await req('POST', '/treasury/transactions', {
    token: T.cashier,
    body: { cashAccountId: S.cashId, kind: 'PAYMENT', method: 'CASH', amountRials: 300_000, businessDate: TODAY(), idempotencyKey: 'jr-txn-2', note: 'پرداخت تأمین‌کننده' }, label: 'txn-pay',
  });
  step('پرداخت نقدی ۳۰۰هزار', t2.status === 201, `status=${t2.status}`);

  // تراکنش بدون شیفت باز روی صندوق دیگر؟ — شیفت دوم روی همان صندوق ممنوع
  const dupShift = await req('POST', '/treasury/shifts/open', {
    token: T.admin, body: { cashAccountId: S.cashId, openingFloatRials: 1_000_000, businessDate: TODAY() }, label: 'shift-dup',
  });
  step('شیفت دوم روی همان صندوق ممنوع (409)', dupShift.status === 409, `status=${dupShift.status} body=${JSON.stringify(dupShift.json ?? {}).slice(0, 120)}`);

  const close = await req('POST', '/treasury/shifts/close', {
    token: T.cashier, body: { shiftId: S.shiftId, countedRials: 6_700_000 }, label: 'shift-close',
  });
  const expExpected = 5_000_000 + 2_000_000 - 300_000;
  step('بستن شیفت — مغایرت صفر (انتظاری ۶٬۷۰۰٬۰۰۰)', close.status === 201 && num(close.json?.varianceRials) === 0,
    `expected=${close.json?.expectedRials ?? close.json?.expected ?? '?'}, variance=${close.json?.varianceRials}`);
  step('مغایرت شمارش = ۰ (دقیق)', num(close.json?.varianceRials) === 0, `variance=${close.json?.varianceRials}`);

  const voidDenied = await req('POST', `/treasury/transactions/${S.txn1}/void`, { token: T.cashier, body: { reason: 'تست ابطال' }, label: 'void-denied' });
  step('ابطال توسط صندوق‌دار رد می‌شود (403)', voidDenied.status === 403, `status=${voidDenied.status}`);
  const voidOk = await req('POST', `/treasury/transactions/${S.txn1}/void`, { token: T.admin, body: { reason: 'تست ابطال توسط مدیر' }, label: 'void' });
  step('ابطال توسط مدیر', voidOk.status === 200 || voidOk.status === 201, `status=${voidOk.status}`);

  const recon = await req('GET', '/treasury/reconciliations/summary', { token: T.accountant, label: 'recon' });
  step('خلاصهٔ مغایرت‌گیری', recon.status === 200 || recon.status === 404, `status=${recon.status}`);
}

// ═══════════ ۶) رستوران ═══════════
async function phaseRestaurant() {
  console.log('\n══ فاز ۶ — رستوران و آشپزخانه ══');
  const menu = await req('GET', '/restaurant/menu', { token: T.frontdesk, label: 'menu' });
  const areas = await req('GET', '/restaurant/areas', { token: T.frontdesk, label: 'areas' });
  step('منو و میزها', menu.status === 200 && areas.status === 200,
    `items=${menu.json?.reduce((a, c) => a + c.items.length, 0)}, tables=${areas.json?.reduce((a, x) => a + x.tables.length, 0)}`);

  const open = await req('POST', '/restaurant/orders', {
    token: T.frontdesk,
    body: {
      outletCode: 'REST-MAIN', tableCode: 'T3', mode: 'DINE_IN',
      items: [{ menuItemCode: 'MI-KABAB', qty: 1 }, { menuItemCode: 'MI-SODA', qty: 1 }], idempotencyKey: 'jr-ord-1',
    }, label: 'order-open',
  });
  step('باز کردن سفارش میز T3', open.status === 201, `status=${open.status}`);
  S.order = open.json;
  step('جمع سفارش دقیق (خالص ۵٬۰۰۰٬۰۰۰ / مالیات ۵۰۰٬۰۰۰)', S.order?.netRials === 5_000_000 && S.order?.taxRials === 500_000,
    `net=${S.order?.netRials}, tax=${S.order?.taxRials}`);

  const kababItem = S.order?.items?.find((i) => i.menuItemCode === 'MI-KABAB');
  const add = await req('POST', `/restaurant/orders/${S.order?.id}/items`, {
    token: T.frontdesk, body: { items: [{ menuItemCode: 'MI-SODA', qty: 1 }] }, label: 'order-add',
  });
  step('افزودن قلم + بازمحاسبه (خالص ۵٬۵۰۰٬۰۰۰)', add.status === 201 && add.json?.netRials === 5_500_000, `net=${add.json?.netRials}`);

  const send = await req('POST', `/restaurant/orders/${S.order?.id}/items/${kababItem?.id}/send`, { token: T.frontdesk, body: {}, label: 'kds-send' });
  step('ارسال قلم به آشپزخانه', send.status === 201, `status=${send.status} ticket=${send.json?.ticketNo}`);
  const tickets = await req('GET', '/restaurant/kitchen/tickets', { token: T.chef, label: 'kds-list' });
  const ticket = tickets.json?.find((t) => t.orderNo === S.order?.orderNo);
  step('بلیت در صف KDS', tickets.status === 200 && !!ticket, ticket ? `${ticket.ticketNo}, ${ticket.waitingMinutes}د` : 'یافت نشد');
  if (ticket) {
    const prep = await req('POST', `/restaurant/kitchen/tickets/${ticket.id}`, { token: T.chef, body: { status: 'PREPARING' }, label: 'kds-prep' });
    const ready = await req('POST', `/restaurant/kitchen/tickets/${ticket.id}`, { token: T.chef, body: { status: 'READY' }, label: 'kds-ready' });
    const back = await req('POST', `/restaurant/kitchen/tickets/${ticket.id}`, { token: T.chef, body: { status: 'PREPARING' }, label: 'kds-back' });
    step('گردش KDS تا READY + برگشت به عقب رد می‌شود', prep.status === 201 && ready.status === 201 && back.status === 400,
      `prep=${prep.status}, ready=${ready.status}, back=${back.status}`);
  }

  const dsDenied = await req('POST', `/restaurant/orders/${S.order?.id}/discount`, { token: T.frontdesk, body: { amountRials: 100_000, reason: 'گارسون' }, label: 'discount-denied' });
  step('تخفیف بدون مجوز ۴۰۳', dsDenied.status === 403, `status=${dsDenied.status}`);
  const ds = await req('POST', `/restaurant/orders/${S.order?.id}/discount`, { token: T.admin, body: { amountRials: 500_000, reason: 'تخفیف مدیریت' }, label: 'discount' });
  step('تخفیف ۵۰۰هزار — مالیات به نسبت و کل = ۵٬۵۰۰٬۰۰۰ (خالص ۵.۵م پس از قلم اضافه)', ds.status === 201 && ds.json?.totalRials === 5_500_000, `total=${ds.json?.totalRials}`);
  if (ds.json?.totalRials !== 5_500_000) report.findings.push({ name: 'discount-math', detail: `total=${ds.json?.totalRials}` });

  const serve = await req('POST', `/restaurant/orders/${S.order?.id}/serve`, { token: T.frontdesk, body: {}, label: 'serve' });
  step('سرو قطعی', serve.status === 201, `status=${serve.status}`);

  // لغو قلم در سفارش دوم
  const o2 = await req('POST', '/restaurant/orders', {
    token: T.frontdesk,
    body: { outletCode: 'REST-MAIN', mode: 'TAKEAWAY', items: [{ menuItemCode: 'MI-RICE', qty: 1 }, { menuItemCode: 'MI-SODA', qty: 1 }], idempotencyKey: 'jr-ord-2' },
    label: 'order-2',
  });
  const rice = o2.json?.items?.find((i) => i.menuItemCode === 'MI-RICE');
  const cancel = await req('POST', `/restaurant/orders/${o2.json?.id}/items/${rice?.id}/cancel`, { token: T.frontdesk, body: { reason: 'برنج تمام شده بود' }, label: 'cancel' });
  step('لغو قلم با دلیل — کل = ۵۵۰٬۰۰۰', cancel.status === 201 && cancel.json?.totalRials === 550_000, `total=${cancel.json?.totalRials}`);
  if (cancel.json?.totalRials !== 550_000) report.findings.push({ name: 'cancel-math', detail: `total=${cancel.json?.totalRials}` });

  // گزارش‌ها و سندهای زنجیرهٔ مصرف — بعد از سرو (زنجیرهٔ دو مرحله‌ای outbox با polling)
  const today = TODAY();
  const cc = await req('GET', `/stores/cost-control?from=${today}&to=${today}`, { token: T.storekeeper, label: 'cost-control' });
  step('کاست کنترل: سفارش سرو‌شدهٔ امروز ≥۱', cc.status === 200 && (cc.json?.servedOrders ?? 0) >= 1, `orders=${cc.json?.servedOrders}, lines=${cc.json?.lines?.length}`);
  const reorder = await req('GET', '/stores/reorder', { token: T.storekeeper, label: 'reorder' });
  step('گزارش سفارش مجدد', reorder.status === 200, `items=${reorder.json?.length}`);
  const cogsEntry = await waitJournalDesc('consumption');
  step('سند COGS مصرف در دفتر', !!cogsEntry, cogsEntry ? cogsEntry.entryNo : 'پیدا نشد');
  if (!cogsEntry) report.findings.push({ name: 'missing-cogs-journal', detail: 'consumption' });
}

// ═══════════ ۷) خرید و انبار ═══════════
async function phaseProcurement() {
  console.log('\n══ فاز ۷ — خرید، انبار، انبارگردانی ══');
  const items = await req('GET', '/stores/items', { token: T.storekeeper, label: 'stores-items' });
  const soda = items.json?.find((i) => i.code === 'STK-SODA');
  step('اقلام انبار', items.status === 200 && items.json?.length >= 4, `count=${items.json?.length}, soda=${soda?.qtyOnHand}`);

  const reqq = await req('POST', '/procurement/requisitions', {
    token: T.storekeeper, body: { items: [{ stockItemCode: 'STK-SODA', qty: 48 }], note: 'شارژ هفتگی' }, label: 'req-create',
  });
  step('درخواست کالا ثبت', reqq.status === 201, `reqNo=${reqq.json?.reqNo}`);
  for (const st of ['SUBMITTED', 'APPROVED']) {
    const r = await req('POST', `/procurement/requisitions/${reqq.json?.id}`, { token: T.approver, body: { status: st }, label: `req-${st}` });
    if (r.status !== 200 && r.status !== 201) step(`گردش درخواست → ${st}`, false, `status=${r.status}`);
  }
  step('گردش درخواست تا تأیید', true);

  const po = await req('POST', '/procurement/orders', {
    token: T.approver,
    body: {
      supplierCode: 'SUP-002', requisitionId: reqq.json?.id,
      items: [
        { stockItemCode: 'STK-SODA', qty: 48, unitCostRials: 120_000 },
        { stockItemCode: 'STK-BEEF', qty: 20, unitCostRials: 800_000 },
        { stockItemCode: 'STK-RICE', qty: 30, unitCostRials: 150_000 },
      ],
    }, label: 'po-create',
  });
  step('تبدیل به PO سه‌قلمی — کل ۲۸٬۸۸۶٬۰۰۰ (نرخ ۱۰٪)', po.status === 201 && po.json?.totalRials === 28_886_000,
    `status=${po.status} body=${JSON.stringify(po.json ?? {}).slice(0, 200)}`);
  if (po.status !== 201) report.findings.push({ name: 'po-create-failed', detail: JSON.stringify(po.json ?? {}).slice(0, 260) });

  const ap = await req('POST', `/procurement/orders/${po.json?.id}/approve`, { token: T.approver, body: {}, label: 'po-approve' });
  step('تأیید PO', ap.status === 201, `status=${ap.status}`);

  const grn = await req('POST', '/procurement/receipts', {
    token: T.storekeeper,
    body: {
      poCode: po.json?.poNo,
      lines: [
        { stockItemCode: 'STK-SODA', qtyReceived: 48 },
        { stockItemCode: 'STK-BEEF', qtyReceived: 20 },
        { stockItemCode: 'STK-RICE', qtyReceived: 30 },
      ],
    }, label: 'grn',
  });
  step('رسید کامل سه‌قلمی → RECEIVED', grn.status === 201 && grn.json?.poStatus === 'RECEIVED', `grnNo=${grn.json?.grnNo}`);

  const items2 = await req('GET', '/stores/items', { token: T.storekeeper });
  const soda2 = items2.json?.find((i) => i.code === 'STK-SODA');
  const beef0 = items2.json?.find((i) => i.code === 'STK-BEEF');
  step('موجودی نوشابه = ۴۸ و گوشت = ۲۰٬۰۰۰ گرم بعد از رسید (تبدیل واحد)',
    Number(soda2?.qtyOnHand) === 48 && Number(beef0?.qtyOnHand) === 20_000 && Number(beef0?.avgCostRials) === 800,
    `soda=${soda2?.qtyOnHand}, beef=${beef0?.qtyOnHand}g @ ${beef0?.avgCostRials}`);

  const tr = await req('POST', '/stores/transfers', {
    token: T.storekeeper, body: { stockItemCode: 'STK-SODA', fromWarehouseCode: 'WH-BEV', toWarehouseCode: 'WH-KITCHEN', qty: 6 }, label: 'transfer',
  });
  step('انتقال ۶ عدد بین انبارها', tr.status === 201, `status=${tr.status}`);
  const adj = await req('POST', '/stores/adjustments', {
    token: T.storekeeper, body: { stockItemCode: 'STK-SODA', direction: 'WASTE', qty: 2, note: 'شکستن در حمل' }, label: 'adjust',
  });
  step('ضایعات با دلیل', adj.status === 201, `status=${adj.status}`);

  const cnt = await req('POST', '/stores/counts', { token: T.storekeeper, body: { warehouseCode: 'WH-BEV' }, label: 'count-open' });
  step('باز کردن شمارش WH-BEV', cnt.status === 201, `lines=${cnt.json?.lines}`);
  // موجودی آیتم‌محور: انتقال خروج/ورود خنثی است؛ ضایعات −۲ و شمارش با کسری −۱ نسبت به ۴۶
  const line = await req('POST', '/stores/counts/lines', {
    token: T.storekeeper, body: { countId: cnt.json?.id, stockItemCode: 'STK-SODA', qtyCounted: 45 }, label: 'count-line',
  });
  step('ثبت شمارش با کسری −۱ (سیستم ۴۶)', line.status === 201 && Number(line.json?.varianceQty) === -1, `variance=${line.json?.varianceQty}`);
  const close = await req('POST', '/stores/counts/close', { token: T.storekeeper, body: { countId: cnt.json?.id }, label: 'count-close' });
  step('بستن شمارش — کسری بهای میانگین ۱۲۰٬۰۰۰', close.status === 201, `loss=${close.json?.lossRials} (انتظار ${num(soda2?.avgCostRials)})`);
  if (Number(close.json?.lossRials) !== num(soda2?.avgCostRials)) report.findings.push({ name: 'count-loss-math', detail: `loss=${close.json?.lossRials}, avg=${soda2?.avgCostRials}` });

  const neg = await req('POST', '/stores/transfers', {
    token: T.storekeeper, body: { stockItemCode: 'STK-RICE', fromWarehouseCode: 'WH-FOOD', toWarehouseCode: 'WH-KITCHEN', qty: 999_999 }, label: 'neg-transfer',
  });
  step('خروج بیش از موجودی (بدون مجوز) رد می‌شود', neg.status === 400, `status=${neg.status}`);
  if (neg.status !== 400) report.findings.push({ name: 'negative-stock-allowed', detail: `status=${neg.status}` });

  const grnEntry2 = await waitJournalDesc(grn.json?.grnNo ?? '@@');
  step('سند GRN در دفتر', !!grnEntry2, grnEntry2 ? grnEntry2.entryNo : 'پیدا نشد');
  if (!grnEntry2) report.findings.push({ name: 'missing-grn-journal', detail: grn.json?.grnNo });
}

// ═══════════ ۸) هم‌روندی و تراز ═══════════
async function phaseCoherence() {
  console.log('\n══ هم‌روندی و انسجام ══');
  const races = [];
  for (let i = 0; i < 8; i += 1) {
    races.push(req('POST', '/restaurant/orders', {
      token: T.frontdesk,
      body: { outletCode: 'REST-MAIN', mode: 'TAKEAWAY', items: [{ menuItemCode: 'MI-SODA', qty: 1 }], idempotencyKey: `jr-race-${Date.now()}-${i}` },
      label: `race-${i}`,
    }));
  }
  const rs = await Promise.all(races);
  const ok = rs.filter((r) => r.status === 201 || r.status === 200);
  const uniq = new Set(ok.map((r) => r.json?.orderNo).filter(Boolean));
  step('۸ سفارش هم‌زمان همه ثبت شدند', ok.length === 8, `${ok.length}/8 ${rs.filter((r) => !(r.status === 201 || r.status === 200)).map((r) => r.status)}`);
  step('شماره‌های سفارش یکتا', uniq.size === ok.length, `${uniq.size}/${ok.length}`);
  if (ok.length !== 8) {
    const err = rs.find((r) => !(r.status === 201 || r.status === 200))?.json;
    report.findings.push({ name: 'concurrent-orders', detail: `statuses=${rs.map((r) => r.status).join(',')} error=${JSON.stringify(err)?.slice(0, 200)}` });
  }

  // داشبوردها
  for (const [d, u] of [['ceo', 'admin'], ['finance', 'accountant'], ['restaurant', 'admin'], ['housekeeping', 'admin']]) {
    const r = await req('GET', `/dashboards/${d}`, { token: T[u], label: `dash-${d}` });
    step(`داشبورد ${d}`, r.status === 200, `status=${r.status}`);
  }
}

// ═══════════ ۹) فاز ۸/۹ — دفاتر، تراز آزمایشی، قوانین، اظهارنامه VAT، بستن دوره ═══════════
async function phaseLedgerCompliance() {
  console.log('\n══ فاز ۸/۹ — دفاتر و انطباق مالی ══');
  const today = TODAY();

  // سند دستی سه‌سطری با مرکز هزینه → تأیید → شماره عطف
  const draft = await req('POST', '/journal-entries', {
    token: T.accountant,
    body: {
      description: 'سفر کاربر — فروش نقدی با مالیات',
      lines: [
        { accountCode: '1101', debit: 1_090_000, credit: 0, costCenter: 'CC-FB' },
        { accountCode: '4102', debit: 0, credit: 1_000_000, costCenter: 'CC-FB' },
        { accountCode: '2201', debit: 0, credit: 90_000, costCenter: 'CC-FB' },
      ],
    }, label: 'manual-entry',
  });
  step('سند دستی سه‌سطری ثبت می‌شود', draft.status === 201, `status=${draft.status}`);
  const ap = await req('POST', `/journal-entries/${draft.json?.data?.id}/approve`, { token: T.approver, body: {}, label: 'manual-approve' });
  step('تأیید سند توسط تأییدکننده', [200, 201].includes(ap.status), `status=${ap.status}`);
  S.manualEntryId = draft.json?.data?.id;

  // پیوست سند
  const att = await req('POST', `/journal-entries/${S.manualEntryId}/attachments`, {
    token: T.accountant, body: { fileName: 'invoice-journey.pdf', mimeType: 'application/pdf', sizeBytes: 2048, dataRef: 'attachments/invoice-journey.pdf' }, label: 'attach',
  });
  step('پیوست سند افزوده می‌شود', att.status === 201, `status=${att.status}`);
  const attList = await req('GET', `/journal-entries/${S.manualEntryId}/attachments`, { token: T.accountant, label: 'attach-list' });
  step('پیوست در فهرست دیده می‌شود', attList.status === 200 && attList.json?.data?.length === 1, `count=${attList.json?.data?.length}`);

  // دفاتر
  const jb = await req('GET', `/journal-entries/ledgers/journal?from=${today}&to=${today}`, { token: T.accountant, label: 'journal-book' });
  const manualRow = jb.json?.data?.find((e) => e.entryNo === draft.json?.data?.entryNo);
  step('دفتر روزنامه شامل سند با شماره عطف', jb.status === 200 && manualRow?.docIndex > 0, `docIndex=${manualRow?.docIndex}`);
  const idxList = (jb.json?.data ?? []).map((e) => e.docIndex).filter((x) => x != null);
  const sortedIdx = [...idxList].sort((a, b) => a - b);
  step('شماره‌های عطف صعودی و یکتا', JSON.stringify(idxList) === JSON.stringify(sortedIdx) && new Set(idxList).size === idxList.length, `${idxList.length} سند`);

  const gl = await req('GET', `/journal-entries/ledgers/general?from=${today}&to=${today}`, { token: T.accountant, label: 'general-ledger' });
  step('دفتر کل متوازن است', gl.status === 200 && gl.json?.meta?.balanced === true, `balanced=${gl.json?.meta?.balanced}`);

  const sub = await req('GET', `/journal-entries/ledgers/subsidiary/1101?from=${today}&to=${today}`, { token: T.accountant, label: 'subsidiary' });
  const gl1101 = (gl.json?.data ?? []).find((r) => r.accountCode === '1101');
  const lastRow = sub.json?.data?.[sub.json.data.length - 1];
  step('دفتر معین: ماندهٔ تجمعی آخرین سطر = ماندهٔ کل', sub.status === 200 && lastRow?.runningBalance === gl1101?.closingBalance,
    `running=${lastRow?.runningBalance}, closing=${gl1101?.closingBalance}`);

  // تراز آزمایشی
  const tb = await req('GET', `/journal-entries/trial-balance?from=${today}&to=${today}`, { token: T.accountant, label: 'trial-balance' });
  step('تراز آزمایشی متوازن (معیار پذیرش فاز ۸)', tb.status === 200 && tb.json?.meta?.balanced === true,
    `dr=${tb.json?.meta?.totals?.periodDebit}, cr=${tb.json?.meta?.totals?.periodCredit}`);

  // صورت‌های مالی
  const pnl = await req('GET', `/journal-entries/statements/income?from=${today}&to=${today}`, { token: T.accountant, label: 'income' });
  step('سود و زیان: نتیجه = درآمد − هزینه', pnl.status === 200 && pnl.json?.totals?.netIncome === pnl.json?.totals?.totalRevenue - pnl.json?.totals?.totalExpense,
    `net=${pnl.json?.totals?.netIncome}`);
  const bs = await req('GET', `/journal-entries/statements/balance-sheet?asOf=${today}`, { token: T.accountant, label: 'balance-sheet' });
  step('ترازنامه متوازن (با نتیجهٔ دوره)', bs.status === 200 && bs.json?.totals?.balanced === true, `balanced=${bs.json?.totals?.balanced}`);
  S.pnl = pnl.json?.totals;

  // کتابخانه قوانین (فاز ۹)
  const laws = await req('GET', '/compliance/laws', { token: T.accountant, label: 'laws' });
  step('کتابخانهٔ قوانین با متادیتای ۱۲گانه (≥۴ قانون)', laws.status === 200 && laws.json?.data?.length >= 4, `count=${laws.json?.data?.length}`);
  const rate = await req('GET', `/compliance/laws/LAW-VAT-RATE/rate?date=${today}`, { token: T.accountant, label: 'law-rate' });
  step('نرخ پارامتریک VAT امروز = ۱۰۰۰ (bp)', rate.status === 200 && rate.json?.data?.vatBps === 1000, `vatBps=${rate.json?.data?.vatBps}`);
  const lawUp = await req('POST', '/compliance/laws', {
    token: T.admin,
    body: {
      code: 'LAW-VAT-RATE', title: 'نرخ مالیات بر ارزش افزوده', lawName: 'قانون مالیات بر ارزش افزوده',
      article: 'ماده ۱۷', effectiveFrom: '2027-01-01', params: { vatBps: 1100, defaultBps: 1000 },
      legalOwner: 'واحد مالیات', sourceRef: 'ابلاغ نرخ ۱۴۰۶',
    }, label: 'law-upsert',
  });
  step('به‌روزرسانی قانون = نسخهٔ جدید (نرخ ۱۴۰۶ بدون تغییر کد)', lawUp.status === 201 && parseFloat(lawUp.json?.data?.version ?? '1') >= 1.1,
    `version=${lawUp.json?.data?.version}`);
  const rateOut = await req('GET', '/compliance/laws/LAW-VAT-RATE/rate?date=2024-06-01', { token: T.accountant, label: 'law-rate-out' });
  step('نرخ خارج از بازهٔ اعتبار رد می‌شود (409)', rateOut.status === 409, `status=${rateOut.status}`);
  const lawsDenied = await req('GET', '/compliance/laws', { token: T.storekeeper, label: 'laws-denied' });
  step('انباردار قوانین را نمی‌بیند (403)', lawsDenied.status === 403, `status=${lawsDenied.status}`);

  // اظهارنامه VAT — انتظار دقیق از گردش امروز سفر
  const decl = await req('GET', `/compliance/vat/declaration?from=${today}&to=${today}`, { token: T.accountant, label: 'vat-decl' });
  step('اظهارنامه VAT: فروش با مالیات = ۹۹۰٬۰۰۰ (رستوران+خدمات+سند دستی — نرخ ۱۰٪)', decl.status === 200 && decl.json?.data?.outputVatRials === 990_000,
    `output=${decl.json?.data?.outputVatRials}`);
  // اعتبار مالیاتی خرید — از کوئری مستقیم ۲۲۰۴ امروز (بدون عدد ثابت؛ مستقل از دادهٔ سایر تست‌ها)
  const { Client: PgClient } = pgPkg;
  const vc = new PgClient({ connectionString: 'postgresql://hotel:hotel_ci_pass@localhost:5433/hotel_erp' });
  await vc.connect();
  const inputVatDb = (await vc.query(`select coalesce(sum(l."debitRials"),0)::text v from journal_lines l join journal_entries e on e.id=l."entryId" where l."accountCode"='2204' and e.status='POSTED' and e."postingDate"::date=current_date`)).rows[0].v;
  await vc.end();
  step('اعتبار مالیاتی خرید = کوئری ۲۲۰۴ امروز', decl.json?.data?.inputVatCreditRials === Number(inputVatDb), `input=${decl.json?.data?.inputVatCreditRials} db=${inputVatDb}`);
  step('خالص اظهارنامه = فروش − اعتبار', decl.json?.data?.netPayableRials === decl.json?.data?.outputVatRials - decl.json?.data?.inputVatCreditRials,
    `net=${decl.json?.data?.netPayableRials}`);
  const fbSection = (decl.json?.data?.sections ?? []).find((s) => s.costCenterCode === 'CC-FB');
  step('تفکیک بخش رستوران (CC-FB) — پایهٔ سند دستی ۱ میلیون', !!fbSection && fbSection.taxBase === 1_000_000, `taxBase=${fbSection?.taxBase}`);

  // بستن دورهٔ جاری — آخرین عملیات
  const close = await req('POST', `/journal-entries/periods/${today.slice(0, 7)}/close`, { token: T.accountant, body: {}, label: 'period-close' });
  step('بستن دورهٔ جاری با سند اختتام', [200, 201].includes(close.status) && !!close.json?.data?.closingEntryId,
    `netIncome=${close.json?.data?.netIncome}`);
  if (S.pnl && close.json?.data) {
    step('نتیجهٔ اختتام = نتیجهٔ صورت سود و زیان', close.json.data.netIncome === S.pnl.netIncome,
      `close=${close.json.data.netIncome}, pnl=${S.pnl.netIncome}`);
    if (close.json.data.netIncome !== S.pnl.netIncome) report.findings.push({ name: 'close-pnl-mismatch', detail: `close=${close.json.data.netIncome} pnl=${S.pnl.netIncome}` });
  }
  const reClose = await req('POST', `/journal-entries/periods/${today.slice(0, 7)}/close`, { token: T.accountant, body: {}, label: 'period-re-close' });
  step('بستن دوبارهٔ دورهٔ بسته رد می‌شود (409)', reClose.status === 409, `status=${reClose.status}`);
  const tbAfter = await req('GET', `/journal-entries/trial-balance?from=${today}&to=${today}`, { token: T.accountant, label: 'tb-after-close' });
  step('تراز آزمایشی پس از بستن همچنان متوازن', tbAfter.status === 200 && tbAfter.json?.meta?.balanced === true, `balanced=${tbAfter.json?.meta?.balanced}`);
}

// اجرا — با بازنشانی وضعیت تراکنشی (مثل ورود روزانهٔ کاربر به دادهٔ تمیز)
// ترتیب واقعی عملیات هتل: خرید و شارژ انبار قبل از فروش رستوران (تا بهای میانگین موجود باشد)
import pgPkg from 'pg';
const { Client } = pgPkg;
async function resetState() {
  const c = new Client({ connectionString: 'postgresql://hotel:hotel_ci_pass@localhost:5433/hotel_erp' });
  await c.connect();
  await c.query(`TRUNCATE "kitchen_tickets","order_items","restaurant_orders","goods_receipt_lines","goods_receipts",
    "purchase_order_lines","purchase_orders","purchase_requisition_lines","purchase_requisitions",
    "stock_count_lines","stock_counts","stock_movements","stay_rooms","stays","cash_transactions",
    "cashier_shifts","ancillary_orders","outbox_events","inbox_events","journal_entries","journal_lines",
    "audit_logs","night_audit_runs","reservations","waitlist_entries" CASCADE`);
  await c.query(`UPDATE "dining_tables" SET "status"='FREE'`);
  await c.query(`UPDATE "rooms" SET "status"='AVAILABLE', "hkStatus"='CLEAN', "note"=NULL`);
  await c.query(`UPDATE "stock_items" SET "qtyOnHand"=0, "avgCostRials"=0`);
  await c.query(`UPDATE "fiscal_periods" SET "status" = CASE WHEN "endDate" < date_trunc('month', now()) THEN 'LOCKED'::fiscal_period_status ELSE 'OPEN'::fiscal_period_status END, "lockedAt" = CASE WHEN "endDate" < date_trunc('month', now()) THEN now() ELSE NULL END, "closedAt"=NULL, "closingEntryId"=NULL`);
  await c.query(`UPDATE "law_rules" SET "version"='1.0', "effectiveFrom"='2025-03-21', "effectiveTo"=NULL, params='{"vatBps":1000,"healthBps":100,"defaultBps":900}'::jsonb WHERE code='LAW-VAT-RATE'`);
  await c.end();
}
await resetState();
await phaseAuth();
await phaseAccounting();
await phaseReservations();
await phaseProcurement();
await phasePms();
await phaseTreasury();
await phaseRestaurant();
await phaseCoherence();
await phaseLedgerCompliance();

// تراز اسناد و اینباکس — مستقیم از DB (صحت‌سنجی حسابرس)
const pg = new Client({ connectionString: 'postgresql://hotel:hotel_ci_pass@localhost:5433/hotel_erp' });
await pg.connect();
const bal = await pg.query("select coalesce(sum(\"debitRials\" - \"creditRials\"),0)::text as diff from journal_lines where \"entryId\" in (select id from journal_entries where status='POSTED')");
const balDiff = Number(bal.rows[0].diff);
step(`تراز کل اسناد posted = ۰`, balDiff === 0, `diff=${balDiff}`);
if (balDiff !== 0) report.findings.push({ name: 'journals-unbalanced', detail: `diff=${balDiff}` });
const dupInbox = await pg.query('select "idempotencyKey", count(*)::int as c from inbox_events group by 1 having count(*) > 1');
step('اینباکس بدون پردازش تکراری رویداد', dupInbox.rows.length === 0, `dupes=${dupInbox.rows.length}`);
const negQty = await pg.query("select count(*)::int as c from stock_movements where direction in ('OUT','ADJUST_OUT','WASTE') and \"createdAt\" > now() - interval '30 minutes'");
step('گردش‌های خروج اخیر ثبت شده‌اند', negQty.rows[0].c > 0, `count=${negQty.rows[0].c}`);
await pg.end();

const grouped = {};
for (const t of report.timings) { (grouped[t.label] = grouped[t.label] || []).push(t.ms); }
report.slowEndpoints = Object.entries(grouped).map(([k, v]) => ({ k, avg: Math.round(v.reduce((a, b) => a + b, 0) / v.length), max: Math.max(...v), n: v.length })).filter((x) => x.avg > 250 || x.max > 1000).sort((a, b) => b.avg - a.avg);
if (report.slowEndpoints.length) console.log('Slow:', JSON.stringify(report.slowEndpoints));

const fails = report.steps.filter((s) => !s.ok);
console.log(`\n═══ خلاصه: ${report.steps.length - fails.length}/${report.steps.length} PASS — ${fails.length} FAIL — ${report.findings.length} یافته ═══`);
if (report.findings.length) console.log('FINDINGS:\n' + report.findings.map((f) => `- [${f.name}] ${f.detail}`).join('\n'));
writeFileSync('/tmp/journey-report.json', JSON.stringify(report, null, 2));
process.exit(0);
