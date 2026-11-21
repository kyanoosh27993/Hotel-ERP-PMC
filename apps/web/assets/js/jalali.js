/**
 * jalali.js — موتور تقویم هجری شمسی (قانون ۲ و ۱۵ مالک)
 * الگوریتم jalaali (استاندارد کوروش کاوسی) — صحیح در کبیسه تا سال ۳۱۷۷ (پوشش کامل تا ۱۵۰۰+)
 * فرمت نمایش: YYYY/MM/DD — ساعت ۲۴ ساعته
 * تعطیلات رسمی ثابت + رجیستری توسعه‌پذیر (قمری‌ها از تقویم رسمی سالانه تکمیل می‌شوند)
 */
(function (global) {
  'use strict';

  var BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210,
    1637, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

  function div(a, b) { return ~~(a / b); }
  function mod(a, b) { return a - ~~(a / b) * b; }

  function jalCal(jy, withoutLeap) {
    var bl = BREAKS.length, gy = jy + 621, leapJ = -14, jp = BREAKS[0], jm, jump = 0, leap, leapG, march, n, i;
    if (jy < jp || jy >= BREAKS[bl - 1]) throw new Error('سال شمسی خارج از محدوده: ' + jy);
    for (i = 1; i < bl; i += 1) {
      jm = BREAKS[i]; jump = jm - jp;
      if (jy < jm) break;
      leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
      jp = jm;
    }
    n = jy - jp;
    leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
    if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
    leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
    march = 20 + leapJ - leapG;
    if (!withoutLeap) {
      if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
      leap = mod(mod(n + 1, 33) - 1, 4);
      if (leap === -1) leap = 4;
    }
    return { leap: leap, gy: gy, march: march };
  }

  function g2d(gy, gm, gd) {
    var d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4)
      + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
    d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
    return d;
  }

  function d2g(jdn) {
    var j = 4 * jdn + 139361631;
    j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
    var i = div(mod(j, 1461), 4) * 5 + 308;
    var gd = div(mod(i, 153), 5) + 1,
      gm = mod(div(i, 153), 12) + 1,
      gy = div(j, 1461) - 100100 + div(8 - gm, 6);
    return { gy: gy, gm: gm, gd: gd };
  }

  function j2d(jy, jm, jd) {
    var r = jalCal(jy, true);
    return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
  }

  function d2j(jdn) {
    var gy = d2g(jdn).gy, jy = gy - 621, r = jalCal(jy, false),
      jdn1f = g2d(gy, 3, r.march), jd, jm, k;
    k = jdn - jdn1f;
    if (k >= 0) {
      if (k <= 185) { jm = 1 + div(k, 31); jd = mod(k, 31) + 1; return { jy: jy, jm: jm, jd: jd }; }
      k -= 186;
    } else {
      jy -= 1; k += 179;
      if (r.leap === 1) k += 1;
    }
    jm = 7 + div(k, 30); jd = mod(k, 30) + 1;
    return { jy: jy, jm: jm, jd: jd };
  }

  var J = {
    MONTH_NAMES: ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
      'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'],
    DAY_NAMES: ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'],

    toJalaali: function (gy, gm, gd) { return d2j(g2d(gy, gm, gd)); },
    toGregorian: function (jy, jm, jd) { return d2g(j2d(jy, jm, jd)); },
    isLeap: function (jy) { return jalCal(jy, false).leap === 0; },
    monthLength: function (jy, jm) {
      if (jm <= 6) return 31;
      if (jm <= 11) return 30;
      return this.isLeap(jy) ? 30 : 29;
    },
    isValid: function (jy, jm, jd) {
      return jy >= -60 && jy <= 3177 && jm >= 1 && jm <= 12 &&
        jd >= 1 && jd <= this.monthLength(jy, jm);
    },
    /** شیء Date جاوااسکریپت → YYYY/MM/DD شمسی (همیشه این فرمت نمایش — قانون ۱۵) */
    fromDate: function (d) {
      var j = this.toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
      return this.format(j.jy, j.jm, j.jd);
    },
    format: function (jy, jm, jd) {
      var p = function (x, n) { x = String(x); while (x.length < n) x = '0' + x; return x; };
      return p(jy, 4) + '/' + p(jm, 2) + '/' + p(jd, 2);
    },
    /** YYYY/MM/DD شمسی → {jy,jm,jd} */
    parse: function (s) {
      if (!s) return null;
      var m = String(s).trim().match(/^(\d{3,4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
      if (!m) return null;
      var jy = +m[1], jm = +m[2], jd = +m[3];
      if (!this.isValid(jy, jm, jd)) return null;
      return { jy: jy, jm: jm, jd: jd };
    },
    /** روز هفته شمسی: 0=شنبه … 5=پنجشنبه 6=جمعه */
    dayOfWeek: function (jy, jm, jd) {
      var g = this.toGregorian(jy, jm, jd);
      var d = new Date(g.gy, g.gm - 1, g.gd).getDay(); // 0=یکشنبه
      return (d + 1) % 7;
    },
    /** ساعت ۲۴ ساعته HH:MM — قانون ۱۵ */
    formatTime: function (date) {
      var p = function (x) { x = String(x); return x.length < 2 ? '0' + x : x; };
      return p(date.getHours()) + ':' + p(date.getMinutes());
    },

    /**
     * تعطیلات رسمی ثابت کشوری (تقویم رسمی) — برای هر سال شمسی معتبر.
     * منبع: تقویم رسمی سالانه کشور؛ رجیستری قمری به‌صورت پارامتریک هر سال
     * از تقویم رسمی تکمیل می‌شود ( Blocking: [نیازمند تکمیل از تقویم رسمی ۱۴۰۵+]).
     */
    FIXED_HOLIDAYS: {
      '1/1': 'جشن نوروز', '1/2': 'عید نوروز', '1/3': 'عید نوروز', '1/4': 'عید نوروز',
      '1/12': 'روز جمهوری اسلامی', '1/13': 'روز طبیعت',
      '3/14': 'رحلت امام خمینی', '3/15': 'قیام ۱۵ خرداد',
      '11/22': 'پیروزی انقلاب اسلامی', '12/29': 'ملی شدن صنعت نفت'
    },
    /** رجیستری تعطیلات قمری/مناسبت‌ها بر پایه سال شمسی — قابل تکمیل از تقویم رسمی */
    RELIGIOUS_HOLIDAYS: {
      // نمونه: '1405': { '1/9': 'تاسوعا', ... } — تا استخراج از تقویم رسمی خالی می‌ماند
    },
    holidayName: function (jy, jm, jd) {
      var fixed = this.FIXED_HOLIDAYS[jm + '/' + jd];
      if (fixed) return fixed;
      var reg = this.RELIGIOUS_HOLIDAYS[String(jy)];
      if (reg && reg[jm + '/' + jd]) return reg[jm + '/' + jd];
      return null;
    },

    /**
     * ویجت تقویم — ساده‌ترین نحوه انتخاب تاریخ (قانون ۲):
     * کلیک روز / ناوبری ماه و سال / پرش مستقیم به تاریخ / دکمه امروز
     * opts: {value:'YYYY/MM/DD', onSelect(jalaliString, dayOfWeek), weekHolidays:[6], showHolidays:true}
     */
    calendar: function (container, opts) {
      opts = opts || {};
      var weekHolidays = opts.weekHolidays || [6]; // جمعه
      var cur = this.parse(opts.value) || this.parse(this.fromDate(new Date()));
      var self = this;

      function el(tag, cls, txt) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (txt != null) e.textContent = txt;
        return e;
      }

      function render() {
        container.innerHTML = '';
        container.classList.add('jcal');
        // نوار ناوبری
        var nav = el('div', 'jcal-nav');
        var btnPrevY = el('button', 'jcal-btn', '«'), btnPrevM = el('button', 'jcal-btn', '‹');
        var btnNextM = el('button', 'jcal-btn', '›'), btnNextY = el('button', 'jcal-btn', '»');
        var lbl = el('span', 'jcal-title', J.MONTH_NAMES[cur.jm - 1] + ' ' + cur.jy);
        var todayBtn = el('button', 'jcal-btn jcal-today', 'امروز');
        var goWrap = el('span', 'jcal-go');
        var goInput = el('input', 'jcal-input');
        goInput.placeholder = 'YYYY/MM/DD';
        goInput.setAttribute('dir', 'ltr');
        var goBtn = el('button', 'jcal-btn', 'برو');
        goWrap.appendChild(goInput); goWrap.appendChild(goBtn);
        btnPrevY.onclick = function () { cur.jy--; render(); };
        btnNextY.onclick = function () { cur.jy++; render(); };
        btnPrevM.onclick = function () { cur.jm--; if (cur.jm < 1) { cur.jm = 12; cur.jy--; } render(); };
        btnNextM.onclick = function () { cur.jm++; if (cur.jm > 12) { cur.jm = 1; cur.jy++; } render(); };
        todayBtn.onclick = function () {
          cur = self.parse(self.fromDate(new Date()));
          render();
        };
        goBtn.onclick = function () {
          var p = self.parse(goInput.value);
          if (p) { cur = p; render(); }
          else { goInput.classList.add('jcal-invalid'); setTimeout(function () { goInput.classList.remove('jcal-invalid'); }, 800); }
        };
        goInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') goBtn.click(); });
        nav.appendChild(btnPrevY); nav.appendChild(btnPrevM); nav.appendChild(lbl);
        nav.appendChild(btnNextM); nav.appendChild(btnNextY);
        nav.appendChild(todayBtn); nav.appendChild(goWrap);
        container.appendChild(nav);

        // شبکه روزها
        var grid = el('div', 'jcal-grid');
        J.DAY_NAMES.forEach(function (d, i) {
          grid.appendChild(el('div', 'jcal-dow' + (i === 6 ? ' jcal-fri' : ''), d));
        });
        var first = self.dayOfWeek(cur.jy, cur.jm, 1);
        var len = self.monthLength(cur.jy, cur.jm);
        for (var i = 0; i < first; i++) grid.appendChild(el('div', 'jcal-empty'));
        var today = self.parse(self.fromDate(new Date()));
        for (var d = 1; d <= len; d++) {
          var dow = self.dayOfWeek(cur.jy, cur.jm, d);
          var cell = el('button', 'jcal-day');
          cell.textContent = d;
          if (dow === 6) cell.classList.add('jcal-fri');
          if (weekHolidays.indexOf(dow) >= 0) cell.classList.add('jcal-holiday');
          var hname = self.holidayName(cur.jy, cur.jm, d);
          if (hname) { cell.classList.add('jcal-event'); cell.title = hname; }
          if (cur.jy === today.jy && cur.jm === today.jm && d === today.jd) cell.classList.add('jcal-today-cell');
          (function (dd) {
            cell.onclick = function () {
              var s = self.format(cur.jy, cur.jm, dd);
              container.querySelectorAll('.jcal-day').forEach(function (c) { c.classList.remove('jcal-selected'); });
              cell.classList.add('jcal-selected');
              if (opts.onSelect) opts.onSelect(s, self.dayOfWeek(cur.jy, cur.jm, dd));
            };
          })(d);
          grid.appendChild(cell);
        }
        container.appendChild(grid);
        var hint = el('div', 'jcal-hint');
        hint.textContent = 'روزهای قرمز تعطیل هستند • نقطه سبز = مناسبت ثبت‌شده';
        container.appendChild(hint);
      }
      render();
      return {
        goTo: function (s) { var p = self.parse(s); if (p) { cur = p; render(); } },
        value: function () { return self.format(cur.jy, cur.jm, cur.jd); }
      };
    }
  };

  global.Jalali = J;
})(window);
