// 17-admin.mjs — نسخهٔ ۳٫۳: کاربران، گروه‌های کاربری و ماتریس دسترسی (درخواست کارفرما)
// الگوی عکس‌های مرجع: گروه + عضوگیری، ماتریس به‌تفکیک ماژول، ویرایش کاربر حتی نام کاربری/رمز.
import { Suite, req, login, tryLogin, db } from './_lib.mjs';

const S = new Suite('17-admin');
const T = {
  admin: await login('admin', true),
  accountant: await login('accountant', true),
  frontdesk: await login('frontdesk', false),
};
const c = await db();
const stamp = Date.now().toString(36);

// شروع تمیز — بقایای اجرای قبلی
await c.query(`delete from refresh_tokens where "userId" in (select id from users where username like 'uitest%')`);
await c.query(`delete from user_roles where "userId" in (select id from users where username like 'uitest%')`);
await c.query(`delete from users where username like 'uitest%'`);
await c.query(`delete from role_permissions where "roleId" in (select id from roles where name like 'uitest%')`);
await c.query(`delete from user_roles where "roleId" in (select id from roles where name like 'uitest%')`);
await c.query(`delete from roles where name like 'uitest%'`);
await c.query(`delete from audit_logs where "action" like 'USER_%' or "action" like 'ROLE_%'`);

// ── ۱. RBAC ──
const f1 = await req('GET', '/admin/users', { token: T.accountant });
S.step('فهرست کاربران توسط حسابدار → 403', f1.status === 403, `status=${f1.status}`);
const f2 = await req('POST', '/admin/users', { token: T.frontdesk, body: { username: 'x', password: 'Password1!', fullName: 'X' } });
S.step('ساخت کاربر توسط پذیرش → 403', f2.status === 403, `status=${f2.status}`);
const users0 = await req('GET', '/admin/users', { token: T.admin });
S.step('فهرست کاربران توسط مدیر → 200', users0.status === 200 && users0.json.data.length >= 4, `n=${users0.json?.data?.length}`);

// ── ۲. کاتالوگ گروه‌بندی‌شده ──
const cat = await req('GET', '/admin/permission-catalog', { token: T.admin });
const groups = cat.json?.data ?? [];
const frontdeskGroup = groups.find((g) => g.key === 'frontdesk');
S.step('کاتالوگ گروه‌بندی ماژول‌ها → ۱۵ گروه', cat.status === 200 && groups.length === 15, `n=${groups.length}`);
S.step('گروه پذیرش شامل stay.checkin با برچسب فارسی', !!frontdeskGroup?.items.some((i) => i.code === 'stay.checkin' && /ورود مهمان/.test(i.fa)), `n=${frontdeskGroup?.items?.length}`);
const noDup = groups.flatMap((g) => g.items.map((i) => i.code));
S.step('هر مجوز فقط در یک ماژول', new Set(noDup).size === noDup.length, `total=${noDup.length}`);

// ── ۳. ساخت کاربر ──
const roles = (await req('GET', '/admin/roles', { token: T.admin })).json.data;
const frontDeskRole = roles.find((r) => r.name === 'front_desk');
const bad1 = await req('POST', '/admin/users', { token: T.admin, body: { username: 'uitest-' + stamp, password: 'short', fullName: 'تست' } });
S.step('رمز کوتاه → 400', bad1.status === 400, `status=${bad1.status}`);
const bad2 = await req('POST', '/admin/users', { token: T.admin, body: { username: 'Bad Name!', password: 'Password1!', fullName: 'تست' } });
S.step('نام کاربری نامعتبر → 400', bad2.status === 400, `status=${bad2.status}`);
const mk = await req('POST', '/admin/users', { token: T.admin, body: {
  username: 'uitest-' + stamp, password: 'Password1!', fullName: 'کاربر تست UI', position: 'کارمند پذیرش', roleIds: [frontDeskRole.id],
} });
const uid = mk.json?.data?.id;
S.step('ساخت کاربر → 201 با گروه پذیرش', [200, 201].includes(mk.status) && mk.json?.data?.roles?.[0]?.name === 'front_desk', `id=${uid}`);
const dup = await req('POST', '/admin/users', { token: T.admin, body: { username: 'uitest-' + stamp, password: 'Password1!', fullName: 'دوباره' } });
S.step('نام کاربری تکراری → 409', dup.status === 409, `status=${dup.status}`);

// ورود کاربر جدید (نقش غیرحساس — بدون TOTP)
const uTok1 = await tryLogin('uitest-' + stamp, 'Password1!');
S.step('ورود کاربر جدید → 200', [200, 201].includes(uTok1.status), `status=${uTok1.status}`);
const newTok = uTok1.json?.accessToken;

