// local-pg-e2e.mjs — بوت PostgreSQL جاسازی‌شده برای اجرای e2e محلی (پورت ۵۴۳۳)
// اجرا: node scripts/local-pg-e2e.mjs  → تا SIGINT فعال می‌ماند؛ سپس migrate/seed/e2e با DATABASE_URL.
import EmbeddedPostgres from 'embedded-postgres';

const dataDir = '/tmp/hotel-e2e-pg';
const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'hotel',
  password: 'hotel_ci_pass',
  port: 5433,
  persistent: false,
});

try {
  await pg.initialise();
} catch (e) {
  if (!String(e).includes('already exists')) throw e;
}
await pg.start();
try {
  await pg.createDatabase('hotel_erp');
} catch {
  /* exists */
}
console.log('PG_READY postgresql://hotel:hotel_ci_pass@localhost:5433/hotel_erp?schema=public');

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  try { await pg.stop(); } catch { /* noop */ }
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
// نگه داشتن پردازش
setInterval(() => {}, 1000);
