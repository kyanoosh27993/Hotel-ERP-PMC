// app/page.tsx — صفحه وضعیت هسته فاز ۱: اتصال به /health و شکل استاندارد خطا
'use client';

import { useEffect, useState } from 'react';

interface HealthState {
  status: string;
  db: string;
  version: string;
}

export default function HomePage() {
  const [health, setHealth] = useState<HealthState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setHealth)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, Tahoma, sans-serif', padding: '2rem', maxWidth: 720, margin: '0 auto' }}>
      <h1>Hotel ERP — Phase 1 Core</h1>
      <p>Bilingual shell (EN default / FA RTL). This page verifies the core API is reachable.</p>
      {error && (
        <div role="alert" style={{ background: '#FEF2F2', border: '1px solid #EF4444', padding: '1rem', borderRadius: 8 }}>
          <strong>API error:</strong> {error} — standard error shape: {'{ error: { code, message, requestId } }'}
        </div>
      )}
      {health && (
        <div style={{ background: '#F0FDF4', border: '1px solid #10B981', padding: '1rem', borderRadius: 8 }}>
          <strong>API health:</strong> {health.status} · db: {health.db} · v{health.version}
        </div>
      )}
      <ul style={{ lineHeight: 1.9 }}>
        <li>Auth: Argon2id + rotating refresh + TOTP MFA for sensitive roles</li>
        <li>RBAC: server-side permission matrix (accountant/approver separation)</li>
        <li>Transactional Outbox + idempotent consumers (event → auto journal)</li>
        <li>PoC: concurrent reservation guard + POS sale → double-entry posting</li>
        <li>Observability: OpenTelemetry + Grafana + Sentry (config-driven)</li>
      </ul>
      <p style={{ color: '#6B7280', fontSize: '0.9rem' }}>
        Swagger: <code>/docs</code> on the API port · OpenAPI versioned at <code>/api/v1</code>
      </p>
    </main>
  );
}
