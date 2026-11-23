/**
 * modules/moadian.js — فاز ۹ / F9-T2: صورتحساب الکترونیکی مؤدیان
 * تولید از سند فروش | لیست صورتحساب‌ها با وضعیت/uid | لغو/استورنو.
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
      return r.json().then(function (j) { return { status: r.status, body: j }; }).catch(function () { return { status: r.status, body: null }; });
    });
  }

  function failText(res) {
    return (res.body && res.body.error && res.body.error.message) ? res.body.error.message : ('خطای ' + res.status);
  }

  function fmtRials(s) {
    try { return Num.toPersian(String(s).replace(/\B(?=(\d{3})+(?!\d))/g, ',')); } catch (e) { return String(s); }
  }

  function statusBadge(st) {
    var map = {
      DRAFT: '٫', QUEUED: '⏳', SENT: '↗', ACCEPTED: '✓', REJECTED: '✗', CANCELLED: '⊘',
    };
    var colors = { ACCEPTED: '#1a7f37', CANCELLED: '#b35900', REJECTED: '#cf222e', QUEUED: '#0969da', SENT: '#0969da', DRAFT: '#6e7781' };
    var b = el('span', 'pill', (map[st] || '؟') + ' ' + st);
    b.style.cssText = 'padding:2px 8px;border-radius:10px;font-size:12px;background:' + (colors[st] || '#6e7781') + '20;color:' + (colors[st] || '#6e7781') + ';';
    return b;
  }

  Modules.moadian = {
    render: function (content) {
      content.innerHTML = '';
      content.appendChild(el('h2', 'panel-title', 'صورتحساب الکترونیکی مؤدیان (فاز ۹)'));
      content.appendChild(el('p', 'muted', 'تولید صورتحساب از سند فروش قطعی، ارسال به سندباکس مؤدیان، پیگیری وضعیت و لغو/استورنو. ارسال مالیاتی هرگز بدون تأیید انسانی نیست.'));

      if (!apiToken()) {
        var warn = el('div', 'panel', '');
        warn.appendChild(el('div', '', 'برای استفاده ابتدا با نقش حسابدار/تأییدکننده/مدیر وارد شوید (توکن در حافظهٔ مرورگر).'));
        content.appendChild(warn);
        return;
      }

      // ── فرم تولید از سند فروش ──
      var gen = el('div', 'panel');
      gen.appendChild(el('h3', '', 'تولید صورتحساب از سند فروش قطعی'));
      var entryInput = el('input'); entryInput.placeholder = 'شناسهٔ سند حسابداری (UUID)';
      var buyerTaxInput = el('input'); buyerTaxInput.placeholder = 'شناسهٔ مالیاتی خریدار (۱۱ رقمی)';
      var buyerNameInput = el('input'); buyerNameInput.placeholder = 'نام خریدار';
      var genBtn = el('button', 'btn', 'تولید و در صف ارسال');
      var genMsg = el('div', 'muted');
      genBtn.onclick = function () {
        if (!entryInput.value.trim()) { genMsg.textContent = 'شناسهٔ سند الزامی است'; genMsg.style.color = '#cf222e'; return; }
        genBtn.disabled = true;
        api('POST', '/compliance/moadian/invoices', {
          journalEntryId: entryInput.value.trim(),
          buyerTaxId: buyerTaxInput.value.trim(),
          buyerName: buyerNameInput.value.trim(),
        }).then(function (res) {
          genBtn.disabled = false;
          if (res.status === 201) {
            var d = res.body.data;
            genMsg.style.color = '#1a7f37';
            genMsg.textContent = 'صورتحساب ' + d.invoiceNumber + ' تولید و در صف ارسال گذاشته شد (وضعیت: ' + d.status + ').';
            entryInput.value = ''; buyerTaxInput.value = ''; buyerNameInput.value = '';
            loadList();
          } else {
            genMsg.style.color = '#cf222e';
            genMsg.textContent = failText(res);
          }
        });
      };
      var form = el('div');
      form.style.cssText = 'display:grid;grid-template-columns:1fr;gap:6px;max-width:520px;';
      form.appendChild(entryInput); form.appendChild(buyerTaxInput); form.appendChild(buyerNameInput);
      form.appendChild(genBtn);
      gen.appendChild(form); gen.appendChild(genMsg);
      content.appendChild(gen);

      // ── فیلتر + لیست ──
      var listPanel = el('div', 'panel');
      listPanel.appendChild(el('h3', '', 'صورتحساب‌ها'));
      var filterRow = el('div');
      filterRow.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px;';
      var sel = el('select');
      ['', 'QUEUED', 'ACCEPTED', 'REJECTED', 'CANCELLED'].forEach(function (s) {
        var o = el('option'); o.value = s; o.textContent = s || 'همه'; sel.appendChild(o);
      });
      var loadBtn = el('button', 'btn', 'بارگذاری');
      var listBody = el('div');
      loadBtn.onclick = loadList;
      filterRow.appendChild(el('span', '', 'وضعیت:')); filterRow.appendChild(sel); filterRow.appendChild(loadBtn);
      listPanel.appendChild(filterRow); listPanel.appendChild(listBody);
      content.appendChild(listPanel);

      function loadList() {
        var q = sel.value ? ('?status=' + sel.value) : '';
        api('GET', '/compliance/moadian/invoices' + q).then(function (res) {
          listBody.innerHTML = '';
          if (res.status !== 200) { listBody.appendChild(el('div', 'muted', failText(res))); return; }
          var rows = res.body.data || [];
          if (!rows.length) { listBody.appendChild(el('div', 'muted', 'صورتحسابی نیست.')); return; }
          var tbl = el('table'); tbl.className = 'data-table';
          tbl.innerHTML = '<thead><tr><th>شماره</th><th>تاریخ</th><th>خریدار</th><th>مجموع</th><th>VAT</th><th>وضعیت</th><th>uid</th><th>عملیات</th></tr></thead>';
          var tb = el('tbody');
          rows.forEach(function (r) {
            var tr = el('tr');
            tr.innerHTML = '<td>' + r.invoiceNumber + '</td><td>' + r.issueDate + '</td><td>' + (r.buyerName || '—') + '</td>' +
              '<td>' + fmtRials(r.totalRials) + '</td><td>' + fmtRials(r.vatRials) + '</td><td></td>' +
              '<td>' + (r.uid ? r.uid.slice(0, 12) + '…' : '—') + '</td><td></td>';
            var stCell = tr.children[5]; stCell.appendChild(statusBadge(r.status));
            var actCell = tr.children[7]; actCell.style.whiteSpace = 'nowrap';
            if (r.status === 'ACCEPTED') {
              var cancelBtn = el('button', 'btn btn-sm', 'لغو');
              cancelBtn.style.marginRight = '4px';
              cancelBtn.onclick = function () {
                var reason = window.prompt('دلیل لغو صورتحساب ' + r.invoiceNumber + ' (اجباری):');
                if (!reason || !reason.trim()) return;
                api('POST', '/compliance/moadian/invoices/' + r.id + '/cancel', { reason: reason }).then(function (res2) {
                  if ([200, 201].includes(res2.status)) loadList();
                  else window.alert(failText(res2));
                });
              };
              actCell.appendChild(cancelBtn);
            } else if (r.status === 'QUEUED' || r.status === 'REJECTED') {
              var retryBtn = el('button', 'btn btn-sm', 'تلاش مجدد');
              retryBtn.onclick = function () {
                api('POST', '/compliance/moadian/invoices/' + r.id + '/retry').then(function (res2) {
                  if ([200, 201].includes(res2.status)) loadList();
                  else window.alert(failText(res2));
                });
              };
              actCell.appendChild(retryBtn);
            }
            tb.appendChild(tr);
          });
          tbl.appendChild(tb);
          var wrap = el('div'); wrap.style.cssText = 'overflow-x:auto;'; wrap.appendChild(tbl);
          listBody.appendChild(wrap);
        });
      }
      loadList();
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
