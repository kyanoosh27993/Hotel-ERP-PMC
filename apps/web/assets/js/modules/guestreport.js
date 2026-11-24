/**
 * modules/guestreport.js — نیاز ۳ کارفرما: گزارش تفکیک مهمان ایرانی/خارجی
 * بازهٔ زمانی (شمسی) → تعداد مهمان، تعداد اتاق‌های گرفته‌شده (رزروها)، جمع شب‌های اقامت
 * داده از GET /api/v1/pms/reservations?from&to — بدون سرور: از رجیسترهای ذخیره‌شدهٔ محلی.
 */
(function (global) {
  'use strict';

  var API_BASE_KEY = 'hotel-erp-api-base';
  var TOKEN_KEY = 'hotel-erp-token';
  function apiBase() { return localStorage.getItem(API_BASE_KEY) || 'http://localhost:3000/api/v1'; }
  function apiToken() { return localStorage.getItem(TOKEN_KEY) || ''; }

  function api(method, path, body) {
    return fetch(apiBase() + path, {
      method: method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiToken() },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, body: j }; });
    });
  }
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }
  function jalaliToIso(v) {
    var m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec((v || '').trim());
    if (!m) return null;
    var g = Jalali.toGregorian(Number(m[1]), Number(m[2]), Number(m[3]));
    return g.gy + '-' + String(g.gm).padStart(2, '0') + '-' + String(g.gd).padStart(2, '0');
  }

  global.Modules = global.Modules || {};

  global.Modules.guestreport = {
    render: function (root) {
      root.innerHTML = '';
      var wrap = el('div', 'gr-wrap');
      wrap.appendChild(el('h3', null, '📊 گزارش مهمانان ایرانی و خارجی'));

      var bar = el('div', 'gr-bar');
      var fromInp = el('input'); fromInp.placeholder = 'از تاریخ ۱۴۰۵/۰۸/۰۱';
      var toInp = el('input'); toInp.placeholder = 'تا تاریخ ۱۴۰۵/۰۹/۰۱';
      /* پیش‌فرض: ماه جاری شمسی */
      var today = Jalali.fromDate(new Date());
      fromInp.value = today.slice(0, 8) + '01';
      toInp.value = today;
      var goBtn = el('button', 'submitbtn gr-go', 'دریافت گزارش');
      var scopeSel = el('select');
      scopeSel.appendChild(new Option('همهٔ رزروها', ''));
      scopeSel.appendChild(new Option('فقط تأییدشده', 'CONFIRMED'));
      scopeSel.appendChild(new Option('فقط مقیم/چک‌این‌شده', 'CHECKED_IN'));
      scopeSel.appendChild(new Option('خروج‌گرفته', 'CHECKED_OUT'));
      bar.appendChild(el('span', 'gr-label', 'از:'));
      bar.appendChild(fromInp);
      bar.appendChild(el('span', 'gr-label', 'تا:'));
      bar.appendChild(toInp);
      bar.appendChild(scopeSel);
      bar.appendChild(goBtn);
      wrap.appendChild(bar);

      var msg = el('p', 'gr-msg');
      var out = el('div', 'gr-out');
      wrap.appendChild(msg);
      wrap.appendChild(out);
      root.appendChild(wrap);

      goBtn.onclick = function () {
        msg.textContent = '';
        out.innerHTML = '';
        var from = jalaliToIso(fromInp.value);
        var to = jalaliToIso(toInp.value);
        if (!from || !to) { msg.textContent = 'تاریخ‌ها باید به شکل ۱۴۰۵/۰۹/۰۱ باشند.'; return; }

        api('GET', '/pms/reservations?from=' + from + '&to=' + to + (scopeSel.value ? '&status=' + scopeSel.value : ''))
          .then(function (res) {
            if (res.status >= 200 && res.status < 300 && res.body.data) {
              render(res.body.data, false);
            } else {
              /* بدون سرور → از رجیسترهای محلی */
              var drafts = JSON.parse(localStorage.getItem('hotel-erp-register-drafts') || '[]');
              if (!drafts.length) {
                msg.textContent = 'خطا در دریافت گزارش: ' + ((res.body && res.body.error && res.body.error.message) || res.status);
                return;
              }
              render(drafts, true);
            }
          })
          .catch(function () {
            var drafts = JSON.parse(localStorage.getItem('hotel-erp-register-drafts') || '[]');
            if (!drafts.length) { msg.textContent = 'اتصال به سرور برقرار نیست و هیچ رجیستر محلی‌ای هم ذخیره نشده است.'; return; }
            render(drafts, true);
          });
      };

      function render(rows, localMode) {
        if (localMode) msg.textContent = '⚠ حالت محلی — سرور در دسترس نیست؛ گزارش از رجیسترهای ذخیره‌شدهٔ همین مرورگر ساخته شد.';
        /* نرمال‌سازی: رزروهای API فیلد nationality دارند؛ پیش‌نویس‌های محلی هم */
        var buckets = { IRANIAN: { label: 'ایرانی', guests: {}, reservations: 0, nights: 0, rooms: 0 }, FOREIGNER: { label: 'خارجی', guests: {}, reservations: 0, nights: 0, rooms: 0 }, NONE: { label: 'ثبت‌نشده', guests: {}, reservations: 0, nights: 0, rooms: 0 } };
        rows.forEach(function (r) {
          var nat = r.nationality === 'IRANIAN' ? 'IRANIAN' : r.nationality === 'FOREIGNER' ? 'FOREIGNER' : 'NONE';
          var b = buckets[nat];
          b.reservations += 1;
          b.nights += Number(r.nights || 0) || 1;
          b.guests[r.guestName || '—'] = true;
        });
        Object.keys(buckets).forEach(function (k) { buckets[k].rooms = buckets[k].reservations; });

        var t = el('table', 'gr-table');
        t.innerHTML = '<thead><tr><th>ملیت</th><th>تعداد مهمان</th><th>تعداد اتاق گرفته‌شده (رزرو)</th><th>جمع شب‌های اقامت</th></tr></thead>';
        var tb = el('tbody');
        ['IRANIAN', 'FOREIGNER', 'NONE'].forEach(function (k) {
          var b = buckets[k];
          var tr = el('tr');
          tr.appendChild(el('td', 'gr-nat-' + k.toLowerCase(), b.label));
          tr.appendChild(el('td', null, Num.toPersian(Object.keys(b.guests).length)));
          tr.appendChild(el('td', null, Num.toPersian(b.rooms)));
          tr.appendChild(el('td', null, Num.toPersian(b.nights)));
          tb.appendChild(tr);
        });
        var tot = el('tr', 'gr-total');
        tot.appendChild(el('td', null, 'جمع کل'));
        tot.appendChild(el('td', null, Num.toPersian(Object.keys(buckets.IRANIAN.guests).length + Object.keys(buckets.FOREIGNER.guests).length + Object.keys(buckets.NONE.guests).length)));
        tot.appendChild(el('td', null, Num.toPersian(buckets.IRANIAN.rooms + buckets.FOREIGNER.rooms + buckets.NONE.rooms)));
        tot.appendChild(el('td', null, Num.toPersian(buckets.IRANIAN.nights + buckets.FOREIGNER.nights + buckets.NONE.nights)));
        tb.appendChild(tot);
        t.appendChild(tb);
        out.appendChild(t);

        /* فهرست تفصیلی */
        var detail = el('details', 'gr-detail');
        var sum = el('summary', null, 'فهرست تفصیلی رزروها (' + Num.toPersian(rows.length) + ' مورد)');
        detail.appendChild(sum);
        var dt = el('table', 'gr-table');
        dt.innerHTML = '<thead><tr><th>کد</th><th>مهمان</th><th>نوع اتاق</th><th>ورود</th><th>خروج</th><th>شب</th><th>ملیت</th><th>وضعیت</th></tr></thead>';
        var dtb = el('tbody');
        rows.slice().sort(function (a, b) { return String(a.checkIn).localeCompare(String(b.checkIn)); }).forEach(function (r) {
          var tr = el('tr');
          [r.code, r.guestName, r.roomTypeNameFa || r.roomType, Jalali.fromDate(new Date(r.checkIn + 'T00:00:00Z')), Jalali.fromDate(new Date(r.checkOut + 'T00:00:00Z')), r.nights,
            r.nationality === 'IRANIAN' ? 'ایرانی' : r.nationality === 'FOREIGNER' ? 'خارجی' : '—',
            r.status === 'CONFIRMED' ? 'تأییدشده' : r.status === 'CHECKED_IN' ? 'مقیم' : r.status === 'CHECKED_OUT' ? 'خروج‌گرفته' : r.status === 'CANCELLED' ? 'لغو' : r.status
          ].forEach(function (v) { tr.appendChild(el('td', null, Num.toPersian(String(v)))); });
          dtb.appendChild(tr);
        });
        dt.appendChild(dtb);
        detail.appendChild(dt);
        out.appendChild(detail);
      }
    },
  };
})(window);
