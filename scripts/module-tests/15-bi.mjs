// 15-bi.mjs — موج ۴ / فاز ۱۱: BI و هوش مصنوعی — F11-T1..T6
import { Suite, req, login, db } from './_lib.mjs';

const S = new Suite('15-bi');
const T = {
  admin: await login('admin', true),
  accountant: await login('accountant', true),
  approver: await login('approver', true),
  frontdesk: await login('frontdesk', false),
  storekeeper: await login('storekeeper', false),
};
const c = await db();
const PERIOD = '1405-11';
const today = new Date().toISOString().slice(0, 10);

// شروع از حالت تمیز — بقایای اجرای قبلی
await c.query(`delete from "ai_doc_drafts"`);
await c.query(`delete from "ai_rate_suggestions"`);
await c.query(`delete from "bi_budgets"`);
await c.query(`delete from audit_logs where "action" like 'AI_%' or "action" like 'BI_%'`);

// ── ۱. RBAC ──
const forb = await req('GET', '/bi/anomalies', { token: T.frontdesk });
S.step('ناهنجاری توسط پذیرش → 403', forb.status === 403, `status=${forb.status}`);
const accView = await req('GET', '/bi/cashflow-forecast', { token: T.accountant });
S.step('پیش‌بینی جریان نقد توسط حسابدار → 200', accView.status === 200, `status=${accView.status}`);
const storek = await req('POST', '/bi/assistant', { token: T.storekeeper, body: { question: 'اشغال امروز' } });
S.step('دستیار توسط انباردار → 403', storek.status === 403, `status=${storek.status}`);

// ── ۲. F11-T1 — بودجه و واریانس ──
const bBad = await req('POST', '/bi/budget', { token: T.accountant, body: { taxYear: 1405, periodCode: PERIOD, costCenterCode: 'CC-ROOMS', revenueRials: '-5', costRials: '0' } });
S.step('بودجهٔ منفی → 400', bBad.status === 400, `status=${bBad.status}`);
const b1 = await req('POST', '/bi/budget', { token: T.accountant, body: { taxYear: 1405, periodCode: PERIOD, costCenterCode: 'CC-ROOMS', revenueRials: '30000000000', costRials: '12000000000', note: 'بودجهٔ آزمون' } });
S.step('ثبت بودجهٔ اتاق → 200/201', [200, 201].includes(b1.status) && b1.json?.data?.costCenterCode === 'CC-ROOMS', `status=${b1.status}`);
const b1b = await req('POST', '/bi/budget', { token: T.accountant, body: { taxYear: 1405, periodCode: PERIOD, costCenterCode: 'CC-ROOMS', revenueRials: '31000000000', costRials: '12500000000' } });
S.step('به‌روزرسانی بودجه (idempotent) → همان سطر', [200, 201].includes(b1b.status) && b1b.json?.data?.revenueRials === '31000000000', `rev=${b1b.json?.data?.revenueRials}`);
const b2 = await req('POST', '/bi/budget', { token: T.accountant, body: { taxYear: 1405, periodCode: PERIOD, costCenterCode: 'CC-FB', revenueRials: '15000000000', costRials: '9000000000' } });
S.step('ثبت بودجهٔ رستوران → 200/201', [200, 201].includes(b2.status), `status=${b2.status}`);
const blist = await req('GET', `/bi/budget?periodCode=${PERIOD}`, { token: T.accountant });
S.step('فهرست بودجهٔ دوره → ۲ سطر', blist.status === 200 && blist.json?.data?.length === 2, `n=${blist.json?.data?.length}`);
// واریانس نسبت به عملکرد واقعی DB — سطر اتاق باید بودجه داشته باشد
const deps = await req('GET', `/bi/departments?from=${today}&to=${today}&periodCode=${PERIOD}`, { token: T.admin });
const roomRow = (deps.json?.data?.rows ?? []).find((r) => r.costCenterCode === 'CC-ROOMS');
S.step('واریانس اتاق = عملکرد − بودجه (زنده)', deps.status === 200 && !!roomRow && roomRow.hasBudget === true,
  `cc=${roomRow?.costCenterCode} hasBudget=${roomRow?.hasBudget}`);
