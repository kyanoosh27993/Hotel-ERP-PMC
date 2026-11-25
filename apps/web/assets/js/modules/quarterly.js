/**
 * modules/quarterly.js — فاز ۹ / F9-T4: معاملات فصلی خارج از سامانه + فایل استاندارد دارایی
 * خلاصهٔ فصل | ثبت دستی | استخراج POS | فایل CSV | بستن فصل با تأیید انسانی (گردش کار) | بازگشایی (مدیر).
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
      return r.arrayBuffer().then(function (buf) {
        var text = new TextDecoder('utf-8').decode(buf);
        try { return { status: r.status, body: JSON.parse(text), raw: text, bytes: new Uint8Array(buf) }; }
        catch (e) { return { status: r.status, body: null, raw: text, bytes: new Uint8Array(buf) }; }
      });
    });
  }

  function failText(res) {
    return (res.body && res.body.error && res.body.error.message) ? res.body.error.message : ('خطای ' + res.status);
  }

  function money(n) { return Number(n || 0).toLocaleString('fa-IR'); }

  function statusBadge(st) {
    var colors = { OPEN: '#0969da', CLOSED: '#1a7f37' };
    var b = el('span', 'pill', st === 'OPEN' ? 'باز' : 'بسته');
    b.style.cssText = 'padding:2px 8px;border-radius:10px;font-size:12px;background:' + (colors[st] || '#6e7781') + '20;color:' + (colors[st] || '#6e7781') + ';';
    return b;
  }

  /** فرم ورود خودِ ماژول — کاربر مالی بدون رفتن به ماژول دیگر وارد می‌شود */
  function connPanel(root, rerender) {
    root.appendChild(App.sessionPanel());
  }

  Modules.quarterly = {
    render: function (content) {
      content.innerHTML = '';
      content.appendChild(el('h2', 'panel-title', 'معاملات فصلی (فاز ۹)'));
      content.appendChild(el('p', 'muted', 'معاملات خارج از مؤدیان (فروش دستی/POS/معاف) به‌ازای هر فصل شمسی + فایل استاندارد اداره دارایی. بستن فصل فقط با تأیید انسانی (گردش کار فاز ۸).'));

      if (!apiToken()) {
        connPanel(content, function () { Modules.quarterly.render(content); });
        return;
      }

      var state = { taxYear: 1405, quarter: 3 };

      // ── انتخاب فصل + خلاصه ──
      var top = el('div', 'panel');
      top.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;';
      var yearInput = el('input'); yearInput.type = 'number'; yearInput.value = state.taxYear; yearInput.style.width = '90px';
      var qSel = el('select');
      ['۱ (بهار)', '۲ (تابستان)', '۳ (پاییز)', '۴ (زمستان)'].forEach(function (label, i) {
        var o = el('option'); o.value = String(i + 1); o.textContent = 'فصل ' + label;
        if (i + 1 === state.quarter) o.selected = true;
        qSel.appendChild(o);
      });
      var loadBtn = el('button', 'btn', 'بارگذاری');
      var summaryBox = el('div');
      summaryBox.style.cssText = 'width:100%;';
      top.appendChild(el('span', '', 'سال:')); top.appendChild(yearInput);
      top.appendChild(qSel); top.appendChild(loadBtn);
      top.appendChild(summaryBox);
      content.appendChild(top);

      function loadSummary() {
        state.taxYear = Number(yearInput.value) || 1405;
        state.quarter = Number(qSel.value) || 3;
        api('GET', '/compliance/quarterly/summary?taxYear=' + state.taxYear + '&quarter=' + state.quarter).then(function (res) {
          summaryBox.innerHTML = '';
          if (res.status !== 200) { summaryBox.appendChild(el('div', 'muted', failText(res))); return; }
          var d = res.body.data;
          var g = el('div');
          g.style.cssText = 'display:flex;gap:16px;flex-wrap:wrap;margin-top:8px;font-size:14px;';
          function card(title, val, vat) {
            var c = el('div');
            c.style.cssText = 'border:1px solid #d0d7de;border-radius:8px;padding:8px 14px;';
            c.appendChild(el('div', 'muted', title));
            c.appendChild(el('div', '', money(val) + ' ریال' + (vat != null ? ' (مالیات ' + money(vat) + ')' : '')));
            return c;
          }
          g.appendChild(card('فروش', d.sale && d.sale.total, d.sale && d.sale.vat));
          g.appendChild(card('خرید', d.purchase && d.purchase.total, d.purchase && d.purchase.vat));
          g.appendChild(card('مالیات خالص فصل', d.netVat));
          var stWrap = el('div'); stWrap.style.cssText = 'display:flex;align-items:center;gap:6px;';
          stWrap.appendChild(el('div', 'muted', 'وضعیت فصل:'));
          stWrap.appendChild(statusBadge(d.status));
          g.appendChild(stWrap);
          summaryBox.appendChild(g);
        });
      }
      loadBtn.onclick = function () { loadSummary(); loadList(); };

      // ── ثبت دستی ──
      var regPanel = el('div', 'panel');
      regPanel.appendChild(el('h3', '', 'ثبت معاملهٔ خارج از سامانه'));
      var form = el('div');
      form.style.cssText = 'display:grid;gap:6px;max-width:560px;';
      var typeSel = el('select');
      ['SALE', 'PURCHASE'].forEach(function (t) { var o = el('option'); o.value = t; o.textContent = t === 'SALE' ? 'فروش' : 'خرید'; typeSel.appendChild(o); });
      var nameIn = el('input'); nameIn.placeholder = 'نام طرف معامله';
      var tinIn = el('input'); tinIn.placeholder = 'شناسهٔ ملی/کد اقتصادی (یا - )';
      /* نیاز یکتایی کارفرما: پیشنهاد زندهٔ طرف‌حساب‌های قبلی با تایپ هر کاراکتر */
      var cpPartyId = '';
      Uniq.suggest(nameIn, {
        onPick: function (p) {
          cpPartyId = p.id;
          nameIn.value = p.displayName || nameIn.value;
          var tin = p.natIdentifier || p.economicCode || p.nationalId || '';
          if (tin) tinIn.value = tin;
          regMsg.style.color = '#8250df';
          regMsg.textContent = '⚠️ این ' + (p.kindFa || 'شخص') + ' قبلاً ثبت شده — اطلاعات قبلی بارگذاری شد؛ ثبت دوباره رکورد انجام نمی‌شود.';
        },
      });
      Uniq.suggest(tinIn, {
        onPick: function (p) {
          cpPartyId = p.id;
          var tin = p.natIdentifier || p.economicCode || p.nationalId || '';
          if (tin) tinIn.value = tin;
          nameIn.value = p.displayName || nameIn.value;
          regMsg.style.color = '#8250df';
          regMsg.textContent = '⚠️ این ' + (p.kindFa || 'شخص') + ' قبلاً ثبت شده — اطلاعات قبلی بارگذاری شد؛ ثبت دوباره رکورد انجام نمی‌شود.';
        },
      });
      var amountIn = el('input'); amountIn.placeholder = 'مبلغ (ریال)';
      var vatIn = el('input'); vatIn.placeholder = 'مالیات (ریال — اختیاری)';
      var dateIn = el('input'); dateIn.placeholder = 'تاریخ میلادی YYYY-MM-DD (داخل بازهٔ فصل)';
      var docRefIn = el('input'); docRefIn.placeholder = 'مرجع سند (اختیاری — یکتا در فصل)';
      var regBtn = el('button', 'btn', 'ثبت');
      var regMsg = el('div', 'muted');
      regBtn.onclick = function () {
        regBtn.disabled = true;
        api('POST', '/compliance/quarterly', {
          taxYear: state.taxYear, quarter: state.quarter, txType: typeSel.value,
          counterpartyName: nameIn.value.trim(), counterpartyTin: tinIn.value.trim() || '-',
          amountRials: amountIn.value.trim(), vatRials: vatIn.value.trim() || undefined,
          txDate: dateIn.value.trim(), docRef: docRefIn.value.trim() || undefined,
        }).then(function (res) {
          regBtn.disabled = false;
          if ([200, 201].includes(res.status)) {
            regMsg.style.color = '#1a7f37'; regMsg.textContent = 'ثبت شد ✓';
            /* نیاز یکتایی کارفرما: طرف معامله در ثبت یکتا هم نگهداری می‌شود (یافتن-یا-ایجاد بی‌صدا) */
            var tin = Uniq.latinDigits(tinIn.value).replace(/\D/g, '');
            var cpPayload = { kind: 'COUNTERPARTY', companyName: nameIn.value.trim() };
            if (tin.length === 11) cpPayload.natIdentifier = tin;
            else if (tin.length >= 12 && tin.length <= 14) cpPayload.economicCode = tin;
            else if (tin.length === 10) cpPayload.nationalId = tin;
            if (nameIn.value.trim()) {
              api('POST', '/parties/ensure', cpPayload).then(function (r2) {
                if (r2.status >= 200 && r2.status < 300 && r2.body.data) cpPartyId = r2.body.data.party.id;
              }).catch(function () { /* ثبت یکتا بی‌صدا — معامله اصلی ثبت شده است */ });
            }
            loadSummary(); loadList();
          } else { regMsg.style.color = '#cf222e'; regMsg.textContent = failText(res); }
        });
      };
      form.appendChild(typeSel); form.appendChild(nameIn); form.appendChild(tinIn);
      form.appendChild(amountIn); form.appendChild(vatIn); form.appendChild(dateIn); form.appendChild(docRefIn);
      form.appendChild(regBtn); form.appendChild(regMsg);
      regPanel.appendChild(form);
      content.appendChild(regPanel);

      // ── اقدام‌های فصل: استخراج POS + فایل + بستن/بازگشایی ──
      var actPanel = el('div', 'panel');
      var actRow = el('div'); actRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;';
      var deriveBtn = el('button', 'btn', 'استخراج خودکار از POS');
      var exportBtn = el('button', 'btn', 'دریافت فایل استاندارد (CSV)');
      var closeBtn = el('button', 'btn', 'درخواست بستن فصل');
      var reopenBtn = el('button', 'btn', 'بازگشایی (مدیر)');
      var actMsg = el('span', 'muted');
      deriveBtn.onclick = function () {
        deriveBtn.disabled = true;
        api('POST', '/compliance/quarterly/derive', { taxYear: state.taxYear, quarter: state.quarter }).then(function (res) {
          deriveBtn.disabled = false;
          actMsg.textContent = [200, 201].includes(res.status)
            ? ('استخراج شد: ' + res.body.data.derived + ' جدید از ' + res.body.data.scanned + ' سفارش')
            : failText(res);
          loadList(); loadSummary();
        });
      };
      exportBtn.onclick = function () {
        api('GET', '/compliance/quarterly/export?taxYear=' + state.taxYear + '&quarter=' + state.quarter).then(function (res) {
          if (res.status !== 200) { actMsg.textContent = failText(res); return; }
          // BOM را روی بایت‌ها بازسازی می‌کنیم (r.text در سرور BOM دارد)
          var blob = new Blob([res.bytes], { type: 'text/csv;charset=utf-8' });
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'quarterly-' + state.taxYear + '-Q' + state.quarter + '.csv';
          a.click();
          actMsg.textContent = 'فایل دانلود شد ✓';
        });
      };
      closeBtn.onclick = function () {
        closeBtn.disabled = true;
        api('POST', '/compliance/quarterly/close', { taxYear: state.taxYear, quarter: state.quarter }).then(function (res) {
          closeBtn.disabled = false;
          actMsg.textContent = [200, 201].includes(res.status)
            ? 'نمونهٔ تأیید ساخته شد — تا تأییدکننده تأیید کند فصل باز می‌ماند.'
            : failText(res);
          loadSummary();
        });
      };
      reopenBtn.onclick = function () {
        reopenBtn.disabled = true;
        api('POST', '/compliance/quarterly/reopen', { taxYear: state.taxYear, quarter: state.quarter }).then(function (res) {
          reopenBtn.disabled = false;
          actMsg.textContent = [200, 201].includes(res.status) ? 'فصل بازگشایی شد ✓' : failText(res);
          loadSummary(); loadList();
        });
      };
      actRow.appendChild(deriveBtn); actRow.appendChild(exportBtn);
      actRow.appendChild(closeBtn); actRow.appendChild(reopenBtn); actRow.appendChild(actMsg);
      actPanel.appendChild(actRow);
      content.appendChild(actPanel);

      // ── لیست معاملات ──
      var listPanel = el('div', 'panel');
      listPanel.appendChild(el('h3', '', 'معاملات فصل'));
      var listBody = el('div');
      listPanel.appendChild(listBody);
      content.appendChild(listPanel);

      function loadList() {
        api('GET', '/compliance/quarterly?taxYear=' + state.taxYear + '&quarter=' + state.quarter).then(function (res) {
          listBody.innerHTML = '';
          if (res.status !== 200) { listBody.appendChild(el('div', 'muted', failText(res))); return; }
          var rows = res.body.data || [];
          if (!rows.length) { listBody.appendChild(el('div', 'muted', 'معامله‌ای برای این فصل ثبت نشده است.')); return; }
          var tbl = el('table'); tbl.className = 'data-table';
          tbl.innerHTML = '<thead><tr><th>نوع</th><th>طرف معامله</th><th>شناسه</th><th>مبلغ (ریال)</th><th>مالیات</th><th>تاریخ</th><th>منبع</th><th>مرجع</th></tr></thead>';
          var tb = el('tbody');
          rows.forEach(function (r) {
            var tr = el('tr');
            tr.innerHTML = '<td>' + (r.txType === 'SALE' ? 'فروش' : 'خرید') + '</td><td>' + r.counterpartyName + '</td><td>' + r.counterpartyTin + '</td>' +
              '<td>' + money(r.amountRials) + '</td><td>' + money(r.vatRials) + '</td><td>' + r.txDate.slice(0, 10) + '</td>' +
              '<td>' + (r.sourceType === 'POS' ? 'POS' : 'دستی') + '</td><td>' + r.docRef + '</td>';
            tb.appendChild(tr);
          });
          tbl.appendChild(tb);
          var wrap = el('div'); wrap.style.cssText = 'overflow-x:auto;'; wrap.appendChild(tbl);
          listBody.appendChild(wrap);
        });
      }
      loadList();

      // ── اظهارنامهٔ ارزش افزوده (F9-T3) — از اسناد قطعی، حساب‌های ۲۲۰۱/۲۲۰۴ ──
      var vatPanel = el('div', 'panel');
      vatPanel.appendChild(el('h3', '', 'اظهارنامهٔ ارزش افزوده (F9-T3)'));
      vatPanel.appendChild(el('p', 'muted', 'محاسبهٔ مالیات فروش (بستانکار ۲۲۰۱)، اعتبار خرید (بدهکار ۲۲۰۴) و خالص پرداختنی از اسناد قطعی بازهٔ انتخابی — مرجع: مادهٔ ۱۷ قانون مالیات بر ارزش افزوده (LAW-VAT-RATE).'));
      var vatRow = el('div'); vatRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;';
      function mkDate(v) { var i = el('input'); i.type = 'date'; i.value = v; return i; }
      var vatFrom = mkDate(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString().slice(0, 10));
      var vatTo = mkDate(new Date().toISOString().slice(0, 10));
      var vatBtn = el('button', 'btn btn-primary', 'محاسبهٔ اظهارنامه');
      var vatOut = el('div'); var vatMsg = el('div', 'muted');
      vatRow.appendChild(vatFrom); vatRow.appendChild(vatTo); vatRow.appendChild(vatBtn);
      vatPanel.appendChild(vatRow);
      vatPanel.appendChild(vatOut);
      vatPanel.appendChild(vatMsg);
      vatBtn.onclick = function () {
        api('GET', '/compliance/vat/declaration?from=' + vatFrom.value + '&to=' + vatTo.value).then(function (res) {
          if (res.status !== 200) { vatMsg.textContent = '❌ ' + failText(res); return; }
          var d = res.body.data;
          vatOut.innerHTML = '';
          var kv = el('div'); kv.style.cssText = 'display:flex;gap:16px;flex-wrap:wrap;margin:8px 0;';
          function card(title, v, hot) {
            var c = el('div'); c.style.cssText = 'border:1px solid #d0d7de;border-radius:8px;padding:10px 14px;min-width:180px;';
            c.appendChild(el('div', 'muted', title));
            var n = el('div', null, money(v) + ' ریال');
            n.style.cssText = 'font-size:18px;font-weight:600;color:' + (hot ? '#cf222e' : '#1a7f37') + ';';
            c.appendChild(n);
            return c;
          }
          kv.appendChild(card('مالیات فروش (۲۲۰۱)', d.outputVatRials, false));
          kv.appendChild(card('اعتبار خرید (۲۲۰۴)', d.inputVatCreditRials, false));
          kv.appendChild(card('خالص پرداختنی', d.netPayableRials, true));
          kv.appendChild(card('پایهٔ مالیاتی', d.taxBaseRials, false));
          vatOut.appendChild(kv);
          if ((d.sections || []).length) {
            var tbl = el('table');
            var tb = el('tbody');
            var trh = el('tr');
            ['مرکز هزینه', 'پایهٔ مالیاتی', 'مالیات'].forEach(function (h) { var th = el('th'); th.textContent = h; trh.appendChild(th); });
            tb.appendChild(trh);
            d.sections.forEach(function (s) {
              var tr = el('tr');
              [s.costCenterCode, money(s.taxBase), money(s.vat)].forEach(function (v) { var td = el('td'); td.textContent = v; tr.appendChild(td); });
              tb.appendChild(tr);
            });
            tbl.appendChild(tb);
            var wrap = el('div'); wrap.style.cssText = 'overflow-x:auto;'; wrap.appendChild(tbl);
            vatOut.appendChild(wrap);
          } else vatOut.appendChild(el('p', 'muted', 'در این بازه سطری با مالیات ثبت نشده است.'));
          vatMsg.textContent = '✅ محاسبه از اسناد قطعی — ارسال اظهارنامه به سامانهٔ مالیاتی خارج از این سامانه است.';
        });
      };
      content.appendChild(vatPanel);
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
