// 11-moadian.mjs — لایه ۱ / ماژول ۱۱: ادغام مؤدیان — صورتحساب الکترونیکی (F9-T2)
import { Suite, req, login, db, sleep, TODAY } from './_lib.mjs';

const S = new Suite('11-moadian');
const T = {
  admin: await login('admin', true),
  accountant: await login('accountant', true),
  approver: await login('approver', true),
  frontdesk: await login('frontdesk', false),
};
const c = await db();

// ── آماده‌سازی: یک سند فروش قطعی (POSTED) با درآمد ۴۱۰۲ + مالیات ۲۲۰۱ + صندوق ۱۱۰۱ ──
const NET = 5_000_000n;
const VAT = 500_000n; // ۱۰٪
const TOTAL = NET + VAT;
const stamp = Date.now().toString(36);
const entryNo = `JV-MOD-${stamp}`;
const desc = `فروش تست مؤدیان ${stamp}`;
await c.query(
  `insert into journal_entries ("entryNo","entryDate","postingDate","description","status","sourceModule","sourceRef","docIndex","updatedAt")
   values ($1, current_date, current_date, $2, 'POSTED', 'moadian-test', $3, nextval('seq_journal_docindex'), now())`,
  [entryNo, desc, stamp],
);
const entryRow = (await c.query(`select id from journal_entries where "entryNo"=$1`, [entryNo])).rows[0];
const entryId = entryRow.id;
await c.query(
  `insert into journal_lines ("entryId","lineNo","accountCode","debitRials","creditRials") values
     ($1, 1, '1101', $2, 0),
     ($1, 2, '4102', 0, $3),
     ($1, 3, '2201', 0, $4)`,
  [entryId, TOTAL.toString(), NET.toString(), VAT.toString()],
);

// ── ۱. تولید صورتحساب از سند قطعی توسط حسابدار ──
const gen = await req('POST', '/compliance/moadian/invoices', {
  token: T.accountant,
  body: { journalEntryId: entryId, buyerTaxId: '140100000000', buyerName: 'مهمان نمونه' },
});
S.step('تولید صورتحساب → 201 QUEUED', gen.status === 201 && gen.json?.data?.status === 'QUEUED',
  `status=${gen.status} inv=${gen.json?.data?.invoiceNumber} st=${gen.json?.data?.status}`);
const inv = gen.json?.data;
S.step('مجموع = خالص + مالیات سند', inv && inv.totalRials === String(NET) && inv.vatRials === String(VAT),
  `total=${inv?.totalRials} vat=${inv?.vatRials} (expect ${NET}/${VAT})`);
S.step('شماره صورتحساب با پیشوند INV- و توالی', !!inv?.invoiceNumber && /^INV-\d{2}-\d{6}$/.test(inv.invoiceNumber),
  `no=${inv?.invoiceNumber}`);

// ── ۲. ماتریس مجوز: پذیرش ۴۰۳ ──
const forb = await req('POST', '/compliance/moadian/invoices', {
  token: T.frontdesk,
  body: { journalEntryId: entryId },
});
S.step('تولید توسط پذیرش → 403', forb.status === 403, `status=${forb.status}`);

// ── ۳. Idempotency: تولید مجدد همان سند → همان صورتحساب ──
const dup = await req('POST', '/compliance/moadian/invoices', {
  token: T.accountant,
  body: { journalEntryId: entryId, buyerTaxId: '140100000000', buyerName: 'مهمان نمونه' },
});
S.step('تولید مجدد همان سند → همان صورتحساب (Idempotent)', dup.status === 201 && dup.json?.data?.invoiceNumber === inv.invoiceNumber,
  `dup=${dup.json?.data?.invoiceNumber} vs ${inv.invoiceNumber}`);

// ── ۴. سند غیرقطعی → 409 ──
await c.query(`insert into journal_entries ("entryNo","entryDate","postingDate","description","status","sourceModule","sourceRef","updatedAt") values ($1, current_date, current_date, 'draft', 'DRAFT', 'moadian-test', $2, now())`, [`JV-DRAFT-${stamp}`, stamp]);
const draftRow = (await c.query(`select id from journal_entries where "entryNo"=$1`, [`JV-DRAFT-${stamp}`])).rows[0];
const draftGen = await req('POST', '/compliance/moadian/invoices', { token: T.accountant, body: { journalEntryId: draftRow.id } });
S.step('سند پیش‌نویس → 409', draftGen.status === 409, `status=${draftGen.status}`);

