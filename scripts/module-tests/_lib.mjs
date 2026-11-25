// _lib.mjs — کتابخانهٔ مشترک تست‌های ماژولی (لایه ۱)
// قانون: هر اسکریپت ماژول فقط این کتابخانه + فایل‌های همان ماژول را لمس می‌کند.
import pgPkg from 'pg';
import { createHmac } from 'node:crypto';

export const BASE = 'http://localhost:3000/api/v1';
export const DB_URL = 'postgresql://hotel:hotel_ci_pass@localhost:5433/hotel_erp';
const TOTP_SECRET = 'JBSWY3DPEHPK3PXPE2ETEST';
export const PASSWORD = 'ChangeMe_Str0ng!';

export const day = (n = 0) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
export const TODAY = day(0);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function totp(secret = TOTP_SECRET, t = Date.now()) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let b = '';
  for (const c of secret) { const i = A.indexOf(c); if (i >= 0) b += i.toString(2).padStart(5, '0'); }
  const k = Buffer.from(Array.from({ length: b.length / 8 }, (_, i) => parseInt(b.slice(i * 8, i * 8 + 8), 2)));
  const ctr = Math.floor(t / 30000);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(ctr / 2 ** 32), 0);
  buf.writeUInt32BE(ctr % 2 ** 32, 4);
  const h = createHmac('sha1', k).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  return String(((h[o] & 0x7f) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1e6).padStart(6, '0');
}

export async function db() {
  const c = new pgPkg.Client({ connectionString: DB_URL });
  await c.connect();
  return c;
}

export async function req(method, path, { token, body } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await r.text();
  let json = null;
  try { json = JSON.parse(raw); } catch { /* پاسخ متنی (مثلاً CSV) */ }
  return { status: r.status, json, raw };
}

/**
 * گیت هویتی سخت‌گیرانه — هر چک‌این به رکورد یکتای مهمان با کد ملی معتبر نیاز دارد.
 * رکورد با رقم کنترلِ محاسبه‌شده می‌سازد؛ 409 (قبلاً ثبت‌شده) → همان رکورد قبلی برگشت داده می‌شود.
 */
let partySeq = 0;
export async function ensureParty(token, name = 'مهمان تست') {
  const base9 = '551' + String(Date.now() % 100000).padStart(5, '0') + String(++partySeq % 10);
  let s = 0;
  for (let i = 0; i < 9; i++) s += Number(base9[i]) * (10 - i);
  const r = s % 11;
  const nationalId = base9 + String(r < 2 ? r : 11 - r);
  const res = await req('POST', '/parties', { token, body: {
    kind: 'GUEST', firstName: name, lastName: `${name}-${Date.now().toString(36)}-${partySeq}`,
    nationalId, mobile: '0913' + String(Date.now() % 10000000).padStart(7, '0'), postalCode: '7719175571',
  } });
  if (res.status === 409) return res.json?.error?.details?.existing?.id;
  if (![200, 201].includes(res.status)) throw new Error('ensureParty failed: ' + res.status + ' ' + JSON.stringify(res.json).slice(0, 200));
  return res.json?.data?.id;
}

export async function login(username, withTotp) {
  const r = await req('POST', '/auth/login', { body: { username, password: PASSWORD, ...(withTotp ? { totp: totp() } : {}) } });
  if (r.status !== 200 && r.status !== 201) throw new Error(`login failed ${username}: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.accessToken;
}

// انتظار سند خودکار از صف outbox
export async function waitForJournal(sourceModule, sourceRef, timeoutMs = 15000) {
  const c = await db();
  const deadline = Date.now() + timeoutMs;
  let row = null;
  while (Date.now() < deadline) {
    const r = await c.query(
      `select e."entryNo", e."docIndex" from journal_entries e where e."sourceModule"=$1 and e."sourceRef"=$2 and e.status='POSTED' limit 1`,
      [sourceModule, sourceRef],
    );
    if (r.rows[0]) { row = r.rows[0]; break; }
    await sleep(400);
  }
  await c.end();
  return row;
}

export class Suite {
  constructor(name) { this.name = name; this.pass = 0; this.fail = 0; this.findings = []; }
  step(title, ok, detail = '') {
    if (ok) { this.pass++; console.log(`PASS ${title}${detail ? ' — ' + detail : ''}`); }
    else { this.fail++; console.log(`FAIL ${title} — ${detail}`); this.findings.push({ title, detail }); }
    return ok;
  }
  finish() {
    const keys = this.findings.map((f) => f.title.split(' ')[0]);
    console.log(`\n${this.name}: ${this.pass}/${this.pass + this.fail} PASS — ${this.fail} FAIL${this.findings.length ? ` — FINDINGS: [${keys.join(', ')}]` : ''}`);
    if (this.fail) process.exitCode = 1;
  }
}

// اعتبارسنجی شبا ایران (mod-97)
export function ibanValid(iban) {
  const s = String(iban).replace(/\s/g, '').toUpperCase();
  if (!/^IR\d{24}$/.test(s)) return false;
  const rearr = s.slice(4) + '1827' + s.slice(2, 4);
  let rem = 0n;
  for (const ch of rearr) rem = (rem * 10n + BigInt(ch)) % 97n;
  return rem === 1n;
}
export function buildIranIban(bban22) {
  // شبا ایران: IR + ۲ رقم کنترل + ۲۲ رقم BBAN = ۲۶ کاراکتر
  const bban = String(bban22).replace(/\D/g, '').padStart(22, '0').slice(-22);
  const payload = bban + '1827' + '00';
  let rem = 0n;
  for (const ch of payload) rem = (rem * 10n + BigInt(ch)) % 97n;
  const check = (98n - rem).toString().padStart(2, '0');
  return 'IR' + check + bban;
}
