// 13-quarterly.mjs — لایه ۱ / ماژول ۱۳: معاملات فصلی خارج از سامانه + فایل استاندارد دارایی (F9-T4)
import { Suite, req, login, db, sleep, BASE } from './_lib.mjs';

const S = new Suite('13-quarterly');
const T = {
  admin: await login('admin', true),
  accountant: await login('accountant', true),
  approver: await login('approver', true),
  frontdesk: await login('frontdesk', false),
};
const c = await db();
const YEAR = 1405;

// شروع از حالت تمیز — اگر اجرای قبلی وسط راه خراب شده باشد
await c.query(`delete from "quarterly_txs"`);
await c.query(`delete from "quarterly_periods"`);
await c.query(`delete from "workflow_actions"`);
await c.query(`delete from "workflow_instances"`);
await c.query(`delete from outbox_events where "eventName"='workflow.completed'`);
await c.query(`delete from audit_logs where "action" like 'QUARTERLY%'`);

// ── ۱. RBAC ──
const forb = await req('GET', `/compliance/quarterly?taxYear=${YEAR}`, { token: T.frontdesk });
S.step('لیست فصلی توسط پذیرش → 403', forb.status === 403, `status=${forb.status}`);
const accList = await req('GET', `/compliance/quarterly?taxYear=${YEAR}`, { token: T.accountant });
S.step('لیست فصلی توسط حسابدار → 200', accList.status === 200, `status=${accList.status}`);

// ── ۲. اعتبارسنجی‌های ثبت ──
const bad = [
  ['نوع نامعتبر', { txType: 'RENT', counterpartyName: 'تأمین‌کننده الف', amountRials: '1000000', txDate: '2026-04-10' }],
  ['مبلغ صفر', { txType: 'SALE', counterpartyName: 'مشتری الف', amountRials: '0', txDate: '2026-04-10' }],
  ['VAT بیشتر از مبلغ', { txType: 'SALE', counterpartyName: 'مشتری الف', amountRials: '1000', vatRials: '2000', txDate: '2026-04-10' }],
  ['شناسهٔ نامعتبر', { txType: 'SALE', counterpartyName: 'مشتری الف', amountRials: '1000', counterpartyTin: '12ab', txDate: '2026-04-10' }],
  ['تاریخ بیرون فصل', { txType: 'SALE', counterpartyName: 'مشتری الف', amountRials: '1000', txDate: '2026-07-01' }],
];
for (const [name, body] of bad) {
  const r = await req('POST', '/compliance/quarterly', { token: T.accountant, body: { taxYear: YEAR, quarter: 1, ...body } });
  S.step(`اعتبارسنجی: ${name} → 400`, r.status === 400, `status=${r.status}`);
}

// ── ۳. ثبت معتبر + تکراری + همان docRef در فصل دیگر ──
const reg = await req('POST', '/compliance/quarterly', {
  token: T.accountant,
  body: { taxYear: YEAR, quarter: 1, txType: 'SALE', counterpartyName: 'شرکت همایش‌گزاری پارس', counterpartyTin: '10861234567', amountRials: '50000000', vatRials: '5000000', txDate: '2026-04-10', docRef: 'MAN-TEST-1', notes: 'سالن همایش — فروش دستی' },
});
S.step('ثبت معاملهٔ دستی معتبر → 201', [200, 201].includes(reg.status), `status=${reg.status}`);
const regId = reg.json?.data?.id;
const dup = await req('POST', '/compliance/quarterly', {
  token: T.accountant,
  body: { taxYear: YEAR, quarter: 1, txType: 'SALE', counterpartyName: 'شرکت همایش‌گزاری پارس', amountRials: '50000000', txDate: '2026-04-11', docRef: 'MAN-TEST-1' },
});
S.step('docRef تکراری در همان فصل → 409', dup.status === 409, `status=${dup.status}`);
const otherQ = await req('POST', '/compliance/quarterly', {
  token: T.accountant,
  body: { taxYear: YEAR, quarter: 2, txType: 'PURCHASE', counterpartyName: 'تأمین‌کنندهٔ کالا', counterpartyTin: '41122334455', amountRials: '20000000', vatRials: '2000000', txDate: '2026-07-05', docRef: 'MAN-TEST-1' },
});
S.step('همان docRef در فصل دیگر → 201', [200, 201].includes(otherQ.status), `status=${otherQ.status}`);