const vr = roomRow?.varianceRevenueRials != null ? BigInt(roomRow.varianceRevenueRials) : null;
const vrExpected = roomRow ? BigInt(roomRow.revenueRials) - 31_000_000_000n : null;
S.step('عدد واریانس دقیق = عملکرد − بودجه', vr !== null && vr === vrExpected, `variance=${vr} expect=${vrExpected}`);
const tot = deps.json?.data?.totals;
S.step('جمع بخش‌ها = جمع سطرها', tot && BigInt(tot.revenueRials) === (deps.json.data.rows ?? []).reduce((a, r) => a + BigInt(r.revenueRials), 0n), `rev=${tot?.revenueRials}`);

// ── ۳. F11-T2 — دستیار مدیر ──
const q1 = await req('POST', '/bi/assistant', { token: T.admin, body: { question: 'اشغال امروز چقدر است؟' } });
const occDb = (await c.query(`select count(*)::int n from stays s join stay_rooms sr on sr."stayId"=s.id where s.status='OPEN'`)).rows[0].n;
S.step('دستیار: اشغال = DB', [200,201].includes(q1.status) && q1.json?.data?.sources?.some((s) => s.label.includes('اقامت')) && q1.json.data.sources[0].value.startsWith(String(occDb)),
  `api=${q1.json?.data?.sources?.[0]?.value} db=${occDb}`);
S.step('دستیار: پاسخ با منبع داده', q1.json?.data?.sources?.length >= 1 && (q1.json?.data?.answer ?? '').length > 10, `src=${q1.json?.data?.sources?.length}`);
const revDbToday = (await c.query(`select coalesce(sum(l."creditRials"-l."debitRials"),0)::text v from journal_lines l join journal_entries e on e.id=l."entryId" where l."accountCode" in ('4101','4102','4103') and e.status='POSTED' and e."postingDate"::date=current_date`)).rows[0].v;
const q2 = await req('POST', '/bi/assistant', { token: T.admin, body: { question: 'درآمد امروز چقدر شد؟' } });
S.step('دستیار: درآمد امروز = DB خالص', [200,201].includes(q2.status) && BigInt(q2.json?.data?.sources?.[0]?.value ?? '0') === BigInt(revDbToday), `api=${q2.json?.data?.sources?.[0]?.value} db=${revDbToday}`);
const q3 = await req('POST', '/bi/assistant', { token: T.admin, body: { question: 'ماندهٔ صندوق چند است؟' } });
const cashDb = (await c.query(`select coalesce(sum(l."debitRials"-l."creditRials"),0)::text v from journal_lines l join journal_entries e on e.id=l."entryId" where l."accountCode"='1101' and e.status='POSTED'`)).rows[0].v;
S.step('دستیار: صندوق = ماندهٔ ۱۱۰۱', [200,201].includes(q3.status) && BigInt(q3.json?.data?.sources?.[0]?.value ?? '0') === BigInt(cashDb), `api=${q3.json?.data?.sources?.[0]?.value} db=${cashDb}`);
const q4 = await req('POST', '/bi/assistant', { token: T.admin, body: { question: 'قیمت پیتزا چند است؟' } });
S.step('دستیار: پرسش خارج از دامنه → فهرست توانمندی‌ها', [200,201].includes(q4.status) && (q4.json?.data?.answer ?? '').includes('اشغال'), `answer=${(q4.json?.data?.answer ?? '').slice(0, 40)}`);

