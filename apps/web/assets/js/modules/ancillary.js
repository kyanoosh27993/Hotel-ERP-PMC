/**
 * modules/ancillary.js — فاز ۱۰ (موج ۱): خدمات جانبی (نقشه ۷.۱۰)
 * کاتالوگ خدمات | سفارش/تأیید با شارژ فولیوی اقامت | فهرست سفارش‌ها و لغو.
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

  var ORDER_STATUS_FA = { CONFIRMED: 'تأییدشده', CHARGED: 'شارژشده', CANCELED: 'لغو' };

  Modules.ancillary = {
    title: 'خدمات جانبی',
    icon: '🛎',
    render: function (root) {
      root.appendChild(el('h2', null, 'خدمات جانبی و شارژ اتاق — فاز ۱۰'));

      var self = this;

      // ── اتصال ──
      root.appendChild(App.sessionPanel());

      // ── کاتالوگ ──
      var catPanel = el('div', 'panel');
      catPanel.appendChild(el('h3', null, 'کاتالوگ خدمات'));
      var svcHost = el('div');
      var svcBtn = el('button', 'btn', 'بارگیری کاتالوگ');
      catPanel.appendChild(svcBtn);
      catPanel.appendChild(svcHost);
      var svcSel = el('select', 'input');
      svcBtn.onclick = function () {
        api('GET', '/ancillary/services').then(function (res) {
          if (res.status !== 200) { svcHost.textContent = failText(res); return; }
          svcSel.innerHTML = '';
          svcHost.innerHTML = '';
          svcHost.appendChild(tableOf(['کد', 'نام', 'نرخ واحد', 'مالیات'],
            res.body.map(function (s) {
              var o = el('option', null, s.code + ' — ' + s.nameFa);
              o.value = s.code;
              svcSel.appendChild(o);
              return [s.code, s.nameFa, money(s.unitPriceRials), Num.toPersian(s.taxRateBps / 100) + '٪'];
            })));
        });
      };
      catPanel.appendChild(row('خدمت', svcSel));
      catPanel.appendChild(svcHost);
      root.appendChild(catPanel);

      // ── ثبت سفارش ──
      var ordPanel = el('div', 'panel');
      ordPanel.appendChild(el('h3', null, 'ثبت سفارش خدمت (F10-T6) — شارژ فولیو یا فاکتور مستقل'));
      var qtyIn = el('input', 'input'); qtyIn.placeholder = 'تعداد';
      var stayIn = el('input', 'input'); stayIn.placeholder = 'کد اقامت STY-… (خالی = فاکتور مستقل)';
      var guestIn = el('input', 'input'); guestIn.placeholder = 'نام مشتری مستقل (اختیاری)';
      var ordBtn = el('button', 'btn btn-primary', 'تأیید سفارش و شارژ');
      var ordMsg = el('div', 'muted');
      ordPanel.appendChild(row('خدمت', svcSel));
      ordPanel.appendChild(row('تعداد', qtyIn));
      ordPanel.appendChild(row('اقامت', stayIn));
      ordPanel.appendChild(row('مشتری', guestIn));
      ordPanel.appendChild(ordBtn);
      ordPanel.appendChild(ordMsg);
      ordBtn.onclick = function () {
        api('POST', '/ancillary/orders', {
          serviceCode: svcSel.value,
          quantity: Number(qtyIn.value || 0),
          stayCode: stayIn.value.trim() || null,
          guestName: guestIn.value.trim() || null,
          idempotencyKey: 'web-svc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        }).then(function (res) {
          if (res.status === 201 || res.status === 200) {
            ordMsg.textContent = '✅ ' + res.body.orderNo + ' — خالص ' + money(res.body.netRials)
              + ' | مالیات ' + money(res.body.taxRials) + ' | کل ' + money(res.body.totalRials)
              + (res.body.replayed ? ' (کلید تکراری)' : '');
            qtyIn.value = '';
            ordersBtn.click();
          } else ordMsg.textContent = '❌ ' + failText(res);
        });
      };
      root.appendChild(ordPanel);

      // ── سفارش‌ها ──
      var ordersPanel = el('div', 'panel');
      ordersPanel.appendChild(el('h3', null, 'سفارش‌های اخیر'));
      var ordersHost = el('div');
      var ordersBtn = el('button', 'btn', 'بارگیری سفارش‌ها');
      ordersPanel.appendChild(ordersBtn);
      ordersPanel.appendChild(ordersHost);
      ordersBtn.onclick = function () {
        api('GET', '/ancillary/orders?limit=15').then(function (res) {
          if (res.status !== 200) { ordersHost.textContent = failText(res); return; }
          ordersHost.innerHTML = '';
          var rows = res.body.map(function (o) {
            var tr = el('tr');
            [o.orderNo, o.serviceName, Num.toPersian(o.quantity), money(o.netRials), money(o.taxRials), money(o.totalRials), o.stayCode || o.guestName || 'مستقل', ORDER_STATUS_FA[o.status] || o.status].forEach(function (c) {
              tr.appendChild(el('td', null, c));
            });
            var act = el('td');
            if (o.status === 'CONFIRMED') {
              var cx = el('button', 'btn btn-danger', 'لغو');
              cx.onclick = function () {
                var why = window.prompt('دلیل لغو؟');
                if (!why) return;
                api('POST', '/ancillary/orders/' + o.id + '/cancel', { reason: why }).then(function () { ordersBtn.click(); });
              };
              act.appendChild(cx);
            }
            tr.appendChild(act);
            return tr;
          });
          ordersHost.appendChild(tableOf(['شماره', 'خدمت', 'تعداد', 'خالص', 'مالیات', 'کل', 'مقصد', 'وضعیت', ''], rows));
        });
      };
      root.appendChild(ordersPanel);

      svcBtn.click();
      ordersBtn.click();
      Num.fitAll(root);
    },
  };
})(window);
