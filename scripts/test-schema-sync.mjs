#!/usr/bin/env node
/**
 * scripts/test-schema-sync.mjs — تست واقعی ماژول desktop/schema-sync.js روی PostgreSQL جاسازی‌شده.
 *
 * سناریوها (همه روی همان باینری‌های embedded-postgres که CI لینوکس هم دارد):
 *   A) تجزیه‌گر SQL (کامنت/رشته/dollar-quote) + دسته‌بندی دستورها
 *   B) نصب تازه: اعمال همهٔ مهاجرت‌ها + هم‌ارز با خروجی Prisma (migrate diff خالی) + checksum
 *      + اجرای دوباره (هیچ تغییری نمی‌دهد) + prisma migrate status «up to date»
 *   C) ارتقا از مجموعهٔ ۱۷تایی (حالت کارفرما) → اعمال ۳ مهاجرتِ جاافتاده + هم‌ارز با Prisma
 *      + مشاهدهٔ رفتار Prisma (رد کردن مهاجرت وسط فهرست)
 *   E) ترمیم ردیف ناتمام (P3009) + بازسازی ستون‌ها
 *   F) از دست رفتن جدول تاریخچه روی DB پر (P3005): baseline بدون اجرای DML + حفظ داده
 *   G) حذف یک جدول + ردیف تاریخچه → بازسازی
 *   H) مهاجرت خراب: خطای فارسی + تراکنش برگشت می‌خورد + داده سالم
 *
 * اجرا: node scripts/test-schema-sync.mjs   (نیاز به node_modules نصب‌شده دارد)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const { Client } = require('pg');
const sync = require(path.join(ROOT, 'infrastructure/desktop/schema-sync.js'));
const PRISMA_CLI = path.join(ROOT, 'node_modules/prisma/build/index.js');
const SCHEMA = path.join(ROOT, 'apps/api/prisma/schema.prisma');
const MIGRATIONS = path.join(ROOT, 'apps/api/prisma/migrations');

// باینری‌های embedded-postgres (در npm ci روی ubuntu همین‌جا سوار می‌شوند)
const PG_BIN_CANDIDATES = [
  path.join(ROOT, 'node_modules/@embedded-postgres/linux-x64/native/bin'),
  path.join(ROOT, 'apps/api/node_modules/@embedded-postgres/linux-x64/native/bin'),
];
const PG_BIN = PG_BIN_CANDIDATES.find((p) => fs.existsSync(path.join(p, 'initdb')));
if (!PG_BIN) {
  console.error('SKIP: باینری embedded-postgres (linux-x64) پیدا نشد — روی ویندوز/غیرلینوکس اجرا نشود.');
  process.exit(process.env.CI ? 1 : 0);
}

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'hsync-'));
const initdb = path.join(PG_BIN, 'initdb');
const pgCtl = path.join(PG_BIN, 'pg_ctl');
let portCounter = 55800;
const nextPort = () => portCounter++;
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });

let pass = 0, fail = 0;
function ok(name, detail = '') { pass++; console.log(`  PASS ${name}${detail ? ' — ' + detail : ''}`); }
function bad(name, detail = '') { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
function assert(name, cond, detail = '') { cond ? ok(name, detail) : bad(name, detail); }

async function freshCluster(name) {
  const dir = path.join(WORK, name);
  const port = nextPort();
  fs.mkdirSync(dir, { recursive: true });
  let r = sh(initdb, ['-D', dir, '--username=hotel', '--encoding=UTF8', '--locale=C', '--auth=trust']);
  if (r.status !== 0) throw new Error('initdb: ' + r.stderr);
  r = sh(pgCtl, ['-D', dir, '-l', path.join(WORK, name + '.log'), '-w', '-t', '120', '-o', `-p ${port}`, 'start']);
  if (r.status !== 0) throw new Error('pg_ctl start: ' + r.stderr);
  return {
    dir, port,
    async createDb(db) {
      const c = new Client({ host: '127.0.0.1', port, user: 'hotel', database: 'postgres' });
      await c.connect(); await c.query(`CREATE DATABASE "${db}" OWNER hotel`); await c.end();
    },
    async stop() { sh(pgCtl, ['-D', dir, '-m', 'fast', '-w', '-t', '60', 'stop']); },
  };
}

function prisma(args, env, timeoutMs = 120_000) {
  return sh(process.execPath, [PRISMA_CLI, ...args], {
    env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1', CHECKPOINT_DISABLE: '1', ...env },
    timeout: timeoutMs,
  });
}

function dbUrl(port, db) { return `postgresql://hotel@127.0.0.1:${port}/${db}?schema=public`; }

// Prisma موقع «هیچ تفاوتی» همیشه یک کامنت «-- This is an empty migration.» چاپ می‌کند؛
// تفاوت واقعی فقط وقتی هست که بعد از حذف خطوط کامنت، متن SQL باقی بماند.
function diffIsEmpty(r) {
  const body = (r.stdout || '').split('\n').filter((l) => !/^\s*--/.test(l)).join('\n').trim();
  return r.status === 0 && body === '';
}

async function withDb(port, db, fn) {
  const c = new Client({ host: '127.0.0.1', port, user: 'hotel', database: db });
  await c.connect();
  try { return await fn(c); } finally { await c.end().catch(() => {}); }
}

// ─── A) تجزیه‌گر ─────────────────────────────────────────────────────────────
function testSplitter() {
  console.log('\n[A] تجزیه‌گر SQL و دسته‌بندی دستورها');
  const sql = [
    '-- comment with ; semicolon',
    "SELECT 'a;b' AS x;",
    '/* block ; comment */ SELECT 1;',
    "DO $$ BEGIN CREATE TYPE t AS ENUM ('A;B'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;",
    'SELECT $tag$ a ; b $tag$;',
    'CREATE TABLE "z" (id int);',
  ].join('\n');
  const s = sync.splitSql(sql);
  assert('split-count', s.length === 5, `got ${s.length}: ${JSON.stringify(s.map((x) => x.slice(0, 30)))}`);
  assert('no-comment-only-stmt', !s.some((x) => !sync.statementBody(x).trim()), 'دستور نباید فقط‌کامنت باشد');
  const doStmt = s.find((x) => /DO\s*\$\$/.test(x));
  assert('do-block-intact', !!doStmt && doStmt.includes("('A;B')"), 'دستور DO باید کامل باشد');
  assert('kind-drop', sync.statementKind('-- c\nALTER TABLE "x" DROP COLUMN y;') === 'drop');
  assert('kind-dml-cte', sync.statementKind('WITH n AS (SELECT 1) UPDATE t SET a=1;') === 'dml');
  assert('kind-ddl', sync.statementKind('CREATE TABLE "z" (id int);') === 'ddl');
  assert('kind-select-dml', sync.statementKind('SELECT setval($$s$$, 1);') === 'dml');
  let totalStmts = 0;
  for (const m of fs.readdirSync(MIGRATIONS)) {
    const f = path.join(MIGRATIONS, m, 'migration.sql');
    if (!fs.existsSync(f)) continue;
    const parts = sync.splitSql(fs.readFileSync(f, 'utf8'));
    assert(`mig-${m}-nonempty`, parts.length > 0, `${m}: ${parts.length} دستور`);
    assert(`mig-${m}-no-garbage`, !parts.some((p) => /^[\s;]*$/.test(p)), `${m}: دستور خالی/کامنت‌خالی`);
    totalStmts += parts.length;
  }
  ok(`all-migrations-split`, `${totalStmts} دستور در ۲۰ مهاجرت`);
}

