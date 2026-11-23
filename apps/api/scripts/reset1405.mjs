import pgPkg from 'pg';
const {Client}=pgPkg;
const c=new Client({connectionString:'postgresql://hotel:hotel_ci_pass@localhost:5433/hotel_erp'});
await c.connect();
const ids=await c.query(`select id from journal_entries where "sourceRef"='period-close:1405-07'`);
for (const r of ids.rows) {
  await c.query(`delete from journal_lines where "entryId"=$1`, [r.id]);
  await c.query(`delete from journal_entries where id=$1`, [r.id]);
}
await c.query(`update fiscal_periods set status='OPEN', "closedAt"=null, "closingEntryId"=null, "lockedAt"=null where code='1405-07'`);
console.log('reset done, removed closing entries:', ids.rows.length);
await c.end();
