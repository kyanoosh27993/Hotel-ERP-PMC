// 12-workflow.mjs — لایه ۱ / ماژول ۱۲: موتور گردش کار تأیید چندمرحله‌ای + امضای الکترونیکی (F8-T6)
import { Suite, req, login, db, sleep, TODAY } from './_lib.mjs';

const S = new Suite('12-workflow');
const T = {
  admin: await login('admin', true),
  accountant: await login('accountant', true),
  approver: await login('approver', true),
  frontdesk: await login('frontdesk', false),
};
const c = await db();
const stamp = Date.now().toString(36);
const uuid = () => crypto.randomUUID();

// ── ۱. تعریف‌های seed ──
const defs = (await req('GET', '/workflows/defs', { token: T.accountant })).json?.data ?? [];
S.step('چهار تعریف seed (journal/payroll/moadian/large-po)', defs.length >= 4, `count=${defs.length}`);
const po2 = defs.find((d) => d.code === 'WF-LARGE-PO');
S.step('WF-LARGE-PO دومرحله‌ای با خودتأییری ممنوع', po2?.steps?.length === 2 && po2.steps.every((s) => s.selfApproval === false),
  `steps=${po2?.steps?.length}`);

// ── ۲. ماتریس مجوز: پذیرش ۴۰۳ ──
const forb = await req('POST', '/workflows', { token: T.frontdesk, body: { defCode: 'WF-JOURNAL-POST', entityType: 'x', entityId: uuid(), title: 'x' } });
S.step('شروع نمونه توسط پذیرش → 403', forb.status === 403, `status=${forb.status}`);

// ── ۳. نمونهٔ دومرحله‌ای (WF-LARGE-PO) ──
const entA = uuid();
const start = await req('POST', '/workflows', {
  token: T.admin,
  body: { defCode: 'WF-LARGE-PO', entityType: 'purchase_order', entityId: entA, title: `PO بزرگ تست ${stamp}` },
});
S.step('شروع نمونه دومرحله‌ای → 201 IN_PROGRESS مرحله ۱', [200, 201].includes(start.status) && start.json?.data?.status === 'IN_PROGRESS' && start.json?.data?.currentStep === 1,
  `status=${start.status} step=${start.json?.data?.currentStep}`);
const instA = start.json?.data?.id;

// Idempotency شروع
const start2 = await req('POST', '/workflows', {
  token: T.admin,
  body: { defCode: 'WF-LARGE-PO', entityType: 'purchase_order', entityId: entA, title: `PO بزرگ تست ${stamp}` },
});
S.step('شروع مجدد همان نهاد → همان نمونه', start2.json?.data?.id === instA, `same=${start2.json?.data?.id === instA}`);

// خودتأییری: آغازگر (admin) مرحله ۱ را تأیید کند → 403
const selfApp = await req('POST', `/workflows/${instA}/approve`, { token: T.admin, body: {} });
S.step('خودتأییری آغازگر → 403', selfApp.status === 403, `status=${selfApp.status}`);

// مجوز ناکافی برای مرحله: حسابدار (workflow.act دارد، procurement.manage ندارد) → 403
const wrongPerm = await req('POST', `/workflows/${instA}/approve`, { token: T.accountant, body: {} });
S.step('تأیید مرحله ۱ با مجوز ناکافی (حسابدار) → 403', wrongPerm.status === 403, `status=${wrongPerm.status}`);

// تأیید مرحله ۱ توسط تأییدکننده → مرحله ۲
const app1 = await req('POST', `/workflows/${instA}/approve`, { token: T.approver, body: { comment: 'خرید مقتضی است' } });
S.step('تأیید مرحله ۱ → مرحله ۲', [200, 201].includes(app1.status) && app1.json?.data?.currentStep === 2,
  `step=${app1.json?.data?.currentStep}`);

// تأیید مرحله ۲ → APPROVED
const app2 = await req('POST', `/workflows/${instA}/approve`, { token: T.approver, body: { comment: 'تأیید مالی' } });
S.step('تأیید مرحله ۲ → APPROVED', [200, 201].includes(app2.status) && app2.json?.data?.status === 'APPROVED',
  `status=${app2.json?.data?.status}`);

// اقدام روی APPROVED → 409
const afterDone = await req('POST', `/workflows/${instA}/approve`, { token: T.approver, body: {} });
S.step('تأیید روی APPROVED → 409', afterDone.status === 409, `status=${afterDone.status}`);

// رویداد workflow.completed در outbox
let wfEvent = null;
for (let i = 0; i < 10; i++) {
  const r = await c.query(`select "eventName","idempotencyKey",payload from outbox_events where "aggregate"=$1`, [`workflow:${instA}`]);
  if (r.rows.length) { wfEvent = r.rows[0]; break; }
  await sleep(400);
}
S.step('رویداد workflow.completed در Outbox با idempotencyKey یکتا',
  wfEvent?.eventName === 'workflow.completed' && wfEvent?.idempotencyKey === `wf-complete:${instA}`,
  `event=${wfEvent?.eventName} key=${wfEvent?.idempotencyKey}`);
S.step('payload رویداد شامل entityType/entityId/defCode',
  wfEvent?.payload?.entityType === 'purchase_order' && wfEvent?.payload?.entityId === entA && wfEvent?.payload?.defCode === 'WF-LARGE-PO',
  `payload=${JSON.stringify(wfEvent?.payload ?? {}).slice(0, 120)}`);

// راستی‌آزمایی زنجیرهٔ سالم
const verifyOk = await req('GET', `/workflows/${instA}/verify`, { token: T.accountant });
S.step('verify زنجیرهٔ دست‌نخورده → valid=true', verifyOk.status === 200 && verifyOk.json?.data?.valid === true,
  `valid=${verifyOk.json?.data?.valid} checked=${verifyOk.json?.data?.actionsChecked}`);

