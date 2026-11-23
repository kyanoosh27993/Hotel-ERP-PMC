import pgPkg from 'pg';
const {Client}=pgPkg;
const c=new Client({connectionString:'postgresql://hotel:hotel_ci_pass@localhost:5433/hotel_erp'});
await c.connect();
const ob=await c.query(`select "eventName", attempts, "lastError" is not null as has_err, left("lastError",120) as err, "publishedAt" is not null as published from outbox_events order by "createdAt" desc limit 6`);
console.log('outbox:'); ob.rows.forEach(r=>console.log(' ', r.eventName, '| attempts', r.attempts, '| published', r.published, '|', r.err ?? ''));
await c.end();
