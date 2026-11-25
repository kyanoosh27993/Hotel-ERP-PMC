/**
 * test-launcher-recovery.mjs — شبیه‌سازی منطق ریکاوری لانچر ویندوز (باگ #۱۲)
 * همان عبارت‌های infrastructure/desktop/server.js: خواندن PG_VERSION، بکاپ
 * pgdata-old-PG<major>-<stamp>، پاک‌سازی postmaster.pid قدیمی (پورت مرده) و
 * حفظ pid وقتی سرور واقعاً زنده است. خروجی: PASS/FAIL هر گام.
 */
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';

const ROOT = '/home/z/my-project/scripts/.sim-tmp';
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(ROOT, { recursive: true });
let pass = 0, fail = 0;
const step = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`PASS ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};

// ── کپیِ دقیق عبارت‌های server.js ──
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
function portAlive(p) {
  return new Promise((res) => {
    const s = net.connect({ host: '127.0.0.1', port: p });
    s.once('connect', () => { s.destroy(); res(true); });
    s.once('error', () => res(false));
    s.setTimeout(1200, () => { s.destroy(); res(false); });
  });
}
async function recoverySim(PG_DIR, bundledMajor) {
  const versionFile = path.join(PG_DIR, 'PG_VERSION');
  let backup = null;
  if (bundledMajor && fs.existsSync(versionFile)) {
    const dirMajor = parseInt(String(fs.readFileSync(versionFile, 'utf8')).trim(), 10);
    if (Number.isFinite(dirMajor) && dirMajor !== bundledMajor) {
      backup = `${PG_DIR}-old-PG${dirMajor}-${stamp}`;
      fs.renameSync(PG_DIR, backup);
    }
  }
  return backup;
}
async function pidCleanupSim(PG_DIR) {
  const pidFile = path.join(PG_DIR, 'postmaster.pid');
  if (!fs.existsSync(pidFile)) return { removed: false, reason: 'absent' };
  const pidPort = Number(String(fs.readFileSync(pidFile, 'utf8')).split(/\r?\n/)[3]);
  if (Number.isFinite(pidPort) && !(await portAlive(pidPort))) {
    fs.unlinkSync(pidFile);
    return { removed: true, port: pidPort };
  }
  return { removed: false, reason: 'server alive or unparsable', port: pidPort };
}

// ── سناریوی دستگاه کارفرما: خوشهٔ PG17/PG19 با باندل متفاوت + pid قدیمی ──
const PG_DIR = path.join(ROOT, 'pgdata');
fs.mkdirSync(PG_DIR, { recursive: true });
fs.writeFileSync(path.join(PG_DIR, 'PG_VERSION'), '17\n');
fs.mkdirSync(path.join(PG_DIR, 'base'), { recursive: true }); // محتوای ساختگی خوشه
fs.writeFileSync(path.join(PG_DIR, 'postmaster.pid'), ['12345', PG_DIR, '2026-11-25 09:00:00', '59999', '', '', ''].join('\n'));

const backup = await recoverySim(PG_DIR, 19);
step('بکاپ خودکار خوشهٔ ناسازگار', !!backup && fs.existsSync(backup), backup ? path.basename(backup) : 'no backup');
step('خوشهٔ تازه در همان مسیر از دست رفته تا initdb اجرا شود', !fs.existsSync(PG_DIR));
step('محتوای خوشهٔ قدیمی در بکاپ حفظ شده', fs.existsSync(path.join(backup ?? '', 'base')));

// ── مسیر عادی (نسخهٔ هم‌خوان): پس از crash قبلی، pid قدیمی با پورت مرده باید پاک شود ──
// در server.js این مرحله پس از initdb است — شبیه‌سازی همان ترتیب:
fs.mkdirSync(PG_DIR, { recursive: true });
fs.writeFileSync(path.join(PG_DIR, 'postmaster.pid'), ['12345', PG_DIR, '2026-11-25 09:00:00', '59999', '', '', ''].join('\n'));
const c1 = await pidCleanupSim(PG_DIR);
step('postmaster.pid قدیمی (پورت مرده 59999) پاک شد', c1.removed === true, `port=${c1.port}`);
step('pg_ctl می‌تواند بدون «control file corrupt» شروع شود', !fs.existsSync(path.join(PG_DIR, 'postmaster.pid')));

// ── سناریوی معکوس: سرور واقعاً روی پورت زنده است → pid نباید پاک شود ──
const aliveSrv = net.createServer();
const alivePort = await new Promise((res) => {
  aliveSrv.listen(0, '127.0.0.1', () => res(aliveSrv.address().port));
});
fs.writeFileSync(path.join(PG_DIR, 'postmaster.pid'), ['99999', PG_DIR, 'x', String(alivePort), '', '', ''].join('\n'));
const c2 = await pidCleanupSim(PG_DIR);
aliveSrv.close();
step('pid با پورت زنده حفظ شد (سرور واقعاً در حال اجرا)', c2.removed === false && fs.existsSync(path.join(PG_DIR, 'postmaster.pid')), `port=${alivePort}`);

// ── سناریوهای هم‌خوانی: نسخهٔ یکسان → بدون بکاپ ──
fs.writeFileSync(path.join(PG_DIR, 'PG_VERSION'), '19\n');
const bak2 = await recoverySim(PG_DIR, 19);
step('نسخهٔ هم‌خوان (19=19) → هیچ بکاپی ساخته نمی‌شود', bak2 === null);

// ── سناریوی PG_VERSION خراب/غیرقابل‌پارس → بدون کرش، بدون بکاپ ──
fs.writeFileSync(path.join(PG_DIR, 'PG_VERSION'), 'garbage\n');
const bak3 = await recoverySim(PG_DIR, 19);
step('PG_VERSION خراب → کرش ندارد و بکاپ نمی‌سازد (محافظه‌کار)', bak3 === null);

console.log(`\nنتیجهٔ شبیه‌سازی ریکاوری: ${pass} PASS / ${fail} FAIL`);
fs.rmSync(ROOT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