// ── ۴. رد با دلیل اجباری ──
const entB = uuid();
const startB = await req('POST', '/workflows', {
  token: T.accountant,
  body: { defCode: 'WF-JOURNAL-POST', entityType: 'journal_entry', entityId: entB, title: `سند تست رد ${stamp}` },
});
const instB = startB.json?.data?.id;
const rejectNoReason = await req('POST', `/workflows/${instB}/reject`, { token: T.approver, body: { reason: '' } });
S.step('رد بدون دلیل → 409/400', [400, 409].includes(rejectNoReason.status), `status=${rejectNoReason.status}`);
const reject = await req('POST', `/workflows/${instB}/reject`, { token: T.approver, body: { reason: 'سند مغایر با اسناد پشتیبان' } });
S.step('رد توسط تأییدکننده → REJECTED', [200, 201].includes(reject.status) && reject.json?.data?.status === 'REJECTED',
  `status=${reject.json?.data?.status}`);
const afterReject = await req('POST', `/workflows/${instB}/approve`, { token: T.approver, body: {} });
S.step('تأیید روی REJECTED → 409', afterReject.status === 409, `status=${afterReject.status}`);
const verifyB = await req('GET', `/workflows/${instB}/verify`, { token: T.accountant });
S.step('verify زنجیرهٔ REJECTED → valid', verifyB.json?.data?.valid === true, `valid=${verifyB.json?.data?.valid}`);

// ── ۵. مرحلهٔ با دو تأییدکننده (minApprovers=2) + تأیید تکراری ──
const defC = await req('POST', '/workflows/defs', {
  token: T.admin,
  body: { code: `WF-TEST-DUAL-${stamp}`, title: 'تست دو تأییدکننده', steps: [{ order: 1, title: 'دو امضا', permission: 'journal.approve', minApprovers: 2, selfApproval: false }] },
});
S.step('تعریف گردش کار جدید توسط admin', [200, 201].includes(defC.status), `status=${defC.status}`);
const entC = uuid();
const startC = await req('POST', '/workflows', {
  token: T.accountant,
  body: { defCode: `WF-TEST-DUAL-${stamp}`, entityType: 'journal_entry', entityId: entC, title: `دو امضا ${stamp}` },
});
const instC = startC.json?.data?.id;
const appC1 = await req('POST', `/workflows/${instC}/approve`, { token: T.approver, body: {} });
S.step('امضای اول → هنوز IN_PROGRESS مرحله ۱', [200, 201].includes(appC1.status) && appC1.json?.data?.status === 'IN_PROGRESS',
  `step=${appC1.json?.data?.currentStep}`);
const appC1dup = await req('POST', `/workflows/${instC}/approve`, { token: T.approver, body: {} });
S.step('تأیید تکراری همان مرحله توسط همان کاربر → 409', appC1dup.status === 409, `status=${appC1dup.status}`);
const appC2 = await req('POST', `/workflows/${instC}/approve`, { token: T.admin, body: {} });
S.step('امضای دوم → APPROVED', [200, 201].includes(appC2.status) && appC2.json?.data?.status === 'APPROVED',
  `status=${appC2.json?.data?.status}`);

// ── ۶. تشخیص دست‌کاری ──
const tamper = await c.query(`update workflow_actions set signature='deadbeef' where "instanceId"=$1 and "stepNo"=1 returning id`, [instC]);
const verifyTampered = await req('GET', `/workflows/${instC}/verify`, { token: T.accountant });
S.step('verify پس از دست‌کاری → valid=false با محل شکست', verifyTampered.json?.data?.valid === false && verifyTampered.json?.data?.brokenAtStep === 1,
  `valid=${verifyTampered.json?.data?.valid} broken=${verifyTampered.json?.data?.brokenAtStep} reason=${verifyTampered.json?.data?.reason}`);

// ── ۷. لغو توسط آغازگر ──
const entD = uuid();
const startD = await req('POST', '/workflows', {
  token: T.accountant,
  body: { defCode: 'WF-JOURNAL-POST', entityType: 'journal_entry', entityId: entD, title: `لغو تست ${stamp}` },
});
const instD = startD.json?.data?.id;
const cancelByOther = await req('POST', `/workflows/${instD}/cancel`, { token: T.approver, body: {} });
S.step('لغو توسط غیرِ آغازگر → 403', cancelByOther.status === 403, `status=${cancelByOther.status}`);
const cancel = await req('POST', `/workflows/${instD}/cancel`, { token: T.accountant, body: {} });
S.step('لغو توسط آغازگر → CANCELLED', [200, 201].includes(cancel.status) && cancel.json?.data?.status === 'CANCELLED',
  `status=${cancel.json?.data?.status}`);

// ── ۸. لیست با فیلتر ──
const listApproved = await req('GET', '/workflows?status=APPROVED', { token: T.accountant });
S.step('لیست با فیلتر APPROVED', listApproved.status === 200 && (listApproved.json?.data ?? []).every((x) => x.status === 'APPROVED'),
  `count=${listApproved.json?.count}`);

// ── پاکسازی ──
await c.query(`delete from workflow_actions where "instanceId" in ($1,$2,$3,$4)`, [instA, instB, instC, instD]);
await c.query(`delete from workflow_instances where id in ($1,$2,$3,$4)`, [instA, instB, instC, instD]);
await c.query(`delete from outbox_events where "aggregate"=$1`, [`workflow:${instA}`]);
await c.query(`delete from workflow_defs where code=$1`, [`WF-TEST-DUAL-${stamp}`]);
await c.query(`delete from audit_logs where "entity"='WorkflowInstance'`).catch(() => {});

await c.end();
S.finish();
