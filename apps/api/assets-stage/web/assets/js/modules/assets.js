/**
 * modules/assets.js — فاز ۱۰ (موج ۱): دارایی ثابت و استهلاک (نقشه ۷.۸)
 * ثبت دارایی | انتقال محل | اسقاط/فروش | اجرای استهلاک دوره | گزارش استهلاک.
 */
(function (global) {
  'use strict';

  var Modules = global.Modules = global.Modules || {};

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

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

  function failText(res) {
    return (res.body && res.body.error && res.body.error.message) ? res.body.error.message : ('خطای ' + res.status);
  }

  function row(label, input) {
    var d = el('div');
    d.style.cssText = 'display:flex;gap:6px;align-items:center;margin:4px 0;flex-wrap:wrap;';
    var l = el('label', null, label); l.style.minWidth = '110px';
    d.appendChild(l); d.appendChild(input);
    return d;
  }

  function tableOf(headers, rows) {
    var wrap = el('div');
    wrap.style.cssText = 'overflow-x:auto;';
    var t = el('table');
    var thead = el('thead');
    var trh = el('tr');
    headers.forEach(function (h) { trh.appendChild(el('th', null, h)); });
    thead.appendChild(trh);
    var tbody = el('tbody');
    rows.forEach(function (r) { tbody.appendChild(r); });
    t.appendChild(thead); t.appendChild(tbody);
    wrap.appendChild(t);
    return wrap;
  }

  function money(n) { return n == null ? '—' : Num.toPersian(String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')) + ' ریال'; }

  var ASSET_STATUS_FA = { ACTIVE: 'فعال', TRANSFERRED: 'منتقل‌شده', SOLD: 'فروخته‌شده', SCRAPPED: 'اسقاط' };

  Modules.assets = {
    title: 'دارایی ثابت',
    icon: '🏛️',
    render: function (root) {
      root.appendChild(el('h2', null, 'دارایی ثابت و استهلاک — فاز ۱۰'));

      var self = this;

      // ── اتصال ──
      var conn = el('div', 'panel');
      conn.appendChild(el('h3', null, 'اتصال به سرور (نقش مدیر/حسابدار)'));
      var baseIn = el('input', 'input'); baseIn.value = apiBase();
      var userIn = el('input', 'input'); userIn.placeholder = 'نام کاربری (admin)';
      var passIn = el('input', 'input'); passIn.type = 'password'; passIn.placeholder = 'گذرواژه';
      var totpIn = el('input', 'input'); totpIn.placeholder = 'کد TOTP (نقش حساس)';
      var loginBtn = el('button', 'btn btn-primary', 'ورود و ذخیره توکن');
      var connMsg = el('div', 'muted');
      conn.appendChild(row('آدرس API', baseIn));
      conn.appendChild(row('کاربر', userIn));
      conn.appendChild(row('گذرواژه', passIn));
      conn.appendChild(row('TOTP', totpIn));
      conn.appendChild(loginBtn);
      conn.appendChild(connMsg);
      loginBtn.onclick = function () {
        localStorage.setItem(API_BASE_KEY, baseIn.value.trim());
        var body = { username: userIn.value.trim(), password: passIn.value };
        if (totpIn.value.trim()) body.totp = totpIn.value.trim();
        api('POST', '/auth/login', body).then(function (res) {
          if (res.status === 200 || res.status === 201) {
            localStorage.setItem(TOKEN_KEY, res.body.accessToken);
            connMsg.textContent = '✅ ورود موفق.';
            root.innerHTML = '';
            self.render(root);
          } else connMsg.textContent = '❌ ' + failText(res);
        });
      };
      root.appendChild(conn);

      // ── ثبت دارایی ──
      var regPanel = el('div', 'panel');
      regPanel.appendChild(el('h3', null, 'ثبت دارایی جدید'));
      var nameIn = el('input', 'input'); nameIn.placeholder = 'نام فارسی دارایی';
      var catSel = el('select', 'input');
      [['FUN', 'تجهیزات مبله'], ['ELE', 'برقی'], ['VEH', 'خودرو'], ['FUR', 'اثاثیه'], ['IT', 'رایانه‌ای'], ['OTHER', 'سایر']].forEach(function (c) {
        var o = el('option', null, c[1]); o.value = c[0]; catSel.appendChild(o);
      });
      var costIn = el('input', 'input'); costIn.placeholder = 'بهای تمام‌شده (ریال)';
      var salvIn = el('input', 'input'); salvIn.placeholder = 'ارزش اسقاط (ریال، اختیاری)';
      var lifeIn = el('input', 'input'); lifeIn.placeholder = 'عمر مفید (ماه)';
      var roomIn = el('input', 'input'); roomIn.placeholder = 'اتاق استقرار (اختیاری)';
      var acqIn = el('input', 'input'); acqIn.value = new Date().toISOString().slice(0, 10);
      var regBtn = el('button', 'btn btn-primary', 'ثبت دارایی');
      var regMsg = el('div', 'muted');
      regPanel.appendChild(row('نام', nameIn));
      regPanel.appendChild(row('طبقه', catSel));
      regPanel.appendChild(row('بها', costIn));
      regPanel.appendChild(row('اسقاط', salvIn));
      regPanel.appendChild(row('عمر مفید', lifeIn));
      regPanel.appendChild(row('اتاق', roomIn));
      regPanel.appendChild(row('تاریخ خرید', acqIn));
      regPanel.appendChild(regBtn);
      regPanel.appendChild(regMsg);
      regBtn.onclick = function () {
        api('POST', '/assets', {
          nameEn: nameIn.value.trim() || 'Asset',
          nameFa: nameIn.value.trim() || 'دارایی',
          category: catSel.value,
          acquiredAt: acqIn.value,
          costRials: Number(costIn.value || 0),
          salvageRials: salvIn.value ? Number(salvIn.value) : 0,
          usefulLifeMonths: Number(lifeIn.value || 60),
          roomCode: roomIn.value.trim() || null,
        }).then(function (res) {
          if (res.status === 201 || res.status === 200) {
            regMsg.textContent = '✅ دارایی ' + res.body.assetCode + ' ثبت شد.';
            nameIn.value = ''; costIn.value = ''; salvIn.value = ''; lifeIn.value = ''; roomIn.value = '';
            listBtn.click();
          } else regMsg.textContent = '❌ ' + failText(res);
        });
      };
      root.appendChild(regPanel);

      // ── فهرست دارایی‌ها ──
      var listPanel = el('div', 'panel');
      listPanel.appendChild(el('h3', null, 'فهرست دارایی‌ها'));
      var listHost = el('div');
      var listBtn = el('button', 'btn', 'بارگیری فهرست');
      listPanel.appendChild(listBtn);
      listPanel.appendChild(listHost);
      listBtn.onclick = function () {
        api('GET', '/assets').then(function (res) {
          if (res.status !== 200) { listHost.textContent = failText(res); return; }
          listHost.innerHTML = '';
          var rows = res.body.map(function (a) {
            var tr = el('tr');
            [a.assetCode, a.nameFa, a.roomCode || '—', money(a.costRials), money(a.accumulatedRials), a.usefulLifeMonths + ' ماه', ASSET_STATUS_FA[a.status] || a.status].forEach(function (c) {
              tr.appendChild(el('td', null, c));
            });
            var act = el('td');
            if (a.status === 'ACTIVE') {
              var trfBtn = el('button', 'btn', 'انتقال');
              trfBtn.onclick = function () {
                var rc = window.prompt('کد اتاق مقصد (خالی = انبار مرکزی):', '');
                api('POST', '/assets/' + a.id + '/transfer', { roomCode: rc || null }).then(function () { listBtn.click(); });
              };
              var dspBtn = el('button', 'btn btn-danger', 'اسقاط/فروش');
              dspBtn.onclick = function () {
                var act2 = window.prompt('نوع خروج: SOLD یا SCRAPPED؟', 'SCRAPPED');
                if (!act2) return;
                var why = window.prompt('دلیل:');
                if (!why) return;
                api('POST', '/assets/' + a.id + '/dispose', { action: act2, reason: why }).then(function () { listBtn.click(); });
              };
              act.appendChild(trfBtn); act.appendChild(dspBtn);
            }
            tr.appendChild(act);
            return tr;
          });
          listHost.appendChild(tableOf(['کد اموال', 'نام', 'موقعیت', 'بها', 'استهلاک انباشته', 'عمر مفید', 'وضعیت', ''], rows));
        });
      };
      root.appendChild(listPanel);

      // ── استهلاک ──
      var depPanel = el('div', 'panel');
      depPanel.appendChild(el('h3', null, 'اجرای استهلاک دوره (F10-T5) — هر دوره فقط یک‌بار'));
      var periodIn = el('input', 'input'); periodIn.placeholder = '1405-09';
      var runBtn = el('button', 'btn btn-primary', 'اجرای استهلاک');
      var rptBtn = el('button', 'btn', 'گزارش استهلاک دوره');
      var depMsg = el('div', 'muted');
      var rptHost = el('div');
      depPanel.appendChild(row('دوره', periodIn));
      depPanel.appendChild(runBtn);
      depPanel.appendChild(rptBtn);
      depPanel.appendChild(depMsg);
      depPanel.appendChild(rptHost);
      runBtn.onclick = function () {
        api('POST', '/assets/depreciation/run', { periodCode: periodIn.value.trim() }).then(function (res) {
          if (res.status === 201 || res.status === 200) {
            var posted = res.body.results.filter(function (r) { return r.amountRials != null && !r.skipped; }).length;
            depMsg.textContent = '✅ استهلاک ' + res.body.periodCode + ' اجرا شد — ' + Num.toPersian(posted) + ' قسط جدید از ' + Num.toPersian(res.body.processed);
            listBtn.click();
          } else depMsg.textContent = '❌ ' + failText(res);
        });
      };
      rptBtn.onclick = function () {
        api('GET', '/assets/depreciation?periodCode=' + encodeURIComponent(periodIn.value.trim())).then(function (res) {
          if (res.status !== 200) { rptHost.textContent = failText(res); return; }
          rptHost.innerHTML = '';
          rptHost.appendChild(el('p', 'muted', 'جمع استهلاک دورهٔ ' + res.body.periodCode + ': ' + money(res.body.totalRials) + ' — ' + Num.toPersian(res.body.count) + ' سند'));
          rptHost.appendChild(tableOf(['کد اموال', 'نام', 'قسط دوره', 'انباشته', 'سند'],
            res.body.lines.map(function (l) {
              return [l.assetCode, l.nameFa, money(l.amountRials), money(l.accumulatedRials), l.journalEntryNo || '—'];
            })));
        });
      };
      root.appendChild(depPanel);

      listBtn.click();
      Num.fitAll(root);
    },
  };
})(window);