// ── ۴. تغییر نام کاربری و رمز توسط مدیر ──
const newUsername = 'uitest2-' + stamp;
const up1 = await req('PATCH', `/admin/users/${uid}`, { token: T.admin, body: { username: newUsername } });
S.step('تغییر نام کاربری → 200', [200, 201].includes(up1.status) && up1.json?.data?.username === newUsername, `username=${up1.json?.data?.username}`);
const oldLogin = await tryLogin('uitest-' + stamp, 'Password1!');
S.step('ورود با نام کاربری قدیمی → 401', oldLogin.status === 401, `status=${oldLogin.status}`);
const newLogin = await tryLogin(newUsername, 'Password1!');
S.step('ورود با نام کاربری جدید → 200', [200, 201].includes(newLogin.status), `status=${newLogin.status}`);
const newTok2 = newLogin.json?.accessToken;
const up2 = await req('PATCH', `/admin/users/${uid}`, { token: T.admin, body: { password: 'NewPass_Str0ng!' } });
S.step('تغییر رمز توسط مدیر → 200', [200, 201].includes(up2.status), `status=${up2.status}`);
const oldPass = await tryLogin(newUsername, 'Password1!');
S.step('ورود با رمز قدیمی → 401', oldPass.status === 401, `status=${oldPass.status}`);
const newPassLogin = await tryLogin(newUsername, 'NewPass_Str0ng!');
S.step('ورود با رمز جدید → 200', [200, 201].includes(newPassLogin.status), `status=${newPassLogin.status}`);

// ── ۵. گروه کاربری سفارشی + ماتریس زنده ──
const mkRole = await req('POST', '/admin/roles', { token: T.admin, body: {
  name: 'uitest_group_' + stamp, displayNameFa: 'گروه تست UI', permissionCodes: ['room.view'],
} });
const roleId = mkRole.json?.data?.id;
S.step('ساخت گروه سفارشی با room.view → 201', [200, 201].includes(mkRole.status) && mkRole.json?.data?.permissionCodes?.includes('room.view'), `id=${roleId}`);
const dupRole = await req('POST', '/admin/roles', { token: T.admin, body: { name: 'uitest_group_' + stamp, displayNameFa: 'دوباره' } });
S.step('نام گروه تکراری → 409', dupRole.status === 409, `status=${dupRole.status}`);
const badCode = await req('POST', '/admin/roles', { token: T.admin, body: { name: 'uitest_bad_' + stamp, displayNameFa: 'X', permissionCodes: ['no.such.permission'] } });
S.step('مجوز ناشناخته → 400', badCode.status === 400, `status=${badCode.status}`);

// جایگزینی گروه‌های کاربر با گروه سفارشی
const up3 = await req('PATCH', `/admin/users/${uid}`, { token: T.admin, body: { roleIds: [roleId] } });
S.step('کاربر فقط در گروه سفارشی', [200, 201].includes(up3.status) && up3.json?.data?.roles?.[0]?.name === 'uitest_group_' + stamp, `roles=${JSON.stringify(up3.json?.data?.roles)}`);

// اثر زندهٔ ماتریس: اضافه کردن stay.checkin → دسترسی؛ حذف room.view → 403 فوری
const map1 = await req('GET', '/pms/rooms/map', { token: newTok2 });
S.step('نقشه اتاق با room.view → 200', map1.status === 200, `status=${map1.status}`);
const ci1 = await req('POST', '/pms/stays/check-in', { token: newTok2, body: { idempotencyKey: 'uitest-' + stamp, roomIds: [], plannedCheckOut: '2026-12-05' } });
S.step('چک‌این بدون مجوز → 403', ci1.status === 403, `status=${ci1.status}`);
const set1 = await req('PUT', `/admin/roles/${roleId}/permissions`, { token: T.admin, body: { codes: ['room.view', 'stay.checkin'] } });
S.step('ذخیرهٔ ماتریس → 200 + matrixOverridden', [200, 201].includes(set1.status) && set1.json?.data?.matrixOverridden === true, `codes=${set1.json?.data?.permissionCodes?.length}`);
const map2 = await req('GET', '/pms/rooms/map', { token: newTok2 });
S.step('نقشه همچنان 200', map2.status === 200, `status=${map2.status}`);
const set2 = await req('PUT', `/admin/roles/${roleId}/permissions`, { token: T.admin, body: { codes: [] } });
S.step('حذف همهٔ مجوزها → 200', [200, 201].includes(set2.status), `status=${set2.status}`);
const map3 = await req('GET', '/pms/rooms/map', { token: newTok2 });
S.step('نقشه بدون مجوز → 403 فوری', map3.status === 403, `status=${map3.status}`);
// بازگرداندن مجوز برای ادامهٔ تست عضوگیری
await req('PUT', `/admin/roles/${roleId}/permissions`, { token: T.admin, body: { codes: ['room.view'] } });

