/**
 * modules/procurement.js — فاز ۷ (موج ۲): خرید و تدارکات
 * تأمین‌کننده | درخواست کالا با گردش | سفارش خرید + تأیید | رسید خرید جزئی/کامل + سند.
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

  var PO_STATUS_FA = { DRAFT: 'پیش‌نویس', APPROVED: 'تأییدشده', PARTIAL: 'رسید جزئی', RECEIVED: 'کامل‌رسید', CANCELED: 'لغو' };
  var REQ_STATUS_FA = { DRAFT: 'پیش‌نویس', SUBMITTED: 'ارسال‌شده', APPROVED: 'تأییدشده', CONVERTED: 'به PO تبدیل شد', REJECTED: 'رد' };

  Modules.procurement = {
    title: 'خرید و تدارکات',
    icon: '🚚',
    render: function (root) {
      root.appendChild(el('h2', null, 'خرید، تدارکات و رسید انبار — فاز ۷'));

      var self = this;

      // ── اتصال ──
      var conn = el('div', 'panel');
      conn.appendChild(el('h3', null, 'اتصال به سرور (انباردار/تأییدکننده/مدیر)'));
      var baseIn = el('input', 'input'); baseIn.value = apiBase();
      var userIn = el('input', 'input'); userIn.placeholder = 'نام کاربری (storekeeper/approver/admin)';
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

      // ── سفارش خرید ──
      var poPanel = el('div', 'panel');
      poPanel.appendChild(el('h3', null, 'سفارش خرید جدید + تأیید (F7-T1)'));
      var supIn = el('input', 'input'); supIn.value = 'SUP-001';
      var itemIn = el('input', 'input'); itemIn.placeholder = 'کد قلم: STK-BEEF';
      var qtyIn = el('input', 'input'); qtyIn.placeholder = 'مقدار (واحد خرید)';
      var costIn = el('input', 'input'); costIn.placeholder = 'بهای واحد (ریال)';
      var addBtn = el('button', 'btn', 'افزودن سطر');
      var poBtn = el('button', 'btn btn-primary', 'ثبت سفارش');
      var approveIn = el('input', 'input'); approveIn.placeholder = 'شناسه PO';
      var approveBtn = el('button', 'btn', 'تأیید سفارش');
      var poMsg = el('div', 'muted');
      var poLines = [];
      var linesBox = el('div', 'muted', 'سطرها: —');
      poPanel.appendChild(row('تأمین‌کننده', supIn));
      poPanel.appendChild(row('قلم', itemIn));
      poPanel.appendChild(row('مقدار', qtyIn));
      poPanel.appendChild(row('بهای واحد', costIn));
      poPanel.appendChild(addBtn);
      poPanel.appendChild(poBtn);
      poPanel.appendChild(linesBox);
      poPanel.appendChild(row('PO', approveIn));
      poPanel.appendChild(approveBtn);
      poPanel.appendChild(poMsg);
      addBtn.onclick = function () {
        var q = Number(qtyIn.value || 0), c = Number(costIn.value || 0);
        if (!itemIn.value.trim() || q <= 0 || c <= 0) { poMsg.textContent = 'قلم/مقدار/بها را کامل کنید.'; return; }
        poLines.push({ stockItemCode: itemIn.value.trim(), qty: q, unitCostRials: c });
        linesBox.textContent = 'سطرها: ' + poLines.map(function (p) { return p.stockItemCode + ' × ' + Num.toPersian(p.qty); }).join(' | ');
        itemIn.value = ''; qtyIn.value = ''; costIn.value = '';
      };
      poBtn.onclick = function () {
        if (!poLines.length) { poMsg.textContent = 'سطری اضافه نشده است.'; return; }
        api('POST', '/procurement/orders', { supplierCode: supIn.value.trim() || 'SUP-001', items: poLines }).then(function (res) {
          if (res.status === 201 || res.status === 200) {
            approveIn.value = res.body.id;
            poMsg.textContent = '✅ ' + res.body.poNo + ' — کل ' + money(res.body.totalRials) + ' (' + Num.toPersian(res.body.lines) + ' سطر)';
            poLines = [];
            linesBox.textContent = 'سطرها: —';
            poListBtn.click();
          } else poMsg.textContent = '❌ ' + failText(res);
        });
      };
      approveBtn.onclick = function () {
        api('POST', '/procurement/orders/' + approveIn.value.trim() + '/approve', {}).then(function (res) {
          if (res.status === 201 || res.status === 200) {
            poMsg.textContent = '✅ سفارش تأیید شد — برای رسید آماده است.';
            poListBtn.click();
          } else poMsg.textContent = '❌ ' + failText(res);
        });
      };
      root.appendChild(poPanel);

      // ── رسید خرید ──
      var grnPanel = el('div', 'panel');
      grnPanel.appendChild(el('h3', null, 'رسید خرید (کامل/جزئی) — موجودی + سند خودکار (F7-T2/T3)'));
      var grnPoIn = el('input', 'input'); grnPoIn.placeholder = 'شماره PO-…';
      var grnItemIn = el('input', 'input'); grnItemIn.placeholder = 'کد قلم';
      var grnQtyIn = el('input', 'input'); grnQtyIn.placeholder = 'مقدار رسید';
      var grnBtn = el('button', 'btn btn-primary', 'ثبت رسید');
      var grnMsg = el('div', 'muted');
      grnPanel.appendChild(row('PO', grnPoIn));
      grnPanel.appendChild(row('قلم', grnItemIn));
      grnPanel.appendChild(row('مقدار', grnQtyIn));
      grnPanel.appendChild(grnBtn);
      grnPanel.appendChild(grnMsg);
      grnBtn.onclick = function () {
        api('POST', '/procurement/receipts', {
          poCode: grnPoIn.value.trim(),
          lines: [{ stockItemCode: grnItemIn.value.trim(), qtyReceived: Number(grnQtyIn.value || 0) }],
        }).then(function (res) {
          if (res.status === 201 || res.status === 200) {
            grnMsg.textContent = '✅ ' + res.body.grnNo + ' — خالص ' + money(res.body.netRials) + ' | وضعیت PO: ' + PO_STATUS_FA[res.body.poStatus];
            grnItemIn.value = ''; grnQtyIn.value = '';
            poListBtn.click(); grnListBtn.click();
          } else grnMsg.textContent = '❌ ' + failText(res);
        });
      };
      root.appendChild(grnPanel);

      // ── فهرست‌ها ──
      var listPanel = el('div', 'panel');
      listPanel.appendChild(el('h3', null, 'سفارش‌ها و رسیدها'));
      var poHost = el('div');
      var grnHost = el('div');
      var poListBtn = el('button', 'btn', 'بارگیری سفارش‌ها');
      var grnListBtn = el('button', 'btn', 'بارگیری رسیدها');
      listPanel.appendChild(poListBtn);
      listPanel.appendChild(poHost);
      listPanel.appendChild(grnListBtn);
      listPanel.appendChild(grnHost);
      poListBtn.onclick = function () {
        api('GET', '/procurement/orders?limit=10').then(function (res) {
          if (res.status !== 200) { poHost.textContent = failText(res); return; }
          poHost.innerHTML = '';
          poHost.appendChild(tableOf(['شماره', 'تأمین‌کننده', 'وضعیت', 'کل'], res.body.map(function (p) {
            return [p.poNo, p.supplier, PO_STATUS_FA[p.status] || p.status, money(p.totalRials)];
          })));
        });
      };
      grnListBtn.onclick = function () {
        api('GET', '/procurement/receipts?limit=10').then(function (res) {
          if (res.status !== 200) { grnHost.textContent = failText(res); return; }
          grnHost.innerHTML = '';
          grnHost.appendChild(tableOf(['شماره رسید', 'تاریخ', 'سطرها'], res.body.map(function (g) {
            return [g.grnNo, g.receivedAt.slice(0, 10), Num.toPersian(g.lineCount)];
          })));
        });
      };
      root.appendChild(listPanel);

      poListBtn.click();
      grnListBtn.click();
      Num.fitAll(root);
    },
  };
})(window);
