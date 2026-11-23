import pgPkg from 'pg';
const {Client}=pgPkg;
const c=new Client({connectionString:'postgresql://hotel:hotel_ci_pass@localhost:5433/hotel_erp'});
await c.connect();
const p=await c.query(`select code, "startDate"::date, "endDate"::date, status from fiscal_periods where '2026-11-23' between "startDate" and "endDate"`);
console.log('period containing today:', JSON.stringify(p.rows));
const all=await c.query(`select code, status from fiscal_periods order by code limit 5`);
console.log('first periods:', JSON.stringify(all.rows));
await c.end();
