// 19-plans.mjs — نسخهٔ ۳٫۴: پلان تور/شرکت، کدینگ درآمدی، تفکیک فولیو و فاکتور رسمی به نام هر طرف
import { Suite, req, login, db, ensureParty, day } from './_lib.mjs';

const S = new Suite('19-plans');
const T = {
  admin: await login('admin', true),
  accountant: await login('accountant', true),
  frontdesk: await login('frontdesk', false),
};
const c = await db();
const stamp = Date.now().toString(36);

// شروع تمیز
await c.query(`delete from moadian_invoices where "invoiceNumber" like 'DRAFT-FOLIO-%'`);
await c.query(`delete from rooms where code in ('902')`);
await c.query(`delete from plans where code = 4 or "nameFa" like 'پلان تست%'`);
await c.query(`delete from revenue_codes where code > 24 or code < 0`);

// ── ۱. RBAC ──
const f1 = await req('GET', '/pms/plans', { token: T.accountant });
S.step('پلان‌ها توسط حسابدار → 403', f1.status === 403, `status=${f1.status}`);
const plans0 = await req('GET', '/pms/plans', { token: T.frontdesk });
S.step('پلان‌های seed توسط پذیرش → 200 (۳ پلان مرجع)', plans0.status === 200 && (plans0.json?.data ?? []).length >= 3, `n=${plans0.json?.data?.length}`);
const allCharge = (plans0.json?.data ?? []).find((p) => p.code === 1);
S.step('پلان ۱ «کلیه هزینه ها بعهده تور/شرکت» با اقلام', !!allCharge && allCharge.itemsCount > 0, `items=${allCharge?.itemsCount}`);

// ── ۲. کدینگ درآمدی ──
const rcs = await req('GET', '/pms/revenue-codes', { token: T.admin });
S.step('دیکشنری کدینگ → ۲۴ کد seed', rcs.status === 200 && (rcs.json?.data ?? []).length >= 24, `n=${rcs.json?.data?.length}`);
const rcAuto = await req('POST', '/pms/revenue-codes', { token: T.admin, body: { nameFa: 'درآمد تست پلان' } });
S.step('ساخت کد با شماره‌گذاری خودکار → ۲۵', [200, 201].includes(rcAuto.status) && rcAuto.json?.data?.code === 25, `code=${rcAuto.json?.data?.code}`);
const rcId = rcAuto.json?.data?.id;
const rcDup = await req('POST', '/pms/revenue-codes', { token: T.admin, body: { code: 25, nameFa: 'دوباره' } });
S.step('کد تکراری → 409', rcDup.status === 409, `status=${rcDup.status}`);
const rcUp = await req('PATCH', `/pms/revenue-codes/${rcId}`, { token: T.admin, body: { nameFa: 'درآمد تست ویرایش' } });
S.step('تصحیح کد درآمدی → 200', [200, 201].includes(rcUp.status), `status=${rcUp.status}`);

