/**
 * uniq-journey.mjs — تست واقعی کاربر: نیاز یکتایی کارفرما (ثبت مرکزی اشخاص/شرکت‌ها)
 * روی پشتهٔ زندهٔ localhost:3000 — دقیقاً همان جریانی که UI انجام می‌دهد:
 * ثبت مهمان → جستجوی زندهٔ زیررشته‌ای → ثبت دوباره → 409 → اصلاح رکورد قبلی →
 * رزرو با partyId → گیت هویتی چک‌این → تکمیل اطلاعات → اقامت | فروشندهٔ حقوقی | طرف حساب | ارقام فارسی.
 * خروجی: /tmp/uniq-journey-report.json
 */
const BASE = 'http://localhost:3000/api/v1';
const PASSWORD = 'ChangeMe_Str0ng!';
const TOTP_SECRET = 'JBSWY3DPEHPK3PXPE2ETEST';
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

const report = { steps: [], findings: [], startedAt: new Date().toISOString() };
let stepNo = 0;
function step(name, ok, detail = '') {
  stepNo += 1;
  report.steps.push({ n: stepNo, name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} #${stepNo} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) report.findings.push({ name, detail });
}
async function req(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}
const tag = Date.now().toString(36);
/** کد ملی معتبر با رقم کنترل — یکتا در هر اجرا (مثل رفتار کاربر واقعی) */
let genN = 0;
function genMellicode() {
  const base9 = '551' + String(Date.now() % 100000).padStart(5, '0') + String(++genN % 10);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(base9[i]) * (10 - i);
  const r = sum % 11;
  return base9 + String(r < 2 ? r : 11 - r);
}
/** شناسهٔ ملی حقوقی معتبر با رقم کنترل — یکتا در هر اجرا */
function genLegalId() {
  const d = '108' + String(Date.now() % 100000).padStart(5, '0') + String(++genN % 10) + '1'; // ده رقم، dec=آخرین رقم
  const w = [29, 27, 23, 19, 17, 29, 27, 23, 19, 17];
  const dec = Number(d[9]);
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (Number(d[i]) + dec + 2) * w[i];
  let r = sum % 11;
  if (r === 10) r = 0;
  return d + String(r);
}
const MELLI_1 = genMellicode();
const MELLI_FA = genMellicode();
const MELLI_2 = genMellicode();
const LEGAL_RUN = genLegalId();
function genEcon() {
  return '4111' + String(Date.now() % 10000000).padStart(7, '0') + String(++genN % 10);
}
const ECON_RUN = genEcon();
const dayFromNow = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

// ── ورود: پذیرش (کاربر واقعی فرم ثبت مهمان) + مدیر ──
const fdLogin = await req('POST', '/auth/login', { body: { username: 'frontdesk', password: PASSWORD } });
step('ورود کاربر پذیرش (frontdesk)', [200, 201].includes(fdLogin.status), `status=${fdLogin.status}`);
const FD = fdLogin.json?.accessToken;
const adLogin = await req('POST', '/auth/login', { body: { username: 'admin', password: PASSWORD, totp: totp(TOTP_SECRET) } });
step('ورود مدیر (با TOTP)', [200, 201].includes(adLogin.status), `status=${adLogin.status}`);
const AD = adLogin.json?.accessToken;

const noTok = await req('GET', '/parties/search?q=تست');
step('جستجوی ثبت یکتا بدون توکن → 401', noTok.status === 401, `status=${noTok.status}`);

// ── صحنهٔ ۱: ثبت مهمان جدید از فرم رجیستر (پذیرش) ──
const mobile = '0913' + String(4000000 + Math.floor(Math.random() * 999999));
const g1 = await req('POST', '/parties', {
  token: FD,
  body: { kind: 'GUEST', firstName: 'محمود', lastName: `رضوانی${tag}`, nationalId: MELLI_1, mobile, postalCode: '7719175571', address: 'رفسنجان، خیابان فردوسی' },
});
step('ثبت مهمان جدید (کد ملی معتبر + کد پستی ۱۰ رقمی)', g1.status === 201 && g1.json?.data?.id, `status=${g1.status}`);
const guestId = g1.json?.data?.id;

// جستجوی زنده — زیررشته در وسط کلمه (تایپ هر کاراکتر)
const s1 = await req('GET', `/parties/search?q=${encodeURIComponent('ضوا')}`, { token: FD });
step('جستجوی زندهٔ «ضوا» (وسط نام خانوادگی) → پیشنهاد می‌آید', s1.status === 200 && s1.json?.data?.some((p) => p.id === guestId), `hits=${s1.json?.data?.length ?? 0}`);
const MELLI_MID = MELLI_1.slice(3, 8);
const s2 = await req('GET', `/parties/search?q=${MELLI_MID}`, { token: FD });
step('جستجوی زندهٔ رقم‌های میانی کد ملی → پیشنهاد می‌آید', s2.status === 200 && s2.json?.data?.some((p) => p.id === guestId), `hits=${s2.json?.data?.length ?? 0}`);
const s3 = await req('GET', `/parties/search?q=${encodeURIComponent('محمود')}`, { token: FD });
step('جستجوی زندهٔ نام کوچک → پیشنهاد می‌آید', s3.status === 200 && s3.json?.data?.some((p) => p.id === guestId), `hits=${s3.json?.data?.length ?? 0}`);

// ── صحنهٔ ۲: ثبت دوباره با همان کد ملی → مسدود + رکورد قبلی ──
const dup = await req('POST', '/parties', {
  token: FD,
  body: { kind: 'GUEST', firstName: 'علی', lastName: `رضوانی${tag}`, nationalId: MELLI_1, mobile: '09135550001' },
});
step('ثبت دوباره با همان کد ملی → 409 DUPLICATE_PARTY', dup.status === 409 && dup.json?.error?.code === 'DUPLICATE_PARTY', `status=${dup.status}`);
step('بدنهٔ 409 رکورد قبلی را می‌دهد (UI بارگذاری می‌کند)', dup.json?.error?.details?.existing?.id === guestId, `existing=${dup.json?.error?.details?.existing?.id ?? '—'}`);

// ── صحنهٔ ۳: اصلاح رکورد قبلی (PATCH) — نه ثبت دوباره ──
const patch = await req('PATCH', `/parties/${guestId}`, {
  token: FD,
  body: { kind: 'GUEST', firstName: 'محمود', lastName: `رضوانی${tag}`, nationalId: MELLI_1, mobile: '09135550002', postalCode: '7719175572', address: 'رفسنجان، بلوار انقلاب' },
});
step('اصلاح رکورد قبلی با PATCH → 200 (ثبت دوباره رخ نمی‌دهد)', patch.status === 200 && patch.json?.data?.mobile === '09135550002', `status=${patch.status}`);
const cnt = await req('GET', `/parties/search?q=${MELLI_MID}`, { token: FD });
step('پس از اصلاح، فقط یک رکورد با آن کد ملی وجود دارد', cnt.json?.data?.filter((p) => p.nationalId === MELLI_1).length === 1, `count=${cnt.json?.data?.filter((p) => p.nationalId === MELLI_1).length}`);

// ── صحنهٔ ۴: کدهای فیک رد می‌شوند ──
const fake1 = await req('POST', '/parties', { token: FD, body: { kind: 'GUEST', firstName: 'تست', lastName: `فیک${tag}`, nationalId: '1234567890' } });
step('کد ملی با رقم کنترل غلط → 400', fake1.status === 400 && (fake1.json?.error?.message || '').includes('کد ملی'), `status=${fake1.status}`);
const fake2 = await req('POST', '/parties', { token: FD, body: { kind: 'GUEST', firstName: 'تست', lastName: `فیک${tag}`, nationalId: '1111111111' } });
step('کد ملی با ارقام یکسان → 400', fake2.status === 400, `status=${fake2.status}`);
const fake3 = await req('POST', '/parties', { token: AD, body: { kind: 'SUPPLIER', companyName: `فیک حقوقی ${tag}`, natIdentifier: '10100582058' } });
step('شناسهٔ ملی دستکاری‌شده → 400', fake3.status === 400 && (fake3.json?.error?.message || '').includes('شناسهٔ ملی'), `status=${fake3.status}`);
const fake4 = await req('POST', '/parties', { token: FD, body: { kind: 'GUEST', firstName: 'تست', lastName: `فیک${tag}`, postalCode: '771917557' } });
step('کد پستی ۹ رقمی → 400', fake4.status === 400, `status=${fake4.status}`);

// ── صحنهٔ ۵: ارقام فارسی — نرمال‌سازی خودکار ──
const fa = await req('POST', '/parties', {
  token: FD,
  body: { kind: 'GUEST', firstName: 'مهسا', lastName: `عابدی${tag}`, nationalId: MELLI_FA.replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]), mobile: '۰۹۱۳۵۵۵۰۰۰۳', postalCode: '۷۷۱۹۱۷۵۵۷۳' },
});
step('ورود کد ملی/موبایل/کد پستی با ارقام فارسی → نرمال‌سازی و ثبت (۲۰۱)', fa.status === 201 && fa.json?.data?.nationalId === MELLI_FA, `status=${fa.status} nationalId=${fa.json?.data?.nationalId ?? '—'}`);

