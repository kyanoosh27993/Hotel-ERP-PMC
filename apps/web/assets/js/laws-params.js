/**
 * laws-params.js — پارامترهای قانونی نسخه‌دار (قانون ۱۶ مالک)
 * مرجع متن: docs/11-iran-compliance/IRAN-LAWS.md
 * قاعده: هیچ عددی حدس زده نمی‌شود؛ verified=false یعنی [نیازمند تأیید بخشنامه رسمی].
 */
window.LAWS = {
  year: 1405,
  labor: {
    minimumDailyWage: { value: 5541850, unit: 'rial', verified: true, year: 1405,
      source: 'مصوب هیئت وزیران ابلاغی ۲۴ اسفند ۱۴۰۴ — iranestekhdam.ir / bimeh.com', url: 'https://iranestekhdam.ir/جدول-حقوق' },
    minimumMonthlyWage: { value: 166255500, unit: 'rial', verified: true, year: 1405,
      source: 'همان منبع (روزانه×۳۰) + bimeh.com', url: 'https://bimeh.com/mag/work-laws' },
    housingAllowance: { value: 30000000, unit: 'rial', verified: true, year: 1405,
      source: 'iranestekhdam.ir', url: 'https://iranestekhdam.ir/جدول-حقوق' },
    hourlyDivisor: { value: 7.33, verified: true, note: 'ماده ۵۸/۵۹ قانون کار' },
    overtimeRate: { value: 1.40, verified: true, note: 'ماده ۵۹' },
    nightShiftRate: { value: 1.75, verified: true, note: 'شب‌کاری غیرموظفی ۱۰۰+۷۵٪' },
    fridayNoRestRate: { value: 1.80, verified: true, note: 'ماده ۶۲ بدون تعطیلی جایگزین' },
    fridayWithRestRate: { value: 1.40, verified: true, note: 'ماده ۶۲ با تعطیلی جایگزین' },
    housingVerifiedNote: 'سایر مزایا (بن/عائله‌مندی) نیازمند بخشنامه رسمی ۱۴۰۵'
  },
  insurance: {
    totalRate: { value: 0.30, verified: true, note: 'مجموع حق بیمه' },
    employerRate: { value: 0.23, verified: true, note: '۲۰٪ حق بیمه + ۳٪ بیمه بیکاری' },
    employeeRate: { value: 0.07, verified: true, note: 'سهم کارگر' },
    ceiling: { value: null, verified: false, note: '[نیازمند تأیید بخشنامه رسمی ۱۴۰۵]' }
  },
  incomeTax: {
    monthlyExemption: { value: 400000000, unit: 'rial', verified: true, year: 1405,
      source: 'بخشنامه سازمان امور مالیاتی — rade.ir / chargoon.com', url: 'https://www.rade.ir/20008' },
    annualExemption: { value: 4800000000, unit: 'rial', verified: true, year: 1405 },
    brackets: { verified: false, note: 'نرخ پلکانی ۱۰٪ تا ۳۰٪ تأیید شد؛ مرز دقیق پله‌ها [نیازمند بخشنامه رسمی ۱۴۰۵] — تا آن زمان پله‌های زیر پارامتریک قابل ویرایش‌اند',
      // پله‌های پیش‌فرض پارامتریک (ریال/سال) — پله اول = معافیت قانونی سال ۱۴۰۵؛ مرزهای بعدی [نیازمند بخشنامه رسمی] و قابل ویرایش
      rows: [
        { from: 0, to: 4800000000, rate: 0.00 },
        { from: 4800000000, to: 24000000000, rate: 0.10 },
        { from: 24000000000, to: 36000000000, rate: 0.15 },
        { from: 36000000000, to: 48000000000, rate: 0.20 },
        { from: 48000000000, to: 60000000000, rate: 0.25 },
        { from: 60000000000, to: null, rate: 0.30 }
      ] }
  },
  vat: {
    generalRate: { value: 0.10, verified: true, year: 1405,
      source: 'chargoon.com / sepidarsystem.com', url: 'https://chargoon.com/blog/what-is-value-added-tax' }
  },
  /** محاسبه مالیات حقوق بر اساس پله‌ها (ریال/سال) */
  salaryTax: function (annualTaxableRial, brackets) {
    var rows = brackets || this.incomeTax.brackets.rows;
    var tax = 0;
    for (var i = 0; i < rows.length; i++) {
      var from = rows[i].from, to = rows[i].to;
      if (annualTaxableRial <= from) break;
      var top = (to == null || annualTaxableRial < to) ? annualTaxableRial : to;
      tax += (top - from) * rows[i].rate;
    }
    return Math.round(tax);
  }
};
