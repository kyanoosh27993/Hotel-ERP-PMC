// 07-payroll.mjs — لایه ۱ / ماژول ۷: پرسنل، حکم، دورهٔ حقوق، لیست‌های رسمی، شبای mod-97
import { Suite, req, login, db, buildIranIban, ibanValid, sleep } from './_lib.mjs';

const S = new Suite('07-payroll');
const T = { admin: await login('admin', true), accountant: await login('accountant', true), approver: await login('approver', true), frontdesk: await login('frontdesk', false) };
const X = { empCode: '9' + String(Date.now()).slice(-3) };
const c = await db();

// ریست جداول دورهٔ حقوق — بدون دست‌زدن به پرسنل/حکم‌های seed
// (TRUNCATE با CASCADE به employees ضربه می‌زد — ریشهٔ خطای FK قبلی)
await c.query(`TRUNCATE "payroll_slips","payroll_runs"`);
await c.query(`TRUNCATE "journal_attachments","journal_lines","journal_entries"`);
await c.query(`TRUNCATE "outbox_events","inbox_events"`);
await c.query(`TRUNCATE "audit_logs"`);
// پاکسازی بقایای کارمندان تستی اجراهای قبل (کدهای ۹XXX)
await c.query(`DELETE FROM payroll_slips WHERE "employeeId" IN (SELECT id FROM employees WHERE code ~ '^9[0-9]{3}$')`);
await c.query(`DELETE FROM salary_decisions WHERE "employeeId" IN (SELECT id FROM employees WHERE code ~ '^9[0-9]{3}$')`);
await c.query(`DELETE FROM employees WHERE code ~ '^9[0-9]{3}$'`);
const approvedBefore = (await c.query(`select count(*)::int as n from employees e where exists (select 1 from salary_decisions d where d."employeeId"=e.id and d.status='APPROVED')`)).rows[0].n;
await c.query(`UPDATE "fiscal_periods" SET "status" = CASE WHEN "endDate" < date_trunc('month', now()) THEN 'LOCKED'::fiscal_period_status ELSE 'OPEN'::fiscal_period_status END, "lockedAt" = CASE WHEN "endDate" < date_trunc('month', now()) THEN now() ELSE NULL END, "closedAt"=NULL, "closingEntryId"=NULL`);

const seeded = (await req('GET', '/payroll/employees', { token: T.accountant })).json?.data ?? [];
S.step('۱۰ کارمند seed شده', seeded.length >= 10, `count=${seeded.length}`);

// ── پذیرش اجازه ثبت پرسنل ندارد ──
const forb = await req('POST', '/payroll/employees', { token: T.frontdesk, body: { code: '999', firstName: 'x', lastName: 'y', marital: false, dependents: 0 } });
S.step('پیش‌reception ثبت پرسنل → 403', forb.status === 403, `status=${forb.status}`);

// ── شبای نامعتبر → 400 ──
const badIban = await req('POST', '/payroll/employees', { token: T.accountant, body: { code: X.empCode, firstName: 'بد', lastName: 'شبا', marital: true, dependents: 1, iban: 'IR1201700000012345678901234' } });
S.step('شبای نامعتبر → 400', badIban.status === 400, `status=${badIban.status}`);

// ── کارمند جدید با شبا معتبر ──
const iban = buildIranIban('017000000123456789012345');
const emp = await req('POST', '/payroll/employees', { token: T.accountant, body: { code: X.empCode, firstName: 'تست', lastName: 'ماژول۷', marital: true, dependents: 2, iban } });
S.step('کارمند جدید ثبت شد', emp.status === 201, `status=${emp.status} ${JSON.stringify(emp.json?.error ?? {}).slice(0, 140)}`);
const empId = emp.json?.data?.id;
const empRow = (await c.query(`select code, "firstName", iban from employees where id=$1`, [empId])).rows[0];
S.step('خواندن مجدد: کد/نام/شبا', empRow?.code === X.empCode && empRow?.firstName === 'تست' && empRow?.iban === iban, `code=${empRow?.code} iban=${String(empRow?.iban).slice(0, 12)}…`);

// ── حکم: پیش‌نویس → جداسازی تأیید ──
const dec = await req('POST', '/payroll/decisions', { token: T.accountant, body: { employeeId: empId, baseSalary: '210000000', seniority: '5000000', housing: '30000000', effectiveFrom: '2025-03-21', note: 'ماژول۷' } });
S.step('حکم پیش‌نویس', dec.status === 201 && dec.json?.data?.status === 'DRAFT', `status=${dec.status} state=${dec.json?.data?.status}`);
const decId = dec.json?.data?.id;
const selfAp = await req('POST', `/payroll/decisions/${decId}/approve`, { token: T.accountant });
S.step('حسابدار اجازه تأیید حکم ندارد → 403', selfAp.status === 403, `status=${selfAp.status}`);
const ap = await req('POST', `/payroll/decisions/${decId}/approve`, { token: T.approver });
S.step('تأییدکننده حکم را تأیید می‌کند', ap.status === 201 && ap.json?.data?.status === 'APPROVED', `status=${ap.status} state=${ap.json?.data?.status}`);

