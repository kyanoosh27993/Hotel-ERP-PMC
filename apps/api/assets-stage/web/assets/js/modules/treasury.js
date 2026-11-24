/**
 * modules/treasury.js — فاز ۵ (موج ۱): صندوق، پرداخت و خزانه‌داری
 * موجودی صندوق‌ها | شیفت صندوق‌دار (باز/بستن با مغایرت) | دریافت/پرداخت/انتقال/برگشت |
 * ابطال | صورت‌حساب بانک و مغایرت‌گیری — همهٔ اعداد از API واقعی (/api/v1/treasury/*).
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

  function table(headers, rows) {
    var wrap = el('div');
    wrap.style.cssText = 'overflow-x:auto;';
    var t = el('table');
    var thead = el('thead');
    var trh = el('tr');
    headers.forEach(function (h) { trh.appendChild(el('th', null, h)); });
    thead.appendChild(trh);
    var tbody = el('tbody');
    rows.forEach(function (r) {
      var tr = el('tr');
      r.forEach(function (c) { tr.appendChild(el('td', null, c == null ? '—' : String(c))); });
      tbody.appendChild(tr);
    });
    t.appendChild(thead); t.appendChild(tbody);
    wrap.appendChild(t);
    return wrap;
  }

  function today() { return new Date().toISOString().slice(0, 10); }
  function money(n) { return n == null ? '—' : Num.toPersian(String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')) + ' ریال'; }

  Modules.treasury = {
    title: 'خزانه‌داری و صندوق',
    icon: '💰',
    render: function (root) {
      root.appendChild(el('h2', null, 'صندوق، پرداخت و خزانه‌داری — فاز ۵'));

      var self = this;
      var accountSel = el('select', 'input');

      // ── اتصال و ورود ──
      var conn = el('div', 'panel');
      conn.appendChild(el('h3', null, 'اتصال به سرور (نقش صندوق‌دار/مدیر/پذیرش)'));
      var baseIn = el('input', 'input'); baseIn.value = apiBase();
      var userIn = el('input', 'input'); userIn.placeholder = 'نام کاربری (مثلاً cashier)';
      var passIn = el('input', 'input'); passIn.type = 'password'; passIn.placeholder = 'گذرواژه';
      var loginBtn = el('button', 'btn btn-primary', 'ورود و ذخیره توکن');
      var connMsg = el('div', 'muted', 'توکن در حافظهٔ مرورگر ذخیره می‌شود.');
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
            connMsg.textContent = '✅ ورود موفق — توکن ذخیره شد.';
            var content = root; content.innerHTML = '';
            self.render(content);
          } else {
            connMsg.textContent = '❌ ورود ناموفق: ' + failText(res);
          }
        });
      };
      root.appendChild(conn);

      // ── موجودی صندوق‌ها ──
      var balPanel = el('div', 'panel');
      balPanel.appendChild(el('h3', null, 'موجودی صندوق‌ها و حساب‌ها'));
      var balHost = el('div');
      var balBtn = el('button', 'btn', 'بارگیری موجودی');
      balPanel.appendChild(balBtn); balPanel.appendChild(balHost);
      balBtn.onclick = function () {
        api('GET', '/treasury/accounts/balances').then(function (res) {
          if (res.status !== 200) { balHost.textContent = failText(res); return; }
          accountSel.innerHTML = '';
          (res.body || []).forEach(function (a) {
            var o = el('option', null, a.code + ' — ' + a.nameFa + ' (' + (a.kind === 'BANK' ? 'بانک' : 'صندوق') + ')');
            o.value = a.id;
            accountSel.appendChild(o);
          });
          balHost.innerHTML = '';
          balHost.appendChild(table(['کد', 'نام', 'نوع', 'حساب کل', 'موجودی'], res.body.map(function (a) {
            return [a.code, a.nameFa, a.kind === 'BANK' ? 'بانک' : 'صندوق', a.glAccountCode, money(a.balanceRials)];
          })));
        });
      };
      root.appendChild(balPanel);

      // ── شیفت صندوق ──
      var shiftPanel = el('div', 'panel');
      shiftPanel.appendChild(el('h3', null, 'شیفت صندوق‌دار (F5-T1)'));
      var floatIn = el('input', 'input'); floatIn.placeholder = 'موجودی ابتدای شیفت (ریال)';
      var dateIn = el('input', 'input'); dateIn.value = today();
      var openBtn = el('button', 'btn btn-primary', 'باز کردن شیفت');
      var closeShiftIn = el('input', 'input'); closeShiftIn.placeholder = 'شناسه شیفت باز';
      var countedIn = el('input', 'input'); countedIn.placeholder = 'شمارش نهایی (ریال)';
      var closeBtn = el('button', 'btn', 'بستن شیفت');
      var shiftMsg = el('div', 'muted');
      shiftPanel.appendChild(row('صندوق', accountSel));
      shiftPanel.appendChild(row('موجودی اول', floatIn));
      shiftPanel.appendChild(row('تاریخ', dateIn));
      shiftPanel.appendChild(openBtn);
      shiftPanel.appendChild(row('شیفت', closeShiftIn));
      shiftPanel.appendChild(row('شمارش', countedIn));
      shiftPanel.appendChild(closeBtn);
      shiftPanel.appendChild(shiftMsg);
      openBtn.onclick = function () {
        api('POST', '/treasury/shifts/open', {
          cashAccountId: accountSel.value,
          openingFloatRials: Number(floatIn.value || 0),
          businessDate: dateIn.value || today(),
        }).then(function (res) {
          if (res.status === 201 || res.status === 200) {
            closeShiftIn.value = res.body.id;
            shiftMsg.textContent = '✅ شیفت باز شد: ' + res.body.code + ' — شناسه در فرم بستن شیفت قرار گرفت.';
          } else shiftMsg.textContent = '❌ ' + failText(res);
        });
      };
      closeBtn.onclick = function () {
        api('POST', '/treasury/shifts/close', {
          shiftId: closeShiftIn.value.trim(),
          countedRials: Number(countedIn.value || 0),
        }).then(function (res) {
          if (res.status === 200 || res.status === 201) {
            shiftMsg.textContent = '✅ شیفت بسته شد — اختلاف مغایرت: ' + money(res.body.varianceRials);
          } else shiftMsg.textContent = '❌ ' + failText(res);
        });
      };
      root.appendChild(shiftPanel);

      // ── ثبت تراکنش ──
      var txnPanel = el('div', 'panel');
      txnPanel.appendChild(el('h3', null, 'ثبت دریافت/پرداخت (F5-T2)'));
      var kindSel = el('select', 'input');
      ['RECEIPT', 'PAYMENT', 'TRANSFER', 'REFUND', 'ADJUSTMENT'].forEach(function (k) {
        var o = el('option', null, { RECEIPT: 'دریافت', PAYMENT: 'پرداخت', TRANSFER: 'دریافت انتقالی', REFUND: 'برگشت وجه', ADJUSTMENT: 'اصلاح' }[k]);
        o.value = k; kindSel.appendChild(o);
      });
      var methodSel = el('select', 'input');
      ['CASH', 'CARD', 'TRANSFER', 'ONLINE'].forEach(function (m) {
        var o = el('option', null, { CASH: 'نقدی', CARD: 'کارت', TRANSFER: 'انتقال بانکی', ONLINE: 'درگاه آنلاین' }[m]);
        o.value = m; methodSel.appendChild(o);
      });
      var amtIn = el('input', 'input'); amtIn.placeholder = 'مبلغ (ریال)';
      var traceIn = el('input', 'input'); traceIn.placeholder = 'شناسه پیگیری (اختیاری)';
      var stayIn = el('input', 'input'); stayIn.placeholder = 'شناسه اقامت برای تسویه فولیو (اختیاری)';
      var counterIn = el('input', 'input'); counterIn.placeholder = 'حساب کل طرف مقابل (اختیاری — پیش‌فرض از قاعده)';
      var txnBtn = el('button', 'btn btn-primary', 'ثبت تراکنش');
      var txnMsg = el('div', 'muted');
      txnPanel.appendChild(row('نوع', kindSel));
      txnPanel.appendChild(row('روش', methodSel));
      txnPanel.appendChild(row('مبلغ', amtIn));
      txnPanel.appendChild(row('پیگیری', traceIn));
      txnPanel.appendChild(row('اقامت', stayIn));
      txnPanel.appendChild(row('حساب مقابل', counterIn));
      txnPanel.appendChild(txnBtn);
      txnPanel.appendChild(txnMsg);
      txnBtn.onclick = function () {
        api('POST', '/treasury/transactions', {
          cashAccountId: accountSel.value,
          kind: kindSel.value,
          method: methodSel.value,
          amountRials: Number(amtIn.value || 0),
          traceNo: traceIn.value.trim() || null,
          counterGlAccountCode: counterIn.value.trim() || null,
          stayId: stayIn.value.trim() || null,
          businessDate: dateIn.value || today(),
          idempotencyKey: 'web-txn-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        }).then(function (res) {
          if (res.status === 201 || res.status === 200) {
            txnMsg.textContent = '✅ ثبت شد: ' + res.body.txnNo + (res.body.replayed ? ' (کلید تکراری — نتیجهٔ قبلی)' : '');
            amtIn.value = ''; traceIn.value = ''; stayIn.value = ''; counterIn.value = '';
          } else txnMsg.textContent = '❌ ' + failText(res);
        });
      };
      root.appendChild(txnPanel);

      // ── فهرست تراکنش‌ها ──
      var listPanel = el('div', 'panel');
      listPanel.appendChild(el('h3', null, 'تراکنش‌های اخیر — با امکان ابطال'));
      var listHost = el('div');
      var listBtn = el('button', 'btn', 'بارگیری تراکنش‌ها');
      listPanel.appendChild(listBtn); listPanel.appendChild(listHost);
      listBtn.onclick = function () {
        api('GET', '/treasury/transactions?limit=15').then(function (res) {
          if (res.status !== 200) { listHost.textContent = failText(res); return; }
          listHost.innerHTML = '';
          var rows = res.body.map(function (t) {
            var tr = el('tr');
            [t.txnNo, t.account, { RECEIPT: 'دریافت', PAYMENT: 'پرداخت', TRANSFER: 'انتقال', REFUND: 'برگشت', ADJUSTMENT: 'اصلاح' }[t.kind],
              t.method, money(t.amountRials), t.status === 'VOID' ? 'ابطال‌شده' : 'قطعی', t.traceNo || '—'].forEach(function (c) {
              tr.appendChild(el('td', null, c));
            });
            var act = el('td');
            if (t.status === 'POSTED') {
              var vb = el('button', 'btn btn-danger', 'ابطال');
              vb.onclick = function () {
                var reason = window.prompt('دلیل ابطال؟');
                if (!reason) return;
                api('POST', '/treasury/transactions/' + t.id + '/void', { reason: reason }).then(function (r2) {
                  listBtn.click();
                });
              };
              act.appendChild(vb);
            }
            tr.appendChild(act);
            return tr;
          });
          var wrap = el('div');
          wrap.style.cssText = 'overflow-x:auto;';
          var t = el('table');
          var thead = el('thead');
          var trh = el('tr');
          ['شماره', 'صندوق', 'نوع', 'روش', 'مبلغ', 'وضعیت', 'پیگیری', ''].forEach(function (h) { trh.appendChild(el('th', null, h)); });
          thead.appendChild(trh);
          var tbody = el('tbody');
          rows.forEach(function (tr) { tbody.appendChild(tr); });
          t.appendChild(thead); t.appendChild(tbody);
          wrap.appendChild(t);
          listHost.appendChild(wrap);
        });
      };
      root.appendChild(listPanel);

      // ── مغایرت‌گیری بانکی ──
      var recPanel = el('div', 'panel');
      recPanel.appendChild(el('h3', null, 'صورت‌حساب بانک و مغایرت‌گیری (F5-T5)'));
      var vDateIn = el('input', 'input'); vDateIn.value = today();
      var refIn = el('input', 'input'); refIn.placeholder = 'شماره سند بانک';
      var descIn = el('input', 'input'); descIn.placeholder = 'شرح';
      var dIn = el('input', 'input'); dIn.placeholder = 'بدهکار (ریال) — برداشت بانک';
      var cIn = el('input', 'input'); cIn.placeholder = 'بستانکار (ریال) — واریز بانک';
      var addLineBtn = el('button', 'btn', 'ورود سطر صورت‌حساب');
      var recDateIn = el('input', 'input'); recDateIn.value = today();
      var recBtn = el('button', 'btn btn-primary', 'اجرای مغایرت‌گیری');
      var recMsg = el('div', 'muted');
      recPanel.appendChild(row('صندوق/بانک', accountSel));
      recPanel.appendChild(row('تاریخ سطر', vDateIn));
      recPanel.appendChild(row('شماره سند', refIn));
      recPanel.appendChild(row('شرح', descIn));
      recPanel.appendChild(row('بدهکار', dIn));
      recPanel.appendChild(row('بستانکار', cIn));
      recPanel.appendChild(addLineBtn);
      recPanel.appendChild(row('تاریخ اجرا', recDateIn));
      recPanel.appendChild(recBtn);
      recPanel.appendChild(recMsg);
      addLineBtn.onclick = function () {
        api('POST', '/treasury/bank-statements', {
          cashAccountId: accountSel.value,
          valueDate: vDateIn.value || today(),
          externalRef: refIn.value.trim(),
          description: descIn.value.trim() || 'بدون شرح',
          debitRials: Number(dIn.value || 0),
          creditRials: Number(cIn.value || 0),
        }).then(function (res) {
          if (res.status === 201 || res.status === 200) {
            recMsg.textContent = '✅ سطر بانک ثبت شد.'; refIn.value = ''; descIn.value = ''; dIn.value = ''; cIn.value = '';
          } else recMsg.textContent = '❌ ' + failText(res);
        });
      };
      recBtn.onclick = function () {
        api('POST', '/treasury/reconciliations/run', {
          cashAccountId: accountSel.value,
          runDate: recDateIn.value || today(),
        }).then(function (res) {
          if (res.status === 201 || res.status === 200) {
            recMsg.textContent = '✅ مغایرت‌گیری: تطبیق‌شده ' + Num.toPersian(res.body.matched) + ' — معلق ' + Num.toPersian(res.body.unmatched) + ' از ' + Num.toPersian(res.body.totalLines);
          } else recMsg.textContent = '❌ ' + failText(res);
        });
      };
      root.appendChild(recPanel);

      balBtn.click();
      listBtn.click();
      Num.fitAll(root);
    },
  };
})(window);
