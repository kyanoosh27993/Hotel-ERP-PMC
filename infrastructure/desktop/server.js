/**
 * infrastructure/desktop/server.js — ارکستراتور نسخهٔ دسکتاپ ویندوز (Hotel ERP)
 * هدف: هیچ‌گاه بسته‌شدن بی‌صدا — هر خطا لاگ فایل + پیام فارسی در کنسول + پنجره باز می‌ماند.
 * جریان: دیتابیس جاسازی‌شده (initdb اگر اولین اجرا) → همگام‌سازی ساختار → داده اولیه
 *        → API + شل وب → مرورگر (صفحهٔ ورود).
 * اجرا: node server.js (توسط run-server.cmd با node.exe همراه بسته)
 *
 * باگ #۱۴ (این نسخه):
 *   - خروجی همهٔ فرزندان (pg_ctl، Prisma، seed، API) هم در فایل لاگ و هم در کنسول می‌رود؛
 *     دیگر خطایی پنهان نمی‌ماند.
 *   - پایگاه دادهٔ یتیم (postgres بازمانده از اجرای قبلی) تشخیص داده می‌شود: اگر همان
 *     خوشه و همان نسخه باشد دوباره استفاده می‌شود، وگرنه تمیز متوقف می‌شود. دیگر
 *     «another server might be running / Permission denied» نمی‌گیریم.
 *   - لاگ PostgreSQL از داخل pgdata به logs/pg-server.log منتقل شد (دیگر fsyncِ
 *     crash-recovery روی فایلِ بازِ pg_ctl هنگ نمی‌کند و ۳۰ ثانیه تأخیر نمی‌سازد).
 *   - تایم‌اوتِ شروع pg_ctl به ۳۰۰ ثانیه رسید (ریکاوری روی دیسک کند + آنتی‌ویروس).
 *   - هنگام هر خطای مهلک (FATAL) یا بستن پنجره، PostgreSQL تمیز متوقف می‌شود (fast stop)
 *     تا دیگر یتیم نمانَد و ریکاوری لازم نشود.
 *   - اجرای دوباره وقتی برنامه از قبل بالا است: مرورگر باز می‌شود و پیام می‌دهد، نه
 *     کاشتنِ دومین سرور.
 *   - به‌روزرسانی ساختار پایگاه داده دیگر به «prisma migrate deploy» وابسته نیست
 *     (ماژول schema-sync.js — باگ #۱۵)؛ موتور بومی Prisma فقط برای بررسی نهایی و
 *     غیرمهلکِ وضعیت فراخوانی می‌شود.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn, exec, execSync, spawnSync } = require('child_process');

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
const VERSION = 'v3.2.3';
const LOCK_FILE = path.join(DATA_DIR, 'launcher.lock');
const PG_LOG = path.join(LOG_DIR, 'pg-server.log');

fs.mkdirSync(LOG_DIR, { recursive: true });

// باگ #۱۲-نمایش: پنجرهٔ کنسولِ ساخته‌شدهٔ schtasks (اجرای محدود) با صفحه‌کد پیش‌فرض
// OEM بالا می‌آید و فارسی به‌صورت «Ø³ÛŒØ³ØªÙ…» نمایش داده می‌شود. chcp را خودِ
// برنامه در همان ابتدا روی 65001 می‌گذارد تا همهٔ مسیرهای اجرا (مستقیم، boot.cmd،
// run-server.cmd) UTF-8 نشان دهند.
if (IS_WIN) {
  try { execSync('chcp 65001', { stdio: 'ignore' }); } catch (e) { /* ناکامی حیاتی نیست */ }
}

// ── لاگر: کنسول + فایل (چرخش: حداکثر ۲۰ فایل) ──
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
// لاگ فرزندِ اجرای محدود جدا از والد — خواناتر در دیاگ
const LOG_FILE = path.join(LOG_DIR, `run-${stamp}${process.env.HOTELERP_DEELEVATED === '1' ? '-child' : ''}.log`);
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

