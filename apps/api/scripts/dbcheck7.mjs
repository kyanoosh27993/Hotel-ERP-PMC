import pgPkg from 'pg';
const {Client}=pgPkg;
const c=new Client({connectionString:'postgresql://hotel:hotel_ci_pass@localhost:5433/hotel_erp'});
await c.connect();
const law=await c.query(`select "code","version",("params"->>'vatBps') as vat, "effectiveFrom"::date from law_rules where code='LAW-VAT-RATE'`);
console.log('law now:', JSON.stringify(law.rows));
const au=await c.query(`select action, reason, "createdAt" from audit_logs where action='LAW_UPSERTED' order by "createdAt" desc limit 3`);
console.log('law audits:', JSON.stringify(au.rows));
await c.end();
