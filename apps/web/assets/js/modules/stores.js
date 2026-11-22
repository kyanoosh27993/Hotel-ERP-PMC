/**
 * modules/stores.js — فاز ۷ (موج ۲): انبار، انبارگردانی و کاست کنترل
 * اقلام و موجودی | انتقال/اصلاح | شمارش با مغایرت | گزارش تئوریک/واقعی و سفارش مجدد.
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
  function num(n) { return Num.toPersian(Math.round((n || 0) * 1000) / 1000); }

  var DIR_FA = { IN: 'ورود', OUT: 'خروج', ADJUST_IN: 'اصلاح افزایش', ADJUST_OUT: 'اصلاح کسری', WASTE: 'ضایعات' };

  Modules.stores = {
    title: 'انبار و کاست کنترل',
    icon: '📦',
    render: function (root) {
      root.appendChild(el('h2', null, 'انبار، انبارگردانی و کاست کنترل — فاز ۷'));

      var self = this;

      // ── اتصال ──
      var conn = el('div', 'panel');
      conn.appendChild(el('h3', null, 'اتصال به سرور (انباردار/مدیر)'));
      var baseIn = el('input', 'input'); baseIn.value = apiBase();
      var userIn = el('input', 'input'); userIn.placeholder = 'نام کاربری (storekeeper/admin)';
      var passIn = el('input', 'input'); passIn.type = 'password'; passIn.placeholder = 'گذرواژه';
      var loginBtn = el('button', 'btn btn-primary', 'ورود و ذخیره توکن');
      var connMsg = el('div', 'muted');
      conn.appendChild(row('آدرس API', baseIn));
      conn.appendChild(row('کاربر', userIn));
      conn.appendChild(row('گذرواژه', passIn));
      conn.appendChild(loginBtn);
      conn.appendChild(connMsg);
      loginBtn.onclick = function () {
        localStorage.setItem(API_BASE_KEY, baseIn.value.trim());
        api('POST', '/auth/login', { username: userIn.value.trim(), password: passIn.value }).then(function (res) {
          if (res.status === 200 || res.status === 201) {
            localStorage.setItem(TOKEN_KEY, res.body.accessToken);
            connMsg.textContent = '✅ ورود موفق.';
            root.innerHTML = '';
            self.render(root);
          } else connMsg.textContent = '❌ ' + failText(res);
        });
      };
      root.appendChild(conn);

      // ── اقلام ──
      var itemsPanel = el('div', 'panel');
      itemsPanel.appendChild(el('h3', null, 'اقلام انبار — موجودی جاری و سفارش مجدد'));
      var itemsHost = el('div');
      var itemsBtn = el('button', 'btn', 'بارگیری اقلام');
      var reorderBtn = el('button', 'btn', 'گزارش سفارش مجدد');
      itemsPanel.appendChild(itemsBtn);
      itemsPanel.appendChild(reorderBtn);
      itemsPanel.appendChild(itemsHost);
      function renderItems(rows) {
        itemsHost.innerHTML = '';
        itemsHost.appendChild(tableOf(['کد', 'نام', 'موجودی', 'حداقل', 'میانگین بهای واحد', 'نیاز سفارش'], rows.map(function (i) {
          return [i.code, i.nameFa, num(i.qtyOnHand) + ' ' + i.unitConsumption, num(i.minQty), money(i.avgCostRials), i.reorderNeeded ? '⚠️ بله' : '—'];
        })));
      }
      itemsBtn.onclick = function () {
        api('GET', '/stores/items').then(function (res) {
          if (res.status !== 200) { itemsHost.textContent = failText(res); return; }
          renderItems(res.body);
        });
      };
      reorderBtn.onclick = function () {
        api('GET', '/stores/reorder').then(function (res) {
          if (res.status !== 200) { itemsHost.textContent = failText(res); return; }
          renderItems(res.body);
        });
      };
      root.appendChild(itemsPanel);

      // ── شمارش ──
      var cntPanel = el('div', 'panel');
      cntPanel.appendChild(el('h3', null, 'انبارگردانی — شمارش و مغایرت (F7-T5)'));
      var whIn = el('input', 'input'); whIn.value = 'WH-COLD';
      var openBtn = el('button', 'btn btn-primary', 'باز کردن شمارش');
      var cntIdIn = el('input', 'input'); cntIdIn.placeholder = 'شناسه شمارش';
      var cntItemIn = el('input', 'input'); cntItemIn.placeholder = 'کد قلم';
      var cntQtyIn = el('input', 'input'); cntQtyIn.placeholder = 'مقدار شمرده‌شده';
      var lineBtn = el('button', 'btn', 'ثبت شمارش قلم');
      var closeBtn = el('button', 'btn', 'بستن شمارش + سند مغایرت');
      var cntMsg = el('div', 'muted');
      cntPanel.appendChild(row('انبار', whIn));
      cntPanel.appendChild(openBtn);
      cntPanel.appendChild(row('شمارش', cntIdIn));
      cntPanel.appendChild(row('قلم', cntItemIn));
      cntPanel.appendChild(row('شمرده', cntQtyIn));
      cntPanel.appendChild(lineBtn);
      cntPanel.appendChild(closeBtn);
      cntPanel.appendChild(cntMsg);
      openBtn.onclick = function () {
        api('POST', '/stores/counts', { warehouseCode: whIn.value.trim() || 'WH-COLD' }).then(function (res) {
          if (res.status === 201 || res.status === 200) {
            cntIdIn.value = res.body.id;
            cntMsg.textContent = '✅ ' + res.body.countNo + ' — ' + Num.toPersian(res.body.lines) + ' سطر snapshot.';
          } else cntMsg.textContent = '❌ ' + failText(res);
        });
      };
      lineBtn.onclick = function () {
        api('POST', '/stores/counts/lines', {
          countId: cntIdIn.value.trim(), stockItemCode: cntItemIn.value.trim(), qtyCounted: Number(cntQtyIn.value || 0),
        }).then(function (res) {
          if (res.status === 201 || res.status === 200) cntMsg.textContent = '✅ مغایرت قلم: ' + num(res.body.varianceQty);
          else cntMsg.textContent = '❌ ' + failText(res);
        });
      };
      closeBtn.onclick = function () {
        api('POST', '/stores/counts/close', { countId: cntIdIn.value.trim() }).then(function (res) {
          if (res.status === 201 || res.status === 200) {
            cntMsg.textContent = '✅ کسری: ' + money(res.body.lossRials) + ' | اضافه: ' + money(res.body.gainRials) + ' — سند خودکار صادر شد.';
            itemsBtn.click();
          } else cntMsg.textContent = '❌ ' + failText(res);
        });
      };
      root.appendChild(cntPanel);

      // ── کاست کنترل ──
      var ccPanel = el('div', 'panel');
      ccPanel.appendChild(el('h3', null, 'کاست کنترل — مصرف تئوریک/واقعی (F7-T6)'));
      var fromIn = el('input', 'input'); fromIn.value = new Date().toISOString().slice(0, 10);
      var toIn = el('input', 'input'); toIn.value = new Date().toISOString().slice(0, 10);
      var ccBtn = el('button', 'btn', 'گزارش انحراف');
      var ccHost = el('div');
      ccPanel.appendChild(row('از', fromIn));
      ccPanel.appendChild(row('تا', toIn));
      ccPanel.appendChild(ccBtn);
      ccPanel.appendChild(ccHost);
      ccBtn.onclick = function () {
        api('GET', '/stores/cost-control?from=' + fromIn.value + '&to=' + toIn.value).then(function (res) {
          if (res.status !== 200) { ccHost.textContent = failText(res); return; }
          ccHost.innerHTML = '';
          ccHost.appendChild(el('p', 'muted', 'سفارش‌های سرو‌شده: ' + Num.toPersian(res.body.servedOrders)));
          ccHost.appendChild(tableOf(['قلم', 'تئوریک', 'واقعی', 'انحراف', 'ارزش مصرف'], res.body.lines.map(function (l) {
            return [l.code + ' — ' + l.name, num(l.theoreticalQty), num(l.actualQty), num(l.varianceQty), money(l.actualValueRials)];
          })));
        });
      };
      root.appendChild(ccPanel);

      // ── گردش‌ها ──
      var mvPanel = el('div', 'panel');
      mvPanel.appendChild(el('h3', null, 'گردش‌های اخیر انبار'));
      var mvHost = el('div');
      var mvBtn = el('button', 'btn', 'بارگیری گردش‌ها');
      mvPanel.appendChild(mvBtn);
      mvPanel.appendChild(mvHost);
      mvBtn.onclick = function () {
        api('GET', '/stores/movements?limit=15').then(function (res) {
          if (res.status !== 200) { mvHost.textContent = failText(res); return; }
          mvHost.innerHTML = '';
          mvHost.appendChild(tableOf(['قلم', 'جهت', 'مقدار', 'ارزش', 'مرجع'], res.body.map(function (m) {
            return [m.stockItemCode, DIR_FA[m.direction] || m.direction, num(m.qty), money(m.valueRials), (m.refModule || '') + ' ' + (m.refId || '')];
          })));
        });
      };
      root.appendChild(mvPanel);

      itemsBtn.click();
      mvBtn.click();
      Num.fitAll(root);
    },
  };
})(window);
