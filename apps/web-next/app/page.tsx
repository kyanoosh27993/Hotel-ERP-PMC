// app/page.tsx — شل وضعیت برنامه: سلام‌رسانی زنده + درگاه ماژول‌ها و داشبوردها
'use client';

import { useEffect, useState } from 'react';

interface HealthState {
  status: string;
  db: string;
  version: string;
}

const DASHBOARDS: Array<{ key: string; fa: string; en: string }> = [
  { key: 'ceo', fa: 'مدیرعامل', en: 'CEO' },
  { key: 'finance', fa: 'مالی', en: 'Finance' },
  { key: 'restaurant', fa: 'رستوران', en: 'Restaurant' },
  { key: 'housekeeping', fa: 'خانه‌داری', en: 'Housekeeping' },
];

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
    <main dir="rtl" style={{ fontFamily: 'Tahoma, system-ui, sans-serif', padding: 'clamp(1rem, 4vw, 2rem)', maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 4 }}>Hotel ERP</h1>
      <p style={{ color: '#6B7280', marginTop: 0 }}>درب هتل — کنسول وضعیت هسته و درگاه ماژول‌ها (فارسی/انگلیسی)</p>

      {error && (
        <div role="alert" style={{ background: '#FEF2F2', border: '1px solid #EF4444', padding: '1rem', borderRadius: 8 }}>
          <strong>خطای API:</strong> {error} — شکل استاندارد: {'{ error: { code, message, requestId } }'}
        </div>
      )}
      {health && (
        <div style={{ background: '#F0FDF4', border: '1px solid #10B981', padding: '1rem', borderRadius: 8, marginBottom: '1rem' }}>
          <strong>وضعیت API:</strong> {health.status} · پایگاه‌داده: {health.db} · نسخه v{health.version}
        </div>
      )}

      <h2 style={{ fontSize: '1.1rem' }}>داشبوردهای نقش‌محور (نیازمند ورود)</h2>
      <ul style={{ lineHeight: 2 }}>
        {DASHBOARDS.map((d) => (
          <li key={d.key}>
            <a href={`/api/dashboards/${d.key}`} style={{ color: '#0F766E' }}>
              داشبورد {d.fa} — <code>/api/dashboards/{d.key}</code>
            </a>
          </li>
        ))}
      </ul>

      <h2 style={{ fontSize: '1.1rem' }}>قابلیت‌های فعال (تا موج ۳)</h2>
      <ul style={{ lineHeight: 1.9, color: '#374151' }}>
        <li>احراز هویت Argon2id + MFA نقش‌های حساس · ماتریس مجوز سمت سرور</li>
        <li>PMS: رزرو/اقامت/شب‌گردی/چک‌اوت با فولیو و سند خودکار</li>
        <li>رستوران/POS، خدمات جانبی، خانه‌داری، دارایی، خزانه، انبار و خرید</li>
        <li>حسابداری مالی: سند ۱۴فیلدی، دفاتر، تراز آزمایشی، بستن دوره</li>
        <li>انطباق ایران: کتابخانهٔ قوانین پارامتریک + اظهارنامهٔ ارزش افزوده</li>
      </ul>

      <p style={{ color: '#6B7280', fontSize: '0.9rem' }}>
        مستندات: <code>/api/docs</code> روی پورت API · OpenAPI نسخه‌دار در <code>/api/v1</code>
      </p>
    </main>
  );
}
