#!/usr/bin/env python3
"""sso-strip-modules.py — نسخهٔ ۳٫۳ (SSO شل وب)
فرم‌های «اتصال به سرور» (ورود جداگانه) از ماژول‌های شل وب حذف و با نوار نشست مشترک
`App.sessionPanel()` جایگزین می‌شود — ورود فقط یک‌بار در صفحهٔ ورود شل.
دو شکل کد موجود: بلاک inline (var conn = ...) و تابع connPanel(root, rerender).
"""
import re
import pathlib
import sys

DRY = '--apply' not in sys.argv
ROOT = pathlib.Path('/home/z/my-project/repo/apps/web/assets/js/modules')

REPL_INLINE = "      root.appendChild(App.sessionPanel());\n"
REPL_FUNC = """  function connPanel(root, rerender) {
    root.appendChild(App.sessionPanel());
  }
"""

def strip_inline(src: str, fname: str):
    """از 'var conn = el('div', 'panel');' تا نخستین 'root.appendChild(conn);' بعدی."""
    start = re.search(r"^(\s*)var conn = el\('div', 'panel'\);", src, re.M)
    if not start:
        return None
    end = src.find("root.appendChild(conn);", start.start())
    if end < 0:
        raise RuntimeError(f"{fname}: end marker not found")
    end += len("root.appendChild(conn);")
    return (start.start(), end)

def strip_connpanel(src: str, fname: str):
    """بدنهٔ تابع connPanel (از اعلام تابع تا 'root.appendChild(panel);' داخلش)."""
    start = re.search(r"^  function connPanel\(root, rerender\) \{", src, re.M)
    if not start:
        return None
    end = src.find("root.appendChild(panel);", start.start())
    if end < 0:
        raise RuntimeError(f"{fname}: connPanel end not found")
    end += len("root.appendChild(panel);")
    # بستن آکولاد تابع در خط بعد حفظ می‌شود
    return (start.start(), end)

INLINE_FILES = ['frontdesk.js', 'treasury.js', 'restaurant.js', 'procurement.js', 'stores.js',
                'housekeepingops.js', 'assets.js', 'ancillary.js', 'settings.js']
FUNC_FILES = ['bi.js', 'directtax.js', 'quarterly.js']

for fname in INLINE_FILES:
    p = ROOT / fname
    src = p.read_text()
    span = strip_inline(src, fname)
    if span is None:
        print(f"[INLINE-MISS] {fname} — الگوی var conn یافت نشد؛ دستی بررسی شود")
        continue
    s, e = span
    if DRY:
        print(f"[INLINE] {fname}: lines {src[:s].count(chr(10))+1}..{src[:e].count(chr(10))+1}")
        print('  first: ' + src[s:s+70].split('\n')[0])
        print('  last : ' + src[max(s, e-90):e].split('\n')[-1])
    else:
        p.write_text(src[:s] + REPL_INLINE.rstrip('\n') + src[e:])
        print(f"[APPLIED] {fname}")

for fname in FUNC_FILES:
    p = ROOT / fname
    src = p.read_text()
    span = strip_connpanel(src, fname)
    if span is None:
        print(f"[FUNC-MISS] {fname}")
        continue
    s, e = span
    if DRY:
        print(f"[FUNC] {fname}: lines {src[:s].count(chr(10))+1}..{src[:e].count(chr(10))+1}")
    else:
        p.write_text(src[:s] + REPL_FUNC.rstrip('\n') + src[e:])
        print(f"[APPLIED] {fname}")

print('DRY-RUN' if DRY else 'APPLIED')
