/**
 * infrastructure/desktop/server.js — ارکستراتور نسخهٔ دسکتاپ ویندوز (Hotel ERP)
 * هدف: هیچ‌گاه بسته‌شدن بی‌صدا — هر خطا لاگ فایل + پیام فارسی در کنسول + پنجره باز می‌ماند.
 * جریان: دیتابیس جاسازی‌شده (initdb اگر اولین اجرا) → مهاجرت → داده اولیه → API + شل وب → مرورگر.
 * اجرا: node server.js ( توسط run-server.cmd با node.exe همراه بسته)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const url = require('url');
const { spawn, exec } = require('child_process');

// ── مسیرها و پیکربندی ──
const ROOT = __dirname;
const API_DIR = path.join(ROOT, 'api');
const WEB_DIR = path.join(ROOT, 'web');
const NODE_EXE = process.env.HOTELERP_NODE || path.join(ROOT, 'node', 'node.exe');
const IS_WIN = process.platform === 'win32';
const DATA_DIR = process.env.HOTELERP_DATA_DIR
  || (IS_WIN ? path.join(process.env.APPDATA || ROOT, 'HotelERP') : path.join(ROOT, 'data'));
const LOG_DIR = path.join(DATA_DIR, 'logs');
const PG_DIR = path.join(DATA_DIR, 'pgdata');
const PORT = Number(process.env.HOTELERP_PORT || 3000);
const SEED_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'Admin@Hotel1';

fs.mkdirSync(LOG_DIR, { recursive: true });

// ── لاگر: کنسول + فایل (چرخش: حداکثر ۲۰ فایل) ──
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const LOG_FILE = path.join(LOG_DIR, `run-${stamp}.log`);
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  logStream.write(line + '\n');
}
try {
  const logs = fs.readdirSync(LOG_DIR).filter((f) => f.startsWith('run-')).sort();
  while (logs.length > 20) fs.unlinkSync(path.join(LOG_DIR, logs.shift()));
} catch (e) { /* چرخش لاگ حیاتی نیست */ }

/** پایان ایمن: پیام فارسی + لاگ + انتظار برای Enter (پنجره بسته نمی‌شود) */
function fatal(err) {
  const msg = err && err.stack ? err.stack : String(err);
  log('FATAL: ' + msg);
  console.error('\n⛔ خطا در اجرای برنامه — جزئیات کامل در فایل لاگ ذخیره شد:');
  console.error('   ' + LOG_FILE);
  console.error('\n' + msg);
  console.error('\nبرای بستن این پنجره Enter را بزنید…');
  process.stdin.resume();
  process.stdin.once('data', () => process.exit(1));
  // در محیط غیرتعاملی (CI) بعد از ۶۰ ثانیه خودش ببندد
  setTimeout(() => process.exit(1), 60_000).unref();
}

process.on('uncaughtException', fatal);
process.on('unhandledRejection', fatal);

function step(fa) { log('── ' + fa); }

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: API_DIR, env: process.env, shell: IS_WIN, ...opts });
    p.stdout.on('data', (d) => logStream.write(d));
    p.stderr.on('data', (d) => logStream.write(d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(code) : reject(new Error(`${cmd} exited ${code}`))));
  });
}

function freePort(start) {
  return new Promise((resolve) => {
    const tryPort = (p) => {
      const s = net.createServer();
      s.once('error', () => tryPort(p + 1));
      s.once('listening', () => s.close(() => resolve(p)));
      s.listen(p, '127.0.0.1');
    };
    tryPort(start);
  });
}

async function waitForHttp(url, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch (e) { /* هنوز بالا نیامده */ }
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error('Server did not become ready in time: ' + url);
}