// tap خروجی استاندارد: هرچه API درون‌پروسه‌ای چاپ کند (Nest/Prisma) هم در فایل لاگ برود.
// با پرچم inLog از دوبلهٔ خطِ خودِ log() جلوگیری می‌شود.
let inLog = false;
const origStdoutWrite = process.stdout.write.bind(process.stdout);
const origStderrWrite = process.stderr.write.bind(process.stderr);
process.stdout.write = function (chunk, ...rest) { if (!inLog) { try { logStream.write(chunk); } catch (e) { /* */ } } return origStdoutWrite(chunk, ...rest); };
process.stderr.write = function (chunk, ...rest) { if (!inLog) { try { logStream.write(chunk); } catch (e) { /* */ } } return origStderrWrite(chunk, ...rest); };

// بافر حلقوی از آخرین خروجی فرزندان — برای پیام FATAL
const recentLines = [];
const RECENT_MAX = 200;
function childLog(buf) {
  const s = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf);
  try { logStream.write(s); } catch (e) { /* */ }
  // کنسول: خط به خط با پیشوند
  for (const line of s.split(/\r?\n/)) {
    if (!line) continue;
    inLog = true; console.log('│ ' + line); inLog = false;
    recentLines.push(line); if (recentLines.length > RECENT_MAX) recentLines.shift();
  }
}
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  inLog = true; console.log(line); inLog = false;
  logStream.write(line + '\n');
}
try {
  const logs = fs.readdirSync(LOG_DIR).filter((f) => f.startsWith('run-')).sort();
  while (logs.length > 20) fs.unlinkSync(path.join(LOG_DIR, logs.shift()));
} catch (e) { /* چرخش لاگ حیاتی نیست */ }

// ── وضعیتِ PostgreSQL که خودمان راه‌اندازی/بازاستفاده می‌کنیم ──
let pgOwned = false;       // آیا مالکیت توقف PG را داریم (شروع کردیم یا بازاستفاده کردیم)
let pgStarted = false;     // آیا PG واقعاً بالا آمده
let pgPort = null;
let lockHeld = false;

/** توقف تمیز PostgreSQL (fast) — هم async برای خروج عادی و هم sync برای سیگنال/FATAL.
 *  همواره فراخوانی می‌شود (pg_ctl stop اگر سروری نباشد بی‌ضرر است) تا هیچ‌گاه یتیم نمانَد. */
async function stopPgFast(timeoutMs = 60_000) {
  pgOwned = false; // جلوگیری از فراخوانی دوباره در همان مسیر
  try {
    const r = await runBin('pg_ctl', ['-D', PG_DIR, '-m', 'fast', '-w', '-t', '60', 'stop'], {}, timeoutMs);
    log('PostgreSQL متوقف شد (کد ' + r.code + ')');
  } catch (e) { log('توقف PostgreSQL ناموفق بود: ' + e.message); }
}
function stopPgSync() {
  try {
    const r = spawnSync(pgBin('pg_ctl'), ['-D', PG_DIR, '-m', 'fast', '-w', '-t', '30', 'stop'], { windowsHide: true, encoding: 'utf8', timeout: 20_000 });
    log('PostgreSQL (sync) متوقف شد (کد ' + r.status + ')');
  } catch (e) { /* در حال خروج — مهم نیست */ }
}

function removeLock() {
  if (!lockHeld) return;
  lockHeld = false;
  try { fs.unlinkSync(LOCK_FILE); } catch (e) { /* */ }
}