// ── ۴. استخراج خودکار POS (فصل ۳ — امروز ۱۴۰۵/۰۹) ──
// سفارش POS واقعی ثبت می‌کنیم (ماژول POS — جدول pos_orders) تا استخراج روی دادهٔ واقعی باشد
const outlet = await req('GET', '/integrations', { token: T.accountant }); // فقط برای گرم شدن؛ outlet از DB می‌آید
const OUTLET_ID = (await c.query(`select id from pos_outlets where code='REST-MAIN' limit 1`)).rows[0].id; // پویا — وابسته به seed مشخص نیست
const posOrd = await req('POST', '/pos/orders', {
  token: T.frontdesk,
  body: {
    outletId: OUTLET_ID,
    lines: [{ itemName: 'چلوکباب — فصل‌گزارش', qty: 2, unitPriceRials: 4500000 }],
    taxRatePermille: 100, // ۱۰٪ ارزش افزوده (F9-T1)
    idempotencyKey: `qtest-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
  },
});
S.step('سفارش POS واقعی ثبت شد (SERVED)', [200, 201].includes(posOrd.status) && String(posOrd.json?.data?.orderNo ?? posOrd.json?.orderNo ?? '').startsWith('ORD-'),
  `status=${posOrd.status} orderNo=${posOrd.json?.data?.orderNo ?? posOrd.json?.orderNo}`);
const d1 = await req('POST', '/compliance/quarterly/derive', { token: T.accountant, body: { taxYear: YEAR, quarter: 3 } });
S.step('استخراج POS اول → derived=scanned (شامل سفارش تازه)', [200, 201].includes(d1.status) && d1.json?.data?.derived === d1.json?.data?.scanned && d1.json?.data?.scanned >= 1,
  `derived=${d1.json?.data?.derived} scanned=${d1.json?.data?.scanned} posOrd=${posOrd.status}`);
const d2 = await req('POST', '/compliance/quarterly/derive', { token: T.accountant, body: { taxYear: YEAR, quarter: 3 } });
S.step('استخراج دوم Idempotent → derived=0', d2.json?.data?.derived === 0 && d2.json?.data?.scanned === d1.json?.data?.scanned,
  `derived=${d2.json?.data?.derived} scanned=${d2.json?.data?.scanned}`);

// ── ۵. خلاصهٔ فصل ۳ = جمع سفارش‌های SERVED همان بازه ──
const posSum = await c.query(`
  select count(*)::int as n, coalesce(sum("totalRials"),0)::text as total, coalesce(sum("taxRials"),0)::text as vat
  from pos_orders where status='SERVED' and "servedAt" >= $1 and "servedAt" < $2`, ['2026-09-23', '2026-12-22']);
const sum3 = await req('GET', `/compliance/quarterly/summary?taxYear=${YEAR}&quarter=3`, { token: T.approver });
S.step('خلاصهٔ فصل ۳ = جمع واقعی POS (شمارش/مبلغ/مالیات)',
  sum3.json?.data?.sale?.count === posSum.rows[0].n && sum3.json?.data?.sale?.total === posSum.rows[0].total && sum3.json?.data?.sale?.vat === posSum.rows[0].vat,
  `api=${sum3.json?.data?.sale?.count}/${sum3.json?.data?.sale?.total} db=${posSum.rows[0].n}/${posSum.rows[0].total}`);
const sum1 = await req('GET', `/compliance/quarterly/summary?taxYear=${YEAR}&quarter=1`, { token: T.approver });
S.step('خلاصهٔ فصل ۱ شامل ثبت دستی (۵۰م + مالیات ۵م)', sum1.json?.data?.sale?.total === '50000000' && sum1.json?.data?.sale?.vat === '5000000',
  `total=${sum1.json?.data?.sale?.total} vat=${sum1.json?.data?.sale?.vat}`);

// ── ۶. فایل استاندارد CSV ──
const csv = await req('GET', `/compliance/quarterly/export?taxYear=${YEAR}&quarter=3`, { token: T.approver });
const csvText = csv.raw ?? '';
const jRow = (csvText.match(/^\d+,فروش,/m) || [])[0];
// BOM را باید روی بایت‌ها چک کرد — r.text() طبق Fetch spec آن را حذف می‌کند
const csvRes = await fetch(`${BASE}/compliance/quarterly/export?taxYear=${YEAR}&quarter=3`, { headers: { Authorization: `Bearer ${T.approver}` } });
const csvBytes = new Uint8Array(await csvRes.arrayBuffer());
const bomOk = csvBytes[0] === 0xEF && csvBytes[1] === 0xBB && csvBytes[2] === 0xBF;
S.step('CSV با BOM شروع می‌شود (EF BB BF روی بایت‌ها)', bomOk, `bytes=${csvBytes.slice(0, 3).join(',')}`);
S.step('CSV ستون‌های استاندارد دارد', csvText.includes('نوع معامله') && csvText.includes('مالیات بر ارزش افزوده (ریال)'), 'cols ok');
S.step('CSV ردیف فروش POS با تاریخ شمسی', !!jRow && /\d{4}\/\d{2}\/\d{2},POS/.test(csvText), `row=${jRow?.slice(0, 30)}`);

// ── ۷. بستن فصل ۱ فقط با تأیید انسانی (گردش کار F8-T6) ──
const close = await req('POST', '/compliance/quarterly/close', { token: T.accountant, body: { taxYear: YEAR, quarter: 1 } });
S.step('درخواست بستن فصل → نمونهٔ گردش کار IN_PROGRESS', [200, 201].includes(close.status) && close.json?.data?.status === 'IN_PROGRESS',
  `status=${close.json?.data?.status}`);
const wfId = close.json?.data?.id;
const closeAgain = await req('POST', '/compliance/quarterly/close', { token: T.accountant, body: { taxYear: YEAR, quarter: 1 } });
S.step('درخواست دوباره بستن → همان نمونه (Idempotent)', closeAgain.json?.data?.id === wfId, `same=${closeAgain.json?.data?.id === wfId}`);
const selfApp = await req('POST', `/workflows/${wfId}/approve`, { token: T.accountant, body: {} });
S.step('خودتأییری آغازگر بستن فصل → 403', selfApp.status === 403, `status=${selfApp.status}`);
const app = await req('POST', `/workflows/${wfId}/approve`, { token: T.approver, body: { comment: 'اعلام فصل بسته شد' } });
S.step('تأیید توسط تأییدکننده → APPROVED', [200, 201].includes(app.status) && app.json?.data?.status === 'APPROVED', `status=${app.json?.data?.status}`);

// رویداد dispatched شود (پابلیشر هر ثانیه)
let closed = null;
for (let i = 0; i < 25; i++) {
  const st = await req('GET', `/compliance/quarterly/summary?taxYear=${YEAR}&quarter=1`, { token: T.accountant });
  if (st.json?.data?.status === 'CLOSED') { closed = st.json.data; break; }
  await sleep(1000);
}
S.step('پس از تأیید → فصل CLOSED (مصرف‌کنندهٔ workflow.completed)', closed?.status === 'CLOSED', `status=${closed?.status ?? 'OPEN'}`);
const ev = await c.query(`select "idempotencyKey" from outbox_events where "eventName"='workflow.completed' order by "createdAt" desc limit 1`);
S.step('رویداد تکمیل در Outbox با کلید یکتا', ev.rows[0]?.idempotencyKey === `wf-complete:${wfId}`, `key=${ev.rows[0]?.idempotencyKey}`);

// ── ۸. فصل بسته → ثبت/استخراج ممنوع؛ فایل موجود ──
const regClosed = await req('POST', '/compliance/quarterly', {
  token: T.accountant,
  body: { taxYear: YEAR, quarter: 1, txType: 'SALE', counterpartyName: 'مشتری ب', amountRials: '1000', txDate: '2026-04-15' },
});
S.step('ثبت روی فصل بسته → 409', regClosed.status === 409, `status=${regClosed.status}`);
const derClosed = await req('POST', '/compliance/quarterly/derive', { token: T.accountant, body: { taxYear: YEAR, quarter: 1 } });
S.step('استخراج روی فصل بسته → 409', derClosed.status === 409, `status=${derClosed.status}`);
const csvClosed = await req('GET', `/compliance/quarterly/export?taxYear=${YEAR}&quarter=1`, { token: T.accountant });
S.step('فایل فصل بسته همچنان قابل دریافت → 200', csvClosed.status === 200, `status=${csvClosed.status}`);

// ── ۹. بازگشایی فقط admin ──
const reAcc = await req('POST', '/compliance/quarterly/reopen', { token: T.accountant, body: { taxYear: YEAR, quarter: 1 } });
S.step('بازگشایی توسط حسابدار → 403', reAcc.status === 403, `status=${reAcc.status}`);
const reAdm = await req('POST', '/compliance/quarterly/reopen', { token: T.admin, body: { taxYear: YEAR, quarter: 1 } });
S.step('بازگشایی توسط admin → OPEN', [200, 201].includes(reAdm.status) && reAdm.json?.data?.status === 'OPEN', `status=${reAdm.json?.data?.status}`);
const regAfter = await req('POST', '/compliance/quarterly', {
  token: T.accountant,
  body: { taxYear: YEAR, quarter: 1, txType: 'SALE', counterpartyName: 'مشتری ج', amountRials: '3000000', txDate: '2026-04-20', docRef: 'MAN-TEST-2' },
});
S.step('ثبت پس از بازگشایی → 201', [200, 201].includes(regAfter.status), `status=${regAfter.status}`);

// ── پاکسازی پایانی ──
await c.query(`delete from "quarterly_txs"`);
await c.query(`delete from "quarterly_periods"`);
await c.query(`delete from "workflow_actions"`);
await c.query(`delete from "workflow_instances"`);
await c.query(`delete from outbox_events where "eventName"='workflow.completed'`);
await c.query(`delete from audit_logs where "action" like 'QUARTERLY%'`);

await c.end();
S.finish();
