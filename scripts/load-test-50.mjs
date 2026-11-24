// load-test-50.mjs — فاز ۱۳ / F13-T3: آزمون بار — ۵۰ کاربر مجازی هم‌زمان، ۶۰ ثانیه، endpoints ترکیبی
const BASE = 'http://localhost:3000/api/v1';
const DURATION_MS = 60_000;
const USERS = 50;

async function login(username, password, totp = '') {
  const r = await fetch(BASE + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, ...(totp ? { totp } : {}) }),
  });
  const j = await r.json();
  if (!j.accessToken) throw new Error('login failed: ' + r.status);
  return j.accessToken;
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function main() {
  // TOTP برای نقش حساس — همان الگوی تست‌های ماژول
  const { createHmac } = await import('node:crypto');
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const secret = 'JBSWY3DPEHPK3PXPE2ETEST';
  let bits = '';
  for (const c of secret) { const i = A.indexOf(c); if (i >= 0) bits += i.toString(2).padStart(5, '0'); }
  const key = Buffer.from(Array.from({ length: bits.length / 8 }, (_, i) => parseInt(bits.slice(i * 8, i * 8 + 8), 2)));
  const ctr = Math.floor(Date.now() / 30000);
  const buf = Buffer.alloc(8); buf.writeUInt32BE(Math.floor(ctr / 2 ** 32), 0); buf.writeUInt32BE(ctr % 2 ** 32, 4);
  const h = createHmac('sha1', key).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const totp = String(((h[o] & 0x7f) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1e6).padStart(6, '0');
  const admin = await login('admin', 'ChangeMe_Str0ng!', totp);
  const front = await login('frontdesk', 'ChangeMe_Str0ng!');
  // ترکیب endpoints بر اساس نقش — فقط مسیرهای مجاز (۴۰۳ یعنی RBAC کار می‌کند، خطای بار نیست)
  const adminEps = [
    { path: '/health' }, { path: '/dashboards/ceo' }, { path: '/dashboards/finance' },
    { path: '/compliance/quarterly/summary?taxYear=1405&quarter=3' }, { path: '/workflows' },
    { path: '/restaurant/orders' },
  ];
  const frontEps = [
    { path: '/health' }, { path: '/restaurant/orders' },
    { path: '/compliance/quarterly/summary?taxYear=1405&quarter=3' },
  ];
  const users = Array.from({ length: USERS }, (_, i) => (i % 3 === 0 ? { token: front, eps: frontEps } : { token: admin, eps: adminEps }));
  const lat = [];
  let ok = 0, err = 0, started = 0;
  const startedAt = Date.now();

  let server5xx = 0;
  async function worker(user, idx) {
    while (Date.now() - startedAt < DURATION_MS) {
      const ep = pick(user.eps);
      const headers = { Authorization: 'Bearer ' + user.token };
      const t0 = performance.now();
      try {
        const r = await fetch(BASE + ep.path, { headers });
        await r.arrayBuffer();
        const ms = performance.now() - t0;
        lat.push(ms);
        if (r.status >= 200 && r.status < 400) ok++;
        else if (r.status >= 500) { err++; server5xx++; } else ok++; // 4xxRBAC = خطای بار نیست
      } catch { err++; }
      started++;
      await new Promise((res) => setTimeout(res, Math.random() * 80)); // think-time
    }
  }
  await Promise.all(users.map((u, i) => worker(u, i)));
  lat.sort((a, b) => a - b);
  const q = (p) => Math.round(lat[Math.min(lat.length - 1, Math.floor((p / 100) * lat.length))] ?? 0);
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  const report = {
    users: USERS, durationSec: elapsed,
    requests: started, ok, err,
    errorRatePct: +(100 * err / Math.max(1, started)).toFixed(2),
    server5xx,
    rps: +(started / +elapsed).toFixed(1),
    p50ms: q(50), p90ms: q(90), p95ms: q(95), p99ms: q(99),
    maxMs: Math.round(lat[lat.length - 1] ?? 0),
  };
  console.log(JSON.stringify(report, null, 1));
  await (await import('node:fs/promises')).writeFile('/tmp/load-report.json', JSON.stringify(report, null, 1));
  process.exit(0);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
