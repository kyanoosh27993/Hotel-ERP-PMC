/**
 * desktop/bootstrap.ts — نقطه ورود نسخه دسکتاپ (Hotel-ERP.exe):
 * ۱) استخراج دارایی‌ها از snapshot به پوشه داده واقعی
 * ۲) اجرای Postgres جاسازی‌شده (initdb/pg_ctl — بدون نیاز به نصب)
 * ۳) ساخت دیتابیس + اعمال مهاجرت‌ها (pg simple-query چندعبارتی)
 * ۴) seed در صورت خالی بودن کاربران
 * ۵) اجرای API + وب روی http://localhost:3000 و بازکردن مرورگر
 */
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomBytes } from 'crypto';
import { Client } from 'pg';

const EXE_DIR = path.dirname(process.execPath);
const IS_WIN = process.platform === 'win32';
const APP_DATA = process.env.HOTEL_DATA_DIR
  ? path.resolve(process.env.HOTEL_DATA_DIR)
  : IS_WIN
    ? path.join(process.env.APPDATA ?? EXE_DIR, 'HotelERP')
    : path.join(os.homedir(), '.hotel-erp-desktop');
const ASSETS = path.resolve(__dirname, '..', '..', 'desktop-assets');
const RUNTIME = path.join(APP_DATA, 'runtime');
const PG_PORT = Number(process.env.HOTEL_PG_PORT ?? 5437);
const PG_USER = 'hotel';
const PG_PASS = 'hotel_local';


function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[HotelERP] ${msg}`);
}

/** کپی بازگشتی از snapshot به دیسک واقعی (سیم‌لینک‌ها با محتوا) */
function copyRecursive(src: string, dest: string): void {
  const st = fs.lstatSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) copyRecursive(path.join(src, entry), path.join(dest, entry));
    return;
  }
  let buf: Buffer;
  try {
    buf = fs.readFileSync(src); // سیم‌لینک → محتوای هدف (در snapshot هم کار می‌کند)
  } catch {
    return; // سیم‌لینک شکسته — نادیده
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  if (!IS_WIN) {
    try { fs.chmodSync(dest, st.mode & 0o777 | 0o755); } catch { /* بی‌اهمیت */ }
  }
}

function extractAssets(): { pgBin: string; webDir: string; migrationsDir: string; engine: string } {
  const platformDir = IS_WIN ? 'win32' : 'linux';
  const pgSrc = path.join(ASSETS, 'pg', platformDir);
  const enginesSrc = path.join(ASSETS, 'engines');
  const webSrc = path.join(ASSETS, 'web');
  const migSrc = path.join(ASSETS, 'migrations');
  for (const d of [pgSrc, enginesSrc, webSrc, migSrc]) {
    if (!fs.existsSync(d)) throw new Error(`asset missing: ${d}`);
  }

  const pgDst = path.join(RUNTIME, 'pg', platformDir);
  const webDst = path.join(RUNTIME, 'web');
  const migDst = path.join(RUNTIME, 'migrations');
  copyRecursive(pgSrc, pgDst);
  copyRecursive(webSrc, webDst);
  copyRecursive(migSrc, migDst);

  // موتور Prisma متناظر پلتفرم → کنار exe واقعی
  const wanted = IS_WIN ? /windows/ : /(linux|debian)/;
  const engines = fs.readdirSync(enginesSrc).filter((f) => f.endsWith('.node') && wanted.test(f));
  if (!engines.length) throw new Error('Prisma query engine for platform not found in assets');
  const engineDst = path.join(RUNTIME, engines[0]);
  fs.copyFileSync(path.join(enginesSrc, engines[0]), engineDst);
  if (!IS_WIN) fs.chmodSync(engineDst, 0o755);
  process.env.PRISMA_QUERY_ENGINE_LIBRARY = engineDst;

  const bin = IS_WIN ? path.join(pgDst, 'native', 'bin') : path.join(pgDst, 'native', 'bin');
  return { pgBin: bin, webDir: webDst, migrationsDir: migDst, engine: engineDst };
}

function ensureSecrets(): void {
  const file = path.join(APP_DATA, 'secrets.json');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(APP_DATA, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      jwtAccess: randomBytes(48).toString('hex'),
    }, null, 2));
  }
  const secrets = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>;
  process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? secrets.jwtAccess;
}

function runTool(exe: string, args: string[], env?: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { env: { ...process.env, ...env }, windowsHide: true });
    let err = '';
    child.stderr.on('data', (d) => { err += String(d); });
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(exe)} exited ${code}: ${err.slice(-800)}`))));
    child.on('error', reject);
  });
}

