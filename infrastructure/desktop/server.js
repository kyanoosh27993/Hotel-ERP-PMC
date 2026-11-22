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
// لاگ فرزندِ اجرای محدود جدا از والد — خواناتر در دیاگ
const LOG_FILE = path.join(LOG_DIR, `run-${stamp}${process.env.HOTELERP_DEELEVATED === '1' ? '-child' : ''}.log`);
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
  let msg;
  if (err instanceof Error && (err.stack || err.message)) msg = err.stack || err.message;
  else {
    try { msg = JSON.stringify(err, Object.getOwnPropertyNames(err ?? {}), 1) + ' [' + (err?.constructor?.name ?? typeof err) + ']'; }
    catch (e) { msg = String(err); }
  }
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

/** شناسایی حساب مدیر (سطح یکپارچگی High/System) — PostgreSQL زیر حساب مدیر اجرا نمی‌شود */
function isWindowsAdmin() {
  if (!IS_WIN) return false;
  try {
    const out = require('child_process').execSync('whoami /groups', { encoding: 'utf8' });
    return out.includes('S-1-16-12288') || out.includes('S-1-16-16384');
  } catch (e) {
    return false;
  }
}

/**
 * اگر کاربر مدیر است: سرور با دسترسی محدود اجرا می‌شود — از طریق وظیفهٔ زمان‌بندی‌شدهٔ
 * ویندوز با /rl LIMITED (روش استاندارد کسر دسترسی؛ runas /trustlevel در برخی محیط‌ها اثر نمی‌کند).
 * همین کنسول نقش «ناظر» را دارد: وضعیت را نشان می‌دهد، مرورگر را باز می‌کند و باز می‌ماند.
 */
async function deElevateIfNeeded() {
  // گارد فرزند: فرایندِ با دسترسی محدود دیگر خود را نمی‌کاهد (جلوگیری از حلقهٔ بی‌پایان)
  if (process.env.HOTELERP_DEELEVATED === '1') {
    log('اجرای محدود فعال (فرزند) — ادامهٔ عادی');
    return false;
  }
  if (!isWindowsAdmin()) return false;
  log('اجرای زیر حساب مدیر شناسایی شد — PostgreSQL اجازهٔ اجرا نمی‌دهد؛ شروع مجدد با وظیفهٔ محدود…');
  const { spawnSync } = require('child_process');
  const tn = 'HotelERP Limited Run';
  const bootFile = path.join(DATA_DIR, 'boot.cmd');
  const boot = [
    '@echo off',
    'set "HOTELERP_DEELEVATED=1"',
    `set "HOTELERP_DATA_DIR=${DATA_DIR}"`,
    `set "HOTELERP_PORT=${PORT}"`,
    `set "SEED_ADMIN_PASSWORD=${SEED_PASSWORD}"`,
    `"${process.execPath}" "${path.join(__dirname, 'server.js')}"`,
  ].join('\r\n');
  fs.writeFileSync(bootFile, boot, 'utf8');

  const runSch = (args) => {
    const r = spawnSync('schtasks', args, { encoding: 'utf8' });
    log('[schtasks] ' + args[0] + ' → ' + String(r.stdout || '').trim().replace(/\r?\n/g, ' | ') + (r.stderr ? ' ERR: ' + String(r.stderr).trim() : ''));
    return r.status === 0;
  };
  const created = runSch(['/create', '/tn', tn, '/tr', `"${bootFile}"`, '/sc', 'once', '/st', '23:59', '/rl', 'LIMITED', '/f']);
  if (!created || !runSch(['/run', '/tn', tn])) {
    console.error('\n⛔ ساخت وظیفهٔ اجرای محدود ناموفق بود — لاگ: ' + LOG_FILE);
    console.error('   راه‌حل: این پنجره را با دسترسی معمولی (نه Run as administrator) باز کنید.');
    console.error('\nبرای بستن این پنجره Enter را بزنید…');
    process.stdin.resume();
    process.stdin.once('data', () => process.exit(1));
    return 'stay-open';
  }

  const baseUrl = `http://localhost:${PORT}`;
  try {
    await waitForHttp(`${baseUrl}/api/v1/health`, 300_000);
  } catch (e) {
    console.error('\n⛔ سرور با دسترسی محدود بالا نیامد — لاگ: ' + LOG_FILE);
    console.error('   اگر این پنجره را با «Run as administrator» باز کرده‌اید، آن را معمولی باز کنید.');
    console.error('\nبرای بستن این پنجره Enter را بزنید…');
    process.stdin.resume();
    process.stdin.once('data', () => process.exit(1));
    return 'stay-open';
  }
  console.log('\n✅ برنامه اجرا شد: ' + baseUrl);
  console.log('   این پنجره را می‌توانید کوچک کنید؛ بستن سرور از پنجرهٔ برنامه.');
  try {
    const opener = exec(`start "" "${baseUrl}"`);
    opener.on('error', () => {});
  } catch (e) { /* بدون رابط گرافیکی — آدرس چاپ شد */ }
  // نگه‌داشتن کنسول تا وقتی سرور زنده است
  let fails = 0;
  while (fails < 5) {
    await new Promise((r) => setTimeout(r, 3000));
    try { const res = await fetch(`${baseUrl}/api/v1/health`); if (res.ok) fails = 0; else fails += 1; }
    catch (e) { fails += 1; }
  }
  console.log('\nبرنامه بسته شد. برای بستن این پنجره Enter را بزنید…');
  process.stdin.resume();
  process.stdin.once('data', () => process.exit(0));
  return 'watching';
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: API_DIR, env: process.env, shell: IS_WIN, ...opts });
    p.stdout.on('data', (d) => logStream.write(d));
    p.stderr.on('data', (d) => logStream.write(d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(code) : reject(new Error(`${cmd} exited ${code}`))));
  });
}

