// app/layout.tsx — شل دوزبانه: پیش‌فرض EN (قرارداد بخش ۶)، فارسی RTL با کوکی lang
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Hotel ERP — Core',
  description: 'Hotel ERP/PMS core shell (Phase 1)',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const lang = cookies().get('lang')?.value === 'fa' ? 'fa' : 'en';
  const rtl = lang === 'fa';
  return (
    <html lang={lang} dir={rtl ? 'rtl' : 'ltr'}>
      <body className={rtl ? 'rtl' : 'ltr'}>{children}</body>
    </html>
  );
}