// ── ۶. عضوگیری گروه (الگوی عکس ۲-۱) ──
const addM = await req('POST', `/admin/roles/${roleId}/members`, { token: T.admin, body: { userId: uid } });
S.step('افزودن عضو → 200', [200, 201].includes(addM.status) && addM.json?.data?.some((m) => m.id === uid), `n=${addM.json?.data?.length}`);
const dupM = await req('POST', `/admin/roles/${roleId}/members`, { token: T.admin, body: { userId: uid } });
S.step('افزودن عضو تکراری → بدون خطا (idempotent)', [200, 201].includes(dupM.status), `status=${dupM.status}`);
const mem = await req('GET', `/admin/roles/${roleId}/members`, { token: T.admin });
S.step('فهرست اعضا شامل کاربر', mem.status === 200 && mem.json.data.some((m) => m.username === newUsername), `n=${mem.json?.data?.length}`);
const rmM = await req('DELETE', `/admin/roles/${roleId}/members/${uid}`, { token: T.admin });
S.step('حذف عضو → 200', [200, 201].includes(rmM.status) && !rmM.json?.data?.some((m) => m.id === uid), `n=${rmM.json?.data?.length}`);

// ── ۷. حفاظت‌های ضدقفل‌شدگی و نقش سیستمی ──
const adminUser = users0.json.data.find((u) => u.roles.some((r) => r.name === 'admin'));
const selfDeact = await req('PATCH', `/admin/users/${adminUser.id}`, { token: T.admin, body: { isActive: false } });
S.step('غیرفعال‌سازی خود → 400', selfDeact.status === 400, `status=${selfDeact.status}`);
const delAdminRole = await req('DELETE', `/admin/roles/${roles.find((r) => r.name === 'admin').id}`, { token: T.admin });
S.step('حذف گروه سیستمی → 403', delAdminRole.status === 403, `status=${delAdminRole.status}`);
// عضو نمونه دوباره متصل می‌شود تا «گروه دارای عضو» تست شود
await req('POST', `/admin/roles/${roleId}/members`, { token: T.admin, body: { userId: uid } });
const delInUse = await req('DELETE', `/admin/roles/${roleId}`, { token: T.admin });
S.step('حذف گروه دارای عضو → 409', delInUse.status === 409, `status=${delInUse.status}`);
await req('DELETE', `/admin/roles/${roleId}/members/${uid}`, { token: T.admin });
const lockout = await req('PUT', `/admin/roles/${roles.find((r) => r.name === 'admin').id}/permissions`, { token: T.admin, body: { codes: ['journal.view'] } });
S.step('ماتریس admin بدون users.manage → 400', lockout.status === 400, `status=${lockout.status}`);
const sysRename = await req('PATCH', `/admin/roles/${roles.find((r) => r.name === 'front_desk').id}`, { token: T.admin, body: { name: 'renamed_' + stamp } });
S.step('تغییر نام گروه سیستمی → 400', sysRename.status === 400, `status=${sysRename.status}`);
const faRename = await req('PATCH', `/admin/roles/${roles.find((r) => r.name === 'front_desk').id}`, { token: T.admin, body: { displayNameFa: 'پذیرش (ویرایش‌شده)' } });
S.step('تغییر نام نمایشی گروه سیستمی → 200', [200, 201].includes(faRename.status), `status=${faRename.status}`);
// بازگردانی نام نمایشی
await req('PATCH', `/admin/roles/${roles.find((r) => r.name === 'front_desk').id}`, { token: T.admin, body: { displayNameFa: 'پذیرش' } });

// ── ۸. غیرفعال‌سازی (حذف نرم) ──
const deact = await req('DELETE', `/admin/users/${uid}`, { token: T.admin });
S.step('حذف کاربر → غیرفعال‌سازی', [200, 201].includes(deact.status) && deact.json?.data?.isActive === false, `isActive=${deact.json?.data?.isActive}`);
const deactLogin = await tryLogin(newUsername, 'NewPass_Str0ng!');
S.step('ورود کاربر غیرفعال → 401', deactLogin.status === 401, `status=${deactLogin.status}`);

// ── ۹. حسابرسی ──
const aud = await c.query(`select action from audit_logs where "action" in ('USER_CREATED','USER_USERNAME_CHANGED','USER_PASSWORD_RESET','ROLE_CREATED','ROLE_MATRIX_CHANGED','ROLE_MEMBER_ADDED') order by "createdAt" desc limit 20`);
const acts = new Set(aud.rows.map((r) => r.action));
S.step('ردپای حسابرسی کامل', ['USER_CREATED', 'USER_USERNAME_CHANGED', 'USER_PASSWORD_RESET', 'ROLE_CREATED', 'ROLE_MATRIX_CHANGED'].every((a) => acts.has(a)), `n=${acts.size}`);

// ── پاکسازی ──
await c.query(`delete from user_roles where "roleId" in (select id from roles where name like 'uitest%')`);
await c.query(`delete from role_permissions where "roleId" in (select id from roles where name like 'uitest%')`);
await c.query(`delete from roles where name like 'uitest%'`);
await c.query(`delete from refresh_tokens where "userId" in (select id from users where username like 'uitest%')`);
await c.query(`delete from user_roles where "userId" in (select id from users where username like 'uitest%')`);
await c.query(`delete from users where username like 'uitest%'`);
await c.query(`delete from audit_logs where "action" like 'USER_%' or "action" like 'ROLE_%'`);
await c.end();
S.finish();