// ── ۴. F11-T3 — جریان نقد ۱۳ هفته ──
const cf = await req('GET', '/bi/cashflow-forecast', { token: T.admin });
const cashBank = (await c.query(`select (coalesce(sum(case when l."accountCode"='1101' then l."debitRials"-l."creditRials" else 0 end)+coalesce(sum(case when l."accountCode"='1102' then l."debitRials"-l."creditRials" else 0 end)),0))::text v from journal_lines l join journal_entries e on e.id=l."entryId" where l."accountCode" in ('1101','1102') and e.status='POSTED'`)).rows[0].v;
S.step('ماندهٔ آغازین = صندوق+بانک DB', cf.status === 200 && BigInt(cf.json?.data?.startBalanceRials ?? '0') === BigInt(cashBank), `api=${cf.json?.data?.startBalanceRials} db=${cashBank}`);
S.step('۱۳ هفته با ساختار کامل', cf.json?.data?.weeks?.length === 13 && cf.json.data.weeks.every((w) => w.from && w.to && 'endBalanceRials' in w), `n=${cf.json?.data?.weeks?.length}`);
const w1 = cf.json.data.weeks[0];
const expectedEnd1 = BigInt(cf.json.data.startBalanceRials) + BigInt(w1.inflowRials) - BigInt(w1.outflowRials);
S.step('ماندهٔ هفتهٔ ۱ = آغاز+ورود−خروج', BigInt(w1.endBalanceRials) === expectedEnd1, `end=${w1.endBalanceRials} expect=${expectedEnd1}`);
S.step('پرچم کسری هفته‌ها هم‌خوان', cf.json.data.weeks.every((w) => w.deficit === (BigInt(w.endBalanceRials) < 0n)), `deficits=${cf.json.data.weeks.filter((w) => w.deficit).length}`);
const cfBad = await req('GET', '/bi/cashflow-forecast?weeks=40', { token: T.admin });
S.step('بازهٔ هفتهٔ نامعتبر → 400', cfBad.status === 400, `status=${cfBad.status}`);

// ── ۵. F11-T4 — سندزنی هوشمند ──
const docText = 'فروشنده شرکت پخش نوشیدنی پارس\nفاکتور INV-9911 تاریخ 2026-11-23\nمبلغ 11,400,000 ریال\nمالیات 1,140,000 ریال';
const doc = await req('POST', '/bi/smart-document', { token: T.accountant, body: { text: docText } });
const ex = doc.json?.data?.extracted ?? {};
const supDb = (await c.query(`select "nameFa" n from suppliers where active=true and "nameFa" is not null order by code limit 20`)).rows.map((r) => r.n).filter((n) => docText.includes(n))[0] ?? null;
S.step('استخراج مبلغ/مالیات/فروشنده (تطبیق واقعی DB)', [200,201].includes(doc.status) && ex.amountRials === 11_400_000 && ex.taxRials === 1_140_000 && ex.supplierNameFa === supDb, `amt=${ex.amountRials} tax=${ex.taxRials} sup=${ex.supplierNameFa}`);
const sug = doc.json?.data?.suggestedLines ?? [];
const sugDebit = sug.reduce((a, l) => a + BigInt(l.debit), 0n);
const sugCredit = sug.reduce((a, l) => a + BigInt(l.credit), 0n);
S.step('سطرهای پیشنهادی متوازن (۱۳۰۱+۲۲۰۴ / ۲۱۰۱)', sugDebit === 11_400_000n && sugCredit === 11_400_000n, `d=${sugDebit} c=${sugCredit}`);
const docList = await req('GET', '/bi/smart-document', { token: T.accountant });
S.step('فهرست پیش‌نویس‌ها شامل جدید', docList.status === 200 && docList.json?.data?.some((d) => d.id === doc.json.data.id), `n=${docList.json?.data?.length}`);
const appr = await req('POST', `/bi/smart-document/${doc.json.data.id}/approve`, { token: T.accountant });
S.step('تولید پیش‌نویس سند حسابداری (DRAFT نه POSTED)', [200, 201].includes(appr.status) && appr.json?.data?.entryNo?.startsWith('JV-'), `entry=${appr.json?.data?.entryNo}`);
const entryDb = appr.json?.data?.draftEntryId ? (await c.query(`select status, "sourceModule" from journal_entries where id=$1`, [appr.json.data.draftEntryId])).rows[0] : null;
S.step('سند ساخته‌شده DRAFT و منبع bi', entryDb && entryDb.status === 'DRAFT' && entryDb.sourceModule === 'bi', `status=${entryDb?.status} src=${entryDb?.sourceModule}`);
const apprAgain = await req('POST', `/bi/smart-document/${doc.json.data.id}/approve`, { token: T.accountant });
S.step('تأیید دوباره → 400', apprAgain.status === 400, `status=${apprAgain.status}`);
const discard = await req('POST', '/bi/smart-document', { token: T.accountant, body: { text: 'فاکتور تست دوم مبلغ 500,000 ریال بدون مالیات فروشنده ناشناس' } });
const disc = await req('POST', `/bi/smart-document/${discard.json.data.id}/discard`, { token: T.accountant });
S.step('کنارگذاری پیش‌نویس → DISCARDED', [200, 201].includes(disc.status) && disc.json?.data?.status === 'DISCARDED', `status=${disc.json?.data?.status}`);