/** پایان ایمن: توقف PG + پیام فارسی + لاگ + انتظار برای Enter (پنجره بسته نمی‌شود) */
async function fatal(err) {
  let msg;
  if (err instanceof Error && (err.stack || err.message)) msg = err.stack || err.message;
  else {
    try { msg = JSON.stringify(err, Object.getOwnPropertyNames(err ?? {}), 1) + ' [' + (err?.constructor?.name ?? typeof err) + ']'; }
    catch (e) { msg = String(err); }
  }
  if (err && err.userMessage) msg = err.userMessage + '\n\n[جزئیات فنی] ' + msg;
  log('FATAL: ' + msg);
  await stopPgFast(30_000).catch(() => {});
  removeLock();
  console.error('\n⛔ خطا در اجرای برنامه — جزئیات کامل در فایل لاگ ذخیره شد:');
  console.error('   ' + LOG_FILE);
  if (recentLines.length) {
    console.error('\n— آخرین خروجی برنامه پیش از خطا:');
    for (const l of recentLines.slice(-25)) console.error('│ ' + l);
  }
  console.error('\n' + msg);
  console.error('\nبرای بستن این پنجره Enter را بزنید…');
  process.stdin.resume();
  process.stdin.once('data', () => process.exit(1));
  setTimeout(() => process.exit(1), 60_000).unref();
}
process.on('uncaughtException', (e) => { fatal(e); });
process.on('unhandledRejection', (e) => { fatal(e); });

// توقف تمیز هنگام بستن پنجره (SIGHUP روی ویندوز = بستن کنسول) یا سیگنال خروج
function shutdown(code) {
  removeLock();
  stopPgSync();
  process.exit(code ?? 0);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('SIGHUP', () => shutdown(0));

function step(fa) { log('── ' + fa); }

/** شناسایی حساب مدیر (سطح یکپارچگی High/System) — PostgreSQL زیر حساب مدیر اجرا نمی‌شود */
function isWindowsAdmin() {
  if (!IS_WIN) return false;
  try {
    const out = execSync('whoami /groups', { encoding: 'utf8' });
    return out.includes('S-1-16-12288') || out.includes('S-1-16-16384');
  } catch (e) { return false; }
}

/**
 * اگر کاربر مدیر است: سرور با دسترسی محدود اجرا می‌شود — از طریق وظیفهٔ زمان‌بندی‌شدهٔ
 * ویندوز با /rl LIMITED. همین کنسول نقش «ناظر» را دارد: وضعیت را نشان می‌دهد، مرورگر را
 * باز می‌کند و باز می‌ماند.
 */
async function deElevateIfNeeded() {
  if (process.env.HOTELERP_DEELEVATED === '1') {
    log('اجرای محدود فعال (فرزند) — ادامهٔ عادی');
    return false;
  }
  if (!isWindowsAdmin()) return false;
  log('اجرای زیر حساب مدیر شناسایی شد — PostgreSQL اجازهٔ اجرا نمی‌دهد؛ شروع مجدد با وظیفهٔ محدود…');
  const tn = 'HotelERP Limited Run';
  const bootFile = path.join(DATA_DIR, 'boot.cmd');
  const boot = [
    '@echo off',
    // فارسیِ پنجرهٔ فرزند — بدون chcp صفحه‌کد OEM باقی می‌ماند و متن خراب می‌شود (باگ #۱۲)
    'chcp 65001 >nul',
    'set "HOTELERP_DEELEVATED=1"',
    `set "HOTELERP_DATA_DIR=${DATA_DIR}"`,
    `set "HOTELERP_PORT=${PORT}"`,
    `set "SEED_ADMIN_PASSWORD=${SEED_PASSWORD}"`,
    ...(process.env.AUTH_CAPTCHA_REQUIRED ? [`set "AUTH_CAPTCHA_REQUIRED=${process.env.AUTH_CAPTCHA_REQUIRED}"`] : []),
    ...(process.env.JWT_ACCESS_SECRET ? [`set "JWT_ACCESS_SECRET=${process.env.JWT_ACCESS_SECRET}"`] : []),
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
  try { const opener = exec(`start "" "${baseUrl}"`); opener.on('error', () => {}); } catch (e) { /* */ }
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

/** اجرای یک فرزند با خروجی آینه‌شده در کنسول+لاگ؛ exit≠0 → reject */
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: API_DIR, env: process.env, shell: false, ...opts });
    p.stdout.on('data', childLog);
    p.stderr.on('data', childLog);
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(code) : reject(new Error(`${cmd} exited ${code}`))));
  });
}