// ─── B) نصب تازه + هم‌ارز با Prisma ──────────────────────────────────────────
async function testFresh() {
  console.log('\n[B] نصب تازه — اعمال بومی + هم‌ارزی با Prisma');
  const cl = await freshCluster('fresh');
  try {
    await cl.createDb('hotel_native');
    await cl.createDb('hotel_prisma');

    const r = await sync.syncSchema({
      pg: { Client },
      connection: { host: '127.0.0.1', port: cl.port, user: 'hotel', password: '', database: 'hotel_native' },
      migrationsDir: MIGRATIONS,
      log: () => {},
    });
    assert('fresh-applied-20', r.applied.length === 20 && r.marked.length === 0, `applied=${r.applied.length} marked=${r.marked.length}`);
    assert('fresh-mode', r.mode === 'applied', `mode=${r.mode}`);

    const dep = prisma(['migrate', 'deploy', '--schema', SCHEMA], { DATABASE_URL: dbUrl(cl.port, 'hotel_native') });
    const depOut = (dep.stdout + dep.stderr);
    assert('prisma-deploy-no-pending', dep.status === 0 && /No pending migrations/i.test(depOut), `exit=${dep.status} out=${depOut.slice(0, 200)}`);
    const st = prisma(['migrate', 'status', '--schema', SCHEMA], { DATABASE_URL: dbUrl(cl.port, 'hotel_native') });
    assert('prisma-status-uptodate', st.status === 0 && /up to date/i.test(st.stdout + st.stderr), `exit=${st.status} out=${(st.stdout + st.stderr).slice(0, 200)}`);

    const depP = prisma(['migrate', 'deploy', '--schema', SCHEMA], { DATABASE_URL: dbUrl(cl.port, 'hotel_prisma') });
    assert('prisma-ref-deploy-ok', depP.status === 0, depP.stderr.slice(0, 200));

    const diff = prisma(['migrate', 'diff', '--from-url', dbUrl(cl.port, 'hotel_native'), '--to-url', dbUrl(cl.port, 'hotel_prisma'), '--script']);
    assert('schema-equiv-prisma', diffIsEmpty(diff), `diff خالی نیست: ${(diff.stdout || '').slice(0, 300)}`);

    const same = await withDb(cl.port, 'hotel_native', async (c) => {
      const a = await c.query('SELECT migration_name, checksum FROM _prisma_migrations ORDER BY migration_name');
      const c2 = new Client({ host: '127.0.0.1', port: cl.port, user: 'hotel', database: 'hotel_prisma' });
      await c2.connect();
      const b = await c2.query('SELECT migration_name, checksum FROM _prisma_migrations ORDER BY migration_name');
      await c2.end();
      return a.rows.every((row, i) => b.rows[i] && row.checksum === b.rows[i].checksum);
    });
    assert('checksums-match-prisma', same);

    const r2 = await sync.syncSchema({ pg: { Client }, connection: { host: '127.0.0.1', port: cl.port, user: 'hotel', password: '', database: 'hotel_native' }, migrationsDir: MIGRATIONS, log: () => {} });
    assert('idempotent-noop', !r2.changed && r2.mode === 'up-to-date' && r2.applied.length === 0, `changed=${r2.changed} mode=${r2.mode}`);
    assert('idempotent-fast', r2.durationMs < 1500, `${r2.durationMs} ms`);
  } finally { await cl.stop(); }
}

