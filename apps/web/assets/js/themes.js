/**
 * themes.js — ۳ تم پایه + شخصی‌سازی کامل ظاهر (قانون ۱۱ مالک)
 * فونت متن و فونت اعداد مستقل انتخاب می‌شوند (فونت‌های نصب‌شده سیستم/ویندوز).
 * ذخیره در localStorage؛ CSS متغیرها در main.css تعریف شده‌اند.
 */
(function (global) {
  'use strict';

  var THEMES = {
    light: {
      name: 'روشن (پیش‌فرض)',
      vars: { '--bg': '#f5f6f8', '--bg-panel': '#ffffff', '--bg-header': '#ffffff', '--text': '#1c2536', '--muted': '#67718a', '--primary': '#0e7c66', '--primary-2': '#0a5c4c', '--accent': '#c99a2e', '--border': '#dde1e8', '--danger': '#c0392b', '--success': '#1e8e3e', '--hover': 'rgba(14,124,102,.08)', '--shadow': '0 1px 4px rgba(20,30,50,.08)' }
    },
    dark: {
      name: 'شبانه (تیره)',
      vars: { '--bg': '#10151f', '--bg-panel': '#1a2130', '--bg-header': '#151b28', '--text': '#e8ecf3', '--muted': '#94a0b8', '--primary': '#2fbf9f', '--primary-2': '#1f9d82', '--accent': '#e0b34c', '--border': '#2a3347', '--danger': '#e74c3c', '--success': '#3fbf6f', '--hover': 'rgba(47,191,159,.12)', '--shadow': '0 1px 6px rgba(0,0,0,.45)' }
    },
    royal: {
      name: 'سازمانی (آبی سلطنتی)',
      vars: { '--bg': '#eef2f9', '--bg-panel': '#ffffff', '--bg-header': '#1f3a6e', '--text': '#17233d', '--muted': '#5d6b88', '--primary': '#1f3a6e', '--primary-2': '#16294f', '--accent': '#c9a13b', '--border': '#d5dcea', '--danger': '#b03030', '--success': '#217a4b', '--hover': 'rgba(31,58,110,.09)', '--shadow': '0 2px 6px rgba(23,35,61,.14)', '--header-text': '#ffffff' }
    }
  };

  var DEFAULTS = {
    theme: 'light',
    fontText: 'Vazirmatn, Estedad, Tahoma, Segoe UI, sans-serif',
    fontNumber: 'Vazirmatn, Consolas, Segoe UI, sans-serif',
    fontSize: 14,
    radius: 10,
    displayMoney: 'rial', // rial | toman
    lang: 'fa'
  };

  var state = Object.assign({}, DEFAULTS);
  try { Object.assign(state, JSON.parse(localStorage.getItem('hotel-erp-ui') || '{}')); } catch (e) { /* حافظه سالم نشد — پیش‌فرض */ }

  function save() { localStorage.setItem('hotel-erp-ui', JSON.stringify(state)); }

  function apply() {
    var t = THEMES[state.theme] || THEMES.light;
    var root = document.documentElement;
    Object.keys(t.vars).forEach(function (k) { root.style.setProperty(k, t.vars[k]); });
    root.style.setProperty('--font-text', state.fontText);
    root.style.setProperty('--font-number', state.fontNumber);
    root.style.setProperty('--font-size', state.fontSize + 'px');
    root.style.setProperty('--radius', state.radius + 'px');
    root.setAttribute('data-theme', state.theme);
    root.setAttribute('dir', 'rtl');
    root.setAttribute('lang', state.lang);
    save();
  }

  /** فونت‌های نصب‌شده ویندوز/سیستم + فونت‌های وب برنامه */
  var BUILTIN_FONTS = [
    { id: 'Vazirmatn, Estedad, Tahoma, Segoe UI, sans-serif', name: 'وزیرمتن / استعداد (وب برنامه)' },
    { id: 'Tahoma, Segoe UI, sans-serif', name: 'Tahoma (ویندوز)' },
    { id: '"Segoe UI", Tahoma, sans-serif', name: 'Segoe UI (ویندوز)' },
    { id: 'IRANSans, "B Nazanin", Nazanin, Tahoma, serif', name: 'ایران‌سنس / نازنین (نصب‌شده)' },
    { id: 'Consolas, monospace', name: 'Consolas (اعداد ویندوز)' },
    { id: 'Cambria, Georgia, serif', name: 'Cambria (ویندوز)' },
    { id: 'Arial, Helvetica, sans-serif', name: 'Arial' },
    { id: 'LXGW WenKai, sans-serif', name: 'LXGW (سیستم سندباکس)' }
  ];

  global.Themes = {
    list: function () { return Object.keys(THEMES).map(function (k) { return { id: k, name: THEMES[k].name }; }); },
    fonts: BUILTIN_FONTS,
    state: state,
    apply: apply,
    set: function (patch) { Object.assign(state, patch); apply(); },
    reset: function () { Object.assign(state, DEFAULTS); apply(); },
    /** نمایش عدد بر اساس تنظیم (قانون ۱۴) */
    displayLang: function () { return state.lang === 'fa' ? 'fa' : 'en'; },
    moneyMode: function () { return state.displayMoney; }
  };

  document.addEventListener('DOMContentLoaded', apply);
})(window);
