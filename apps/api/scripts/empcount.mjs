import pgPkg from 'pg';
const c = new pgPkg.Client({ connectionString: 'postgresql://hotel:hotel_ci_pass@localhost:5433/hotel_erp' });
await c.connect();
const r = await c.query('select count(*)::int as n, (select count(*)::int from salary_decisions) as d from employees');
console.log('employees:', r.rows[0].n, '| decisions:', r.rows[0].d);
await c.end();
