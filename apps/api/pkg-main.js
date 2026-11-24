/**
 * pkg-main.js — نقطهٔ ورود نسخهٔ دسکتاپ تک‌فایل (قانون ۸).
 * جریان: آماده‌سازی داده در APPDATA → استخراج موتورها/pg از snapshot → initdb+start →
 * اعمال مهاجرت‌ها → seed (اولین اجرا) → اجرای API روی 3000 با شل وب.
 * درست مثل INSTALL-WINDOWS-FA.md: دابل‌کلیک، پنجرهٔ کنسول سرور است، مرورگر localhost:3000.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const crypto = require('crypto');

const DATA_DIR =
  process.env.HOTELERP_DATA ||
  (process.platform === 'win32'
    ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'HotelERP')
    : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'HotelERP'));

const PG_PORT = 5434;
const WEB_PORT = 3000;
const WIN = process.platform === 'win32';
// لینوکس: باینری‌ها مستقیم در native/ — ویندوز: در native/bin
const PG_BIN_SNAP = path.join(__dirname, 'assets-stage', WIN ? 'pg-win' : 'pg-linux');
const ENGINE_SNAP = path.join(__dirname, 'assets-stage', 'engines', WIN ? 'query_engine-windows.dll.node' : 'libquery_engine-debian-openssl-3.0.x.so.node');
const WEB_SNAP = path.join(__dirname, 'assets-stage', 'web');
const MIG_SNAP = path.join(__dirname, 'prisma', 'migrations');
const PGDATA = path.join(DATA_DIR, 'pgdata');
const PGBIN = path.join(DATA_DIR, 'pg', 'bin');
const SOCK = path.join(DATA_DIR, 'pg-sock');
const LOG = (m) => console.log('[HotelERP] ' + m);

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

/** کپی بازگشتی از snapshot به دیسک واقعی (برای باینری‌های native و شل وب استاتیک) */
function copyTree(src, dst) {
  if (!fs.existsSync(src)) return false;
  ensureDir(dst);
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
  return true;
}

function loadConfig() {
  ensureDir(DATA_DIR);
  const cfgPath = path.join(DATA_DIR, 'config.json');
  if (fs.existsSync(cfgPath)) return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const cfg = {
    jwtAccess: crypto.randomBytes(48).toString('hex'),
    jwtRefresh: crypto.randomBytes(48).toString('hex'),
    adminPassword: 'Admin@Hotel1',
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 1));
  return cfg;
}

function extractRuntime() {
  let copied = false;
  const exeName = WIN ? 'postgres.exe' : 'postgres';
  if (!fs.existsSync(path.join(PGBIN, exeName))) {
    LOG('استخراج Postgres جاسازی‌شده…');
    copyTree(PG_BIN_SNAP, path.join(DATA_DIR, 'pg'));
    copied = true;
  }
  if (!fs.existsSync(path.join(DATA_DIR, 'engine', path.basename(ENGINE_SNAP)))) {
    LOG('استخراج موتور Prisma…');
    copyTree(path.dirname(ENGINE_SNAP), path.join(DATA_DIR, 'engine'));
    copied = true;
  }
  if (!fs.existsSync(path.join(DATA_DIR, 'web', 'index.html'))) {
    LOG('استخراج شل وب…');
    copyTree(WEB_SNAP, path.join(DATA_DIR, 'web'));
    copied = true;
  }
  // اجرایی کردن باینری‌های pg روی لینوکس
  if (!WIN && fs.existsSync(PGBIN)) {
    for (const f of ['initdb', 'pg_ctl', 'postgres']) {
      const p = path.join(PGBIN, f);
      if (fs.existsSync(p)) fs.chmodSync(p, 0o755);
    }
  }
  return copied;
}

function startPostgres(cfg) {
  const exe = (n) => n + (WIN ? '.exe' : '');
  const initdb = path.join(PGBIN, exe('initdb'));
  const pgctl = path.join(PGBIN, exe('pg_ctl'));
  const psql = path.join(PGBIN, exe('psql'));
  if (!fs.existsSync(PGDATA)) {
    LOG('ساخت خوشهٔ دیتابیس (اولین اجرا — حدود ۳۰ ثانیه)…');
    ensureDir(SOCK);
    const r = spawnSync(initdb, ['-D', PGDATA, '-U', 'hotel', '-A', 'trust', '--locale=C', '-E', 'UTF8'], { stdio: 'ignore' });
    if (r.status !== 0) throw new Error('initdb failed: ' + r.status + ' ' + (r.error && r.error.code) + ' ' + (r.stderr && r.stderr.toString().slice(0, 200)));
  }
  ensureDir(SOCK);
  // ویندوز از سوکت یونیکس پشتیبانی نمی‌کند — فقط TCP روی 127.0.0.1
  const sockOpt = WIN ? '' : ` -k "${SOCK}"`;
  const r = spawnSync(pgctl, ['-D', PGDATA, '-w', 'start', '-o', `-p ${PG_PORT}${sockOpt} -c listen_addresses=127.0.0.1`], { stdio: 'ignore' });
  if (r.status !== 0) LOG('pg_ctl start status=' + r.status + ' — احتمالاً از قبل روشن است؛ ادامه…');
  // URL ادمین — ساخت دیتابیس در main() با کلاینت Node (psql در پکیج embedded نیست)
  const adminUrl = `postgresql://hotel@127.0.0.1:${PG_PORT}/postgres`;
  LOG('کلاستر آماده روی پورت ' + PG_PORT);
  return adminUrl;
}

