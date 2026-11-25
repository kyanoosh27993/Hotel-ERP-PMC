// dbcheck-uniq.mjs — کنترل سریع جدول parties و مجوزها روی PG محلی
import pg from 'pg';
const client = new pg.Client({ connectionString: 'postgresql://hotel:hotel_ci_pass@localhost:5433/hotel_erp' });
await client.connect();
const q = async (sql) => (await client.query(sql)).rows;
console.log('parties rows:', await q('SELECT count(*)::int AS n FROM parties'));
console.log('party perms:', await q("SELECT code FROM permissions WHERE code LIKE 'party.%'"));
console.log('migrations:', await q('SELECT count(*)::int AS n FROM _prisma_migrations'));
console.log('reservation partyId:', await q("SELECT column_name FROM information_schema.columns WHERE table_name='reservations' AND column_name='partyId'"));
console.log('supplier partyId:', await q("SELECT column_name FROM information_schema.columns WHERE table_name='suppliers' AND column_name='partyId'"));
await client.end();
