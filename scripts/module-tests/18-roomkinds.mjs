// 18-roomkinds.mjs — نسخهٔ ۳٫۴: انواع اتاق، ستون‌های زندهٔ تعداد پر/تخت اضافه، مشخصه‌های اضافی
import { Suite, req, login, db, ensureParty, TODAY, day } from './_lib.mjs';

const S = new Suite('18-roomkinds');
const T = {
  admin: await login('admin', true),
  accountant: await login('accountant', true),
  frontdesk: await login('frontdesk', false),
};
const c = await db();

// شروع تمیز
await c.query(`delete from rooms where code in ('901','902')`);
await c.query(`delete from room_types where code in ('VIPK','TSTK')`);
await c.query(`delete from room_amenity_links where "amenityId" in (select id from room_amenities where code in ('TSTA'))`);
await c.query(`delete from room_amenities where code in ('TSTA')`);

// ── ۱. RBAC ──
const f1 = await req('GET', '/pms/room-kinds', { token: T.accountant });
S.step('انواع اتاق توسط حسابدار → 403', f1.status === 403, `status=${f1.status}`);
const ok1 = await req('GET', '/pms/room-kinds', { token: T.frontdesk });
S.step('انواع اتاق توسط پذیرش → 200 با ستون‌های زنده', ok1.status === 200 && 'occupiedCount' in (ok1.json?.data?.[0] ?? {}), `n=${ok1.json?.data?.length}`);
const ok2 = await req('GET', '/pms/room-kinds', { token: T.admin });
S.step('انواع اتاق توسط مدیر → 200', ok2.status === 200, `n=${ok2.json?.data?.length}`);

// ── ۲. ساخت نوع اتاق کامل (فرم مرجع) ──
const bad = await req('POST', '/pms/room-types', { token: T.admin, body: { code: 'TSTK', nameFa: 'تست', rateFullRials: 'abc' } });
S.step('نرخ غیرعددی → 400', bad.status === 400, `status=${bad.status}`);
const mk = await req('POST', '/pms/room-types', { token: T.admin, body: {
  code: 'TSTK', nameFa: 'سوئیت دو خوابه تست', nameEn: 'suite', nameLatin: 'suite',
  capacity: 4, bedCount: 4, rateSingleRials: '60150000', rateDoubleRials: '60150000',
  rateTripleRials: '60150000', rateFullRials: '60150000', rateSingleUsd: 100.5,
  ratePeak1Rials: '70000000', fullBoardRials: '80000000', extraBedCount: 2, extraBedRials: '5000000', syncCode: 1,
} });
const kindId = mk.json?.data?.id;
S.step('ساخت نوع اتاق با نرخ‌های ۴گانه/فصلی/تخت اضافه → 201', [200, 201].includes(mk.status) && mk.json?.data?.rateFullRials === '60150000' && mk.json?.data?.extraBedCount === 2, `id=${kindId}`);
const dup = await req('POST', '/pms/room-types', { token: T.admin, body: { code: 'TSTK', nameFa: 'دوباره' } });
S.step('کد تکراری → 409', dup.status === 409, `status=${dup.status}`);
const up = await req('PATCH', `/pms/room-types/${kindId}`, { token: T.admin, body: { rateFullRials: '65000000', extraBedCount: 1 } });
S.step('تصحیح نوع اتاق → 200', [200, 201].includes(up.status) && up.json?.data?.rateFullRials === '65000000', `full=${up.json?.data?.rateFullRials}`);

// ── ۳. اتاق با فیلدهای کامل + مشخصه‌ها ──
const am = await req('POST', '/pms/room-amenities', { token: T.admin, body: { code: 'TSTA', nameFa: 'بالکن تست', shortName: 'B' } });
const amenityId = am.json?.data?.id;
S.step('ساخت مشخصه اضافی → 201', [200, 201].includes(am.status), `id=${amenityId}`);
const amDup = await req('POST', '/pms/room-amenities', { token: T.admin, body: { code: 'TSTA', nameFa: 'دوباره' } });
S.step('مشخصه تکراری → 409', amDup.status === 409, `status=${amDup.status}`);
const badRoom = await req('POST', '/pms/rooms', { token: T.admin, body: { code: '901', floor: 9, roomTypeId: kindId, extraBeds: 99 } });
S.step('تخت اضافه خارج از بازه → 409', badRoom.status === 409, `status=${badRoom.status}`);
const room = await req('POST', '/pms/rooms', { token: T.admin, body: {
  code: '901', floor: 9, roomTypeId: kindId, nameFa: 'سوئیت ۹۰۱', nameLatin: 'suite901',
  bedCount: 4, extraBeds: 1, rateSingleRials: '61000000', note: 'توضیحات اتاق تست', amenityIds: [amenityId],
} });
const roomId = room.json?.data?.id;
S.step('ثبت اتاق با نام/تخت/تخت اضافه/مشخصه‌ها → 201', [200, 201].includes(room.status) && room.json?.data?.code === '901', `id=${roomId}`);
const amDel = await req('DELETE', `/pms/room-amenities/${amenityId}`, { token: T.admin });
S.step('حذف مشخصه متصل به اتاق → 409', amDel.status === 409, `status=${amDel.status}`);

