import pgPkg from 'pg';
const {Client}=pgPkg;
const c=new Client({connectionString:'postgresql://hotel:hotel_ci_pass@localhost:5433/hotel_erp'});
await c.connect();
const q=async(s)=>(await c.query(s)).rows[0].count;
console.log('laws:',await q('select count(*) from law_rules'),'| mappings:',await q('select count(*) from event_journal_mappings'),'| cost centers:',await q('select count(*) from cost_centers'),'| accounts 3901/4901:',await q(`select count(*) from accounts where code in ('3901','4901')`),'| users:',await q('select count(*) from users'));
await c.end();
