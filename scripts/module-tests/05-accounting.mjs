// 05-accounting.mjs — لایه ۱ / ماژول ۵: سند دستی، دفاتر، تراز آزمایشی، صورت سود و زیان، بستن دوره
import { Suite, req, login, db, TODAY } from './_lib.mjs';

const S = new Suite('05-accounting');
const T = { admin: await login('admin', true), accountant: await login('accountant', true), approver: await login('approver', true), frontdesk: await login('frontdesk', false) };
const c = await db();

// ریست جداول حسابداری + بازگشایی دوره‌های ماه جاری
await c.query(`TRUNCATE "journal_attachments","journal_lines","journal_entries","outbox_events","inbox_events","audit_logs" CASCADE`);
await c.query(`UPDATE "fiscal_periods" SET "status" = CASE WHEN "endDate" < date_trunc('month', now()) THEN 'LOCKED'::fiscal_period_status ELSE 'OPEN'::fiscal_period_status END, "lockedAt" = CASE WHEN "endDate" < date_trunc('month', now()) THEN now() ELSE NULL END, "closedAt"=NULL, "closingEntryId"=NULL`);

const jKey = () => `m05-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// ── سند نامتوازن → 400 ──
const unbal = await req('POST', '/journal-entries', { token: T.accountant, body: { description: 'نامتوازن', lines: [{ accountCode: '1101', debit: 1_000_000, credit: 0 }, { accountCode: '4101', debit: 0, credit: 900_000 }] } });
S.step('سند نامتوازن → 400', unbal.status === 400, `status=${unbal.status}`);

// ── سند متوازن سه‌سطری → پیش‌نویس → خواندن مجدد ──
const draft = await req('POST', '/journal-entries', { token: T.accountant, body: { description: 'فروش نقدی ماژول۵', lines: [
  { accountCode: '1101', debit: 1_090_000, credit: 0, costCenter: 'CC-FB' },
  { accountCode: '4102', debit: 0, credit: 1_000_000, costCenter: 'CC-FB' },
  { accountCode: '2201', debit: 0, credit: 90_000, costCenter: 'CC-FB' },
] } });
S.step('سند متوازن → پیش‌نویس', draft.status === 201, `status=${draft.status}`);
const draftId = draft.json?.data?.id;
const list = (await req('GET', '/journal-entries?limit=50', { token: T.accountant })).json?.data ?? [];
const got = list.find((e) => e.id === draftId);
S.step('خواندن مجدد: ۳ سطر با مرکز هزینه و شماره سطر', got?.lines?.length === 3 && got.lines[0]?.costCenterCode === 'CC-FB' && got.lines[0]?.lineNo === 1, `lines=${JSON.stringify(got?.lines?.slice(0, 1))}`);

// ── تأیید: فقط تأییدکننده؛ شماره عطف پیوسته ──
const selfAp = await req('POST', `/journal-entries/${draftId}/approve`, { token: T.accountant, body: {} });
S.step('حسابدار اجازه تأیید سند خود را ندارد → 403', selfAp.status === 403, `status=${selfAp.status}`);
const ap = await req('POST', `/journal-entries/${draftId}/approve`, { token: T.approver, body: {} });
S.step('تأییدکننده سند را posted می‌کند', [200, 201].includes(ap.status), `status=${ap.status}`);
const postedRow = (await c.query(`select "docIndex"::text as di, "entryNo", status from journal_entries where id=$1`, [draftId])).rows[0];
S.step('شماره عطف (docIndex) تخصیص شد', postedRow?.status === 'POSTED' && Number(postedRow?.di) >= 1, `docIndex=${postedRow?.di} entryNo=${postedRow?.entryNo}`);
const diSeq = (await c.query(`select "docIndex"::text as di from journal_entries where status='POSTED' order by "docIndex" desc limit 2`)).rows;
S.step('docIndex بدون پرش', diSeq.length === 1 || Number(diSeq[1]?.di) === Number(diSeq[0]?.di) - 1, `top=${diSeq.map((r) => r.di).join(',')}`);

// ── تأیید دوباره → رد (idempotent رفتار) ──
const reap = await req('POST', `/journal-entries/${draftId}/approve`, { token: T.approver, body: {} });
S.step('تأیید دوباره سند posted → 400/409', [400, 409].includes(reap.status), `status=${reap.status}`);

// ── دفتر معین ۱۱۰۱ ──
const sub = await req('GET', '/journal-entries/ledgers/subsidiary/1101?from=' + TODAY + '&to=' + TODAY, { token: T.accountant });
const dbSum = (await c.query(`select coalesce(sum(l."debitRials"-l."creditRials"),0)::text as v from journal_lines l join journal_entries e on e.id=l."entryId" where l."accountCode"='1101' and e.status='POSTED' and e."postingDate"::date=current_date`)).rows[0];
S.step('دفتر معین ۱۱۰۱: ماندهٔ پایانی = DB', sub.status === 200 && Number(sub.json?.meta?.closingBalance) === Number(dbSum.v), `api=${sub.json?.meta?.closingBalance} db=${dbSum.v}`);

// ── تراز آزمایشی متوازن = DB ──
const tb = await req('GET', `/journal-entries/trial-balance?from=${TODAY}&to=${TODAY}`, { token: T.accountant });
const turn = (await c.query(`select coalesce(sum(l."debitRials"),0)::text as d, coalesce(sum(l."creditRials"),0)::text as cr from journal_lines l join journal_entries e on e.id=l."entryId" where e.status='POSTED' and e."postingDate"::date=current_date`)).rows[0];
S.step('تراز آزمایشی: گردش بدهکار/بستانکار = DB و متوازن', Number(turn.d) === Number(tb.json?.meta?.totals?.periodDebit) && Number(turn.cr) === Number(tb.json?.meta?.totals?.periodCredit) && tb.json?.meta?.balanced === true, `db=${turn.d}/${turn.cr} api=${tb.json?.meta?.totals?.periodDebit}/${tb.json?.meta?.totals?.periodCredit}`);

// ── صورت سود و زیان = DB ──
const pnl = await req('GET', `/journal-entries/statements/income?from=${TODAY}&to=${TODAY}`, { token: T.accountant });
const pnlDb = (await c.query(`select a.type, coalesce(sum(case when a.type='REVENUE' then l."creditRials"-l."debitRials" else l."debitRials"-l."creditRials" end),0)::text as v from journal_lines l join journal_entries e on e.id=l."entryId" join accounts a on a.code=l."accountCode" where e.status='POSTED' and e."postingDate"::date=current_date group by a.type`)).rows;
const rev = Number(pnlDb.find((r) => r.type === 'REVENUE')?.v ?? 0);
const exp = Number(pnlDb.find((r) => r.type === 'EXPENSE')?.v ?? 0);
S.step('سود و زیان = درآمدDB − هزینهDB', pnl.json?.totals?.netIncome === rev - exp, `api=${pnl.json?.totals?.netIncome} db=${rev - exp}`);

// ── ثبت در دورهٔ قفل‌شده → رد ──
const lockedPeriod = (await c.query(`select code from fiscal_periods where status='LOCKED' order by "endDate" desc limit 1`)).rows[0]?.code;
const lastDayOfLocked = (await c.query(`select "endDate"::text as d from fiscal_periods where code=$1`, [lockedPeriod])).rows[0]?.d;
const lockedTry = await req('POST', '/journal-entries', { token: T.accountant, body: { description: 'در دوره قفل', postingDate: lastDayOfLocked, lines: [{ accountCode: '1101', debit: 1000, credit: 0 }, { accountCode: '4101', debit: 0, credit: 1000 }] } });
S.step('سند در دورهٔ LOCKED → 400', lockedTry.status === 400, `status=${lockedTry.status} period=${lockedPeriod}`);

// ── بستن دورهٔ جاری: سند اختتام + قفل ──
const curPeriod = (await c.query(`select code from fiscal_periods where status='OPEN' order by "startDate" limit 1`)).rows[0]?.code;
const close = await req('POST', `/journal-entries/periods/${curPeriod}/close`, { token: T.accountant, body: {} });
S.step('بستن دورهٔ جاری', [200, 201].includes(close.status), `status=${close.status} ${JSON.stringify(close.json?.error ?? close.json ?? {}).slice(0, 120)}`);
const closedRow = (await c.query(`select status, "closedAt", "closingEntryId" from fiscal_periods where code=$1`, [curPeriod])).rows[0];
// مدل دامنه: بسته = LOCKED با closedAt و سند اختتام
S.step('دوره بسته شد (LOCKED + closedAt + سند اختتام)', closedRow?.status === 'LOCKED' && !!closedRow?.closedAt && !!closedRow?.closingEntryId, `status=${closedRow?.status} closedAt=${!!closedRow?.closedAt}`);
const closeEntry = (await c.query(`select coalesce(sum(l."debitRials"),0)::text as d, coalesce(sum(l."creditRials"),0)::text as cr, count(*)::int as n from journal_lines l where l."entryId"=$1`, [closedRow?.closingEntryId])).rows[0];
// سند اختتام در سطح سند متوازن است (جمع بدهکار = جمع بستانکار)؛ سطرها تک‌طرفه‌اند
S.step('سند اختتام متوازن (جمع بدهکار = جمع بستانکار)', closeEntry?.n > 0 && Number(closeEntry?.d) === Number(closeEntry?.cr) && Number(closeEntry?.d) > 0, `lines=${closeEntry?.n} d=${closeEntry?.d} cr=${closeEntry?.cr}`);
const closeAfter = await req('POST', `/journal-entries/periods/${curPeriod}/close`, { token: T.accountant, body: {} });
S.step('بستن دوباره دورهٔ بسته → 400/409', [400, 409].includes(closeAfter.status), `status=${closeAfter.status}`);

// ── بازگشایی دوره برای اسکریپت‌های بعدی (بازگردانی وضعیت پایه) ──
await c.query(`UPDATE "fiscal_periods" SET "status"='OPEN'::fiscal_period_status, "lockedAt"=NULL, "closedAt"=NULL, "closingEntryId"=NULL WHERE "endDate" >= date_trunc('month', now())`);

await c.end();
S.finish();
