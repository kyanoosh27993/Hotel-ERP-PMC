import pgPkg from 'pg';
const {Client}=pgPkg;
const c=new Client({connectionString:'postgresql://hotel:hotel_ci_pass@localhost:5433/hotel_erp'});
await c.connect();
const idx=await c.query(`select tablename, indexname from pg_indexes where schemaname='public' and tablename in ('journal_lines','journal_entries','stock_movements','outbox_events','audit_logs','folio_charges','reservations','stay_rooms') order by tablename`);
idx.rows.forEach(r=>console.log(r.tablename,'::',r.indexname));
await c.end();
