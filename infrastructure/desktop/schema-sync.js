/**
 * infrastructure/desktop/schema-sync.js — همگام‌سازی ساختار پایگاه دادهٔ دسکتاپ (باگ #۱۵)
 *
 * چرا این ماژول وجود دارد: لانچر قبلی برای هر اجرا «prisma migrate deploy» را صدا می‌زد.
 * روی رایانهٔ کارفرما همین مرحله با «node.exe exited 1» شکست می‌خورد و چون خروجی Prisma
 * فقط در فایل لاگ می‌رفت، نه متن خطا روی صفحه می‌آمد و نه برنامه بالا می‌آمد. این ماژول
 * همان کار migrate deploy را مستقیم روی PostgreSQL انجام می‌دهد و به موتور بومی Prisma
 * (schema-engine) در زمان اجرا نیاز ندارد:
 *
 *   ۱) جدول تاریخچهٔ «_prisma_migrations» را دقیقاً هم‌شکل Prisma می‌سازد/می‌خواند
 *      (checksum = sha256 فایل migration.sql؛ همان قالبی که Prisma 5.22 می‌نویسد).
 *   ۲) مهاجرت‌های ثبت‌نشده را به ترتیب پوشه، هر کدام در یک تراکنش، اعمال و ثبت می‌کند.
 *   ۳) حالت‌های خراب را خودش ترمیم می‌کند (معادل P3009/P3005 در Prisma) بدون از دست رفتن داده:
 *        - ردیف «ناتمام» (اجرای قبلی وسط مهاجرت کشته شده) → مثل «migrate resolve --rolled-back»
 *          علامت‌گذاری و مهاجرت دوباره اعمال می‌شود.
 *        - جدول تاریخچهٔ گم‌شده روی پایگاه دادهٔ پر (P3005) → baseline: هر مهاجرتی که
 *          اشیایش از قبل هست فقط «ثبت» می‌شود، اشیای جاافتاده ساخته می‌شود، DML اجرا نمی‌شود.
 *        - مهاجرتی که وسط فهرست جا افتاده (Prisma فقط «بعد از آخرین مهاجرت اعمال‌شده» را
 *          می‌بیند و آن را بی‌صدا رد می‌کند) → اعمال می‌شود.
 *        - اجرای دوباره پس از COMMIT اما قبل از ثبت ردیف → دستورهای تکراری با خطای
 *          «already exists» تحمل می‌شوند و فقط ثبت تاریخچه تکمیل می‌شود.
 *   ۴) خطای واقعی SQL را دقیق و به فارسی برمی‌گرداند (کدام مهاجرت، کدام دستور، متن PostgreSQL).
 *
 * قانون برای مهاجرت‌های آینده: هر مهاجرت باید در یک تراکنش اجرا شود (بدون CONCURRENTLY /
 * VACUUM / CREATE DATABASE) و اگر DML دارد باید بی‌ضرر و تکرارشدنی باشد
 * (ON CONFLICT، رنک‌گذاری قطعی و …).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HISTORY_TABLE = '_prisma_migrations';

// همان DDL که Prisma 5.22 برای PostgreSQL می‌سازد (ستون‌ها، NOT NULL و کلید اصلی).
const HISTORY_DDL = `CREATE TABLE IF NOT EXISTS "${HISTORY_TABLE}" (
    "id" VARCHAR(36) NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "finished_at" TIMESTAMPTZ,
    "migration_name" VARCHAR(255) NOT NULL,
    "logs" TEXT,
    "rolled_back_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "${HISTORY_TABLE}_pkey" PRIMARY KEY ("id")
)`;

// SQLSTATEهایی که معنی «این شیء از قبل هست» می‌دهند
const ALREADY_EXISTS = new Set([
  '42P07', // duplicate_table (table/index/view/sequence)
  '42701', // duplicate_column
  '42710', // duplicate_object (constraint/type/trigger/…)
  '42P03', // duplicate_cursor
  '42712', // duplicate_function
  '42713', // duplicate_operator
  '42723', // duplicate_function (same signature)
  '42P04', // duplicate_database
]);
// و SQLSTATEهایی که برای دستور DROP معنی «از قبل حذف شده» می‌دهند
const ALREADY_DROPPED = new Set(['42704', '42703']);

const DML_KEYWORDS = new Set(['INSERT', 'UPDATE', 'DELETE', 'SELECT', 'WITH', 'TRUNCATE', 'MERGE', 'COPY', 'VALUES']);

class SchemaSyncError extends Error {
  /** @param {string} userMessage متن فارسی قابل‌نمایش برای کاربر @param {object} detail جزئیات فنی */
  constructor(userMessage, detail = {}) {
    super(userMessage);
    this.name = 'SchemaSyncError';
    this.userMessage = userMessage;
    this.detail = detail;
  }
}