// ── ۳. پلان CRUD + اقلام ──
const mkP = await req('POST', '/pms/plans', { token: T.admin, body: { nameFa: 'پلان تست کارفرما', nameLatin: 'UITEST Plan' } });
const planId = mkP.json?.data?.id;
S.step('ساخت پلان با کد خودکار → 4', [200, 201].includes(mkP.status) && mkP.json?.data?.code === 4, `id=${planId}`);
const laundry = (rcs.json.data.find((x) => x.code === 8)).id; // درآمد لاندری
const minibar = (rcs.json.data.find((x) => x.code === 20)).id; // مینی بار
const itAdd = await req('POST', `/pms/plans/${planId}/items`, { token: T.admin, body: { revenueCodeId: laundry, chargeTo: 'COMPANY' } });
S.step('قلم پلان با سهم شرکت → 201', [200, 201].includes(itAdd.status) && itAdd.json?.data?.chargeTo === 'COMPANY', `id=${itAdd.json?.data?.id}`);
const itDup = await req('POST', `/pms/plans/${planId}/items`, { token: T.admin, body: { revenueCodeId: laundry, chargeTo: 'COMPANY' } });
S.step('قلم تکراری → idempotent (updated)', [200, 201].includes(itDup.status) && itDup.json?.data?.updated === true, `status=${itDup.status}`);
const itUp = await req('PATCH', `/pms/plan-items/${itAdd.json?.data?.id}`, { token: T.admin, body: { chargeTo: 'GUEST' } });
S.step('تغییر سهم قلم → GUEST', [200, 201].includes(itUp.status) && itUp.json?.data?.chargeTo === 'GUEST', `status=${itUp.status}`);
const itBack = await req('PATCH', `/pms/plan-items/${itAdd.json?.data?.id}`, { token: T.admin, body: { chargeTo: 'COMPANY' } });
S.step('بازگردانی سهم → COMPANY', [200, 201].includes(itBack.status), `status=${itBack.status}`);
const detail = await req('GET', `/pms/plans/${planId}/items`, { token: T.frontdesk });
S.step('نمایش تفکیکی پلان → دو گروه guest/company', detail.status === 200 && detail.json?.data?.guest?.length === 0 && detail.json?.data?.company?.length === 1, `g=${detail.json?.data?.guest?.length} c=${detail.json?.data?.company?.length}`);

// ── ۴. اثر زندهٔ پلان روی فولیو ──
const stdKind = (await req('GET', '/pms/room-types', { token: T.admin })).json.data.find((t) => t.code === 'STD');
const room = await req('POST', '/pms/rooms', { token: T.admin, body: { code: '902', floor: 9, roomTypeId: stdKind.id } });
const roomId = room.json?.data?.id;
S.step('اتاق تست ۹۰۲ ساخته شد', [200, 201].includes(room.status), `id=${roomId}`);
const partyId = await ensureParty(T.admin, 'مهمان پلان');
const mkRes = await req('POST', '/pms/reservations', { token: T.frontdesk, body: {
  roomTypeId: stdKind.id, guestName: 'مهمان پلان تور', checkInDate: day(0), checkOutDate: day(2),
  idempotencyKey: 'pl-' + stamp, groupName: 'شرکت تور تست UI', planId,
} });
const resId = mkRes.json?.data?.reservationId;
S.step('رزرو با پلان → 201', [200, 201].includes(mkRes.status), `res=${resId}`);
const ci = await req('POST', '/pms/stays/check-in', { token: T.frontdesk, body: {
  idempotencyKey: 'plci-' + stamp, reservationId: resId,
  roomIds: [roomId], plannedCheckOut: day(2), partyId,
} });
const stayId = ci.json?.data?.stayId;
S.step('چک‌این رزرو پلان‌دار → 201', [200, 201].includes(ci.status), `stay=${stayId}`);

// قلم با کد لاندری (COMPANY در پلان) → روی صورت‌حساب شرکت
const it1 = await req('POST', `/pms/stays/${stayId}/folio-items`, { token: T.frontdesk, body: { desc: 'لاندری لباس', qty: 2, unitRials: '500000', revenueCodeId: laundry } });
S.step('قلم لاندری → مسیر COMPANY از پلان', [200, 201].includes(it1.status) && it1.json?.data?.chargeTo === 'COMPANY', `chargeTo=${it1.json?.data?.chargeTo}`);
const it2 = await req('POST', `/pms/stays/${stayId}/folio-items`, { token: T.frontdesk, body: { desc: 'نوشیدنی مینی بار', qty: 1, unitRials: '350000', revenueCodeId: minibar } });
S.step('قلم مینی بار → مسیر GUEST', [200, 201].includes(it2.status) && it2.json?.data?.chargeTo === 'GUEST', `chargeTo=${it2.json?.data?.chargeTo}`);
const split = await req('GET', `/pms/stays/${stayId}/folio-split`, { token: T.frontdesk });
S.step('تفکیک فولیو: شرکت=۱٬۰۰۰٬۰۰۰ و مهمان=۳۵۰٬۰۰۰', split.status === 200 && split.json?.data?.company?.totalRials === '1000000' && split.json?.data?.guest?.totalRials === '350000', `c=${split.json?.data?.company?.totalRials} g=${split.json?.data?.guest?.totalRials}`);
const folioList = await req('GET', `/pms/stays/${stayId}/folio-items`, { token: T.frontdesk });
S.step('فهرست فولیو شامل کد درآمدی و مسیر', folioList.status === 200 && folioList.json?.data?.items?.every((i) => i.chargeTo && typeof i.revenueCode?.code === 'number'), `n=${folioList.json?.data?.items?.length}`);