// ── صحنهٔ ۶: گیت هویتی چک‌این (رزرو فعال → آمده) ──
// مهمان بدون کدها ثبت می‌شود
const g2 = await req('POST', '/parties', { token: FD, body: { kind: 'GUEST', firstName: 'نرگس', lastName: `شریفی${tag}`, mobile: '09135550004' } });
step('ثبت مهمان بدون کدها (مجاز در مرحلهٔ رزرو)', g2.status === 201, `status=${g2.status}`);
const noCodesId = g2.json?.data?.id;
const rts = await req('GET', '/pms/room-types', { token: FD });
const map0 = await req('GET', '/pms/rooms/map', { token: FD });
const rooms = (map0.json?.data?.floors ?? []).flatMap((f) => f.rooms);
const free0 = rooms.find((r) => r.status === 'AVAILABLE');
const rt = (rts.json?.data ?? []).find((t) => t.code === free0?.roomType?.code);
const resv = await req('POST', '/pms/reservations', {
  token: FD,
  body: {
    roomTypeId: rt?.id, guestName: `نرگس شریفی${tag}`,
    checkInDate: dayFromNow(1), checkOutDate: dayFromNow(2),
    idempotencyKey: `uniqj-resv-${tag}`, source: 'WALK_IN', partyId: noCodesId,
  },
});
step('ثبت رزرو با partyId (بدون اجبار کدها در مرحلهٔ رزرو)', resv.status === 201, `status=${resv.status}`);
const map1 = await req('GET', '/pms/rooms/map', { token: FD });
const rooms1 = (map1.json?.data?.floors ?? []).flatMap((f) => f.rooms);
const free1 = rooms1.find((r) => r.status === 'AVAILABLE' && r.roomType?.code === rt?.code);
const gate = await req('POST', '/pms/stays/check-in', {
  token: FD,
  body: { idempotencyKey: `uniqj-ci-${tag}`, reservationId: resv.json?.data?.reservationId, roomIds: [free1?.id], plannedCheckOut: dayFromNow(2) },
});
step('چک‌این بدون کد ملی/کد پستی → مسدود (IDENTITY_INCOMPLETE)', gate.status === 409 && gate.json?.error?.code === 'IDENTITY_INCOMPLETE', `status=${gate.status} msg=${(gate.json?.error?.message || '').slice(0, 80)}`);
const fix = await req('PATCH', `/parties/${noCodesId}`, {
  token: FD,
  body: { kind: 'GUEST', firstName: 'نرگس', lastName: `شریفی${tag}`, mobile: '09135550004', nationalId: MELLI_2, postalCode: '7719175574' },
});
step('تکمیل اطلاعات هویتی رکورد قبلی (اصلاح)', fix.status === 200, `status=${fix.status}`);
const map2 = await req('GET', '/pms/rooms/map', { token: FD });
const rooms2 = (map2.json?.data?.floors ?? []).flatMap((f) => f.rooms);
const free2 = rooms2.find((r) => r.status === 'AVAILABLE' && r.roomType?.code === rt?.code);
const ci = await req('POST', '/pms/stays/check-in', {
  token: FD,
  body: { idempotencyKey: `uniqj-ci-${tag}`, reservationId: resv.json?.data?.reservationId, roomIds: [free2?.id], plannedCheckOut: dayFromNow(2) },
});
step('پس از تکمیل اطلاعات، چک‌این مجاز → رزرو به اقامت تبدیل شد', ci.status === 201 && !!ci.json?.data?.stayId, `status=${ci.status}`);

