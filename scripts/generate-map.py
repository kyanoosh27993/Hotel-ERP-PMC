#!/usr/bin/env python3
"""
generate-map.py — نقشه ساختاری برنامه (الگوی Graphify — قوانین ۴ و ۵ مالک)
خروجی: graphify-out/map.md (نقشه انسانی) + graphify-out/graph.json (نقشه ماشینی)
مسیر مستقیم به هر فایل → بدون بازبینی کل برنامه.
"""
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'graphify-out'

DESC = {
    'apps/web/index.html': 'شل HTML و ترتیب بارگذاری اسکریپت‌ها',
    'apps/web/assets/css/main.css': 'استایل RTL، سه تم، ریسپانسیو موبایل',
    'apps/web/assets/js/jalali.js': 'موتور تقویم شمسی + ویجت انتخاب تاریخ (قانون ۲)',
    'apps/web/assets/js/num.js': 'اعداد دوزبانه، پول ریال/تومان، shrink-to-fit (قوانین ۱۳،۱۴)',
    'apps/web/assets/js/laws-params.js': 'پارامترهای قانونی ۱۴۰۵ منبع‌دار (قانون ۱۶)',
    'apps/web/assets/js/themes.js': '۳ تم + فونت جدا متن/عدد (قانون ۱۱)',
    'apps/web/assets/js/data-table.js': 'جدول استاندارد: جستجو/سورت/فیلتر/سطر جمع (قانون ۱۲)',
    'apps/web/assets/js/store.js': 'حافظه داده localStorage + بک‌آپ/بازیابی',
    'apps/web/assets/js/payroll-engine.js': 'موتور محاسبه حقوق + لیست‌های مالیات/بیمه/بانک (فاز ۲)',
    'apps/web/assets/js/modules/payroll.js': 'UI حقوق: پرسنل/قرارداد/احکام/محاسبه/لیست‌ها',
    'apps/web/assets/js/modules/dashboard.js': 'داشبورد مدیر AI: گزارش روزانه + تحلیل (قانون ۱۷)',
    'apps/web/assets/js/modules/settings.js': 'تنظیمات تم/فونت/پارامتر قانونی/بک‌آپ',
    'apps/web/assets/js/app.js': 'شل برنامه: سایدبار، نوار بالا، ساعت شمسی، روتر',
    'AI_DEVELOPMENT_RULES.md': 'قوانین ۲۰گانه مالک + روش فازبندی ۷ ماده‌ای + چک‌لیست انطباق',
    'AI_DEVELOPMENT_MASTER_RULES.md': 'قرارداد توسعه با هوش مصنوعی (۱۰ بخش — الزامی برای هر AI)',
    'PHASES.md': 'فازبندی و وضعیت فازها (قانون ۱۸)',
    'PROGRESS-STATE.md': 'حافظه پایدار بین نشست‌ها',
    'docs/11-iran-compliance/IRAN-LAWS.md': 'کتابخانه قوانین ایران با نقشه دسترسی سریع',
}


def scan():
    entries = []
    for path in sorted(ROOT.rglob('*')):
        rel = str(path.relative_to(ROOT))
        if path.is_dir() or rel.startswith('.git') or 'node_modules' in rel:
            continue
        rel_posix = rel.replace(os.sep, '/')
        lines = path.read_text(encoding='utf-8', errors='ignore').splitlines()
        info = {
            'path': rel_posix,
            'lines': len(lines),
            'bytes': path.stat().st_size,
            'desc': DESC.get(rel_posix, ''),
        }
        if path.suffix == '.js':
            fns = re.findall(r'^(?:\s*)(?:function\s+(\w[\w$]*)|(\w[\w$]*)\s*:\s*function|\s*global\.\w+\s*=\s*\{)', '\n'.join(lines[:0]) or '')  # noqa
            names = []
            for m in re.finditer(r'function\s+([A-Za-z_$][\w$]*)\s*\(', '\n'.join(lines)):
                names.append(m.group(1))
            info['functions'] = names[:40]
        entries.append(info)
    return entries


def main():
    OUT.mkdir(exist_ok=True)
    entries = scan()
    # graph.json
    (OUT / 'graph.json').write_text(
        json.dumps({'generated': True, 'root': str(ROOT), 'files': entries}, ensure_ascii=False, indent=1),
        encoding='utf-8')
    # map.md
    md = ['# نقشه ساختاری برنامه (Graphify) — به‌روزرسانی خودکار', '',
          '> برای یافتن سریع هر بخش، این نقشه را ببینید؛ کل برنامه را بازبینی نکنید (قانون ۴).', '',
          '| مسیر | خطوط | توضیح |', '| --- | --- | --- |']
    for e in entries:
        md.append('| `{}` | {} | {} |'.format(e['path'], e['lines'], e['desc'] or '-'))
    (OUT / 'map.md').write_text('\n'.join(md), encoding='utf-8')
    print('OK — graphify-out/map.md ({} فایل) و graph.json ساخته شد'.format(len(entries)))


if __name__ == '__main__':
    main()