// ── باینری‌های PostgreSQL (از @embedded-postgres/<platform>) ──
const PG_PLATFORM = IS_WIN ? 'windows-x64' : 'linux-x64';
const PG_BIN_DIR = path.join(API_DIR, 'node_modules', '@embedded-postgres', PG_PLATFORM, 'native', 'bin');
function pgBin(name) { return path.join(PG_BIN_DIR, IS_WIN ? name + '.exe' : name); }
function runBin(name, args, extraEnv = {}, timeoutMs = 90_000) {
  return new Promise((resolve) => {
    const out = [], err = [];
    let settled = false;
    let p;
    try { p = spawn(pgBin(name), args, { env: { ...process.env, ...extraEnv }, shell: false, windowsHide: true }); }
    catch (e) { resolve({ code: -1, stdout: '', stderr: 'spawn failed: ' + e.message }); return; }
    const finish = (code) => {
      if (settled) return;
      settled = true;
      setTimeout(() => {
        try { p.stdout && p.stdout.destroy(); } catch (e1) { /* */ }
        try { p.stderr && p.stderr.destroy(); } catch (e2) { /* */ }
        resolve({ code, stdout: Buffer.concat(out).toString(), stderr: Buffer.concat(err).toString() });
      }, 250);
    };
    p.stdout.on('data', (d) => { out.push(d); childLog('[' + name + '] ' + d); });
    p.stderr.on('data', (d) => { err.push(d); childLog('[' + name + '!] ' + d); });
    p.on('error', (e) => { if (settled) return; settled = true; resolve({ code: -1, stdout: Buffer.concat(out).toString(), stderr: 'spawn error: ' + e.message }); });
    // نکتهٔ ویندوز: postgresِ daemon دستگیرهٔ pipeی pg_ctl را به ارث می‌برد؛ رویداد «close»
    // هرگز نمی‌آید — فقط «exit».
    p.on('exit', (code) => finish(code ?? -1));
    // شبکهٔ ایمنی با تایم‌اوتِ قابل‌تنظیم
    if (timeoutMs > 0) setTimeout(() => finish(-2), timeoutMs).unref();
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
    try { const res = await fetch(url); if (res.ok) return; } catch (e) { /* هنوز بالا نیامده */ }
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error('Server did not become ready in time: ' + url);
}

/** نسخهٔ اصلی PostgreSQL باندل‌شده از خروجی pg_ctl --version («pg_ctl (PostgreSQL) 19.0 …») */
async function pgBundledMajor() {
  try {
    const r = await runBin('pg_ctl', ['--version'], {}, 15_000);
    const m = String(r.stdout).match(/PostgreSQL\)\s+(\d+)/);
    return m ? Number(m[1]) : null;
  } catch (e) { return null; }
}

/** اگر سروری روی پورت داده‌شده زنده است true می‌دهد */
function portAlive(p) {
  return new Promise((res) => {
    const s = net.connect({ host: '127.0.0.1', port: p });
    s.once('connect', () => { s.destroy(); res(true); });
    s.once('error', () => res(false));
    s.setTimeout(1200, () => { s.destroy(); res(false); });
  });
}

/** pid هنوز زنده است؟ (process.kill(pid,0) روی ویندوز و لینوکس کار می‌کند) */
function pidAlive(pid) {
  if (!pid || !Number.isFinite(pid)) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return false; }
}

const pgLib = () => require(path.join(API_DIR, 'node_modules', 'pg'));

/**
 * وضعیتِ سرور PostgreSQL روی این data dir را بررسی می‌کند.
 * @returns {{state:'running'|'stale-pid'|'stopped', port?, pid?, major?, sameDir?, reachable?}}
 */