// ── صحنهٔ ۷: فروشندهٔ حقوقی (شخص حقوقی: شناسهٔ ملی + کد اقتصادی الزامی) ──
const missing = await req('POST', '/parties', { token: AD, body: { kind: 'SUPPLIER', companyName: `بدون شناسه ${tag}` } });
step('فروشنده بدون شناسهٔ ملی/کد اقتصادی → 400 (الزام حقوقی)', missing.status === 400 && (missing.json?.error?.message || '').includes('الزامی'), `status=${missing.status}`);
const sup = await req('POST', '/parties', {
  token: AD,
  body: { kind: 'SUPPLIER', companyName: `شرکت تأمین مس ${tag}`, natIdentifier: LEGAL_RUN, economicCode: ECON_RUN, phone: '02188729011', postalCode: '1996834111' },
});
step('ثبت فروشندهٔ حقوقی با شناسهٔ ملی معتبرِ تولیدشده → 201', sup.status === 201, `status=${sup.status}`);
const supId = sup.json?.data?.id;
const dupSup = await req('POST', '/parties', {
  token: AD,
  body: { kind: 'SUPPLIER', companyName: 'شرکت تأمین مس (نام دیگر)', natIdentifier: LEGAL_RUN, economicCode: ECON_RUN },
});
step('ثبت دوبارهٔ فروشنده با همان شناسهٔ ملی → 409', dupSup.status === 409, `status=${dupSup.status}`);
const supSearch = await req('GET', '/parties/search?q=' + encodeURIComponent('تأمین'), { token: AD });
step('جستجوی زندهٔ فروشنده («تأمین» وسط نام شرکت) → می‌آید', supSearch.json?.data?.some((p) => p.id === supId), `hits=${supSearch.json?.data?.length ?? 0}`);
const supRow = await req('POST', '/procurement/suppliers', {
  token: AD,
  body: { code: `SUP-${tag.slice(-6).toUpperCase()}`, nameEn: 'NICICO', nameFa: `شرکت تأمین مس ${tag}`, phone: '02188729011', partyId: supId },
});
step('ایجاد رکورد تأمین‌کنندهٔ مرتبط با ثبت یکتا → 201', supRow.status === 201, `status=${supRow.status}`);
const supEdit = await req('PATCH', `/procurement/suppliers/${supRow.json?.code}`, { token: AD, body: { code: supRow.json?.code, nameFa: `شرکت تأمین مس ${tag}`, nameEn: 'NICICO', phone: '021-88729011', partyId: supId } });
step('اصلاح فروشندهٔ موجود (PATCH) → 200', supEdit.status === 200, `status=${supEdit.status}`);