async function startPostgres(pgBin: string): Promise<void> {
  const pgData = path.join(APP_DATA, 'pgdata');
  const sockDir = path.join(APP_DATA, 'sock');
  fs.mkdirSync(pgData, { recursive: true });
  fs.mkdirSync(sockDir, { recursive: true });
  const marker = path.join(pgData, 'PG_VERSION');
  const initdb = path.join(pgBin, IS_WIN ? 'initdb.exe' : 'initdb');
  const pgctl = path.join(pgBin, IS_WIN ? 'pg_ctl.exe' : 'pg_ctl');

  if (!fs.existsSync(marker)) {
    log('initdb — ساخت خوشه داده اول');
    const pwfile = path.join(APP_DATA, 'pgpw.txt');
    fs.writeFileSync(pwfile, PG_PASS);
    const env = IS_WIN ? {} : { LD_LIBRARY_PATH: path.join(pgBin, '..', 'lib') };
    await runTool(initdb, ['-D', pgData, '-U', PG_USER, '-A', 'md5', '--pwfile', pwfile, '-E', 'UTF8'], env);
    fs.rmSync(pwfile, { force: true });
  }

  log(`pg_ctl start — port ${PG_PORT}`);
  const serverArgs = `-p ${PG_PORT} -c listen_addresses=127.0.0.1${IS_WIN ? '' : ` -k ${sockDir}`}`;
  const child = spawn(pgctl, ['-D', pgData, '-l', path.join(APP_DATA, 'pg.log'), '-o', serverArgs, 'start'], {
    env: IS_WIN ? process.env : { ...process.env, LD_LIBRARY_PATH: path.join(pgBin, '..', 'lib') },
    windowsHide: true,
  });
  child.stdout?.on('data', () => undefined);
  child.stderr?.on('data', (d) => log(`pg_ctl: ${String(d).trim()}`));
  await new Promise<void>((resolve, reject) => {
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`pg_ctl start failed (${code})`))));
    child.on('error', reject);
  });
}