async function pgStatus() {
  const pidFile = path.join(PG_DIR, 'postmaster.pid');
  if (!fs.existsSync(pidFile)) return { state: 'stopped' };
  const lines = String(fs.readFileSync(pidFile, 'utf8')).split(/\r?\n/);
  const pid = Number(lines[0]);
  const port = Number(lines[3]);
  if (!pidAlive(pid)) return { state: 'stale-pid', pid, port };
  // فرایند زنده است — آیا واقعاً PGِ همان خوشه و همان نسخه است و می‌پذیرد؟
  try {
    const c = new (pgLib()).Client({ host: '127.0.0.1', port, user: 'hotel', password: 'hotel_local_pass', database: 'postgres', connectionTimeoutMillis: 3000 });
    await c.connect();
    const v = await c.query('SHOW server_version_num');
    const d = await c.query('SHOW data_directory');
    await c.end();
    const major = Math.floor(Number(v.rows[0].server_version_num) / 10000);
    const sameDir = path.resolve(d.rows[0].data_directory).toLowerCase() === path.resolve(PG_DIR).toLowerCase();
    return { state: 'running', pid, port, major, sameDir, reachable: true };
  } catch (e) {
    return { state: 'running', pid, port, reachable: false };
  }
}

/** منتقل/چرخش لاگ PostgreSQL به logs/pg-server.log (خارج از pgdata) */
function rotatePgLog() {
  try {
    const legacy = path.join(PG_DIR, 'pg-server.log');
    if (fs.existsSync(legacy)) {
      // فقط وقتی سرور نمی‌چرخد این کار امن است (فراخوانی‌کننده تضمین می‌کند)
      const dest = path.join(LOG_DIR, 'pg-server.previous.log');
      try { fs.renameSync(legacy, dest); log('لاگ قدیمی pgdata/pg-server.log به logs/pg-server.previous.log منتقل شد'); }
      catch (e) { /* شاید قفل باشد — مهم نیست */ }
    }
    if (fs.existsSync(PG_LOG)) {
      const st = fs.statSync(PG_LOG);
      if (st.size > 5 * 1024 * 1024) {
        try { fs.renameSync(PG_LOG, path.join(LOG_DIR, 'pg-server.1.log')); } catch (e) { /* */ }
      }
    }
  } catch (e) { /* */ }
}

/**
 * اگر سرور از قبل روی همین خوشه و همین نسخه در حال اجراست → بازاستفاده (pgPort از pid).
 * وگرنه اگر فرایندِ یتیمِ ناسازگار یا ناشناخته زنده است → توقف تمیز.
 * اگر pid قدیمی است → پاک‌سازی.
 */