// ── صحنهٔ ۸: طرف حساب معاملات فصلی — ensure بی‌صدا ──
const CP_LEGAL = genLegalId();
const CP_ECON = genEcon();
const en1 = await req('POST', '/parties/ensure', {
  token: AD,
  body: { kind: 'COUNTERPARTY', companyName: 'باشگاه فرهنگی و ورزشی صنعت مس رفسنجان', natIdentifier: CP_LEGAL, economicCode: CP_ECON },
});
step('ensure طرف حساب (شناسهٔ تولیدی معتبر) → ایجاد true', en1.status === 201 && en1.json?.data?.created === true, `status=${en1.status} created=${en1.json?.data?.created}`);
const en2 = await req('POST', '/parties/ensure', {
  token: AD,
  body: { kind: 'COUNTERPARTY', companyName: 'باشگاه فرهنگی و ورزشی صنعت مس رفسنجان', natIdentifier: CP_LEGAL, economicCode: CP_ECON },
});
step('ensure دوباره → همان رکورد، created=false (ثبت دوباره رخ نمی‌دهد)', en2.status === 201 && en2.json?.data?.created === false && en2.json?.data?.party?.id === en1.json?.data?.party?.id, `status=${en2.status}`);

// ── خلاصه ──
report.finishedAt = new Date().toISOString();
report.passed = report.steps.filter((s) => s.ok).length;
report.failed = report.steps.filter((s) => !s.ok).length;
writeFileSync('/tmp/uniq-journey-report.json', JSON.stringify(report, null, 2));
console.log(`\n=== نتیجه: ${report.passed} PASS / ${report.failed} FAIL ===`);
if (report.failed > 0) process.exit(1);