// ── ۶. F11-T5 — Revenue AI ──
const rf = await req('GET', '/bi/revenue-forecast', { token: T.admin });
S.step('پیشنهاد نرخ برای انواع اتاق', rf.status === 200 && rf.json?.data?.suggestions?.length >= 1, `n=${rf.json?.data?.suggestions?.length}`);
const s0 = rf.json.data.suggestions[0];
const baseDb = (await c.query(`select "baseRateRials"::text v from room_types where code=$1`, [s0.roomTypeCode])).rows[0].v;
S.step('نرخ پایهٔ پیشنهاد = DB', BigInt(s0.baseRials) === BigInt(baseDb), `api=${s0.baseRials} db=${baseDb}`);
S.step('بازهٔ اطمینان منطقی (کمتر از پیشنهاد، بیشتر)', BigInt(s0.confidenceLow) < BigInt(s0.suggestedRials) && BigInt(s0.confidenceHigh) > BigInt(s0.suggestedRials), `low=${s0.confidenceLow} high=${s0.confidenceHigh}`);
const types = await req('GET', '/restaurant/menu', { token: T.admin });
const dec = await req('POST', `/bi/rate-suggestions/${s0.id}/decide`, { token: T.accountant, body: { action: 'APPROVE' } });
S.step('تصمیم مدیر (پذیرش) → APPROVED', [200, 201].includes(dec.status) && dec.json?.data?.status === 'APPROVED', `status=${dec.json?.data?.status}`);
const decAgain = await req('POST', `/bi/rate-suggestions/${s0.id}/decide`, { token: T.accountant, body: { action: 'REJECT' } });
S.step('تصمیم دوباره → 400', decAgain.status === 400, `status=${decAgain.status}`);
const rfBad = await req('POST', `/bi/rate-suggestions/${s0.id}/decide`, { token: T.accountant, body: { action: 'RESET' } });
S.step('اقدام نامعتبر → 400', rfBad.status === 400, `status=${rfBad.status}`);

// ── ۷. F11-T6 — ناهنجاری + احساسات ──
const an = await req('GET', '/bi/anomalies', { token: T.admin });
S.step('اسکن ناهنجاری → ساختار کامل', an.status === 200 && Array.isArray(an.json?.data?.findings) && an.json?.data?.sentiment, `findings=${an.json?.data?.findings?.length}`);
const dupRisk = an.json?.data?.findings?.some((f) => f.type === 'NEGATIVE_CASH') ?? false;
const cashBal = BigInt(cashDb);
S.step('پرچم صندوق منفی فقط در صورت منفی بودن واقعی', an.json?.data?.findings?.filter((f) => f.type === 'NEGATIVE_CASH').length === (cashBal < 0n ? 1 : 0), `cash=${cashBal}`);
const sentiment = an.json?.data?.sentiment;
S.step('احساسات: مجموع منفی+مثبت ≥ ۰ و نسبت بین ۰ و ۱', typeof sentiment?.ratio === 'number' && sentiment.ratio >= 0 && sentiment.ratio <= 1, `neg=${sentiment?.negativeCount} pos=${sentiment?.positiveCount}`);
const auditRow = (await c.query(`select count(*)::int n from audit_logs where "action" in ('AI_ASSISTANT','AI_DOC_DRAFT_CREATED','AI_DOC_DRAFT_ENTRY','AI_REVENUE_FORECAST','AI_RATE_APPROVE','BI_ANOMALIES','BI_BUDGET_UPSERT')`)).rows[0].n;
S.step('ردپای حسابرسی AI/BI ثبت شده', auditRow >= 5, `n=${auditRow}`);

// ── پاکسازی ──
const docEntryId = appr.json?.data?.draftEntryId;
if (docEntryId) {
  await c.query(`delete from "journal_lines" where "entryId"=$1`, [docEntryId]);
  await c.query(`delete from "journal_entries" where id=$1`, [docEntryId]);
}
await c.query(`delete from "ai_doc_drafts"`);
await c.query(`delete from "ai_rate_suggestions"`);
await c.query(`delete from "bi_budgets"`);
await c.query(`delete from audit_logs where "action" like 'AI_%' or "action" like 'BI_%'`);

await c.end();
S.finish();
