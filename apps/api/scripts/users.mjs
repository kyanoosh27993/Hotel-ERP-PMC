import pgPkg from 'pg';
const c = new pgPkg.Client({ connectionString: 'postgresql://hotel:hotel_ci_pass@localhost:5433/hotel_erp' });
await c.connect();
const r = await c.query('select username from users order by username');
r.rows.forEach(u => console.log(u.username, '| totp:', u.requiresTotp));
await c.end();
