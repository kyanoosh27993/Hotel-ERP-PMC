import pgPkg from 'pg';
const {Client}=pgPkg;
const c=new Client({connectionString:'postgresql://hotel:hotel_ci_pass@localhost:5433/hotel_erp'});
await c.connect();
const p=await c.query(`select code, status, "closedAt" is not null as closed, "closingEntryId" is not null as has_closing, "startDate"::date, "endDate"::date from fiscal_periods where code in ('1405-07','1405-98')`);
console.log('synthetic periods:', JSON.stringify(p.rows));
const e=await c.query(`select count(*)::int from journal_entries where "periodId" in (select id from fiscal_periods where code='1405-07')`);
console.log('entries in 1405-07:', e.rows[0].count);
await c.end();