async function waitReady(): Promise<void> {
  const url = `postgresql://${PG_USER}:${PG_PASS}@127.0.0.1:${PG_PORT}/postgres`;
  for (let i = 0; i < 60; i += 1) {
    try {
      const c = new Client({ connectionString: url });
      await c.connect();
      await c.end();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error('Postgres ready timeout');
}

async function ensureDatabase(): Promise<void> {
  const admin = new Client({ connectionString: `postgresql://${PG_USER}:${PG_PASS}@127.0.0.1:${PG_PORT}/postgres` });
  await admin.connect();
  const dup = await admin.query(`SELECT 1 FROM pg_database WHERE datname = 'hotel_erp'`);
  if (dup.rowCount === 0) {
    log('CREATE DATABASE hotel_erp');
    await admin.query('CREATE DATABASE hotel_erp');
  }
  await admin.end();
}

async function applyMigrations(migrationsDir: string): Promise<void> {
  const url = `postgresql://${PG_USER}:${PG_PASS}@127.0.0.1:${PG_PORT}/hotel_erp`;
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query(`CREATE TABLE IF NOT EXISTS _desktop_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await c.query(`SELECT name FROM _desktop_migrations`)).rows.map((r) => r.name as string));
  const dirs = fs.readdirSync(migrationsDir).filter((d) => /^\d+_/.test(d)).sort();
  for (const name of dirs) {
    if (done.has(name)) continue;
    const sqlFile = path.join(migrationsDir, name, 'migration.sql');
    if (!fs.existsSync(sqlFile)) continue;
    log(`migration ${name}`);
    await c.query(fs.readFileSync(sqlFile, 'utf8')); // simple-query: چندعبارتی
    await c.query(`INSERT INTO _desktop_migrations (name) VALUES ($1)`, [name]);
  }
  await c.end();
}

async function seedIfNeeded(): Promise<void> {
  // require دیرهنگام — پس از تنظیم env و موتور Prisma
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PrismaClient } = require('@prisma/client') as typeof import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const users = await prisma.user.count();
    if (users > 0) {
      log(`db already seeded (${users} users)`);
      return;
    }
    log('seed — داده اولیه (کاربران/حساب‌ها/اتاق‌ها/قواعد/پرسنل)');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { runSeed } = require('../seed/seed') as typeof import('../seed/seed');
    await runSeed(prisma, { disableSensitiveMfa: true });
  } finally {
    await prisma.$disconnect();
  }
}

function openBrowser(url: string): void {
  try {
    const child = IS_WIN
      ? spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' })
      : spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    child.on('error', () => log(`browser open failed — آدرس را دستی باز کنید: ${url}`));
    child.unref();
  } catch {
    log(`browser open failed — آدرس را دستی باز کنید: ${url}`);
  }
}

function pollHealth(port: number, cb: () => void): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const http = require('http') as typeof import('http');
  const tick = (): void => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/v1/health', timeout: 1500 }, (res) => {
      res.resume();
      if (res.statusCode === 200) cb();
      else setTimeout(tick, 500);
    });
    req.on('error', () => setTimeout(tick, 500));
    req.on('timeout', () => { req.destroy(); setTimeout(tick, 500); });
  };
  tick();
}

async function main(): Promise<void> {
  log(`data dir: ${APP_DATA}`);
  fs.mkdirSync(APP_DATA, { recursive: true });
  ensureSecrets();
  const { pgBin, webDir, migrationsDir } = extractAssets();
  process.env.DATABASE_URL = `postgresql://${PG_USER}:${PG_PASS}@127.0.0.1:${PG_PORT}/hotel_erp?schema=public&connection_limit=10`;
  process.env.PORT = process.env.PORT ?? '3000';
  process.env.SEED_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@Hotel1';
  process.env.DESKTOP_WEB_DIR = webDir;
  // نسخه دسکتاپ: MFA خاموش برای تست آسان؛ حساس‌ها در استقرار واقعی فعال می‌شوند
  process.env.MFA_TEST_SECRET = process.env.MFA_TEST_SECRET ?? '';

  await startPostgres(pgBin);
  await waitReady();
  await ensureDatabase();
  await applyMigrations(migrationsDir);
  await seedIfNeeded();

  log(`starting app — http://localhost:${process.env.PORT}`);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('../main'); // Nest API + وب استاتیک

  pollHealth(Number(process.env.PORT), () => {
    log('ready ✓ — opening browser');
    openBrowser(`http://localhost:${process.env.PORT}`);
  });

  const stopPg = (): void => {
    try {
      const pgData = path.join(APP_DATA, 'pgdata');
      const pgctl = path.join(pgBin, IS_WIN ? 'pg_ctl.exe' : 'pg_ctl');
      const args = ['-D', pgData, '-m', 'fast', 'stop'];
      spawn(pgctl, args, { windowsHide: true, stdio: 'ignore', env: IS_WIN ? process.env : { ...process.env, LD_LIBRARY_PATH: path.join(pgBin, '..', 'lib') } });
    } catch { /* بی‌اهمیت */ }
  };
  process.on('SIGINT', () => { stopPg(); process.exit(0); });
  process.on('SIGTERM', () => { stopPg(); process.exit(0); });
}

main()
  .then(() => log('bootstrap done'))
  .catch((e) => {
    log(`FATAL: ${e.message}`);
    // eslint-disable-next-line no-console
    console.error(e);
    try { spawn(path.join(RUNTIME, 'pg', IS_WIN ? 'win32' : 'linux', 'native', 'bin', IS_WIN ? 'pg_ctl.exe' : 'pg_ctl'), ['-D', path.join(APP_DATA, 'pgdata'), '-m', 'immediate', 'stop'], { stdio: 'ignore' }); } catch { /* بی‌اهمیت */ }
    process.exit(1);
  });
