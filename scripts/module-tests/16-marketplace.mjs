// 16-marketplace.mjs — موج ۵ / فاز ۱۲ (F12-T4): API Marketplace — کلید، scope، نرخ، فراخوانی نمونه
import { Suite, req, login, db } from './_lib.mjs';

const S = new Suite('16-marketplace');
const T = {
  admin: await login('admin', true),
  accountant: await login('accountant', true),
  frontdesk: await login('frontdesk', false),
};
const c = await db();
// helper عمومی با هدر x-api-key
const pub = async (method, path, apiKey, body) => {
  const r = await fetch(`http://localhost:3000/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(apiKey ? { 'x-api-key': apiKey } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json };
};

// شروع تمیز
await c.query(`delete from "api_clients"`);
await c.query(`delete from audit_logs where "action" like 'API_CLIENT%' or "action"='API_RESERVATION_CREATED'`);

// ── ۱. RBAC مدیریت کلیدها ──
const forb = await req('GET', '/marketplace/clients', { token: T.accountant });
S.step('فهرست کلیدها توسط حسابدار → 403', forb.status === 403, `status=${forb.status}`);
const forb2 = await req('POST', '/marketplace/clients', { token: T.frontdesk, body: { name: 'X' } });
S.step('ساخت کلید توسط پذیرش → 403', forb2.status === 403, `status=${forb2.status}`);

// ── ۲. ساخت کلید توسط مدیر ──
const bad = await req('POST', '/marketplace/clients', { token: T.admin, body: { name: '' } });
S.step('نام خالی → 400', bad.status === 400, `status=${bad.status}`);
const badScope = await req('POST', '/marketplace/clients', { token: T.admin, body: { name: 'Bad', scopes: ['all'] } });
S.step('scope نامعتبر → 400', badScope.status === 400, `status=${badScope.status}`);
const mk = await req('POST', '/marketplace/clients', { token: T.admin, body: { name: 'UITEST-Partner', rateLimitPerMin: 60, scopes: ['availability', 'rates', 'reservations'] } });
const key = mk.json?.data?.apiKey;
S.step('ساخت کلید → متن آشکار یک‌بار + پیشوند hk_', [200, 201].includes(mk.status) && String(key).startsWith('hk_'), `prefix=${mk.json?.data?.keyPrefix}`);
const list = await req('GET', '/marketplace/clients', { token: T.admin });
S.step('فهرست شامل مشتری — بدون متن آشکار کلید', list.status === 200 && list.json.data.some((x) => x.name === 'UITEST-Partner') && !JSON.stringify(list.json).includes(key), `n=${list.json?.data?.length}`);

// ── ۳. مسیرهای عمومی با کلید ──
const noKey = await pub('GET', '/public-api/v1/availability', null);
S.step('بدون کلید → 401', noKey.status === 401, `status=${noKey.status}`);
const wrong = await pub('GET', '/public-api/v1/availability', 'hk_wrongwrongwrong');
S.step('کلید غلط → 401', wrong.status === 401, `status=${wrong.status}`);
const av = await pub('GET', '/public-api/v1/availability', key);
S.step('availability با کلید → 200 + گروه‌بندی وضعیت', av.status === 200 && Array.isArray(av.json?.data?.rooms), `status=${av.status}`);
const rates = await pub('GET', '/public-api/v1/rates', key);
S.step('rates با کلید → 200 و نرخ رشته‌ای', rates.status === 200 && (rates.json.data?.length ?? 0) >= 1 && typeof rates.json.data[0].baseNightRateRials === 'string', `n=${rates.json?.data?.length}`);
const docs = await pub('GET', '/public-api/v1/_docs', key);
S.step('_docs → سه مسیر مستند', docs.status === 200 && docs.json.data?.endpoints?.length === 3, `n=${docs.json?.data?.endpoints?.length}`);

// ── ۴. فراخوانی نمونهٔ رزرو ──
const type = (await c.query(`select id, code, "baseRateRials"::text r from room_types order by code limit 1`)).rows[0];
const from = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
const res = await pub('POST', '/public-api/v1/reservations', key, { guestName: 'API Tester', roomTypeId: type.id, from, nights: 2 });
S.step('رزرو نمونه → CONFIRMED با کد RSV', [200, 201].includes(res.status) && res.json?.data?.code?.startsWith('RSV-') && res.json.data.status === 'CONFIRMED', `code=${res.json?.data?.code}`);
const total = BigInt(type.r) * 2n;
S.step('مبلغ کل = نرخ پایه × شب', [200,201].includes(res.status) && BigInt(res.json?.data?.totalRials ?? '0') === total, `api=${res.json?.data?.totalRials} expect=${total}`);
const resDb = (await c.query(`select source, status from reservations where id=$1`, [res.json.data.id])).rows[0];
S.step('منبع رزرو ONLINE در DB', resDb && resDb.source === 'ONLINE' && resDb.status === 'CONFIRMED', `src=${resDb?.source}`);
const audit = (await c.query(`select count(*)::int n from audit_logs where "action"='API_RESERVATION_CREATED'`)).rows[0].n;
S.step('ردپای حسابرسی رزرو عمومی', audit >= 1, `n=${audit}`);

// ── ۵. scope و غیرفعال‌سازی ──
const mk2 = await req('POST', '/marketplace/clients', { token: T.admin, body: { name: 'UITEST-Limited', scopes: ['availability'] } });
const key2 = mk2.json?.data?.apiKey;
const rates2 = await pub('GET', '/public-api/v1/rates', key2);
S.step('کلید بدون scope rates → 403', rates2.status === 403, `status=${rates2.status}`);
const av2 = await pub('GET', '/public-api/v1/availability', key2);
S.step('همان کلید برای availability → 200', av2.status === 200, `status=${av2.status}`);
const clientId2 = mk2.json.data.id;
const tog = await req('POST', `/marketplace/clients/${clientId2}/toggle`, { token: T.admin });
S.step('غیرفعال‌سازی کلید → active=false', [200, 201].includes(tog.status) && tog.json?.data?.active === false, `active=${tog.json?.data?.active}`);
const av3 = await pub('GET', '/public-api/v1/availability', key2);
S.step('درخواست با کلید غیرفعال → 403', av3.status === 403, `status=${av3.status}`);

// ── ۶. محدودسازی نرخ ──
const mk3 = await req('POST', '/marketplace/clients', { token: T.admin, body: { name: 'UITEST-LowRate', rateLimitPerMin: 3 } });
const key3 = mk3.json?.data?.apiKey;
let last = 0, limited = 0;
for (let i = 0; i < 5; i++) {
  const r = await fetch('http://localhost:3000/api/v1/public-api/v1/availability', { headers: { 'x-api-key': key3 } });
  last = r.status;
  if (r.status === 400) { const j = await r.json(); if (j?.error?.code === 'RATE_LIMITED') limited++; }
}
S.step('درخواست چهارم+ → RATE_LIMITED', limited >= 1 && last === 400, `limited=${limited} last=${last}`);

// ── پاکسازی ──
await c.query(`delete from reservations where code=$1`, [res.json?.data?.code ?? '']);
await c.query(`delete from "api_clients"`);
await c.query(`delete from audit_logs where "action" like 'API_CLIENT%' or "action"='API_RESERVATION_CREATED'`);
await c.end();
S.finish();