// ── ۴. ستون‌های زندهٔ نوع اتاق ──
const kinds1 = await req('GET', '/pms/room-kinds', { token: T.admin });
const k1 = kinds1.json.data.find((k) => k.code === 'TSTK');
S.step('تعداد اتاق = ۱', k1?.roomsCount === 1, `rooms=${k1?.roomsCount}`);
S.step('تعداد پر = ۰ و تخت اضافه = ۱', k1?.occupiedCount === 0 && k1?.extraBedsCount === 1, `pr=${k1?.occupiedCount} extra=${k1?.extraBedsCount}`);

// ── ۵. اثر زندهٔ پذیرش: چک‌این → تعداد پر + drill-down ──
const partyId = await ensureParty(T.admin, 'مهمان انواع اتاق');
const ci = await req('POST', '/pms/stays/check-in', { token: T.frontdesk, body: {
  idempotencyKey: 'rk-' + Date.now().toString(36), guestName: 'مهمان انواع اتاق',
  roomIds: [roomId], plannedCheckOut: day(3), partyId,
} });
const stayId = ci.json?.data?.stayId;
S.step('چک‌این اتاق ۹۰۱ → 201', [200, 201].includes(ci.status), `stay=${stayId}`);
const kinds2 = await req('GET', '/pms/room-kinds', { token: T.admin });
const k2 = kinds2.json.data.find((k) => k.code === 'TSTK');
S.step('تعداد پر = ۱ (زنده)', k2?.occupiedCount === 1, `pr=${k2?.occupiedCount}`);
const dd1 = await req('GET', `/pms/room-kinds/${kindId}/rooms?occupied=1`, { token: T.frontdesk });
S.step('drill-down تعداد پر → اتاق ۹۰۱ با نام مهمان', dd1.status === 200 && dd1.json?.data?.rooms?.some((r) => r.code === '901' && r.guestName), `n=${dd1.json?.data?.rooms?.length}`);
const dd2 = await req('GET', `/pms/room-kinds/${kindId}/rooms?extraBeds=1`, { token: T.frontdesk });
S.step('drill-down تخت اضافه → اتاق ۹۰۱ با extraBeds=1', dd2.status === 200 && dd2.json?.data?.rooms?.some((r) => r.code === '901' && r.extraBeds === 1), `n=${dd2.json?.data?.rooms?.length}`);

// ── ۶. تصحیح اتاق: برداشتن تخت اضافه → ستون زنده صفر ──
const ru = await req('PATCH', `/pms/rooms/${roomId}`, { token: T.frontdesk, body: { extraBeds: 0, guestRequests: 2 } });
S.step('تصحیح اتاق (تخت اضافه=۰، درخواست مهمان=۲) → 200', [200, 201].includes(ru.status) && ru.json?.data?.extraBeds === 0, `extra=${ru.json?.data?.extraBeds}`);
const kinds3 = await req('GET', '/pms/room-kinds', { token: T.admin });
const k3 = kinds3.json.data.find((k) => k.code === 'TSTK');
S.step('تخت اضافهٔ نوع = ۰ پس از تصحیح', k3?.extraBedsCount === 0, `extra=${k3?.extraBedsCount}`);

// ── ۷. حذف محافظت‌شده ──
const kdel = await req('DELETE', `/pms/room-kinds/${kindId}`, { token: T.admin });
S.step('حذف نوع دارای اتاق → 409', kdel.status === 409, `status=${kdel.status}`);

// ── پاکسازی ──
await c.query(`delete from "stay_rooms" where "roomId"=$1`, [roomId]);
await c.query(`delete from stays where id=$1`, [stayId]);
await c.query(`delete from room_amenity_links where "roomId"=$1`, [roomId]);
await c.query(`delete from rooms where id=$1`, [roomId]);
await c.query(`delete from room_types where id=$1`, [kindId]);
await c.query(`delete from room_amenities where code='TSTA'`);
await c.query(`delete from parties where id=$1`, [partyId]);
await c.query(`delete from audit_logs where "action" like '%ROOM%'`);
await c.end();
S.finish();
