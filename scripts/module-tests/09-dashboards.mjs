// 09-dashboards.mjs — لایه ۱ / ماژول ۹: چهار پنل نقش‌محور و هم‌خوانی با DB
import { Suite, req, login, db } from './_lib.mjs';

const S = new Suite('09-dashboards');
const T = { admin: await login('admin', true), accountant: await login('accountant', true), frontdesk: await login('frontdesk', false) };
const c = await db();

// ── دسترسی نقش‌محور: پیش‌reception به پنل مالی ندارد ──
const forb = await req('GET', '/dashboards/finance', { token: T.frontdesk });
S.step('پنل مالی برای پیش‌reception → 403', forb.status === 403, `status=${forb.status}`);

// ── CEO ──
const ceo = (await req('GET', '/dashboards/ceo', { token: T.admin })).json?.data;
const roomsTotal = (await c.query(`select count(*)::int as n from rooms`)).rows[0].n;
const occupied = (await c.query(`select count(*)::int as n from rooms where status='OCCUPIED'`)).rows[0].n;
S.step('CEO: شکل کامل (occupancy/revenue/cash)', !!ceo?.occupancy && 'revenueTodayRials' in ceo && 'cashBalanceRials' in ceo, `keys=${Object.keys(ceo ?? {}).join(',')}`);
S.step('CEO: جمع اتاق‌ها = DB', ceo?.occupancy?.totalRooms === roomsTotal, `api=${ceo?.occupancy?.totalRooms} db=${roomsTotal}`);
S.step('CEO: اشغال = DB', ceo?.occupancy?.occupiedUnits === occupied, `api=${ceo?.occupancy?.occupiedUnits} db=${occupied}`);
const revDb = (await c.query(`select coalesce(sum(l."creditRials"-l."debitRials"),0)::text as v from journal_lines l join journal_entries e on e.id=l."entryId" join accounts a on a.code=l."accountCode" where a.type='REVENUE' and e.status='POSTED' and e."postingDate"::date=current_date`)).rows[0];
S.step('CEO: درآمد امروز = DB', Number(ceo?.revenueTodayRials) === Number(revDb.v), `api=${ceo?.revenueTodayRials} db=${revDb.v}`);
S.step('CEO: asOf تاریخ شمسی (ماه نام‌دار)', /^[0-9]{1,2}\s+[\u0600-\u06FF]+\s+1[34][0-9]{2}$/.test(String(ceo?.asOf ?? '').trim()), `asOf=${ceo?.asOf}`);

// ── Finance ──
const fin = (await req('GET', '/dashboards/finance', { token: T.accountant })).json?.data;
const cashDb = (await c.query(`select coalesce(sum(l."debitRials"-l."creditRials"),0)::text as v from journal_lines l join journal_entries e on e.id=l."entryId" where l."accountCode"='1101' and e.status='POSTED'`)).rows[0];
const recDb = (await c.query(`select coalesce(sum(l."debitRials"-l."creditRials"),0)::text as v from journal_lines l join journal_entries e on e.id=l."entryId" where l."accountCode"='1201' and e.status='POSTED'`)).rows[0];
S.step('Finance: صندوق = ماندهٔ ۱۱۰۱', Number(fin?.cashBoxes?.[0]?.balanceRials) === Number(cashDb.v), `api=${fin?.cashBoxes?.[0]?.balanceRials} db=${cashDb.v}`);
S.step('Finance: دریافتنی = ماندهٔ ۱۲۰۱', Number(fin?.receivablesRials) === Number(recDb.v), `api=${fin?.receivablesRials} db=${recDb.v}`);
S.step('Finance: هشدار اقلام معلق و staleItems حاضر', Array.isArray(fin?.staleItems) && 'alertsCount' in fin, `stale=${fin?.staleItems?.length} alerts=${fin?.alertsCount}`);

// ── Restaurant ──
const rest = (await req('GET', '/dashboards/restaurant', { token: T.admin })).json?.data;
// منبع واقعی داشبورد pos_orders است (سایر تست‌ها journal را truncate می‌کنند — مقایسهٔ journal شکننده بود)
const salesDb = (await c.query(`select coalesce(sum("totalRials"),0)::text as v from pos_orders where status='SERVED' and "servedAt"::date=current_date`)).rows[0];
S.step('Restaurant: فروش امروز = جمع سفارش‌های SERVED امروز', Number(rest?.todaySalesRials) === Number(salesDb.v), `api=${rest?.todaySalesRials} db=${salesDb.v}`);
S.step('Restaurant: KPI ضایعات صفر واقعی (نه تخمین)', 'waste' in rest && rest?.waste?.todayRials === '0', `waste=${JSON.stringify(rest?.waste ?? {}).slice(0, 60)}`);

// ── Housekeeping ──
const hk = (await req('GET', '/dashboards/housekeeping', { token: T.admin })).json?.data;
const dirtyDb = (await c.query(`select count(*)::int as n from rooms where "hkStatus"='DIRTY'`)).rows[0].n;
const dirtyApi = (hk?.roomsByStatus ?? []).find((r) => r.status === 'DIRTY')?.count ?? 0;
S.step('Housekeeping: اتاق کثیف = DB', dirtyApi === dirtyDb, `api=${dirtyApi} db=${dirtyDb}`);
S.step('Housekeeping: تعداد کل اتاق = DB', hk?.totalRooms === roomsTotal, `api=${hk?.totalRooms}`);

await c.end();
S.finish();
