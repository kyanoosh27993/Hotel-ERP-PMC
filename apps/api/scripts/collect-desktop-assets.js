/**
 * collect-desktop-assets.js — آماده‌سازی desktop-assets برای pkg:
 * وب استاتیک + مهاجرت‌های SQL + موتورهای Prisma (native+windows) + باینری Postgres دو پلتفرم.
 * تیربال‌های ویندوزی از vendor-dist استخراج می‌شوند (نصب مستقیم روی لینوکس ممکن نیست).
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const API = path.resolve(__dirname, '..'); // apps/api
const ROOT = path.resolve(API, '..', '..');
const ASSETS = path.join(API, 'desktop-assets');

function rm(p) { fs.rmSync(p, { recursive: true, force: true }); }
function cp(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true, verbatimSymlinks: false });
}

rm(ASSETS);
fs.mkdirSync(ASSETS, { recursive: true });

// 1) وب استاتیک
cp(path.join(ROOT, 'apps', 'web'), path.join(ASSETS, 'web'));
rm(path.join(ASSETS, 'web', 'node_modules'));

// 2) مهاجرت‌ها
cp(path.join(API, 'prisma', 'migrations'), path.join(ASSETS, 'migrations'));

// 3) موتورهای Prisma (linux native + windows)
const engines = path.join(ASSETS, 'engines');
fs.mkdirSync(engines, { recursive: true });
for (const dir of [path.join(ROOT, 'node_modules', '@prisma', 'engines'), path.join(ROOT, 'node_modules', '.prisma', 'client')]) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.node')) {
      const dest = path.join(engines, f);
      if (!fs.existsSync(dest)) fs.copyFileSync(path.join(dir, f), dest);
    }
  }
}

// 4) Postgres ویندوزی از تیربال vendor-dist
const vendor = path.join(API, 'vendor-dist');
const winTgz = fs.readdirSync(vendor).find((f) => f.startsWith('embedded-postgres-windows-x64') && f.endsWith('.tgz'));
if (!winTgz) throw new Error('windows postgres tarball missing in vendor-dist');
const tmp = path.join(ASSETS, '.tmp-extract');
rm(tmp);
fs.mkdirSync(tmp, { recursive: true });
execSync(`tar -xzf "${path.join(vendor, winTgz)}" -C "${tmp}"`);
cp(path.join(tmp, 'package'), path.join(ASSETS, 'pg', 'win32'));
rm(tmp);

// 5) Postgres لینوکسی از node_modules (برای باینری تست همزاد)
cp(path.join(ROOT, 'node_modules', '@embedded-postgres', 'linux-x64'), path.join(ASSETS, 'pg', 'linux'));
rm(path.join(ASSETS, 'pg', 'linux', 'dist'));
rm(path.join(ASSETS, 'pg', 'linux', 'scripts'));

// خلاصه
const size = (p) => {
  let t = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else t += fs.statSync(f).size;
    }
  };
  walk(p);
  return (t / 1024 / 1024).toFixed(1) + 'MB';
};
// eslint-disable-next-line no-console
console.log('desktop-assets ready:');
for (const d of ['web', 'migrations', 'engines', 'pg/win32', 'pg/linux']) {
  // eslint-disable-next-line no-console
  console.log(`  ${d}: ${size(path.join(ASSETS, d))}`);
}
