// 01-auth.mjs — لایه ۱ / ماژول ۱: احراز هویت، MFA، چرخش refresh، RBAC
import { Suite, req, login, db, PASSWORD, totp } from './_lib.mjs';

const S = new Suite('01-auth');

// ── ورود موفق همهٔ کاربران seed (۳ نقش حساس با TOTP) ──
const tokens = {};
for (const [u, t] of [['admin', true], ['accountant', true], ['approver', true], ['frontdesk', false], ['cashier', false], ['chef', false], ['storekeeper', false], ['housekeeper', false]]) {
  const r = await req('POST', '/auth/login', { body: { username: u, password: PASSWORD, ...(t ? { totp: totp() } : {}) } });
  S.step(`ورود ${u} (${t ? 'با TOTP' : 'بدون TOTP'})`, r.status === 200 || r.status === 201, `status=${r.status}`);
  tokens[u] = r.json?.accessToken;
  if (t) S[`refresh_${u}`] = r.json?.refreshToken;
}

// ── رمز غلط → 401 ──
const bad = await req('POST', '/auth/login', { body: { username: 'frontdesk', password: 'totally-wrong-pass' } });
S.step('رمز نادرست → 401', bad.status === 401, `status=${bad.status}`);

// ── نقش حساس بدون TOTP → رد ──
const noTotp = await req('POST', '/auth/login', { body: { username: 'admin', password: PASSWORD } });
S.step('مدیرعامل بدون TOTP → رد (400/401/403)', [400, 401, 403].includes(noTotp.status), `status=${noTotp.status}`);

// ── TOTP اشتباه → رد ──
const wrongTotp = await req('POST', '/auth/login', { body: { username: 'admin', password: PASSWORD, totp: '000000' } });
S.step('TOTP اشتباه → رد', [400, 401, 403].includes(wrongTotp.status), `status=${wrongTotp.status}`);

// ── /auth/me با توکن معتبر و بدون توکن ──
const me = await req('GET', '/auth/me', { token: tokens.frontdesk });
S.step('/auth/me شناسه کاربر را می‌دهد', me.status === 200 && !!me.json?.data?.username, `status=${me.status} user=${me.json?.data?.username}`);
const meNo = await req('GET', '/auth/me');
S.step('/auth/me بدون توکن → 401', meNo.status === 401, `status=${meNo.status}`);

// ── چرخش refresh با معنای امنیتی کامل (auth.service:117-125) ──
// استفادهٔ مجدد از توکن چرخیده = نشانه سرقت → کل زنجیرهٔ کاربر باطل می‌شود؛
// بنابراین پس از تست reuse، توکن تازهٔ همان زنجیره عمداً مرده است (رفتار درست).
const rt = S.refresh_admin;
const r1 = await req('POST', '/auth/refresh', { body: { refreshToken: rt } });
S.step('refresh اول → جفت توکن تازه', [200, 201].includes(r1.status) && !!r1.json?.refreshToken, `status=${r1.status}`);
const r2 = await req('POST', '/auth/refresh', { body: { refreshToken: rt } });
S.step('استفادهٔ مجدد از توکن مصرف‌شده → 401 + ابطال کل زنجیره', [401, 403].includes(r2.status), `status=${r2.status}`);
const r3 = await req('POST', '/auth/refresh', { body: { refreshToken: r1.json?.refreshToken } });
S.step('توکن تازهٔ زنجیرهٔ ابطال‌شده هم رد می‌شود (سیاست ضدسرقت)', [401, 403].includes(r3.status), `status=${r3.status}`);
// چرخش عادی: ورود تازه → refresh → موفق
const freshLogin = await req('POST', '/auth/login', { body: { username: 'admin', password: PASSWORD, totp: totp() } });
const r4 = await req('POST', '/auth/refresh', { body: { refreshToken: freshLogin.json?.refreshToken } });
S.step('چرخش عادی با زنجیرهٔ تازه → موفق', [200, 201].includes(r4.status) && !!r4.json?.refreshToken, `status=${r4.status}`);

// ── خروج → refresh باطل ──
const rt2 = freshLogin.json?.refreshToken;
const out = await req('POST', '/auth/logout', { body: { refreshToken: rt2 }, token: tokens.admin });
S.step('logout → 204', [200, 201, 204].includes(out.status), `status=${out.status}`);
const outUse = await req('POST', '/auth/refresh', { body: { refreshToken: rt2 } });
S.step('refresh پس از خروج → رد', [400, 401, 403].includes(outUse.status), `status=${outUse.status}`);

// ── RBAC: ماتریس دسترسی سمت سرور ──
const rb = [];
// پیش‌ reception اجازه ثبت سند مالی ندارد
rb.push(['frontdesk ثبت سند مالی → 403', await req('POST', '/journal-entries', { token: tokens.frontdesk, body: { description: 'x', lines: [] } })]);
// حسابدار اجازه تأیید حکم ندارد (سرور باید 403 بدهد — جدا از تعریف حکم)
// آشپز به حقوق دسترسی ندارد (stores.view عمداً به آشپز داده شده — دید انبار آشپزخانه)
rb.push(['chef فهرست پرسنل → 403', await req('GET', '/payroll/employees', { token: tokens.chef })]);
// انباردار اجازه ثبت رزرو ندارد
rb.push(['storekeeper ثبت رزرو → 403', await req('POST', '/pms/reservations', { token: tokens.storekeeper, body: {} })]);
// متصدی صندوق اجازه ثبت پرسنل ندارد
rb.push(['cashier ثبت پرسنل → 403', await req('POST', '/payroll/employees', { token: tokens.cashier, body: {} })]);
for (const [title, r] of rb) S.step(title, r.status === 403, `status=${r.status} ${JSON.stringify(r.json?.error ?? {}).slice(0, 80)}`);

// ── Token payload: نقش درست باشد ──
const meAdmin = await req('GET', '/auth/me', { token: tokens.admin });
S.step('/auth/me نقش admin را نشان می‌دهد', (meAdmin.json?.data?.roles ?? []).includes('admin'), `roles=${JSON.stringify(meAdmin.json?.data?.roles)}`);

S.finish();
