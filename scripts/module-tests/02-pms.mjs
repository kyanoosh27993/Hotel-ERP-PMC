// 02-pms.mjs — لایه ۱ / ماژول ۲: رزرو، اقامت، شب‌گردی، چک‌اوت
import { Suite, req, login, db, day, TODAY, sleep, ensureParty } from './_lib.mjs';

const S = new Suite('02-pms');
const T = {
  admin: await login('admin', true),
  frontdesk: await login('frontdesk', false),
};
const c = await db();

// ریست جداول همان ماژول
await c.query(`TRUNCATE "stay_rooms","stays","night_audit_runs","reservations","waitlist_entries","outbox_events","inbox_events","journal_entries","journal_lines","audit_logs" CASCADE`);
await c.query(`UPDATE "rooms" SET "status"='AVAILABLE', "hkStatus"='CLEAN', "note"=NULL`);
await c.query(`UPDATE "fiscal_periods" SET "status" = CASE WHEN "endDate" < date_trunc('month', now()) THEN 'LOCKED'::fiscal_period_status ELSE 'OPEN'::fiscal_period_status END, "lockedAt" = CASE WHEN "endDate" < date_trunc('month', now()) THEN now() ELSE NULL END, "closedAt"=NULL, "closingEntryId"=NULL`);

const rt = (await req('GET', '/room-types', { token: T.frontdesk })).json?.data ?? [];
const std = rt.find((x) => x.code === 'STD');
S.step('نوع اتاق STD با نرخ پایه موجود', !!std && Number(std.baseRateRials) > 0, `base=${std?.baseRateRials}`);
const nightly = Number(std.baseRateRials);