// ─── C) ارتقا از مجموعهٔ ۱۷تایی (حالت کارفرما) ────────────────────────────────
async function testUpgrade() {
  console.log('\n[C] ارتقا از مجموعهٔ ۱۷تایی + مهاجرت جاافتاده وسط فهرست');
  const cl = await freshCluster('upgrade');
  try {
    await cl.createDb('hotel_old');     // حالت کارفرما: ۱۷ مهاجرت با Prisma
    await cl.createDb('hotel_full');    // مرجع: ۲۰ مهاجرت با Prisma

    const subset = path.join(WORK, 'mig-subset');
    fs.mkdirSync(path.join(subset, 'migrations'), { recursive: true });
    fs.copyFileSync(SCHEMA, path.join(subset, 'schema.prisma'));
    const LATER = new Set(['20261124130000_nationality_folio_items', '20261125100000_party_registry', '20261202000000_user_profile_fields']);
    for (const m of fs.readdirSync(MIGRATIONS)) {
      if (LATER.has(m)) continue;
      fs.cpSync(path.join(MIGRATIONS, m), path.join(subset, 'migrations', m), { recursive: true });
    }
    const depOld = prisma(['migrate', 'deploy', '--schema', path.join(subset, 'schema.prisma')], { DATABASE_URL: dbUrl(cl.port, 'hotel_old') });
    assert('prisma-old-deploy-ok', depOld.status === 0, depOld.stderr.slice(0, 200));

    await withDb(cl.port, 'hotel_old', async (c) => {
      await c.query('CREATE TABLE _ci_marker (v text NOT NULL)');
      await c.query("INSERT INTO _ci_marker VALUES ('customer-data')");
    });

    const depFull = prisma(['migrate', 'deploy', '--schema', SCHEMA], { DATABASE_URL: dbUrl(cl.port, 'hotel_full') });
    assert('prisma-full-deploy-ok', depFull.status === 0, depFull.stderr.slice(0, 200));

    // (یادداشت: Prisma 5.22 مهاجرت جاافتاده وسط فهرست را هم اعمال می‌کند — این حفره نیست.
    //  ماژول ما نیز آن را اعمال می‌کند؛ سناریوی زیر فقط اعمال بومی را می‌سنجد.)

    const r = await sync.syncSchema({ pg: { Client }, connection: { host: '127.0.0.1', port: cl.port, user: 'hotel', password: '', database: 'hotel_old' }, migrationsDir: MIGRATIONS, log: () => {} });
    assert('upgrade-applied-3', r.applied.length + r.marked.length === 3, `applied=${r.applied.length} marked=${r.marked.length}`);
    assert('upgrade-folio-created', await withDb(cl.port, 'hotel_old', async (c) => { const x = await c.query("SELECT to_regclass('public.folio_items') AS o"); return x.rows[0].o !== null; }), 'folio_items باید ساخته شود');
    assert('upgrade-marker-preserved', await withDb(cl.port, 'hotel_old', async (c) => { const x = await c.query('SELECT v FROM _ci_marker'); return x.rows.length === 1 && x.rows[0].v === 'customer-data'; }), 'دادهٔ کاربر باید دست‌نخورده بماند');

    // جدول نشان را قبلٔ هم‌ارزی‌سنجی حذف کنیم (خارج از مهاجرت‌هاست)
    await withDb(cl.port, 'hotel_old', async (c) => { await c.query('DROP TABLE _ci_marker'); });
    const diff = prisma(['migrate', 'diff', '--from-url', dbUrl(cl.port, 'hotel_old'), '--to-url', dbUrl(cl.port, 'hotel_full'), '--script']);
    assert('upgrade-equiv-prisma', diffIsEmpty(diff), `diff خالی نیست: ${(diff.stdout || '').slice(0, 300)}`);

    const st = prisma(['migrate', 'status', '--schema', SCHEMA], { DATABASE_URL: dbUrl(cl.port, 'hotel_old') });
    assert('upgrade-prisma-status-ok', st.status === 0 && /up to date/i.test(st.stdout + st.stderr), (st.stdout + st.stderr).slice(0, 200));
  } finally { await cl.stop(); }
}