async function ensurePg(bundledMajor, freshPort) {
  const st = await pgStatus();
  if (st.state === 'running' && st.reachable && st.sameDir && st.major === bundledMajor) {
    pgPort = st.port;
    pgOwned = true;
    log(`PostgreSQL از اجرای قبل فعال است (PID ${st.pid}، پورت ${st.port}) — از همان استفاده می‌شود`);
    return 'reused';
  }
  if (st.state === 'running') {
    // یتیم ناسازگار/ناشناخته → تمیز متوقف کن تا pg_ctl بتواند شروع کند
    log(`پایگاه دادهٔ یتیم (PID ${st.pid}) شناسایی شد — توقف تمیز قبل از شروع تازه…`);
    const r = await runBin('pg_ctl', ['-D', PG_DIR, '-m', 'fast', '-w', '-t', '60', 'stop'], {}, 90_000);
    if (r.code !== 0) {
      // باز هم زنده؟
      const st2 = await pgStatus();
      if (st2.state === 'running' && pidAlive(st2.pid)) {
        throw new Error('پایگاه دادهٔ یتیم متوقف نشد (pg_ctl stop کد ' + r.code + '). سرور دیگری روی این داده در حال اجراست — لطفاً برنامه را از طریق Setup حذف و دوباره نصب کنید یا رایانه را ری‌استارت کنید.');
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (st.state === 'stale-pid') {
    try { fs.unlinkSync(path.join(PG_DIR, 'postmaster.pid')); log('postmaster.pid قدیمی پاک شد (فرایند زنده نبود)'); }
    catch (e) { /* */ }
  }
  // شروع تازه
  pgPort = freshPort;
  rotatePgLog();
  let started = false;
  for (let attempt = 1; attempt <= 2 && !started; attempt += 1) {
    // -t 300: ریکاوری روی دیسک کند/آنتی‌ویروس ممکن است طول بکشد (باگ #۱۴)
    const r = await runBin('pg_ctl', ['-D', PG_DIR, '-l', PG_LOG, '-w', '-t', '300', '-o', `-p ${pgPort}`, 'start'], { PGPASSWORD: 'hotel_local_pass', PGUSER: 'hotel' }, 330_000);
    if (r.code === 0) { started = true; log('PostgreSQL روی پورت ' + pgPort + ' بالا آمد'); }
    else {
      log(`pg_ctl تلاش ${attempt} ناموفق (کد ${r.code}): ${String(r.stderr).trim().slice(-400)}`);
      try { if (fs.existsSync(PG_LOG)) log('pg log tail: ' + fs.readFileSync(PG_LOG, 'utf8').slice(-1500)); } catch (e2) { /* */ }
      if (attempt < 2) await new Promise((r2) => setTimeout(r2, 3000));
      else throw new Error('شروع PostgreSQL ناموفق ماند — لاگ: ' + PG_LOG);
    }
  }
  pgOwned = true;
  return 'started';
}

// ── اجرای دوباره وقتی برنامه از قبل بالا است ──
async function appAlreadyRunning(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
    if (!res.ok) return false;
    const root = await fetch(`http://127.0.0.1:${port}/`);
    const html = await root.text();
    return /frontdesk\.js/.test(html); // نشانِ شل وبِ خودمان
  } catch (e) { return false; }
}

async function checkExistingInstance() {
  if (!fs.existsSync(LOCK_FILE)) return null;
  let parts;
  try { parts = String(fs.readFileSync(LOCK_FILE, 'utf8')).split('\t'); } catch (e) { return null; }
  const pid = Number(parts[0]);
  const port = Number(parts[1]);
  const ts = Number(parts[2]);
  if (!pidAlive(pid)) { try { fs.unlinkSync(LOCK_FILE); } catch (e) { /* */ } return null; }
  // نمونهٔ در حال راه‌اندازی یا اجرا — تا سلامتی پنج‌دقیقه صبر کن
  const t0 = Date.now();
  while (Date.now() - t0 < 300_000) {
    if (await appAlreadyRunning(port)) return { port, pid };
    // اگر قفل خیلی قدیمی شد (بیش از ۱۰ دقیقه بدون سلامتی) یعنی گیر کرده — قبضه کن
    if (Date.now() - ts > 600_000) { try { fs.unlinkSync(LOCK_FILE); } catch (e) { /* */ } log('قفل اجرای قبلی خیلی قدیمی بود — قبضه شد'); return null; }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('راه‌اندازی قبلی برنامه هنوز ادامه دارد و کامل نشده. لطفاً چند لحظه صبر کنید و دوباره اجرا کنید؛ اگر تکرار شد، پنجرهٔ قبلی را ببندید یا رایانه را ری‌استارت کنید.');
}

async function main() {
  console.log('\n==============================================');
  console.log('   Hotel ERP — سامانه یکپارچه هتلداری');
  console.log('   نسخهٔ دسکتاپ ' + VERSION + ' — در حال راه‌اندازی…');
  console.log('==============================================\n');
  log('data dir: ' + DATA_DIR);
  log('log file: ' + LOG_FILE);

  // کاربر مدیر → اجرای محدود و نظارت (PostgreSQL زیر مدیر اجرا نمی‌شود)
  const delev = await deElevateIfNeeded();
  if (delev) return;

  // اجرای دوباره وقتی از قبل بالا است → مرورگر + خروج
  const existing = await checkExistingInstance();
  if (existing) {
    const url = `http://localhost:${existing.port}`;
    log('برنامه از قبل در حال اجراست (PID ' + existing.pid + ') — مرورگر باز می‌شود');
    console.log('\n✅ برنامه از قبل در حال اجراست: ' + url);
    try { if (IS_WIN) { const o = exec(`start "" "${url}"`); o.on('error', () => {}); } } catch (e) { /* */ }
    console.log('\nبرای بستن این پنجره کلیدی بزنید…');
    process.stdin.resume();
    process.stdin.once('data', () => process.exit(0));
    return;
  }

  const port = await freePort(PORT);
  if (port !== PORT) log(`پورت ${PORT} اشغال بود — پورت ${port} انتخاب شد`);
  const baseUrl = `http://localhost:${port}`;

  // قفلِ نمونهٔ واحد
  try { fs.writeFileSync(LOCK_FILE, [process.pid, port, Date.now()].join('\t')); lockHeld = true; } catch (e) { /* */ }

  // ── ۱) دیتابیس جاسازی‌شده PostgreSQL ──
  step('۱/۴ پایگاه داده جاسازی‌شده (PostgreSQL embedded)');
  const bundledMajor = await pgBundledMajor();
  // باگ #۱۲: ناسازگاری نسخهٔ خوشهٔ موجود با باینری همراه — بکاپ کامل + خوشهٔ تازه
  const versionFile = path.join(PG_DIR, 'PG_VERSION');
  if (bundledMajor && fs.existsSync(versionFile)) {
    const dirMajor = parseInt(String(fs.readFileSync(versionFile, 'utf8')).trim(), 10);
    if (Number.isFinite(dirMajor) && dirMajor !== bundledMajor) {
      // اگر سرور قدیمی هنوز می‌چرخد اول متوقفش کنیم
      await stopPgFast(30_000).catch(() => {});
      pgOwned = false;
      const backup = `${PG_DIR}-old-PG${dirMajor}-${stamp}`;
      fs.renameSync(PG_DIR, backup);
      log(`خوشهٔ موجود با PostgreSQL ${dirMajor} ساخته شده ولی نسخهٔ همراه ${bundledMajor} است — بکاپ: ${backup}`);
      console.log('\n⚠️  خوشهٔ دیتابیس قدیمی با نسخهٔ متفاوت PostgreSQL ساخته شده بود و با نسخهٔ همراه برنامه سازگار نیست.');
      console.log('    داده‌های قبلی کامل نگه داشته شد در: ' + backup);
      console.log('    برنامه با خوشهٔ تازه ادامه می‌دهد (دادهٔ اولیهٔ استاندارد بازسازی می‌شود).\n');
    }
  }
  // initdb مستقیم با UTF-8 — روی ویندوز locale پیش‌فرض (WIN1252) متن فارسی را می‌شکند
  if (!fs.existsSync(versionFile)) {
    const r = await runBin('initdb', ['-D', PG_DIR, '--username=hotel', '--encoding=UTF8', '--locale=C', '--auth=trust'], {}, 120_000);
    if (r.code !== 0) throw new Error('initdb ناموفق (کد ' + r.code + '): ' + String(r.stderr).trim().slice(-400));
    log('خوشهٔ دیتابیس با کدگذاری UTF-8 ساخته شد (اجرای اول)');
  } else {
    log('خوشهٔ دیتابیس موجود است — از اجرای قبل ادامه می‌دهیم');
  }

  // شروع یا بازاستفادهٔ PostgreSQL (مدیریت یتیم + تایم‌اوت + لاگ خارج از pgdata)
  pgStarted = false;
  const freshPgPort = await freePort(port + 1);
  const pgMode = await ensurePg(bundledMajor, freshPgPort);
  pgStarted = true;
  if (pgMode === 'reused') log('(سرور پایگاه داده بازاستفاده شد — لاگ آن در ' + PG_LOG + ')');

  // ساخت پایگاه داده با کلاینت pg
  const adminCli = new (pgLib()).Client({ host: '127.0.0.1', port: pgPort, user: 'hotel', password: 'hotel_local_pass', database: 'postgres', connectionTimeoutMillis: 15000 });
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

  // ── ۲) همگام‌سازی ساختار پایگاه داده (باگ #۱۵: مستقل از موتور Prisma) ──
  step('۲/۴ به‌روزرسانی ساختار پایگاه داده (schema-sync)');
  const schemaSync = require(path.join(__dirname, 'schema-sync.js'));
  const syncResult = await schemaSync.syncSchema({
    pg: pgLib(),
    connection: { host: '127.0.0.1', port: pgPort, user: 'hotel', password: 'hotel_local_pass', database: 'hotel_erp' },
    migrationsDir: path.join(API_DIR, 'prisma', 'migrations'),
    log,
  });
  log(`نتیجه: mode=${syncResult.mode} applied=${syncResult.applied.length} marked=${syncResult.marked.length} healed=${syncResult.healed.length} (${syncResult.durationMs} ms)`);
  if (syncResult.applied.length) console.log('   اعمال شد: ' + syncResult.applied.join('، '));
  if (syncResult.marked.length) console.log('   از قبل اعمال‌شده ثبت شد: ' + syncResult.marked.join('، '));
  if (syncResult.healed.length) console.log('   ترمیم شد: ' + syncResult.healed.join('، '));

  // بررسی نهاییِ غیرمهلک با Prisma (فقط وقتی کاری انجام شده) — اگر شکست خورد فقط هشدار
  if (syncResult.changed) {
    const prismaCli = path.join(API_DIR, 'node_modules', 'prisma', 'build', 'index.js');
    if (fs.existsSync(prismaCli)) {
      try {
        await run(process.execPath, [prismaCli, 'migrate', 'status', '--schema', path.join(API_DIR, 'prisma', 'schema.prisma')]);
      } catch (e) {
        log('⚠️ بررسی وضعیت با Prisma ناموفق بود (برنامه ادامه می‌دهد، به‌روزرسانی بومی موفق بود): ' + e.message);
      }
    }
  }

  // ── ۳) داده اولیه (فقط اگر کاربر admin وجود نداشته باشد) ──
  step('۳/۴ دادهٔ اولیه (کاربران و اتاق‌های نمونه — در صورت نیاز)');
  const { Client } = pgLib();
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
  await waitForHttp(`${baseUrl}/api/v1/health`, 180_000);
  log('سرور آماده است: ' + baseUrl);

  // شل وب را بررسی کنیم (صفحهٔ ورود روی baseUrl)
  let loginReady = false;
  try {
    const r = await fetch(baseUrl);
    const html = await r.text();
    loginReady = /frontdesk\.js/.test(html);
    if (!loginReady) log('⚠️ شل وب بارگذاری شد ولی نشان frontdesk.js پیدا نشد — ممکن است نصب ناقص باشد');
  } catch (e) { log('⚠️ بررسی شل وب ناموفق: ' + e.message); }

  // بازکردن مرورگر — هر خطا نباید سرور را بیندازد
  if (process.env.HOTELERP_DEELEVATED !== '1') {
    try {
      if (IS_WIN) { const opener = exec(`start "" "${baseUrl}"`); opener.on('error', () => {}); }
      else { const opener = spawn('xdg-open', [baseUrl], { stdio: 'ignore' }); opener.on('error', () => log('مرورگر گرافیکی یافت نشد — آدرس را دستی باز کنید: ' + baseUrl)); }
    } catch (e) { log('بازکردن مرورگر ناموفق — آدرس را دستی باز کنید: ' + baseUrl); }
  }
  console.log('\n✅ برنامه اجرا شد: ' + baseUrl + (loginReady ? ' (صفحهٔ ورود باز شد)' : ''));
  console.log('   کاربران: admin / frontdesk / housekeeper / accountant — گذرواژه: ' + SEED_PASSWORD);
  console.log('   این پنجره = سرور برنامه؛ بستن آن = خاموش شدن برنامه.');
  console.log('   لاگ‌ها: ' + LOG_DIR + '\n');
}

main().catch(fatal);
