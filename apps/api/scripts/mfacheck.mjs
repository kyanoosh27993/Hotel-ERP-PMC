import pgPkg from 'pg';
const c = new pgPkg.Client({ connectionString: 'postgresql://hotel:hotel_ci_pass@localhost:5433/hotel_erp' });
await c.connect();
const r = await c.query(`select username, "totpSecret" from users where username='accountant'`);
console.log(r.rows[0]);
await c.end();
