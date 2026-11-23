import pgPkg from 'pg';
const {Client}=pgPkg;
const c=new Client({connectionString:'postgresql://hotel:hotel_ci_pass@localhost:5433/hotel_erp'});
await c.connect();
const r=await c.query(`SELECT setval('seq_journal', GREATEST(COALESCE((SELECT MAX((regexp_replace("entryNo", '^JV-\\d+-', ''))::bigint) FROM journal_entries WHERE "entryNo" LIKE 'JV-%'), 1), (SELECT last_value FROM seq_journal)))`);
console.log('seq_journal aligned to:', r.rows[0].setval);
await c.end();
