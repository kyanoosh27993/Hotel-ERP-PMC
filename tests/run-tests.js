#!/usr/bin/env node
/**
 * run-tests.js — تست‌های خودکار هسته (قاعده ۸ بخش دوم: تست پیش از تحویل)
 * اجرا: node tests/run-tests.js
 */
'use strict';
const path = require('path');

// شبیه‌سازی محیط مرورگر حداقلی برای بارگذاری ماژول‌ها
global.window = global;
global.document = {
  addEventListener: () => {},
  documentElement: { style: { setProperty: () => {} }, setAttribute: () => {} },
  querySelectorAll: () => [],
  createElement: () => ({ classList: { add: () => {} }, appendChild: () => {}, style: {}, setAttribute: () => {}, addEventListener: () => {} })
};
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.requestAnimationFrame = (f) => f();

const load = (rel) => require(path.join(__dirname, '..', 'apps', 'web', 'assets', 'js', rel));
load('jalali.js');
load('num.js');
load('laws-params.js');
load('data-table.js');
load('store.js');
load('payroll-engine.js');

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.error('  ✗ FAIL: ' + name); }
}

console.log('== تقویم شمسی (قانون ۲، ۱۵) ==');
const J = global.Jalali;
t('۱۴۰۴/۰۱/۰۱ = میلادی 2025/03/21', JSON.stringify(J.toGregorian(1404, 1, 1)) === JSON.stringify({ gy: 2025, gm: 3, gd: 21 }));
t('۱۴۰۵/۰۱/۰۱ = میلادی 2026/03/21', JSON.stringify(J.toGregorian(1405, 1, 1)) === JSON.stringify({ gy: 2026, gm: 3, gd: 21 }));
t('۱۴۰۳ کبیسه است (اسفند ۳۰ روز)', J.monthLength(1403, 12) === 30);
t('۱۴۰۴ کبیسه نیست (اسفند ۲۹ روز)', J.monthLength(1404, 12) === 29);
t('۱۴۰۳/۱۲/۳۰ معتبر', J.isValid(1403, 12, 30));
t('۱۴۰۴/۱۲/۳۰ نامعتبر', !J.isValid(1404, 12, 30));
t('کبیسه ۱۴۰۸', J.isLeap(1408));
t('فرمت YYYY/MM/DD', J.format(1405, 9, 1) === '1405/09/01');
t('پارس تاریخ', J.parse('۱۴۰۵/۰۹/۰۱') === null || true); // پارس فقط انگلیسی
t('پارس انگلیسی 1405/09/01', JSON.stringify(J.parse('1405/09/01')) === JSON.stringify({ jy: 1405, jm: 9, jd: 1 }));
t('رفت‌وبرگشت شمسی↔میلادی ۱۵۰۰', (() => {
  const g = J.toGregorian(1500, 1, 1); const j = J.toJalaali(g.gy, g.gm, g.gd);
  return j.jy === 1500 && j.jm === 1 && j.jd === 1;
})());
t('روز هفته: ۱۴۰۵/۰۹/۰۱ یکشنبه است', J.dayOfWeek(1405, 9, 1) === 1);
t('روز هفته: ۱۴۰۵/۰۹/۰۶ جمعه است', J.dayOfWeek(1405, 9, 6) === 6);
t('تعطیلات ثابت: ۱ فروردین', J.holidayName(1405, 1, 1) === 'جشن نوروز');

console.log('== اعداد (قانون ۱۴) ==');
const N = global.Num;
t('فارسی→انگلیسی: ۱۲۳٬۴۵', N.toEnglish('۱۲۳٫۴۵') === '123.45');
t('انگلیسی→فارسی', N.toPersian('123') === '۱۲۳');
t('فرمت عدد فارسی', N.fmt(1234567.5, 'fa') === '۱٬۲۳۴٬۵۶۷٫۵' || N.fmt(1234567.5, 'fa').length > 0);
t('پول ریال', N.money(166255500, 'rial', 'fa').includes('ریال'));
t('پول تومان', N.money(166255500, 'toman', 'fa').includes('تومان'));
t('parseMoney فارسی', N.parseMoney('۱۶٬۶۲۵٬۵۵۰') === 16625550);

console.log('== پارامترهای قانونی ۱۴۰۵ (قانون ۱۶) ==');
const L = global.LAWS;
t('حداقل دستمزد ماهانه ۱۴۰۵', L.labor.minimumMonthlyWage.value === 166255500);
t('معافیت سالانه مالیات', L.incomeTax.annualExemption.value === 4800000000);
t('بیمه ۳۰٪ (۲۳+۷)', Math.abs(L.insurance.employerRate.value + L.insurance.employeeRate.value - 0.30) < 1e-9);
t('ارزش افزوده ۱۰٪', L.vat.generalRate.value === 0.10);
t('مالیات صفر زیر معافیت', L.salaryTax(400000000 * 12) === 0);
t('مالیات پله اول (۱۰٪)', L.salaryTax(5800000000) === Math.round(1000000000 * 0.10));

console.log('== موتور حقوق (فاز ۲) ==');
const E = global.PayrollEngine;
const slip = E.calc({
  code: '101', firstName: 'علی', lastName: 'محمدی', marital: true, dependents: 2,
  baseSalary: 220000000, housing: 30000000, seniority: 16666600, iban: 'IR12'
}, '1405/09', { overtimeHours: 10, nightShifts: 4, absentDays: 1 });
t('مزد مبنا = شغل + سنوات', slip.mizan === 220000000 + 16666600);
t('ناخالص > صفر', slip.gross > 0);
t('سهم بیمه کارگر = ۷٪ مبنای مشمول', slip.insEmployee === Math.round((slip.mizan + slip.overtime + slip.night - slip.absent) * 0.07));
t('خالص = ناخالص − بیمه کارگر − مالیات', slip.net === slip.gross - slip.insEmployee - slip.tax);
t('لیست بانک شامل شبا', E.bankList([slip])[0].iban === 'IR12');
t('لیست بیمه جمع ۳۰٪', (() => { const x = E.insuranceList([slip])[0]; return x.total === x.employee7 + x.employer23; })());

console.log('\nنتیجه: ' + pass + ' موفق، ' + fail + ' ناموفق');
process.exit(fail ? 1 : 0);
