import pgPkg from 'pg';
const {Client}=pgPkg;
const c=new Client({connectionString:'postgresql://hotel:hotel_ci_pass@localhost:5433/hotel_erp'});
await c.connect();
const m=await c.query(`select direction, qty, "refModule", "refId", "createdAt" from stock_movements where "stockItemId"=(select id from stock_items where code='STK-RICE') order by "createdAt"`);
m.rows.forEach(r=>console.log(r.direction, r.qty, '|', r.refModule, '|', String(r.refId).slice(0,20)));
const ords=await c.query(`select "orderNo", status, "createdAt" from restaurant_orders`);
ords.rows.forEach(r=>console.log('order:', r.orderNo, r.status, r.createdAt.toISOString().slice(11,19)));
await c.end();