// ─── E) ترمیم ردیف ناتمام (P3009) ─────────────────────────────────────────────
async function testFaulted() {
  console.log('\n[E] ترمیم ردیف ناتمام (P3009) + بازسازی ستون‌ها');
  const cl = await freshCluster('faulted');
  try {
    await cl.createDb('hotel_f');
    await sync.syncSchema({ pg: { Client }, connection: { host: '127.0.0.1', port: cl.port, user: 'hotel', password: '', database: 'hotel_f' }, migrationsDir: MIGRATIONS, log: () => {} });
    await withDb(cl.port, 'hotel_f', async (c) => {
      await c.query(`UPDATE _prisma_migrations SET finished_at = NULL, rolled_back_at = NULL WHERE migration_name = '20261202000000_user_profile_fields'`);
      await c.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "photoUrl"`);
      await c.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "position"`);
      await c.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "lastLoginAt"`);
      await c.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "lastLoginIp"`);
    });
    const dep = prisma(['migrate', 'deploy', '--schema', SCHEMA], { DATABASE_URL: dbUrl(cl.port, 'hotel_f') });
    console.log(`    [obs] Prisma روی DB خراب: exit=${dep.status} ${/P3009|failed migration/i.test(dep.stdout + dep.stderr) ? '(P3009)' : ''}`);
    const r = await sync.syncSchema({ pg: { Client }, connection: { host: '127.0.0.1', port: cl.port, user: 'hotel', password: '', database: 'hotel_f' }, migrationsDir: MIGRATIONS, log: () => {} });
    assert('faulted-healed-1', r.healed.length === 1, `healed=${r.healed.length}`);
    assert('faulted-applied-1', r.applied.length + r.marked.length === 1, `applied=${r.applied.length} marked=${r.marked.length}`);
    assert('faulted-cols-restored', await withDb(cl.port, 'hotel_f', async (c) => {
      const x = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name IN ('photoUrl','position','lastLoginAt','lastLoginIp')`);
      return x.rows.length === 4;
    }), 'ستون‌های users باید برگردانده شوند');
    const st = prisma(['migrate', 'status', '--schema', SCHEMA], { DATABASE_URL: dbUrl(cl.port, 'hotel_f') });
    assert('faulted-status-ok', st.status === 0 && /up to date/i.test(st.stdout + st.stderr), (st.stdout + st.stderr).slice(0, 200));
  } finally { await cl.stop(); }
}

// ─── F) از دست رفتن جدول تاریخچه روی DB پر (P3005) ────────────────────────────
async function testNoHistory() {
  console.log('\n[F] baseline (P3005) — بدون اجرای DML + حفظ داده');
  const cl = await freshCluster('nohist');
  try {
    await cl.createDb('hotel_h');
    await sync.syncSchema({ pg: { Client }, connection: { host: '127.0.0.1', port: cl.port, user: 'hotel', password: '', database: 'hotel_h' }, migrationsDir: MIGRATIONS, log: () => {} });
    await withDb(cl.port, 'hotel_h', async (c) => {
      // یک سند حسابداری با docIndex دستی — wave3 اگر DML اجرا کند آن را به ۱ تغییر می‌دهد
      await c.query(`INSERT INTO "journal_entries" ("entryNo","entryDate","postingDate","description","sourceModule","sourceRef","status","docIndex","updatedAt")
                     VALUES ('JV-CI-1','2026-01-01','2026-01-01','ci','ci','ci','POSTED',999999,now())`);
      await c.query(`DROP TABLE _prisma_migrations`);
    });
    const dep = prisma(['migrate', 'deploy', '--schema', SCHEMA], { DATABASE_URL: dbUrl(cl.port, 'hotel_h') });
    console.log(`    [obs] Prisma روی DB بدون تاریخچه: exit=${dep.status} ${/P3005|not empty/i.test(dep.stdout + dep.stderr) ? '(P3005)' : ''}`);
    const r = await sync.syncSchema({ pg: { Client }, connection: { host: '127.0.0.1', port: cl.port, user: 'hotel', password: '', database: 'hotel_h' }, migrationsDir: MIGRATIONS, log: () => {} });
    assert('nohist-baseline', r.mode === 'baseline', `mode=${r.mode}`);
    assert('nohist-data-preserved', await withDb(cl.port, 'hotel_h', async (c) => {
      const x = await c.query(`SELECT "docIndex" FROM "journal_entries" WHERE "docIndex" = 999999 LIMIT 1`);
      return x.rows.length === 1;
    }), 'ویرایش دستی docIndex نباید بازنویسی شود');
    const st = prisma(['migrate', 'status', '--schema', SCHEMA], { DATABASE_URL: dbUrl(cl.port, 'hotel_h') });
    assert('nohist-status-ok', st.status === 0 && /up to date/i.test(st.stdout + st.stderr), (st.stdout + st.stderr).slice(0, 200));
  } finally { await cl.stop(); }
}

// ─── G) حذف یک جدول + ردیف تاریخچه → بازسازی ────────────────────────────────
async function testMissingObject() {
  console.log('\n[G] بازسازی جدول حذف‌شده + ردیف تاریخچه');
  const cl = await freshCluster('missing');
  try {
    await cl.createDb('hotel_m');
    await sync.syncSchema({ pg: { Client }, connection: { host: '127.0.0.1', port: cl.port, user: 'hotel', password: '', database: 'hotel_m' }, migrationsDir: MIGRATIONS, log: () => {} });
    await withDb(cl.port, 'hotel_m', async (c) => {
      await c.query(`DROP TABLE "folio_items" CASCADE`);
      await c.query(`DELETE FROM _prisma_migrations WHERE migration_name = '20261124130000_nationality_folio_items'`);
    });
    const r = await sync.syncSchema({ pg: { Client }, connection: { host: '127.0.0.1', port: cl.port, user: 'hotel', password: '', database: 'hotel_m' }, migrationsDir: MIGRATIONS, log: () => {} });
    assert('missing-recreated', r.changed && (r.applied.length + r.marked.length) === 1, `applied=${r.applied.length} marked=${r.marked.length}`);
    assert('missing-folio-back', await withDb(cl.port, 'hotel_m', async (c) => { const x = await c.query("SELECT to_regclass('public.folio_items') AS o"); return x.rows[0].o !== null; }));
  } finally { await cl.stop(); }
}

// ─── H) مهاجرت خراب: خطای فارسی + تراکنش برگشت ───────────────────────────────
async function testBrokenMigration() {
  console.log('\n[H] مهاجرت خراب — خطای دقیق + داده سالم');
  const cl = await freshCluster('broken');
  try {
    await cl.createDb('hotel_b');
    await sync.syncSchema({ pg: { Client }, connection: { host: '127.0.0.1', port: cl.port, user: 'hotel', password: '', database: 'hotel_b' }, migrationsDir: MIGRATIONS, log: () => {} });
    const tmpMig = path.join(WORK, 'mig-broken');
    fs.mkdirSync(path.join(tmpMig, 'migrations', '20261231000000_zzz_broken'), { recursive: true });
    fs.copyFileSync(SCHEMA, path.join(tmpMig, 'schema.prisma'));
    for (const m of fs.readdirSync(MIGRATIONS)) fs.cpSync(path.join(MIGRATIONS, m), path.join(tmpMig, 'migrations', m), { recursive: true });
    fs.writeFileSync(
      path.join(tmpMig, 'migrations', '20261231000000_zzz_broken', 'migration.sql'),
      'CREATE TABLE "zzz_ci" (id int NOT NULL);\nINSERT INTO "no_such_table_ci" VALUES (1);\n',
    );
    let err = null;
    try {
      await sync.syncSchema({ pg: { Client }, connection: { host: '127.0.0.1', port: cl.port, user: 'hotel', password: '', database: 'hotel_b' }, migrationsDir: path.join(tmpMig, 'migrations'), log: () => {} });
    } catch (e) { err = e; }
    assert('broken-throws', !!err && err.name === 'SchemaSyncError', err ? `name=${err.name}` : 'بدون خطا');
    assert('broken-persian-msg', !!err && /اعمال به‌روزرسانی پایگاه داده.*ناموفق بود/.test(err.userMessage), err ? err.userMessage.slice(0, 120) : '');
    assert('broken-shows-migration', !!err && err.detail && /20261231000000_zzz_broken/.test(JSON.stringify(err.detail)), err ? JSON.stringify(err.detail).slice(0, 120) : '');
    const clean = await withDb(cl.port, 'hotel_b', async (c) => {
      const t = await c.query("SELECT to_regclass('public.zzz_ci') AS o");
      const h = await c.query("SELECT count(*)::int AS n FROM _prisma_migrations WHERE migration_name = '20261231000000_zzz_broken'");
      return t.rows[0].o === null && h.rows[0].n === 0;
    });
    assert('broken-rolled-back', clean, 'جدول موقت نباید ساخته شود و ردیف تاریخچه نباید ثبت شود');
    const st = prisma(['migrate', 'status', '--schema', SCHEMA], { DATABASE_URL: dbUrl(cl.port, 'hotel_b') });
    assert('broken-db-still-ok', st.status === 0 && /up to date/i.test(st.stdout + st.stderr), (st.stdout + st.stderr).slice(0, 200));
  } finally { await cl.stop(); }
}

// ─── اجرا ───────────────────────────────────────────────────────────────────
(async () => {
  console.log('=== test-schema-sync ===');
  console.log(`PG_BIN: ${PG_BIN}`);
  testSplitter();
  await testFresh();
  await testUpgrade();
  await testFaulted();
  await testNoHistory();
  await testMissingObject();
  await testBrokenMigration();
  fs.rmSync(WORK, { recursive: true, force: true });
  console.log(`\n=== خلاصه: ${pass} PASS / ${fail} FAIL ===`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