// ── تجزیهٔ امن اسکریپت SQL به دستورها ─────────────────────────────────────────
// کامنت‌ها، رشته‌های '…' (با '' و \')، شناسه‌های "…" و بلوک‌های dollar-quoted
// ($$ … $$ و $tag$ … $tag$) را می‌شناسد تا «;» داخل آن‌ها دستور را نشکند.
const DOLLAR_TAG = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;
const IDENT_CHAR = /[A-Za-z0-9_$\u0080-\uFFFF]/;

function skipQuoted(sql, i, quote, escaped) {
  // sql[i] === quote؛ اندیس بعد از رشتهٔ بسته‌شده را می‌دهد
  let j = i + 1;
  while (j < sql.length) {
    const c = sql[j];
    if (escaped && c === '\\') { j += 2; continue; }
    if (c === quote) {
      if (sql[j + 1] === quote) { j += 2; continue; } // '' → نقل‌قول داخل رشته
      return j + 1;
    }
    j += 1;
  }
  return j; // رشتهٔ بسته‌نشده — PG خودش خطا می‌دهد
}

function splitSql(sql) {
  const out = [];
  let cur = '';
  let i = 0;
  let dollar = null;
  while (i < sql.length) {
    const c = sql[i];
    if (dollar) {
      if (c === '$' && sql.startsWith(dollar, i)) {
        cur += dollar;
        i += dollar.length;
        dollar = null;
      } else {
        cur += c;
        i += 1;
      }
      continue;
    }
    if (c === '-' && sql[i + 1] === '-') {
      const j = sql.indexOf('\n', i);
      if (j < 0) { cur += sql.slice(i); break; }
      cur += sql.slice(i, j);
      i = j;
      continue;
    }
    if (c === '/' && sql[i + 1] === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < sql.length && depth > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*') { depth += 1; j += 2; }
        else if (sql[j] === '*' && sql[j + 1] === '/') { depth -= 1; j += 2; }
        else j += 1;
      }
      cur += sql.slice(i, j);
      i = j;
      continue;
    }
    if (c === "'" || c === '"') {
      // E'…' رشتهٔ با escape؛ حرف E نباید دنبالهٔ یک شناسه باشد
      const escaped = c === "'" && (sql[i - 1] === 'e' || sql[i - 1] === 'E') && !(i > 1 && IDENT_CHAR.test(sql[i - 2]));
      const j = skipQuoted(sql, i, c, escaped);
      cur += sql.slice(i, j);
      i = j;
      continue;
    }
    if (c === '$') {
      const m = DOLLAR_TAG.exec(sql.slice(i));
      // $1 پارامتر یا a$b شناسه، تگ dollar-quote نیست
      if (m && !(i > 0 && IDENT_CHAR.test(sql[i - 1]))) {
        dollar = m[0];
        cur += m[0];
        i += m[0].length;
        continue;
      }
    }
    if (c === ';') {
      out.push(cur + ';');
      cur = '';
      i += 1;
      continue;
    }
    cur += c;
    i += 1;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** متن دستور بدون کامنت‌ها/فاصله‌های ابتدایی */
function statementBody(stmt) {
  const ws = /\s+/y;
  for (let i = 0; i < stmt.length;) {
    ws.lastIndex = i;
    const m = ws.exec(stmt);
    if (m) { i += m[0].length; continue; }
    if (stmt.startsWith('--', i)) {
      const j = stmt.indexOf('\n', i);
      if (j < 0) return '';
      i = j + 1;
      continue;
    }
    if (stmt.startsWith('/*', i)) {
      let depth = 1;
      let j = i + 2;
      while (j < stmt.length && depth > 0) {
        if (stmt.startsWith('/*', j)) { depth += 1; j += 2; }
        else if (stmt.startsWith('*/', j)) { depth -= 1; j += 2; }
        else j += 1;
      }
      i = j;
      continue;
    }
    return stmt.slice(i);
  }
  return '';
}

/** 'dml' (داده را تغییر می‌دهد) | 'drop' | 'ddl' */
function statementKind(stmt) {
  const body = statementBody(stmt);
  const m = /^([A-Za-z]+)/.exec(body);
  const kw = m ? m[1].toUpperCase() : '';
  if (kw === 'DROP') return 'drop';
  if (/^ALTER\s+TABLE\s+(?:"(?:[^"]|"")*"|[^\s]+)\s+DROP\b/i.test(body)) return 'drop';
  if (DML_KEYWORDS.has(kw)) return 'dml';
  return 'ddl';
}

/** 'exists' | 'dropped' | 'other' — آیا خطای PostgreSQL یعنی «این دستور قبلاً اثر خود را گذاشته»؟ */
function classifyError(err, stmt) {
  const code = String((err && err.code) || '');
  if (ALREADY_EXISTS.has(code)) return 'exists';
  if (ALREADY_DROPPED.has(code) && statementKind(stmt) === 'drop') return 'dropped';
  return 'other';
}

function excerpt(text, max = 160) {
  const s = String(text).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function pgErrorText(err) {
  if (!err) return 'خطای ناشناخته';
  const parts = [];
  parts.push(`[${err.code || 'بدون کد'}] ${err.message}`);
  for (const k of ['detail', 'hint', 'where']) if (err[k]) parts.push(`${k}: ${err[k]}`);
  return parts.join('\n');
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** مهاجرت‌های پوشه، مرتب‌شده مثل Prisma (مرتب‌سازی لغوی نام پوشه‌ها) */
function listMigrations(dir) {
  const items = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const file = path.join(dir, ent.name, 'migration.sql');
    if (!fs.existsSync(file)) continue;
    items.push({ name: ent.name, file, checksum: sha256File(file) });
  }
  items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return items;
}

async function withTransaction(client, fn) {
  await client.query('BEGIN');
  try {
    const r = await fn();
    await client.query('COMMIT');
    return r;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (e2) { /* اتصال افتاده — خطای اصلی مهم‌تر است */ }
    throw e;
  }
}

/** یک دستور داخل SAVEPOINT اجرا می‌شود تا خطای آن بقیهٔ مهاجرت را نکشد */
async function execStatement(client, idx, stmt) {
  const sp = `"hotel_erp_sp_${idx}"`;
  await client.query(`SAVEPOINT ${sp}`);
  try {
    await client.query(stmt);
    await client.query(`RELEASE SAVEPOINT ${sp}`);
    return 'ok';
  } catch (e) {
    try {
      await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
      await client.query(`RELEASE SAVEPOINT ${sp}`);
    } catch (e2) {
      // نتوانستیم به نقطهٔ امن برگردیم (اتصال قطع شده) — خطای اصلی را با نشانهٔ مرگناک پرتاب کن
      e.connectionLost = true;
    }
    throw e;
  }
}

/**
 * اعمال یک مهاجرت ثبت‌نشده.
 * @returns {{state:'applied'|'marked', ran:number, present:number, skippedDml:number}}
 */
async function applyMigration(client, mig, allowDml) {
  const stmts = splitSql(fs.readFileSync(mig.file, 'utf8'));
  return withTransaction(client, async () => {
    // DDL روی جدولِ در حال استفاده توسط برنامهٔ دیگری نباید تا ابد منتظر بماند
    await client.query("SET LOCAL lock_timeout = '30s'");
    let ran = 0;
    let present = 0;
    let skippedDml = 0;
    for (let i = 0; i < stmts.length; i += 1) {
      const stmt = stmts[i];
      const kind = statementKind(stmt);
      if (kind === 'dml' && !allowDml) { skippedDml += 1; continue; }
      try {
        await execStatement(client, i, stmt);
        ran += 1;
      } catch (e) {
        if (e.connectionLost) throw e;
        const cls = classifyError(e, stmt);
        if (cls === 'other') {
          throw new SchemaSyncError(
            `اعمال به‌روزرسانی پایگاه داده («${mig.name}»، دستور ${i + 1} از ${stmts.length}) ناموفق بود.\n` +
              `   دستور: ${excerpt(statementBody(stmt), 140)}\n` +
              `   خطای PostgreSQL: ${pgErrorText(e)}\n` +
              '   هیچ تغییری از این به‌روزرسانی در پایگاه داده ثبت نشد (داده‌ها سالم و دست‌نخورده‌اند).',
            { migration: mig.name, statement: i + 1, of: stmts.length, sql: excerpt(stmt, 2000), pg: e.message, code: e.code },
          );
        }
        present += 1;
      }
    }
    // ردیف تاریخچه — همان لحظه با تغییر ساختار ثبت می‌شود (اتمی)
    await client.query(
      `INSERT INTO "${HISTORY_TABLE}" ("id","checksum","finished_at","migration_name","logs","started_at","applied_steps_count")` +
        ' VALUES ($1, $2, now(), $3, NULL, now(), 1)',
      [crypto.randomUUID(), mig.checksum, mig.name],
    );
    const state = ran > 0 ? 'applied' : 'marked';
    return { state, ran, present, skippedDml };
  });
}

/**
 * همگام‌سازی ساختار پایگاه داده با پوشهٔ مهاجرت.
 * @param {object} opts
 * @param {object} opts.pg           ماژول pg (از node_modules برنامه)
 * @param {object} opts.connection   { host, port, user, password, database }
 * @param {string} opts.migrationsDir مسیر پوشهٔ prisma/migrations
 * @param {(msg:string)=>void} [opts.log]
 */
async function syncSchema(opts) {
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  const { pg, connection, migrationsDir } = opts;
  if (!pg || !pg.Client) throw new SchemaSyncError('ماژول pg در دسترس نیست.', {});
  if (!fs.existsSync(migrationsDir)) {
    throw new SchemaSyncError('پوشهٔ مهاجرت‌های پایگاه داده در فایل‌های برنامه پیدا نشد.', { migrationsDir });
  }
  const migrations = listMigrations(migrationsDir);
  if (migrations.length === 0) {
    throw new SchemaSyncError('هیچ فایل مهاجرتی در پوشهٔ مهاجرت‌ها پیدا نشد.', { migrationsDir });
  }

  const t0 = Date.now();
  const client = new pg.Client({
    host: connection.host,
    port: connection.port,
    user: connection.user,
    password: connection.password,
    database: connection.database,
    connectionTimeoutMillis: 15_000,
    query_timeout: 10 * 60 * 1000,
  });
  await client.connect();
  const result = {
    changed: false,
    mode: 'up-to-date',
    applied: [],
    marked: [],
    healed: [],
    skippedDml: 0,
    total: migrations.length,
    durationMs: 0,
  };
  try {
    // ── ۱) جدول تاریخچه ──
    const reg = await client.query('SELECT to_regclass($1) AS oid', [`public.${HISTORY_TABLE}`]);
    const historyExisted = reg.rows[0].oid !== null;
    let baseline = false;
    if (!historyExisted) {
      const tbl = await client.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`);
      const nonEmpty = tbl.rows[0].n > 0;
      await client.query(HISTORY_DDL);
      if (nonEmpty) {
        // معادل P3005: جداول هست ولی تاریخچه نیست — فقط ساختار کامل می‌شود، DML اجرا نمی‌شود
        baseline = true;
        result.mode = 'baseline';
        log('جدول تاریخچهٔ مهاجرت‌ها نبود ولی پایگاه داده خالی نبود — حالت baseline: ساختار جاافتاده کامل می‌شود، داده دست نمی‌خورد');
      } else {
        log('جدول تاریخچهٔ مهاجرت‌ها ساخته شد (پایگاه دادهٔ جدید)');
      }
    }
    // ── ۲) وضعیت تاریخچه ──
    const hist = await client.query(
      `SELECT id, migration_name, finished_at, rolled_back_at FROM "${HISTORY_TABLE}" ORDER BY started_at`,
    );
    const finished = new Set();
    for (const row of hist.rows) if (row.finished_at) finished.add(row.migration_name);
    const faulted = hist.rows.filter((r) => !r.finished_at && !r.rolled_back_at);
    if (faulted.length > 0) {
      // معادل «prisma migrate resolve --rolled-back <name>» — Prisma به چنین ردیفی P3009 می‌دهد
      await withTransaction(client, async () => {
        for (const row of faulted) {
          await client.query(`UPDATE "${HISTORY_TABLE}" SET rolled_back_at = now() WHERE id = $1`, [row.id]);
          result.healed.push(row.migration_name);
        }
      });
      result.changed = true;
      if (result.mode !== 'baseline') result.mode = 'healed';
      log('مهاجرت ناتمام از اجرای قبلی ترمیم شد (به‌عنوان برگشت‌خورده علامت خورد): ' + faulted.map((r) => r.migration_name).join('، '));
    }
    // در baseline دستورهای داده‌ای (INSERT/UPDATE) دوباره اجرا نمی‌شوند
    const allowDml = historyExisted || !baseline;

    // ── ۳) اعمال مهاجرت‌های ثبت‌نشده، به ترتیب پوشه ──
    const pending = migrations.filter((m) => !finished.has(m.name));
    if (pending.length === 0 && faulted.length === 0 && !baseline) {
      log(`ساختار پایگاه داده به‌روز است (${migrations.length} مهاجرت ثبت‌شده) — چیزی برای اعمال نیست`);
      return result;
    }
    for (const mig of pending) {
      const t = Date.now();
      const r = await applyMigration(client, mig, allowDml);
      result.changed = true;
      if (r.state === 'marked') {
        result.marked.push(mig.name);
        log(`ثبت شد (از قبل اعمال‌شده بود): ${mig.name}`);
      } else {
        result.applied.push(mig.name);
        log(
          `اعمال شد: ${mig.name} — ${r.ran} دستور در ${Date.now() - t} ms` +
            (r.present ? ` (${r.present} دستور از قبل اثر داشته بود)` : '') +
            (r.skippedDml ? ` — ${r.skippedDml} دستور داده‌ای در حالت baseline اجرا نشد` : ''),
        );
      }
      if (result.mode === 'up-to-date') result.mode = 'applied';
    }
    return result;
  } finally {
    result.durationMs = Date.now() - t0;
    try { await client.end(); } catch (e) { /* نادیده */ }
  }
}

module.exports = { syncSchema, splitSql, statementBody, statementKind, classifyError, SchemaSyncError, listMigrations, HISTORY_DDL };