async function main() {
  console.log('\n==============================================');
  console.log('   Hotel ERP — سامانه یکپارچه هتلداری');
  console.log('   نسخهٔ دسکتاپ v0.5.0 — در حال راه‌اندازی…');
  console.log('==============================================\n');
  log('data dir: ' + DATA_DIR);
  log('log file: ' + LOG_FILE);

  const port = await freePort(PORT);
  if (port !== PORT) log(`پورت ${PORT} اشغال بود — پورت ${port} انتخاب شد`);
  const baseUrl = `http://localhost:${port}`;

  // ── ۱) دیتابیس جاسازی‌شده PostgreSQL ──
  step('۱/۴ پایگاه داده جاسازی‌شده (PostgreSQL embedded)');
  // embedded-postgres بستهٔ ESM است — با import پویا بارگذاری می‌شود (سازگار با ویندوز/لینوکس)
  const { default: EmbeddedPostgres } = await import(
    url.pathToFileURL(path.join(API_DIR, 'node_modules', 'embedded-postgres', 'dist', 'index.js')).href
  );
  const pgPort = await freePort(port + 1);
  const pg = new EmbeddedPostgres({
    databaseDir: PG_DIR,
    user: 'hotel',
    password: 'hotel_local_pass',
    port: pgPort,
    persistent: true,
  });
  let initialised = false;
  try {
    await pg.initialise();
    initialised = true;
    log('خوشهٔ دیتابیس ساخته شد (اجرای اول)');
  } catch (e) {
    if (String(e.message).includes('already exists') || fs.existsSync(path.join(PG_DIR, 'PG_VERSION'))) {
      log('خوشهٔ دیتابیس موجود است — از اجرای قبل ادامه می‌دهیم');
    } else { throw e; }
  }
  await pg.start();
  try {
    await pg.createDatabase('hotel_erp');
    log('پایگاه داده hotel_erp ساخته شد');
  } catch (e) { log('پایگاه داده موجود است'); }

  process.env.DATABASE_URL = `postgresql://hotel:hotel_local_pass@localhost:${pgPort}/hotel_erp?schema=public`;
  process.env.PORT = String(port);
  process.env.WEB_DIR = WEB_DIR;
  process.env.SEED_ADMIN_PASSWORD = SEED_PASSWORD;
  process.env.NODE_ENV = 'production';
  log('DATABASE_URL تنظیم شد (پورت pg: ' + pgPort + ')');

  // ── ۲) مهاجرت‌ها ──
  step('۲/۴ به‌روزرسانی ساختار پایگاه داده (migrate deploy)');
  const prismaCli = path.join(API_DIR, 'node_modules', 'prisma', 'build', 'index.js');
  await run(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', path.join(API_DIR, 'prisma', 'schema.prisma')]);

  // ── ۳) داده اولیه (فقط اگر کاربر admin وجود نداشته باشد) ──
  step('۳/۴ دادهٔ اولیه (کاربران و اتاق‌های نمونه — در صورت نیاز)');
  const { Client } = require(path.join(API_DIR, 'node_modules', 'pg'));
  const probe = new Client({ connectionString: process.env.DATABASE_URL });
  await probe.connect();
  const hasAdmin = await probe.query(`SELECT 1 FROM "users" WHERE "username"='admin' LIMIT 1`);
  await probe.end();
  if (hasAdmin.rowCount === 0) {
    await run(process.execPath, [path.join(API_DIR, 'seed', 'prisma', 'seed.js')]);
  } else {
    log('کاربران موجودند — دادهٔ اولیه اجرا نشد');
  }

  // ── ۴) سرور برنامه + شل وب ──
  step('۴/۴ اجرای سرور برنامه و شل وب');
  require(path.join(API_DIR, 'dist', 'main.js'));
  await waitForHttp(`${baseUrl}/api/v1/health`, 120_000);
  log('سرور آماده است: ' + baseUrl);

  // بازکردن مرورگر — هر خطایی نباید سرور را بیندازد (در سرور بدون رابط هم امن است)
  try {
    if (IS_WIN) {
      const opener = exec(`start "" "${baseUrl}"`);
      opener.on('error', () => {});
    } else {
      const opener = spawn('xdg-open', [baseUrl], { stdio: 'ignore' });
      opener.on('error', () => log('مرورگر گرافیکی یافت نشد — آدرس را دستی باز کنید: ' + baseUrl));
    }
  } catch (e) {
    log('بازکردن مرورگر ناموفق — آدرس را دستی باز کنید: ' + baseUrl);
  }
  console.log('\n✅ برنامه اجرا شد: ' + baseUrl);
  console.log('   کاربران: admin / frontdesk / housekeeper / accountant — گذرواژه: ' + SEED_PASSWORD);
  console.log('   این پنجره = سرور برنامه؛ بستن آن = خاموش شدن برنامه.');
  console.log('   لاگ‌ها: ' + LOG_DIR + '\n');
}

main().catch(fatal);
