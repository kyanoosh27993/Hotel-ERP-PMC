/**
 * store.js — حافظه داده برنامه (localStorage/IndexedDB ساده) — کارکرد آفلاین
 * اعداد همیشه انگلیسی ذخیره می‌شوند (قانون ۱۴). نسخه‌بندی schema با migration ساده (قاعده ۶ بخش دوم).
 */
(function (global) {
  'use strict';
  var KEY = 'hotel-erp-data';
  var SCHEMA_VERSION = 1;

  var seed = {
    _version: SCHEMA_VERSION,
    personnel: [
      { code: '101', firstName: 'علی', lastName: 'محمدی', nationalId: '1234567890', marital: true, dependents: 2, jobTitle: 'پذیرش شب', jobCode: '3311', account: 'IR120570028180010280979101', iban: 'IR120570028180010280979101', hire: '1402/03/15', baseSalary: 220000000, housing: 30000000, seniority: 16666600, contract: '1405/01/01', contractEnd: '1405/12/29', education: 'لیسانس' },
      { code: '102', firstName: 'زهرا', lastName: 'کریمی', nationalId: '2345678901', marital: true, dependents: 1, jobTitle: 'حسابدار', jobCode: '2411', account: 'IR350620000000211111111102', iban: 'IR350620000000211111111102', hire: '1401/07/01', baseSalary: 260000000, housing: 30000000, seniority: 16666600, contract: '1405/01/01', contractEnd: '1405/12/29', education: 'لیسانس حسابداری' },
      { code: '103', firstName: 'حسین', lastName: 'رحیمی', nationalId: '3456789012', marital: false, dependents: 0, jobTitle: 'گارسون', jobCode: '5131', account: 'IR560540000000322222222103', iban: 'IR560540000000322222222103', hire: '1403/02/10', baseSalary: 190000000, housing: 30000000, seniority: 16666600, contract: '1405/01/01', contractEnd: '1405/12/29', education: 'دیپلم' },
      { code: '104', firstName: 'فاطمه', lastName: 'نوری', nationalId: '4567890123', marital: true, dependents: 3, jobTitle: 'خانه‌دار ارشد', jobCode: '5142', account: 'IR780560000000433333333104', iban: 'IR780560000000433333333104', hire: '1400/11/20', baseSalary: 200000000, housing: 30000000, seniority: 16666600, contract: '1405/01/01', contractEnd: '1405/12/29', education: 'دیپلم' }
    ],
    decrees: [],   // احکام پرسنلی
    payrollRuns: {}, // دوره '1405/09' → نتیجه محاسبه
    dailyReports: [], // گزارش روزانه بخش‌ها برای داشبورد مدیر AI
    settings: { hotelName: 'هتل نمونه — آزمایشی', fiscalYear: 1405 }
  };

  var db;
  try { db = JSON.parse(localStorage.getItem(KEY) || 'null') || null; } catch (e) { db = null; }
  if (!db) { db = seed; persist(); }
  // Migration ساده نسخه‌دار
  if (db._version < SCHEMA_VERSION) { db._version = SCHEMA_VERSION; persist(); }

  function persist() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { console.warn('ذخیره ناموفق', e); } }

  global.Store = {
    get: function (k) { return db[k]; },
    set: function (k, v) { db[k] = v; persist(); },
    push: function (k, item) { db[k].push(item); persist(); },
    remove: function (k, pred) { db[k] = db[k].filter(function (x) { return !pred(x); }); persist(); },
    all: function () { return db; },
    persist: persist,
    /** بک‌آپ JSON کامل (الگوی بک‌آپ payroll-releases) */
    backup: function () {
      return { exportedAt: Jalali.fromDate(new Date()), data: db };
    },
    restore: function (obj) {
      if (obj && obj.data && obj.data._version) { db = obj.data; persist(); return true; }
      return false;
    }
  };
})(window);