// ── باینری‌های PostgreSQL (از @embedded-postgres/<platform>) — کنترل مستقیم با لاگ کامل ──
const PG_PLATFORM = IS_WIN ? 'windows-x64' : 'linux-x64';
const PG_BIN_DIR = path.join(API_DIR, 'node_modules', '@embedded-postgres', PG_PLATFORM, 'native', 'bin');
function pgBin(name) { return path.join(PG_BIN_DIR, IS_WIN ? name + '.exe' : name); }
function runBin(name, args, extraEnv = {}) {
  return new Promise((resolve) => {
    const out = [], err = [];
    let settled = false;
    let p;
    try { p = spawn(pgBin(name), args, { env: { ...process.env, ...extraEnv }, shell: false, windowsHide: true }); }
    catch (e) { resolve({ code: -1, stdout: '', stderr: 'spawn failed: ' + e.message }); return; }
    const finish = (code) => {
      if (settled) return;
      settled = true;
      // مهلت کوتاه برای رسیدن خروجی باقی‌مانده، سپس بستن pipeها تا حلقهٔ رویداد آزاد بماند
      setTimeout(() => {
        try { p.stdout && p.stdout.destroy(); } catch (e1) { /* بسته شده */ }
        try { p.stderr && p.stderr.destroy(); } catch (e2) { /* بسته شده */ }
        resolve({ code, stdout: Buffer.concat(out).toString(), stderr: Buffer.concat(err).toString() });
      }, 250);
    };
    p.stdout.on('data', (d) => { out.push(d); logStream.write('[' + name + '] ' + d); });
    p.stderr.on('data', (d) => { err.push(d); logStream.write('[' + name + '!] ' + d); });
    p.on('error', (e) => {
      if (settled) return;
      settled = true;
      resolve({ code: -1, stdout: Buffer.concat(out).toString(), stderr: 'spawn error: ' + e.message });
    });
    // نکتهٔ حیاتی ویندوز: postgresِ daemon دستگیرهٔ pipeی pg_ctl را به ارث می‌برد؛
    // رویداد «close» (منتظر بسته‌شدن stdio) هرگز نمی‌آید — فقط «exit».
    p.on('exit', (code) => finish(code ?? -1));
    // شبکهٔ ایمنی: اگر ۹۰ ثانیه نتیجه نیامد، با کد -2 رزولو کن
    setTimeout(() => finish(-2), 90_000).unref();
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

  // کاربر مدیر → اجرای محدود و نظارت (PostgreSQL زیر مدیر اجرا نمی‌شود)
  const delev = await deElevateIfNeeded();
  if (delev) return;

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
  // شروع مستقیم با pg_ctl (به‌جای pg.start که در خروج زودهنگام postgres، reject بی‌پیام می‌زد)
  // -l logfile: خطای واقعی postgres را ثبت می‌کند؛ -w: تا آماده‌شدن صبر می‌کند.
  const pgLog = path.join(PG_DIR, 'pg-server.log');
  let started = false;
  for (let attempt = 1; attempt <= 2 && !started; attempt += 1) {
    const r = await runBin('pg_ctl', ['-D', PG_DIR, '-l', pgLog, '-w', '-o', `-p ${pgPort}`, 'start'], { PGPASSWORD: 'hotel_local_pass', PGUSER: 'hotel' });
    if (r.code === 0) { started = true; log('PostgreSQL روی پورت ' + pgPort + ' بالا آمد'); }
    else {
      log(`pg_ctl تلاش ${attempt} ناموفق (کد ${r.code}): ${String(r.stderr).trim().slice(-400)}`);
      try { if (fs.existsSync(pgLog)) log('pg log tail: ' + fs.readFileSync(pgLog, 'utf8').slice(-1500)); } catch (e2) { /* خواندن لاگ حیاتی نیست */ }
      if (attempt < 2) await new Promise((r2) => setTimeout(r2, 3000));
      else throw new Error('شروع PostgreSQL ناموفق ماند — لاگ: ' + pgLog);
    }
  }
  // توقف تمیز هنگام خروج برنامه
  const stopPg = () => { runBin('pg_ctl', ['-D', PG_DIR, '-m', 'fast', 'stop']).catch(() => {}); };
  process.on('SIGINT', () => { stopPg(); process.exit(0); });
  process.on('SIGTERM', () => { stopPg(); process.exit(0); });

  // ساخت پایگاه داده با کلاینت pg (به دیتابیس پیش‌فرض postgres وصل می‌شویم)
  const pgLib = require(path.join(API_DIR, 'node_modules', 'pg'));
  const adminCli = new pgLib.Client({ host: '127.0.0.1', port: pgPort, user: 'hotel', password: 'hotel_local_pass', database: 'postgres', connectionTimeoutMillis: 15000 });
  await adminCli.connect();
  try { await adminCli.query('CREATE DATABASE hotel_erp OWNER hotel'); log('پایگاه داده hotel_erp ساخته شد'); }
  catch (e) { log('پایگاه داده hotel_erp موجود است (' + String(e.message).slice(-120) + ')'); }
  await adminCli.end();

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
  const probe = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 });
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

  // بازکردن مرورگر — هر خطایی نباید سرور را بیندازد؛ در اجرای محدود والد مرورگر را باز می‌کند
  if (process.env.HOTELERP_DEELEVATED !== '1') {
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
  }
  console.log('\n✅ برنامه اجرا شد: ' + baseUrl);
  console.log('   کاربران: admin / frontdesk / housekeeper / accountant — گذرواژه: ' + SEED_PASSWORD);
  console.log('   این پنجره = سرور برنامه؛ بستن آن = خاموش شدن برنامه.');
  console.log('   لاگ‌ها: ' + LOG_DIR + '\n');
}

main().catch(fatal);
