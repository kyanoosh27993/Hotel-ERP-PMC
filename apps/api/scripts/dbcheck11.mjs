import pgPkg from 'pg';
const {Client}=pgPkg;
const c=new Client({connectionString:'postgresql://hotel:hotel_ci_pass@localhost:5433/hotel_erp'});
await c.connect();
const ob=await c.query(`select "eventName", attempts, "lastError", "publishedAt" is not null as pub from outbox_events where "eventName" like 'pms%' or "eventName" like '%night%'`);
console.log('pms/night events:'); ob.rows.forEach(r=>console.log(' ', r.eventName, 'attempts', r.attempts, 'pub', r.pub, '| err:', (r.lastError ?? '').slice(0,180)));
const je=await c.query(`select "entryNo", description, status from journal_entries where description like '%night audit%' order by "createdAt" desc limit 3`);
console.log('night audit journals:'); je.rows.forEach(r=>console.log(' ', r.entryNo, '|', r.status, '|', r.description));
await c.end();
