/**
 * modules/restaurant.js — فاز ۶ (موج ۲): رستوران، سفارش‌گیری و نمایشگر آشپزخانه (KDS)
 * سالن/میز | منو | سفارش با اقلام و تخفیف | ارسال به آشپزخانه | بورد KDS — API واقعی.
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

  var MODE_FA = { DINE_IN: 'حضوری', TAKEAWAY: 'بیرون‌بر', ROOM_SERVICE: 'روم‌سرویس' };
  var TICKET_FA = { QUEUED: 'در صف', PREPARING: 'در آماده‌سازی', READY: 'آماده', SERVED: 'سرو‌شده' };

  Modules.restaurant = {
    title: 'رستوران و آشپزخانه',
    icon: '🍽️',
    render: function (root) {
      root.appendChild(el('h2', null, 'رستوران، POS و آشپزخانه — فاز ۶'));

      var self = this;
      var menuSel = el('select', 'input');
      var state = { orderId: null };

      // ── اتصال ──
      root.appendChild(App.sessionPanel());

      // ── سفارش جدید ──
      var ordPanel = el('div', 'panel');
      ordPanel.appendChild(el('h3', null, 'باز کردن سفارش (F6-T2)'));
      var outletIn = el('input', 'input'); outletIn.value = 'REST-MAIN';
      var tableIn = el('input', 'input'); tableIn.placeholder = 'کد میز (T1) — حضوری';
      var modeSel = el('select', 'input');
      Object.keys(MODE_FA).forEach(function (m) { var o = el('option', null, MODE_FA[m]); o.value = m; modeSel.appendChild(o); });
      var stayIn = el('input', 'input'); stayIn.placeholder = 'کد اقامت STY-… (روم‌سرویس)';
      var qtyIn = el('input', 'input'); qtyIn.placeholder = 'تعداد';
      var addBtn = el('button', 'btn', 'افزودن به سفارش');
      var openBtn = el('button', 'btn btn-primary', 'ثبت سفارش');
      var ordMsg = el('div', 'muted');
      var itemsBox = el('div', 'muted', 'اقلام سفارش جاری: —');
      var pending = [];
      ordPanel.appendChild(row('مرکز', outletIn));
      ordPanel.appendChild(row('میز', tableIn));
      ordPanel.appendChild(row('حالت', modeSel));
      ordPanel.appendChild(row('اقامت', stayIn));
      ordPanel.appendChild(row('آیتم منو', menuSel));
      ordPanel.appendChild(row('تعداد', qtyIn));
      ordPanel.appendChild(addBtn);
      ordPanel.appendChild(openBtn);
      ordPanel.appendChild(itemsBox);
      ordPanel.appendChild(ordMsg);
      addBtn.onclick = function () {
        var q = Number(qtyIn.value || 0);
        if (!menuSel.value || q < 1) { ordMsg.textContent = 'آیتم و تعداد را انتخاب کنید.'; return; }
        pending.push({ menuItemCode: menuSel.value, qty: q });
        itemsBox.textContent = 'اقلام سفارش جاری: ' + pending.map(function (p) { return p.menuItemCode + ' × ' + Num.toPersian(p.qty); }).join(' | ');
        qtyIn.value = '';
      };
      openBtn.onclick = function () {
        if (!pending.length) { ordMsg.textContent = 'ابتدا قلم اضافه کنید.'; return; }
        api('POST', '/restaurant/orders', {
          outletCode: outletIn.value.trim() || 'REST-MAIN',
          tableCode: tableIn.value.trim() || null,
          mode: modeSel.value,
          stayCode: stayIn.value.trim() || null,
          items: pending,
          idempotencyKey: 'web-ord-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        }).then(function (res) {
          if (res.status === 201 || res.status === 200) {
            state.orderId = res.body.id;
            ordMsg.textContent = '✅ ' + res.body.orderNo + ' — خالص ' + money(res.body.netRials) + ' | مالیات ' + money(res.body.taxRials) + ' | کل ' + money(res.body.totalRials)
              + ' — شناسه سفارش در دکمه‌های پایین ثبت شد.';
            pending = [];
            itemsBox.textContent = 'اقلام سفارش جاری: —';
            tableIn.value = ''; stayIn.value = '';
            ordersBtn.click();
          } else ordMsg.textContent = '❌ ' + failText(res);
        });
      };
      root.appendChild(ordPanel);

      // ── عملیات سفارش جاری ──
      var actPanel = el('div', 'panel');
      actPanel.appendChild(el('h3', null, 'عملیات سفارش جاری — ارسال آشپزخانه / تخفیف / سرو'));
      var ordIdIn = el('input', 'input'); ordIdIn.placeholder = 'شناسه سفارش';
      var itemIdIn = el('input', 'input'); itemIdIn.placeholder = 'شناسه قلم';
      var sendBtn = el('button', 'btn', 'ارسال قلم به آشپزخانه');
      var dsIn = el('input', 'input'); dsIn.placeholder = 'تخفیف (ریال)';
      var dsBtn = el('button', 'btn', 'اعمال تخفیف (مجوز مدیر)');
      var serveBtn = el('button', 'btn btn-primary', 'سرو قطعی سفارش');
      var actMsg = el('div', 'muted');
      actPanel.appendChild(row('سفارش', ordIdIn));
      actPanel.appendChild(row('قلم', itemIdIn));
      actPanel.appendChild(sendBtn);
      actPanel.appendChild(row('تخفیف', dsIn));
      actPanel.appendChild(dsBtn);
      actPanel.appendChild(serveBtn);
      actPanel.appendChild(actMsg);
      sendBtn.onclick = function () {
        api('POST', '/restaurant/orders/' + ordIdIn.value.trim() + '/items/' + itemIdIn.value.trim() + '/send', {}).then(function (res) {
          if (res.status === 201 || res.status === 200) actMsg.textContent = '✅ بلیت ' + res.body.ticketNo + ' در صف آشپزخانه.';
          else actMsg.textContent = '❌ ' + failText(res);
        });
      };
      dsBtn.onclick = function () {
        api('POST', '/restaurant/orders/' + ordIdIn.value.trim() + '/discount', {
          amountRials: Number(dsIn.value || 0), reason: 'تخفیف پنل مدیریت',
        }).then(function (res) {
          if (res.status === 201 || res.status === 200) actMsg.textContent = '✅ کل پس از تخفیف: ' + money(res.body.totalRials);
          else actMsg.textContent = '❌ ' + failText(res);
        });
      };
      serveBtn.onclick = function () {
        api('POST', '/restaurant/orders/' + ordIdIn.value.trim() + '/serve', {}).then(function (res) {
          if (res.status === 201 || res.status === 200) {
            actMsg.textContent = '✅ سفارش سرو شد — کل ' + money(res.body.totalRials) + (res.body.mode === 'ROOM_SERVICE' ? ' (به فولیو شارژ شد)' : '');
            ordersBtn.click();
          } else actMsg.textContent = '❌ ' + failText(res);
        });
      };
      root.appendChild(actPanel);

      // ── KDS ──
      var kdsPanel = el('div', 'panel');
      kdsPanel.appendChild(el('h3', null, 'نمایشگر آشپزخانه (KDS) — بلیت‌های در جریان'));
      var kdsHost = el('div');
      var kdsBtn = el('button', 'btn', 'بارگیری بلیت‌ها');
      kdsPanel.appendChild(kdsBtn);
      kdsPanel.appendChild(kdsHost);
      kdsBtn.onclick = function () {
        api('GET', '/restaurant/kitchen/tickets').then(function (res) {
          if (res.status !== 200) { kdsHost.textContent = failText(res); return; }
          kdsHost.innerHTML = '';
          if (!res.body.length) { kdsHost.appendChild(el('p', 'muted', 'بلیت بازی وجود ندارد.')); return; }
          res.body.forEach(function (t) {
            var card = el('div', 'panel');
            card.style.cssText = 'display:inline-block;min-width:220px;margin:6px;vertical-align:top;';
            card.appendChild(el('h4', null, t.ticketNo + ' — ' + (t.tableLabel || '') + ' (' + Num.toPersian(t.waitingMinutes) + ' دقیقه)'));
            card.appendChild(el('p', 'muted', TICKET_FA[t.status] || t.status));
            (t.items || []).forEach(function (i) {
              card.appendChild(el('div', null, '• ' + i.name + ' × ' + Num.toPersian(i.qty)));
            });
            ['PREPARING', 'READY', 'SERVED'].forEach(function (st) {
              var b = el('button', 'btn', TICKET_FA[st]);
              b.onclick = function () {
                api('POST', '/restaurant/kitchen/tickets/' + t.id, { status: st }).then(function () { kdsBtn.click(); });
              };
              card.appendChild(b);
            });
            kdsHost.appendChild(card);
          });
        });
      };
      root.appendChild(kdsPanel);

      // ── سفارش‌ها ──
      var ordersPanel = el('div', 'panel');
      ordersPanel.appendChild(el('h3', null, 'سفارش‌های اخیر'));
      var ordersHost = el('div');
      var ordersBtn = el('button', 'btn', 'بارگیری سفارش‌ها');
      ordersPanel.appendChild(ordersBtn);
      ordersPanel.appendChild(ordersHost);
      ordersBtn.onclick = function () {
        api('GET', '/restaurant/orders?limit=10').then(function (res) {
          if (res.status !== 200) { ordersHost.textContent = failText(res); return; }
          ordersHost.innerHTML = '';
          var rows = res.body.map(function (o) {
            var tr = el('tr');
            [o.orderNo, MODE_FA[o.mode] || o.mode, o.status === 'SERVED' ? 'سرو‌شده' : 'باز', money(o.netRials), money(o.taxRials), money(o.totalRials),
              o.discountRials > 0 ? money(o.discountRials) : '—'].forEach(function (c) { tr.appendChild(el('td', null, c)); });
            var act = el('td');
            var pick = el('button', 'btn', 'انتخاب');
            pick.onclick = function () { ordIdIn.value = o.id; };
            act.appendChild(pick);
            tr.appendChild(act);
            return tr;
          });
          ordersHost.appendChild(tableOf(['شماره', 'حالت', 'وضعیت', 'خالص', 'مالیات', 'کل', 'تخفیف', ''], rows));
        });
      };
      root.appendChild(ordersPanel);

      // بارگذاری منو
      api('GET', '/restaurant/menu').then(function (res) {
        if (res.status !== 200) return;
        menuSel.innerHTML = '';
        res.body.forEach(function (c) {
          c.items.forEach(function (i) {
            var o = el('option', null, i.nameFa + ' (' + money(i.priceRials) + ')');
            o.value = i.code;
            menuSel.appendChild(o);
          });
        });
      });

      ordersBtn.click();
      kdsBtn.click();
      Num.fitAll(root);
    },
  };
})(window);