// ── دورهٔ حقوق ۱۴۰۵-۰۹: ۱۱ فیش و فرمول هر فیش ──
const run = await req('POST', '/payroll/runs', { token: T.accountant, body: { periodCode: '1405-09' } });
S.step('محاسبهٔ دوره → DRAFT با نسخهٔ پارامتر', run.status === 201 && run.json?.data?.status === 'DRAFT' && !!run.json?.data?.paramsVersion, `status=${run.status} n=${run.json?.data?.employeeCount}`);
const runId = run.json?.data?.id;
S.step('تعداد فیش = حکم‌های تأییدشده + کارمند جدید', run.json?.data?.employeeCount === approvedBefore + 1, `n=${run.json?.data?.employeeCount} (انتظار ${approvedBefore + 1})`);
const detail = await req('GET', `/payroll/runs/${runId}`, { token: T.accountant });
const slips = detail.json?.data?.slips ?? [];
let formulaOk = true;
for (const s of slips) if (BigInt(s.net) !== BigInt(s.gross) - BigInt(s.ins) - BigInt(s.tax)) formulaOk = false;
S.step('فرمول هر فیش: خالص = ناخالص − بیمه − مالیات', slips.length > 0 && formulaOk, `slips=${slips.length}`);
const sumSlips = slips.reduce((a, s) => a + BigInt(s.net), 0n);
const runRow = (await c.query(`select "netRials"::text as v from payroll_runs where id=$1`, [runId])).rows[0];
S.step('جمع فیش‌ها = جمع دوره', Number(runRow?.v) === Number(sumSlips), `run=${runRow?.v} slips=${sumSlips}`);

// ── تأیید دوره → سند ۵سطری متوازن با جمع فیش‌ها ──
const runAp = await req('POST', `/payroll/runs/${runId}/approve`, { token: T.approver });
S.step('تأیید دورهٔ حقوق', [200, 201].includes(runAp.status), `status=${runAp.status}`);
let payEntry = null;
for (let i = 0; i < 30; i++) { const e = await c.query(`select "entryNo" from journal_entries where "sourceModule"='payroll' and "sourceRef"=$1 and status='POSTED'`, [runId]); if (e.rows[0]) { payEntry = e.rows[0]; break; } await sleep(400); }
S.step('سند خودکار حقوق posted', !!payEntry, `entry=${payEntry?.entryNo}`);
const payLines = (await c.query(`select count(*)::int as n, coalesce(sum("debitRials"),0)::text as d, coalesce(sum("creditRials"),0)::text as cr from journal_lines where "entryId"=(select id from journal_entries where "entryNo"=$1)`, [payEntry?.entryNo])).rows[0];
const cr2102 = (await c.query(`select coalesce(sum("creditRials"),0)::text as v from journal_lines where "entryId"=(select id from journal_entries where "entryNo"=$1) and "accountCode"='2102'`, [payEntry?.entryNo])).rows[0];
// سطرها تک‌طرفه‌اند؛ توازن در سطح سند: Σبدهکار = Σبستانکار
S.step('سند حقوق ۵سطری متوازن و ۲۱۰۲ = خالص فیش‌ها', payLines?.n === 5 && Number(payLines?.d) === Number(payLines?.cr) && Number(cr2102?.v) === Number(sumSlips), `lines=${payLines?.n} d=${payLines?.d} cr=${payLines?.cr} 2102=${cr2102?.v}`);

// ── لیست‌های رسمی: بانک با شبای معتبر mod-97 ──
const bankList = (await req('GET', `/payroll/runs/${runId}/lists/bank`, { token: T.accountant })).json?.data ?? [];
S.step('لیست بانک = فیش‌ها', bankList.length === slips.length, `bank=${bankList.length} slips=${slips.length}`);
const allValid = bankList.every((r) => ibanValid(r.iban));
S.step('همهٔ شباهای لیست بانک mod-97 معتبر', allValid, `sample=${String(bankList[0]?.iban).slice(0, 8)}…`);
const taxList = (await req('GET', `/payroll/runs/${runId}/lists/tax`, { token: T.accountant })).json?.data ?? [];
const insList = (await req('GET', `/payroll/runs/${runId}/lists/insurance`, { token: T.accountant })).json?.data ?? [];
S.step('لیست مالیات و بیمه = فیش‌ها', taxList.length === slips.length && insList.length === slips.length, `tax=${taxList.length} ins=${insList.length}`);


// پاکسازی کارمند تست این اجرا — اول فیش‌ها، بعد حکم، بعد پرسنل (RESTRICT)
await c.query(`DELETE FROM payroll_slips WHERE "employeeId" IN (SELECT id FROM employees WHERE code=$1)`, [X.empCode]);
await c.query(`DELETE FROM salary_decisions WHERE "employeeId" IN (SELECT id FROM employees WHERE code=$1)`, [X.empCode]);
await c.query(`DELETE FROM employees WHERE code=$1`, [X.empCode]);

await c.end();
S.finish();
