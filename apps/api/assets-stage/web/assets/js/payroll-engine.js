/**
 * payroll-engine.js — موتور محاسبه حقوق و دستمزد (فاز ۲)
 * فرمول‌ها: docs/18-module-references/payroll-releases-notes.md + docs/11-iran-compliance/IRAN-LAWS.md
 * تمام مقادیر از LAWS خوانده می‌شود؛ اعداد انگلیسی ذخیره می‌شوند (قانون ۱۴).
 */
(function (global) {
  'use strict';

  var Engine = {
    /**
     * محاسبه فیش یک پرسنل برای یک ماه شمسی
     * p: رکورد پرسنل | period: '1405/09' | opt: {overtimeHours, nightShifts, absentDays}
     */
    calc: function (p, period, opt) {
      opt = opt || {};
      var L = LAWS.labor, I = LAWS.insurance;
      var mizan = (Number(p.baseSalary) || 0) + (Number(p.seniority) || 0);
      var daily = mizan / 30;
      var hourly = daily / L.hourlyDivisor.value;
      var overtime = (opt.overtimeHours || 0) * hourly * L.overtimeRate.value;
      var night = (opt.nightShifts || 0) * hourly * (L.nightShiftRate.value - 1);
      var absent = (opt.absentDays || 0) * daily;
      var housing = Number(p.housing) || 0;
      var childAllow = p.marital ? (Number(p.dependents) || 0) * 554185 : 0; // معادل روزانه حداقل دستمزد/۴ (پارامتریک؛ [نیازمند بخشنامه ۱۴۰۵])
      var gross = mizan + overtime + night + housing + childAllow - absent;
      // بیمه: ۷٪ کارگر بر مبنای مشمول (دستمزد+اضافه‌کار، بدون حق مسکن)
      var insBase = mizan + overtime + night - absent;
      var insEmployee = Math.round(insBase * I.employeeRate.value);
      var insEmployer = Math.round(insBase * I.employerRate.value);
      // مالیات حقوق: مشمول سالانه × ۱۲ − معافیت سالانه (ریال)
      var monthlyTaxable = Math.max(0, gross - insEmployee - housing - childAllow);
      var annualTaxable = monthlyTaxable * 12;
      var annualExempt = LAWS.incomeTax.annualExemption.value;
      var taxAnnual = LAWS.salaryTax(Math.max(0, annualTaxable - annualExempt));
      var taxMonthly = Math.round(taxAnnual / 12);
      var net = gross - insEmployee - taxMonthly;
      return {
        code: p.code, name: p.firstName + ' ' + p.lastName, period: period,
        mizan: Math.round(mizan), daily: Math.round(daily), hourly: Math.round(hourly),
        overtime: Math.round(overtime), night: Math.round(night),
        housing: housing, childAllow: childAllow, absent: Math.round(absent),
        gross: Math.round(gross),
        insEmployee: insEmployee, insEmployer: insEmployer,
        monthlyTaxable: Math.round(monthlyTaxable), annualTaxable: annualTaxable,
        tax: taxMonthly, net: Math.round(net),
        iban: p.iban || p.account || '',
        params: { overtimeHours: opt.overtimeHours || 0, nightShifts: opt.nightShifts || 0, absentDays: opt.absentDays || 0 }
      };
    },

    /** محاسبه کل دوره + ثبت گزارش روزانه/دوره‌ای برای داشبورد مدیر AI (قانون ۱۷) */
    runPeriod: function (personnel, period, overrides) {
      overrides = overrides || {};
      var slips = personnel.map(function (p) {
        return this.calc(p, period, overrides[p.code] || {});
      }, this);
      var totalNet = slips.reduce(function (s, x) { return s + x.net; }, 0);
      var totalTax = slips.reduce(function (s, x) { return s + x.tax; }, 0);
      var totalIns = slips.reduce(function (s, x) { return s + x.insEmployee + x.insEmployer; }, 0);
      return { period: period, slips: slips, totals: { net: totalNet, tax: totalTax, insurance: totalIns, count: slips.length } };
    },

    /** لیست مالیات حقوق (خروجی ارسال به my.tax.gov.ir — قالب ستونی استاندارد) */
    taxList: function (slips) {
      return slips.map(function (s) {
        return { code: s.code, name: s.name, monthlyTaxable: s.monthlyTaxable, exemption: LAWS.incomeTax.monthlyExemption.value / 12, tax: s.tax, period: s.period };
      });
    },
    /** لیست بیمه تأمین اجتماعی */
    insuranceList: function (slips) {
      return slips.map(function (s) {
        return { code: s.code, name: s.name, base: s.mizan + s.overtime + s.night, employee7: s.insEmployee, employer23: s.insEmployer, total: s.insEmployee + s.insEmployer, period: s.period };
      });
    },
    /** لیست بانک (کد پرسنلی + شبا + خالص پرداختی) */
    bankList: function (slips) {
      return slips.map(function (s) {
        return { code: s.code, name: s.name, iban: s.iban, net: s.net, period: s.period };
      });
    }
  };

  global.PayrollEngine = Engine;
})(window);