// ── ۵. سند بدون خط مالیات → 400 ──
await c.query(`insert into journal_entries ("entryNo","entryDate","postingDate","description","status","sourceModule","sourceRef","docIndex","updatedAt") values ($1, current_date, current_date, 'no-vat', 'POSTED', 'moadian-test', $2, nextval('seq_journal_docindex'), now())`, [`JV-NOVAT-${stamp}`, stamp]);
const novatRow = (await c.query(`select id from journal_entries where "entryNo"=$1`, [`JV-NOVAT-${stamp}`])).rows[0];
await c.query(`insert into journal_lines ("entryId","lineNo","accountCode","debitRials","creditRials") values ($1, 1, '1101', $2, 0), ($1, 2, '4102', 0, $3)`, [novatRow.id, String(NET), String(NET)]);
const novatGen = await req('POST', '/compliance/moadian/invoices', { token: T.accountant, body: { journalEntryId: novatRow.id } });
S.step('سند بدون خط VAT → 400', novatGen.status === 400, `status=${novatGen.status}`);

// ── ۶. صف Outbox → ارسال → ACCEPTED + uid (poll تا ۱۵ث) ──
let accepted = null;
for (let i = 0; i < 30; i++) {
  const g = await req('GET', `/compliance/moadian/invoices/${inv.id}`, { token: T.accountant });
  if (g.json?.data?.status === 'ACCEPTED') { accepted = g.json.data; break; }
  await sleep(500);
}
S.step('صف ارسال → ACCEPTED + uid', !!accepted && !!accepted.uid, `status=${accepted?.status} uid=${accepted?.uid}`);
S.step('زمان ارسال ثبت شده', !!accepted?.submittedAt, `submittedAt=${accepted?.submittedAt}`);

// ── ۷. وضعیت زندهٔ سندباکس ──
const live = await req('GET', `/compliance/moadian/invoices/${inv.id}/status`, { token: T.accountant });
S.step('وضعیت زندهٔ سندباکس = ACCEPTED', live.status === 200 && live.json?.data?.sandboxStatus === 'ACCEPTED',
  `sandbox=${live.json?.data?.sandboxStatus}`);

// ── ۸. لیست صورتحساب‌ها ──
const list = await req('GET', '/compliance/moadian/invoices', { token: T.accountant });
S.step('لیست صورتحساب‌ها شامل مورد تست', list.status === 200 && (list.json?.data ?? []).some((x) => x.invoiceNumber === inv.invoiceNumber),
  `count=${list.json?.count}`);
const listFiltered = await req('GET', '/compliance/moadian/invoices?status=ACCEPTED', { token: T.accountant });
S.step('فیلتر وضعیت ACCEPTED', listFiltered.status === 200 && (listFiltered.json?.data ?? []).every((x) => x.status === 'ACCEPTED'),
  `count=${listFiltered.json?.count}`);

// ── ۹. لغو بدون دلیل → 400؛ با دلیل → 200 CANCELLED ──
const cancelNoReason = await req('POST', `/compliance/moadian/invoices/${inv.id}/cancel`, { token: T.approver, body: { reason: '' } });
S.step('لغو بدون دلیل → 400', cancelNoReason.status === 400, `status=${cancelNoReason.status}`);
const cancelByAccountant = await req('POST', `/compliance/moadian/invoices/${inv.id}/cancel`, { token: T.accountant, body: { reason: 'ابطال تست' } });
S.step('لغو توسط حسابدار → 403 (فقط approver)', cancelByAccountant.status === 403, `status=${cancelByAccountant.status}`);
const cancel = await req('POST', `/compliance/moadian/invoices/${inv.id}/cancel`, { token: T.approver, body: { reason: 'ابطال تست مؤدیان' } });
S.step('لغو توسط تأییدکننده → 2xx CANCELLED', [200, 201].includes(cancel.status) && cancel.json?.data?.status === 'CANCELLED',
  `status=${cancel.status} st=${cancel.json?.data?.status}`);
const cancelAgain = await req('POST', `/compliance/moadian/invoices/${inv.id}/cancel`, { token: T.approver, body: { reason: 'دوباره' } });
S.step('لغوی دوباره → 409', cancelAgain.status === 409, `status=${cancelAgain.status}`);

// ── ۱۰. تلاش مجدد روی CANCELLED → 409 ──
const retry = await req('POST', `/compliance/moadian/invoices/${inv.id}/retry`, { token: T.accountant });
S.step('تلاش مجدد روی CANCELLED → 409', retry.status === 409, `status=${retry.status}`);

// ── پاکسازی ──
await c.query(`delete from moadian_invoices where "journalEntryId" in ($1, $2)`, [entryId, novatRow.id]);
await c.query(`delete from journal_lines where "entryId" in ($1, $2, $3)`, [entryId, draftRow.id, novatRow.id]);
await c.query(`delete from journal_entries where "entryNo" like 'JV-%-${stamp}'`);
await c.query(`delete from audit_logs where "entity"='MoadianInvoice' and "reason" like '%${stamp}%'`).catch(() => {});
await c.query(`delete from outbox_events where "aggregate" like 'moadian:%'`).catch(() => {});

await c.end();
S.finish();
