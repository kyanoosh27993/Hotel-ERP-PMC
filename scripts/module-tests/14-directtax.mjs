// 14-directtax.mjs — لایه ۱ / ماژول ۱۴: مالیات مستقیم — برنامهٔ عملکرد، اظهارنامه، طرف‌های معامله (F9-T5)
import { Suite, req, login, db, sleep } from './_lib.mjs';

const S = new Suite('14-directtax');
const T = {
  admin: await login('admin', true),
  accountant: await login('accountant', true),
  approver: await login('approver', true),
  frontdesk: await login('frontdesk', false),
};
const c = await db();
const YEAR = 1405;
const jKey = () => `dt-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// شروع از حالت تمیز — بقایای اجرای قبلی
await c.query(`delete from "direct_tax_returns"`);
await c.query(`delete from "direct_tax_plans"`);
await c.query(`delete from "workflow_actions"`);
await c.query(`delete from "workflow_instances"`);
await c.query(`delete from outbox_events where "eventName"='workflow.completed'`);
await c.query(`delete from audit_logs where "action" like 'DIRECTTAX%'`);
// دادهٔ مالی سال ۱۴۰۵ را خودمان می‌سازیم (سند قطعی) — سندهای قبلی تست‌های دیگر در بازه ممکن است باشند
// (محاسبه نسبت به DB مقایسه می‌شود نه عدد فرضی)

// ── ۱. RBAC ──
const forb = await req('GET', `/compliance/directtax/return?taxYear=${YEAR}`, { token: T.frontdesk });
S.step('اظهارنامه توسط پذیرش → 403', forb.status === 403, `status=${forb.status}`);
const accView = await req('GET', `/compliance/directtax/plan?taxYear=${YEAR}`, { token: T.accountant });
S.step('برنامهٔ عملکرد توسط حسابدار → 200 (خالی)', accView.status === 200 && accView.json?.data === null, `status=${accView.status} data=${accView.json?.data}`);

// ── ۲. برنامهٔ عملکرد ──
const badPlan = await req('POST', '/compliance/directtax/plan', { token: T.accountant, body: { taxYear: 12, planJson: {} } });
S.step('سال نامعتبر → 400', badPlan.status === 400, `status=${badPlan.status}`);
const plan = await req('POST', '/compliance/directtax/plan', {
  token: T.accountant,
  body: { taxYear: YEAR, planJson: { roomCapacity: 80, targetOccupancyPercent: 65, targetRevenueRials: '90000000000', employmentHeadcount: 42 } },
});
S.step('ثبت برنامهٔ عملکرد → DRAFT', [200, 201].includes(plan.status) && plan.json?.data?.status === 'DRAFT', `status=${plan.json?.data?.status}`);
const planUpd = await req('POST', '/compliance/directtax/plan', {
  token: T.accountant,
  body: { taxYear: YEAR, planJson: { roomCapacity: 84, targetOccupancyPercent: 66, targetRevenueRials: '92000000000', employmentHeadcount: 44 } },
});
S.step('به‌روزرسانی برنامهٔ DRAFT → 200', [200, 201].includes(planUpd.status) && planUpd.json?.data?.plan?.roomCapacity === 84, `rooms=${planUpd.json?.data?.plan?.roomCapacity}`);

// ── ۳. ارسال اظهارنامه بدون برنامهٔ تأییدشده → 409 ──
const submitNoPlan = await req('POST', '/compliance/directtax/return/submit', { token: T.accountant, body: { taxYear: YEAR } });
S.step('ارسال بدون برنامهٔ تأییدشده → 409', submitNoPlan.status === 409, `status=${submitNoPlan.status}`);
const planC = await req('POST', '/compliance/directtax/plan/confirm', { token: T.accountant, body: { taxYear: YEAR } });
S.step('تأیید برنامهٔ عملکرد → CONFIRMED', [200, 201].includes(planC.status) && planC.json?.data?.status === 'CONFIRMED', `status=${planC.json?.data?.status}`);
const planRe = await req('POST', '/compliance/directtax/plan', { token: T.accountant, body: { taxYear: YEAR, planJson: {} } });
S.step('ویرایش برنامهٔ تأییدشده → 409', planRe.status === 409, `status=${planRe.status}`);

// ── ۴. محاسبهٔ اظهارنامه — دادهٔ واقعی می‌سازیم ──
// سند فروش قطعی سال ۱۴۰۵: صندوق بدهکار / درآمد رستوران ۶۰م + مالیات فروش ۶م
const draft = await req('POST', '/journal-entries', { token: T.accountant, body: { description: 'فروش سالانهٔ F9-T5', lines: [
  { accountCode: '1101', debit: 66_000_000, credit: 0, costCenter: 'CC-FB' },
  { accountCode: '4102', debit: 0, credit: 60_000_000, costCenter: 'CC-FB' },
  { accountCode: '2201', debit: 0, credit: 6_000_000, costCenter: 'CC-FB' },
] } });
const draftId = draft.json?.data?.id;
const post1 = await req('POST', `/journal-entries/${draftId}/approve`, { token: T.approver, body: {} });
S.step('سند فروش ۱۴۰۵ قطعی شد', [200, 201].includes(post1.status) && post1.json?.data?.status === 'POSTED', `status=${post1.json?.data?.status}`);
// سند هزینهٔ حقوق + مالیات حقوق پرداختنی (پیش‌پرداخت): هزینه ۲۰م + مالیات کسرشده ۲م + بیمه ۶م
const draft2 = await req('POST', '/journal-entries', { token: T.accountant, body: { description: 'حقوق F9-T5', lines: [
  { accountCode: '5102', debit: 20_000_000, credit: 0 },
  { accountCode: '2203', debit: 0, credit: 2_000_000 },
  { accountCode: '2202', debit: 0, credit: 6_000_000 },
  { accountCode: '2101', debit: 0, credit: 12_000_000 },
] } });
const draftId2 = draft2.json?.data?.id;
const post2 = await req('POST', `/journal-entries/${draftId2}/approve`, { token: T.approver, body: {} });
S.step('سند حقوق+مالیات کسرشده قطعی شد', [200, 201].includes(post2.status) && post2.json?.data?.status === 'POSTED', `status=${post2.json?.data?.status}`);

// انتظار: درآمد حداقل ۶۰م (سایر درآمدهای سال ممکن است اضافه باشند) — مقایسه با DB
const dbSum = (await c.query(`
  select
    coalesce(sum(case when l."accountCode" in ('4101','4102','4103') then l."creditRials" - l."debitRials" else 0 end),0)::text as rev,
    coalesce(sum(case when l."accountCode" in ('5101','5102','5103','5104','5201') then l."debitRials" - l."creditRials" else 0 end),0)::text as cost,
    coalesce(sum(case when l."accountCode"='2203' then l."creditRials" else 0 end),0)::text as prepaid
  from journal_lines l join journal_entries e on e.id=l."entryId"
  where e.status='POSTED' and e."postingDate" >= $1 and e."postingDate" < $2`,
['2026-03-21', '2027-03-21'])).rows[0];
const comp = await req('POST', '/compliance/directtax/return/compute', { token: T.accountant, body: { taxYear: YEAR } });
S.step('محاسبهٔ اظهارنامه → DRAFT', [200, 201].includes(comp.status) && comp.json?.data?.status === 'DRAFT', `status=${comp.json?.data?.status}`);
S.step('درآمد = DB', comp.json?.data?.revenueRials === dbSum.rev, `api=${comp.json?.data?.revenueRials} db=${dbSum.rev}`);
S.step('هزینه = DB', comp.json?.data?.costRials === dbSum.cost, `api=${comp.json?.data?.costRials} db=${dbSum.cost}`);
S.step('پیش‌پرداخت (۲۲۰۳) = DB', comp.json?.data?.prepaidRials === dbSum.prepaid, `api=${comp.json?.data?.prepaidRials} db=${dbSum.prepaid}`);
// مالیات متعلق = مشمول × ۲۵٪ (مادهٔ ۱۰۵ از کتابخانهٔ قوانین)
const taxable = BigInt(dbSum.rev) > BigInt(dbSum.cost) ? BigInt(dbSum.rev) - BigInt(dbSum.cost) : 0n;
const expectDue = (taxable * 25n) / 100n;
S.step('مالیات متعلق = مشمول × ۲۵٪ (مادهٔ ۱۰۵)', comp.json?.data?.taxDueRials === expectDue.toString(),
  `api=${comp.json?.data?.taxDueRials} expect=${expectDue.toString()}`);
const comp2 = await req('POST', '/compliance/directtax/return/compute', { token: T.accountant, body: { taxYear: YEAR } });
S.step('محاسبهٔ مجدد Idempotent (DRAFT)', [200, 201].includes(comp2.status) && comp2.json?.data?.revenueRials === dbSum.rev, `status=${comp2.status}`);

// ── ۵. شناسهٔ طرف‌های معامله — معاملهٔ فصلی با شناسه + معاملهٔ ناقص ──
const cpBefore = (await req('GET', `/compliance/directtax/counterparties?taxYear=${YEAR}`, { token: T.accountant })).json?.data;
await req('POST', '/compliance/quarterly', {
  token: T.accountant,
  body: { taxYear: YEAR, quarter: 3, txType: 'SALE', counterpartyName: 'شرکت نمایشگاه بین‌المللی', counterpartyTin: '10861234567', amountRials: '15000000', vatRials: '1500000', txDate: '2026-11-10', docRef: 'DT-CP-1' },
});
await req('POST', '/compliance/quarterly', {
  token: T.accountant,
  body: { taxYear: YEAR, quarter: 3, txType: 'SALE', counterpartyName: 'مشتری ناشناس POS', counterpartyTin: '-', amountRials: '5000000', txDate: '2026-11-12', docRef: 'DT-CP-2' },
});
const cp = await req('GET', `/compliance/directtax/counterparties?taxYear=${YEAR}`, { token: T.accountant });
const rows = cp.json?.data?.rows ?? [];
S.step('طرف‌های معامله تجمیع شد (دست‌کم ۲ سطر)', cp.status === 200 && rows.length >= (cpBefore?.count ?? 0) + 2, `count=${cp.json?.data?.count}`);
const known = rows.find((r) => r.tin === '10861234567');
S.step('سطر کامل با شناسهٔ ملی + فروش ۱۵م', known?.complete === true && known?.saleRials === '15000000', `tin=${known?.tin} sale=${known?.saleRials}`);
const noTin = rows.find((r) => r.tin === null);
S.step('سطر ناقص بدون شناسه پرچم‌خورده', noTin?.complete === false && cp.json?.data?.incomplete >= 1, `incomplete=${cp.json?.data?.incomplete}`);

// ── ۶. ارسال اظهارنامه — فقط با تأیید انسانی ──
const submit = await req('POST', '/compliance/directtax/return/submit', { token: T.accountant, body: { taxYear: YEAR } });
S.step('درخواست ارسال → نمونهٔ گردش کار IN_PROGRESS', [200, 201].includes(submit.status) && submit.json?.data?.status === 'IN_PROGRESS', `status=${submit.json?.data?.status}`);
const wfId = submit.json?.data?.id;
const submitAgain = await req('POST', '/compliance/directtax/return/submit', { token: T.accountant, body: { taxYear: YEAR } });
S.step('درخواست دوباره → همان نمونه (Idempotent)', submitAgain.json?.data?.id === wfId, `same=${submitAgain.json?.data?.id === wfId}`);
const selfApp = await req('POST', `/workflows/${wfId}/approve`, { token: T.accountant, body: {} });
S.step('خودتأییری آغازگر ارسال → 403', selfApp.status === 403, `status=${selfApp.status}`);
const expDraft = await req('GET', `/compliance/directtax/export?taxYear=${YEAR}`, { token: T.accountant });
S.step('فایل استاندارد قبل از تأیید → 409', expDraft.status === 409, `status=${expDraft.status}`);
const app = await req('POST', `/workflows/${wfId}/approve`, { token: T.approver, body: { comment: 'اظهارنامهٔ عملکرد ۱۴۰۵ مطابق دفاتر است' } });
S.step('تأیید توسط تأییدکننده → APPROVED', [200, 201].includes(app.status) && app.json?.data?.status === 'APPROVED', `status=${app.json?.data?.status}`);

let submitted = null;
for (let i = 0; i < 25; i++) {
  const st = await req('GET', `/compliance/directtax/return?taxYear=${YEAR}`, { token: T.accountant });
  if (st.json?.data?.status === 'SUBMITTED') { submitted = st.json.data; break; }
  await sleep(1000);
}
S.step('پس از تأیید → اظهارنامه SUBMITTED (مصرف‌کنندهٔ workflow.completed)', submitted?.status === 'SUBMITTED', `status=${submitted?.status ?? 'DRAFT'}`);
S.step('submittedBy = تأییدکننده ثبت شد', !!submitted?.submittedById, `by=${submitted?.submittedById ? 'yes' : 'no'}`);

// ── ۷. پس از ارسال: قفل‌ها + فایل ──
const compAfter = await req('POST', '/compliance/directtax/return/compute', { token: T.accountant, body: { taxYear: YEAR } });
S.step('محاسبه روی اظهارنامهٔ ارسال‌شده → 409', compAfter.status === 409, `status=${compAfter.status}`);
const exp = await req('GET', `/compliance/directtax/export?taxYear=${YEAR}`, { token: T.admin });
const expText = exp.raw ?? '';
S.step('فایل استاندارد پس از تأیید → 200 با سه بخش', exp.status === 200 && expText.includes('اظهارنامه') && expText.includes('برنامه عملکرد') && expText.includes('شناسهٔ طرف‌های معامله'),
  `status=${exp.status} sections=${expText.split('\n').length}`);
const ev = await c.query(`select "idempotencyKey" from outbox_events where "eventName"='workflow.completed' order by "createdAt" desc limit 1`);
S.step('رویداد تکمیل در Outbox با کلید یکتا', ev.rows[0]?.idempotencyKey === `wf-complete:${wfId}`, `key=${ev.rows[0]?.idempotencyKey}`);

// ── ۸. بازگشایی فقط admin ──
const reAcc = await req('POST', '/compliance/directtax/return/reopen', { token: T.accountant, body: { taxYear: YEAR } });
S.step('بازگشایی توسط حسابدار → 403', reAcc.status === 403, `status=${reAcc.status}`);
const reAdm = await req('POST', '/compliance/directtax/return/reopen', { token: T.admin, body: { taxYear: YEAR } });
S.step('بازگشایی توسط admin → DRAFT', [200, 201].includes(reAdm.status) && reAdm.json?.data?.status === 'DRAFT', `status=${reAdm.json?.data?.status}`);
const comp3 = await req('POST', '/compliance/directtax/return/compute', { token: T.accountant, body: { taxYear: YEAR } });
S.step('محاسبهٔ مجدد پس از بازگشایی → 200', [200, 201].includes(comp3.status), `status=${comp3.status}`);

// ── پاکسازی ──
await c.query(`delete from "direct_tax_returns"`);
await c.query(`delete from "direct_tax_plans"`);
await c.query(`delete from "workflow_actions"`);
await c.query(`delete from "workflow_instances"`);
await c.query(`delete from outbox_events where "eventName"='workflow.completed'`);
await c.query(`delete from audit_logs where "action" like 'DIRECTTAX%'`);
// سندها و معاملات ساخته‌شدهٔ این تست
await c.query(`delete from "quarterly_txs" where "docRef" in ('DT-CP-1','DT-CP-2')`);
await c.query(`delete from "quarterly_periods" where "taxYear"=$1`, [YEAR]);
await c.query(`delete from "journal_lines" where "entryId" in ($1,$2)`, [draftId, draftId2]).catch(async () => {
  await c.query(`delete from "journal_lines" where "entryId"=$1`, [draftId]);
  await c.query(`delete from "journal_lines" where "entryId"=$1`, [draftId2]);
});
await c.query(`delete from "journal_entries" where id in ($1,$2)`, [draftId, draftId2]);
await c.query(`delete from audit_logs where "action" like 'QUARTERLY%'`);

await c.end();
S.finish();
