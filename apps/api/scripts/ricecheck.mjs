import pgPkg from 'pg';
const {Client}=pgPkg;
const c=new Client({connectionString:'postgresql://hotel:hotel_ci_pass@localhost:5433/hotel_erp'});
await c.connect();
const m=await c.query(`select direction, qty, "createdAt" from stock_movements where "stockItemId"=(select id from stock_items where code='STK-RICE') order by "createdAt"`);
console.log('rice movements:'); m.rows.forEach(r=>console.log(' ', r.direction, r.qty));
await c.end();