// ── ۵. فاکتور رسمی به نام هر طرف (پیش‌نویس مؤدیان) ──
const invC = await req('POST', `/pms/stays/${stayId}/invoice`, { token: T.frontdesk, body: { debtor: 'COMPANY', buyerTaxId: '41135876912', buyerName: 'شرکت تور تست UI' } });
S.step('فاکتور شرکت → DRAFT با ۱ ردیف و مبلغ ۱٬۰۰۰٬۰۰۰', [200, 201].includes(invC.status) && invC.json?.data?.rows === 1 && invC.json?.data?.totalRials === '1000000', `inv=${invC.json?.data?.invoiceNumber}`);
const invG = await req('POST', `/pms/stays/${stayId}/invoice`, { token: T.frontdesk, body: { debtor: 'GUEST', buyerName: 'مهمان پلان تور' } });
S.step('فاکتور مهمان → DRAFT با ۱ ردیف', [200, 201].includes(invG.status) && invG.json?.data?.rows === 1, `inv=${invG.json?.data?.invoiceNumber}`);
const invEmpty = await req('POST', '/pms/stays/' + '00000000-0000-0000-0000-000000000000' + '/invoice', { token: T.frontdesk, body: { debtor: 'COMPANY' } });
S.step('اقامت ناموجود → 404', invEmpty.status === 404, `status=${invEmpty.status}`);

// ── ۶. حذف محافظت‌شده ──
const pDelLocked = await req('DELETE', `/pms/plans/${planId}`, { token: T.admin });
S.step('حذف پلانِ رزرو متصل → 409', pDelLocked.status === 409, `status=${pDelLocked.status}`);
const rcDel = await req('DELETE', `/pms/revenue-codes/${laundry}`, { token: T.admin });
S.step('حذف کد درآمدی استفاده‌شده → 409', rcDel.status === 409, `status=${rcDel.status}`);
const rcDel2 = await req('DELETE', `/pms/revenue-codes/${rcId}`, { token: T.admin });
S.step('حذف کد استفاده‌نشده → 200', [200, 201].includes(rcDel2.status), `status=${rcDel2.status}`);

// ── پاکسازی ──
await c.query(`delete from moadian_invoices where "invoiceNumber" like 'DRAFT-FOLIO-%'`);
await c.query(`delete from folio_items where "stayId"=$1`, [stayId]);
await c.query(`delete from "stay_rooms" where "roomId"=$1`, [roomId]);
await c.query(`delete from stays where id=$1`, [stayId]);
await c.query(`update reservations set "planId"=null where id=$1`, [resId]);
await c.query(`delete from reservations where id=$1`, [resId]);
await c.query(`delete from rooms where id=$1`, [roomId]);
await c.query(`delete from parties where id=$1`, [partyId]);
await c.query(`delete from audit_logs where "action" like '%ROOM%' or "action"='RESERVATION_CREATED'`);
await c.end();
const pDelFree = await req('DELETE', `/pms/plans/${planId}`, { token: T.admin });
S.step('حذف پلان بدون استفاده → 200', [200, 201].includes(pDelFree.status), `status=${pDelFree.status}`);
S.finish();
