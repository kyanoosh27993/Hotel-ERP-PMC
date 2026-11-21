/**
 * num.js — اعداد دوزبانه (قانون ۱۴ مالک) و واحد پول ایرانی (قانون ۱)
 * قاعده: ورود با ارقام فارسی یا انگلیسی → ذخیره همیشه انگلیسی → نمایش همیشه فارسی
 * (مگر زبان برنامه فارسی نباشد). واحد پایه مالی: ریال؛ نمایش تومان اختیاری در UI.
 */
(function (global) {
  'use strict';
  var FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

  var Num = {
    /** تبدیل ارقام فارسی/عربی به انگلیسی (برای ذخیره‌سازی) — ٫ اعشار؛ ٬/، جداکننده هزارگان حذف می‌شود؛ اسلش تاریخ حفظ می‌شود */
    toEnglish: function (s) {
      return String(s == null ? '' : s)
        .replace(/[۰-۹]/g, function (d) { return String(FA_DIGITS.indexOf(d)); })
        .replace(/[٠-٩]/g, function (d) { return String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)); })
        .replace(/[٬،\s]/g, '')
        .replace(/٫/g, '.');
    },
    /** تبدیل ارقام انگلیسی به فارسی (برای نمایش) */
    toPersian: function (s) {
      return String(s == null ? '' : s).replace(/\d/g, function (d) { return FA_DIGITS[+d]; });
    },
    /** عدد با جداکننده هزارگان؛ lang: 'fa' نمایش فارسی، 'en' انگلیسی */
    fmt: function (n, lang) {
      if (n == null || isNaN(Number(n))) return lang === 'en' ? '0' : '۰';
      var s = Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
      if (lang === 'en') return s;
      return this.toPersian(s).replace(/,/g, '٬');
    },
    /** پول: ورود ریال؛ display 'rial'|'toman' — واحد ایرانی (قانون ۱) */
    money: function (rial, display, lang) {
      var v = Number(rial) || 0;
      var val = display === 'toman' ? v / 10 : v;
      return this.fmt(Math.round(val * 100) / 100, lang) + (display === 'toman' ? ' تومان' : ' ریال');
    },
    /** ورودی پول (کاربر فارسی/انگلیسی می‌نویسد) → عدد انگلیسی برای ذخیره */
    parseMoney: function (s) {
      var v = parseFloat(this.toEnglish(s));
      return isNaN(v) ? 0 : v;
    },
    /** ورودی تاریخ/ساعت: همه ارقام فارسی ورودی → انگلیسی (ذخیره) */
    normalizeInput: function (s) { return this.toEnglish(s); },

    /**
     * Shrink-to-fit (قانون ۱۳): کاهش تدریجی اندازه فونت تا محتوا از کادر خارج نشود.
     * به‌صورت batch روی همه .fit پس از هر رندر/فیلتر جدول فراخوانی می‌شود.
     */
    fitAll: function (root) {
      (root || document).querySelectorAll('.fit').forEach(function (elm) {
        elm.style.fontSize = '';
        var base = parseFloat(getComputedStyle(elm).fontSize) || 12;
        var size = base, steps = 0;
        while ((elm.scrollWidth > elm.clientWidth || elm.scrollHeight > elm.clientHeight) && size > 7 && steps < 8) {
          size -= 0.8; elm.style.fontSize = size + 'px'; steps++;
        }
        if (elm.scrollWidth > elm.clientWidth) {
          elm.title = elm.textContent;
        }
      });
    }
  };

  global.Num = Num;
})(window);