async function applyMigrations(dbUrl) {
  const { Client } = require('pg');
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  await client.query(`CREATE TABLE IF NOT EXISTS exe_migrations (id TEXT PRIMARY KEY, applied_at timestamptz DEFAULT now())`);
  const done = new Set((await client.query(`SELECT id FROM exe_migrations`)).rows.map((r) => r.id));
  const dirs = fs.readdirSync(MIG_SNAP).filter((d) => /^\d{14}_/.test(d)).sort();
  let applied = 0;
  for (const d of dirs) {
    if (done.has(d)) continue;
    const sql = fs.readFileSync(path.join(MIG_SNAP, d, 'migration.sql'), 'utf8');
    await client.query(sql);
    await client.query(`INSERT INTO exe_migrations (id) VALUES ($1)`, [d]);
    applied++;
  }
  LOG(`مهاجرت‌ها: ${dirs.length} کل — ${applied} اعمال شد`);
  await client.end();
}

async function seedIfEmpty(dbUrl, adminPassword) {
  const { Client } = require('pg');
  const c = new Client({ connectionString: dbUrl });
  await c.connect();
  const has = await c.query(`SELECT to_regclass('public.users') IS NOT NULL AS ok`);
  const empty = !has.rows[0].ok || (await c.query(`SELECT count(*)::int n FROM users`)).rows[0].n === 0;
  await c.end();
  if (!empty) { LOG('seed: داده موجود — رد شد'); return; }
  LOG('دادهٔ اولیه (نقش‌ها/کاربران/حساب‌ها/اتاق‌ها/قواعد)…');
  process.env.SEED_ADMIN_PASSWORD = adminPassword;
  // seed کامپایل‌شده — از snapshot اجرا می‌شود (بدون native وابستگی)
  await require('./build-seed/prisma/seed.js');
}

async function main() {
  const cfg = loadConfig();
  extractRuntime();
  const adminUrl = startPostgres(cfg);
  // ساخت hotel_erp اگر نیست
  const { Client } = require('pg');
  const ac = new Client({ connectionString: adminUrl });
  await ac.connect();
  const exists = await ac.query(`SELECT 1 FROM pg_database WHERE datname='hotel_erp'`);
  if (!exists.rows.length) { LOG('ساخت دیتابیس hotel_erp…'); await ac.query(`CREATE DATABASE hotel_erp`); }
  await ac.end();
  const dbUrl = adminUrl.replace('/postgres', '/hotel_erp');
  process.env.DATABASE_URL = dbUrl;
  process.env.PRISMA_QUERY_ENGINE_LIBRARY = path.join(DATA_DIR, 'engine', path.basename(ENGINE_SNAP));
  process.env.PORT = String(WEB_PORT);
  process.env.WEB_DIR = path.join(DATA_DIR, 'web');
  process.env.NODE_ENV = 'production';
  process.env.JWT_ACCESS_SECRET = cfg.jwtAccess;
  process.env.JWT_REFRESH_SECRET = cfg.jwtRefresh;
  process.env.SEED_ADMIN_PASSWORD = cfg.adminPassword;
  // نسخهٔ دسکتاپ تست: MFA خاموش (طبق INSTALL-WINDOWS-FA.md)
  delete process.env.MFA_TEST_SECRET;

  await applyMigrations(dbUrl);
  await seedIfEmpty(dbUrl, cfg.adminPassword);
  // نسخهٔ دسکتاپ: MFA خاموش (طبق INSTALL-WINDOWS-FA.md) — نقش‌های حساس بدون عامل دوم
  try {
    const { Client: C2 } = require('pg');
    const c2 = new C2({ connectionString: dbUrl });
    await c2.connect();
    await c2.query(`UPDATE roles SET "sensitiveMfa" = false`);
    await c2.end();
    LOG('MFA نسخهٔ دسکتاپ: خاموش');
  } catch (e) { LOG('MFA-off skip: ' + e.message); }
  LOG('اجرای سرور روی http://localhost:' + WEB_PORT + ' — این پنجره سرور است؛ بستنش = خاموش شدن برنامه');
  require('./dist/main.js');
}

main().catch((e) => { console.error('[HotelERP] خطا:', e); process.exit(1); });
