// 06-compliance.mjs — لایه ۱ / ماژول ۶: کتابخانهٔ قوانین نسخه‌دار، نرخ لحظه‌ای، اظهارنامهٔ VAT
import { Suite, req, login, db, TODAY } from './_lib.mjs';

const S = new Suite('06-compliance');
const T = { admin: await login('admin', true), accountant: await login('accountant', true), frontdesk: await login('frontdesk', false) };
const c = await db();

// ── فهرست قوانین seed (۴ قانون) ──
const laws = (await req('GET', '/compliance/laws', { token: T.accountant })).json?.data ?? [];
S.step('کتابخانهٔ قوانین ≥۴ قانون', laws.length >= 4, `count=${laws.length}`);
const vatLaw = laws.find((l) => l.code === 'LAW-VAT-RATE');
S.step('قانون VAT با پارامتر vatBps و مادهٔ قانون', !!vatLaw && Number(vatLaw.params?.vatBps) > 0 && !!vatLaw.article, `vatBps=${vatLaw?.params?.vatBps} article=${vatLaw?.article?.slice(0, 20)}`);

// پیش‌ Reception اجازه مدیریت قوانین ندارد
const forb = await req('POST', '/compliance/laws', { token: T.frontdesk, body: { code: 'X', lawName: 'x', params: {} } });
S.step('ثبت قانون توسط پیش‌reception → 403', forb.status === 403, `status=${forb.status}`);

// ── قانون جدید → نسخه ۱ ──
const code = `LAW-TEST-${Date.now() % 100000}`;
const created = await req('POST', '/compliance/laws', { token: T.admin, body: { code, title: 'قانون جرائم تست', lawName: 'قانون تست ماژول۶', article: 'ماده ۱', params: { penaltyBps: 200 }, effectiveFrom: TODAY } });
S.step('ثبت قانون جدید', created.status === 201, `status=${created.status} ${JSON.stringify(created.json?.error ?? {}).slice(0, 100)}`);
const v1 = (await c.query(`select version, active from law_rules where code=$1`, [code])).rows[0];
S.step('خواندن مجدد: نسخهٔ ۱ فعال', String(v1?.version ?? '').startsWith('1') && v1?.active === true, `version=${v1?.version} active=${v1?.active}`);

// ── به‌روزرسانی همان کد → نسخه ۲ (نسخه‌دار) ──
const updated = await req('POST', '/compliance/laws', { token: T.admin, body: { code, title: 'قانون جرائم تست', lawName: 'قانون تست ماژول۶', article: 'ماده ۱', params: { penaltyBps: 300 }, effectiveFrom: TODAY } });
S.step('به‌روزرسانی قانون', [200, 201].includes(updated.status), `status=${updated.status}`);
// طرح فعلی: نسخه در همان رکورد افزایش می‌یابد (۱.۰ → ۱.۱) و تاریخچه در audit_log
const versions = (await c.query(`select version, active from law_rules where code=$1`, [code])).rows;
S.step('به‌روزرسانی نسخه‌دار: ۱.۰ → ۱.۱ در همان رکورد فعال', versions.length === 1 && String(versions[0]?.version) === '1.1' && versions[0]?.active === true, `versions=${versions.map((v) => `${v.version}:${v.active}`).join(',')}`);

// ── نرخ لحظه‌ای قانون ──
const rate = await req('GET', `/compliance/laws/${code}/rate`, { token: T.accountant });
S.step('نرخ لحظه‌ای قانون = پارامترهای نسخهٔ فعال', rate.status === 200 && Number(rate.json?.data?.penaltyBps) === 300, `status=${rate.status} data=${JSON.stringify(rate.json?.data ?? {})}`);

// ── قانون ناموجود → 404 ──
const nope = await req('GET', '/compliance/laws/LAW-NONEXIST/rate', { token: T.accountant });
S.step('قانون ناموجود → 404', nope.status === 404, `status=${nope.status}`);

// ── رجیستری نگاشت رویدادها ──
const mappings = (await c.query(`select "eventName", version, active from event_journal_mappings`)).rows;
S.step('رجیستری نگاشت: نگاشت شب‌گردی فعال', mappings.some((m) => m.eventName === 'pms.night_audit.posted' && m.active === true), `count=${mappings.length}`);

// ── اظهارنامهٔ VAT = محاسبهٔ مستقیم DB ──
const decl = await req('GET', `/compliance/vat/declaration?from=${TODAY}&to=${TODAY}`, { token: T.accountant });
const outDb = (await c.query(`select coalesce(sum(l."creditRials"),0)::text as v from journal_lines l join journal_entries e on e.id=l."entryId" where l."accountCode"='2201' and e.status='POSTED' and e."postingDate"::date=current_date`)).rows[0];
const inDb = (await c.query(`select coalesce(sum(l."debitRials"),0)::text as v from journal_lines l join journal_entries e on e.id=l."entryId" where l."accountCode"='2204' and e.status='POSTED' and e."postingDate"::date=current_date`)).rows[0];
S.step('اظهارنامه: خروجی VAT = DB', Number(decl.json?.data?.outputVatRials) === Number(outDb.v), `api=${decl.json?.data?.outputVatRials} db=${outDb.v}`);
S.step('اظهارنامه: اعتبار VAT = DB', Number(decl.json?.data?.inputVatCreditRials) === Number(inDb.v), `api=${decl.json?.data?.inputVatCreditRials} db=${inDb.v}`);
const net = Number(decl.json?.data?.netPayableRials ?? 0);
S.step('اظهارنامه: خالص = خروجی − اعتبار', net === Number(decl.json?.data?.outputVatRials) - Number(decl.json?.data?.inputVatCreditRials), `net=${net}`);

// پاکسازی قانون تست
await c.query(`DELETE FROM law_rules WHERE code=$1`, [code]);

await c.end();
S.finish();