const jKey = () => `m02-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// ── رزرو: ثبت + خواندن مجدد از DB ──
const res1 = await req('POST', '/pms/reservations', { token: T.frontdesk, body: { roomTypeId: std.id, guestName: 'مهمان ماژول۲', checkInDate: TODAY, checkOutDate: day(2), idempotencyKey: jKey() } });
S.step('ثبت رزرو', res1.status === 201, `status=${res1.status} ${JSON.stringify(res1.json?.error ?? {}).slice(0, 100)}`);
const res1Id = res1.json?.data?.reservationId ?? res1.json?.data?.id;
const row = (await c.query(`select "guestName","nights","totalRials"::text as total, status from reservations where id=$1`, [res1Id])).rows[0];
S.step('خواندن مجدد: مهمان/شب‌ها/مبلغ = ورودی', row?.guestName === 'مهمان ماژول۲' && Number(row?.total) === nightly * 2 && Number(row?.nights) === 2, `guest=${row?.guestName} nights=${row?.nights} total=${row?.total} (انتظار ${nightly * 2})`);

// ── idempotency: کلید تکراری → همان رکورد، نه دوتا ──
const key1 = (await c.query(`select "idempotencyKey" from reservations where id=$1`, [res1Id])).rows[0]?.idempotencyKey;
const res2 = await req('POST', '/pms/reservations', { token: T.frontdesk, body: { roomTypeId: std.id, guestName: 'مهمان ماژول۲', checkInDate: TODAY, checkOutDate: day(2), idempotencyKey: key1 } });
const cnt = (await c.query(`select count(*)::int as n from reservations where "idempotencyKey"=$1`, [key1])).rows[0].n;
S.step('کلید idempotency تکراری → رکورد تکراری ساخته نمی‌شود', cnt === 1, `count=${cnt} status=${res2.status}`);

// ── لغو رزرو ──
const res3 = await req('POST', '/pms/reservations', { token: T.frontdesk, body: { roomTypeId: std.id, guestName: 'قابل لغو', checkInDate: day(5), checkOutDate: day(6), idempotencyKey: jKey() } });
const res3Id = res3.json?.data?.reservationId ?? res3.json?.data?.id;
const cancel = await req('POST', `/pms/reservations/${res3Id}/cancel`, { token: T.frontdesk, body: {} });
const row3 = (await c.query(`select status, "cancelledAt" from reservations where id=$1`, [res3Id])).rows[0];
S.step('لغو رزرو → CANCELLED با زمان', [200, 201].includes(cancel.status) && row3?.status === 'CANCELLED' && !!row3?.cancelledAt, `status=${cancel.status} db=${row3?.status}`);
// سند معکوس لغو: ۴۱۰۱ بدهکار / ۱۲۰۱ بستانکار
let cancelEntry = null;
for (let i = 0; i < 30; i++) { const e = await c.query(`select "entryNo" from journal_entries where "sourceModule"='booking' and "sourceRef"=$1 and status='POSTED'`, [`cancel:${res3Id}`]); if (e.rows[0]) { cancelEntry = e.rows[0]; break; } await sleep(400); }
const cancelLines = (await c.query(`select l."accountCode", l."debitRials"::text as d, l."creditRials"::text as cr from journal_lines l join journal_entries e on e.id=l."entryId" where e."entryNo"=$1 order by l."lineNo"`, [cancelEntry?.entryNo])).rows;
const cr4101 = cancelLines.find((l) => l.accountCode === '4101');
const dr1201 = cancelLines.find((l) => l.accountCode === '1201');
S.step('سند معکوس لغو: ۴۱۰۱ بدهکار / ۱۲۰۱ بستانکار (مبلغ رزرو)', Number(cr4101?.d) === nightly && Number(dr1201?.cr) === nightly, `4101d=${cr4101?.d} 1201cr=${dr1201?.cr} (انتظار ${nightly})`);
// لغو دوباره → 400
const recancel = await req('POST', `/pms/reservations/${res3Id}/cancel`, { token: T.frontdesk, body: {} });
S.step('لغو رزرو لغوشده → 400/409', [400, 409].includes(recancel.status), `status=${recancel.status}`);

// ── چک‌این: فقط با شناسه‌ها (بدون تکرار مهمان/نرخ) ──
const map = (await req('GET', '/pms/rooms/map', { token: T.frontdesk })).json?.data;
const room101 = (map?.floors ?? []).flatMap((f) => f.rooms ?? []).find((r) => r.code === '101');
const gateParty = await ensureParty(T.frontdesk, 'مهمان pms');
const ci = await req('POST', '/pms/stays/check-in', { token: T.frontdesk, body: { reservationId: res1Id, roomIds: [room101.id], plannedCheckOut: day(2), idempotencyKey: jKey(), partyId: gateParty } });
S.step('چک‌این موفق', ci.status === 201, `status=${ci.status} ${JSON.stringify(ci.json?.error ?? {}).slice(0, 100)}`);
const stayId = ci.json?.data?.stayId ?? ci.json?.stayId;
const stay = (await c.query(`select code, "folioRials"::text as folio, status from stays where id=$1`, [stayId])).rows[0];
S.step('اقامت باز با فولیو صفر شروع می‌شود', stay?.status === 'OPEN' && Number(stay?.folio) === 0, `status=${stay?.status} folio=${stay?.folio}`);
const roomAfter = (await c.query(`select status from rooms where id=$1`, [room101.id])).rows[0];
S.step('اتاق پس از چک‌این OCCUPIED', roomAfter?.status === 'OCCUPIED', `db=${roomAfter?.status}`);

// ── سند خودکار رزرو (booking) ──
const bookingEntry = await (async () => { for (let i = 0; i < 30; i++) { const e = await c.query(`select "entryNo" from journal_entries where "sourceModule"='booking' and "sourceRef"=$1 and status='POSTED'`, [res1Id]); if (e.rows[0]) return e.rows[0]; await sleep(400); } return null; })();
S.step('سند ۱۲۰۱/۴۱۰۱ رزرو posted شد', !!bookingEntry, `entry=${bookingEntry?.entryNo ?? 'null'}`);
const lines1 = (await c.query(`select l."accountCode", l."debitRials"::text as d, l."creditRials"::text as cr from journal_lines l join journal_entries e on e.id=l."entryId" where e."sourceRef"=$1 order by l."lineNo"`, [res1Id])).rows;
S.step('سطرهای سند رزرو: ۱۲۰۱ بدهکار = مبلغ رزرو', lines1[0]?.accountCode === '1201' && Number(lines1[0]?.d) === nightly * 2, `line1=${lines1[0]?.accountCode}/${lines1[0]?.d}`);

// ── شب‌گردی: شارژ اتاق + سند نگاشت ──
const na = await req('POST', '/pms/night-audit', { token: T.frontdesk, body: { businessDate: TODAY } });
S.step('شب‌گردی اجرا شد', [200, 201].includes(na.status), `status=${na.status}`);
let naEntry = null;
for (let i = 0; i < 30; i++) {
  const e = await c.query(`select "entryNo", description from journal_entries where status='POSTED' and description like '%night audit room charge%' order by "createdAt" desc limit 1`);
  if (e.rows[0]) { naEntry = e.rows[0]; break; }
  await sleep(400);
}
S.step('سند شارژ شب از موتور نگاشت با برچسب', !!naEntry && /\[mapping:v\d+\]/.test(naEntry?.description ?? ''), `desc=${naEntry?.description?.slice(0, 80)}`);
const naLine = (await c.query(`select l."accountCode", l."debitRials"::text as d from journal_lines l join journal_entries e on e.id=l."entryId" where e."entryNo"=$1 and l."accountCode"='1201'`, [naEntry?.entryNo])).rows[0];
S.step('شارژ شب = نرخ × ۱ شب در ۱۲۰۱', Number(naLine?.d) === nightly, `d=${naLine?.d} (انتظار ${nightly})`);
const folioMid = (await c.query(`select "folioRials"::text as f from stays where id=$1`, [stayId])).rows[0];
S.step('فولیو پس از شب‌گردی = یک شب', Number(folioMid?.f) === nightly, `folio=${folioMid?.f}`);

// ── چک‌اوت: تسویه خودکار ──
const co = await req('POST', `/pms/stays/${stayId}/check-out`, { token: T.frontdesk, body: {} });
const coFolio = Number(co.json?.folioRials ?? co.json?.data?.folioRials ?? 0);
// فولیو = شب‌های سپری‌شده (۱ شب با شب‌گردی) — چک‌اوت زودتر از موعد شارژ اضافه ندارد
S.step('چک‌اوت موفق با فولیو شب‌های سپری‌شده', [200, 201].includes(co.status) && coFolio === nightly, `status=${co.status} folio=${coFolio} (انتظار ${nightly})`);
const coStay = (await c.query(`select status from stays where id=$1`, [stayId])).rows[0];
const coRoom = (await c.query(`select status, "hkStatus" from rooms where id=$1`, [room101.id])).rows[0];
S.step('پس از چک‌اوت: اقامت CLOSED و اتاق DIRTY (تا نظافت)', coStay?.status === 'CLOSED' && coRoom?.status === 'DIRTY' && coRoom?.hkStatus === 'DIRTY', `stay=${coStay?.status} room=${coRoom?.status}/${coRoom?.hkStatus}`);

// ── ظرفیت: رزرو بیش از ظرفیت نوع اتاق → رد ──
const roomsOfType = (await c.query(`select count(*)::int as n from rooms where "roomTypeId"=$1`, [std.id])).rows[0].n;
let guardRejected = false;
let guardStatus = 0;
for (let i = 0; i < roomsOfType + 1; i++) {
  const r = await req('POST', '/pms/reservations', { token: T.frontdesk, body: { roomTypeId: std.id, guestName: `ظرفیت ${i}`, checkInDate: day(10), checkOutDate: day(11), idempotencyKey: jKey() } });
  guardStatus = r.status;
  if (![200, 201].includes(r.status)) { guardRejected = true; break; }
}
S.step('نگهبان هم‌زمانی: بیش از ظرفیت → رد', guardRejected && [400, 409].includes(guardStatus), `rejected=${guardRejected} lastStatus=${guardStatus}`);

await c.end();
S.finish();
