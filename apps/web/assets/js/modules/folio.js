/**
 * modules/folio.js — فاز R4 بر اساس 4.zip (دو صفحهٔ واقعی مرجع):
 *  ۱) «ثبت اقلام اضافی اتاق» (Room Additional Items) — چارج اتاق به فولیو اقامت باز
 *  ۲) «لیست صورتحساب‌های باز مهمان» (Open Invoices Guests List) + پرینت فاکتور + تسویه/چک‌اوت
 * API: GET /pms/stays?status=OPEN، POST /pms/stays/:id/folio-items، GET /pms/folios/open، POST /pms/stays/:id/check-out
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
  function failText(res) {
    return (res.body && res.body.error && res.body.error.message) ? res.body.error.message : ('خطای ' + res.status);
  }
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }
  function rial(x) { return Num.toPersian(Number(x || 0).toLocaleString('en-US')); }

  /* کاتالوگ اقلام اضافی — الگوی مرجع؛ قیمت‌ها پیش‌فرض و قابل ویرایش؛ rev = کد درآمدی پلان (v3.4) */
  var CATALOG = [
    { desc: 'میان‌وعده', unit: 250000, rev: 'سرویس اتاق' },
    { desc: 'ناهار', unit: 450000, rev: 'ناهار' },
    { desc: 'شام', unit: 550000, rev: 'شام' },
    { desc: 'لاندری (شست‌وشو)', unit: 200000, rev: 'درآمد لاندری' },
    { desc: 'مینی‌بار', unit: 150000, rev: 'مینی بار' },
    { desc: 'اینترنت پرسرعت', unit: 100000, rev: 'اینترنت' },
    { desc: 'تلفن بین‌الملل', unit: 500000, rev: 'تلفن هتل' },
    { desc: 'تاکسی سرویس', unit: 300000, rev: 'ترانسفر' },
    { desc: 'خسارت تجهیزات', unit: 800000, rev: 'عوارض خسارت' },
    { desc: 'نوشیدنی اتاق', unit: 120000, rev: 'مینی بار' },
  ];
  var REV_CODES = []; /* از سرور پر می‌شود: {id, code, nameFa} */
  function revIdFor(desc) {
    var item = CATALOG.filter(function (x) { return x.desc === desc; })[0];
    if (!item) return undefined;
    var rc = REV_CODES.filter(function (c) { return c.nameFa === item.rev; })[0];
    return rc ? rc.id : undefined;
  }

  global.Modules = global.Modules || {};

  global.Modules.folio = {
    render: function (root) {
      fetch((localStorage.getItem('hotel-erp-api-base') || 'http://localhost:3000/api/v1') + '/pms/revenue-codes', { headers: { Authorization: 'Bearer ' + (localStorage.getItem('hotel-erp-token') || '') } })
        .then(function (r) { return r.json(); })
        .then(function (j) { REV_CODES = (j.data || []).filter(function (c) { return c.isActive !== false; }); })
        .catch(function () {});
      root.innerHTML = '';
      var wrap = el('div', 'fo-wrap');
      var err = el('p', 'fo-err');
      var okMsg = el('p', 'fo-ok');

      /* ── پنل ۱: ثبت اقلام اضافی اتاق ── */
      var addBox = el('fieldset', 'fo-box');
      addBox.appendChild(el('legend', null, '🛎 ثبت اقلام اضافی اتاق (Room Additional Items)'));
      var addRow = el('div', 'fo-form-row');
      var staySel = el('select');
      staySel.appendChild(new Option('— انتخاب مهمان مقیم —', ''));
      var itemSel = el('select');
      CATALOG.forEach(function (c, i) { itemSel.appendChild(new Option(c.desc, String(i))); });
      var qtyInp = el('input'); qtyInp.type = 'number'; qtyInp.min = '1'; qtyInp.max = '999'; qtyInp.value = '1';
      var unitInp = el('input'); unitInp.type = 'number'; unitInp.min = '0'; unitInp.step = '1000'; unitInp.value = String(CATALOG[0].unit);
      var addBtn = el('button', 'submitbtn fo-add-btn', 'ثبت به حساب مهمان');
      addRow.appendChild(staySel);
      addRow.appendChild(itemSel);
      addRow.appendChild(qtyInp);
      addRow.appendChild(unitInp);
      addRow.appendChild(addBtn);
      addBox.appendChild(addRow);
      addBox.appendChild(el('p', 'muted fo-hint', 'قلم و تعداد و مبلغ واحد (ریال) — مبلغ با ثبت، به فولیو مهمان اضافه و در خروج تسویه می‌شود.'));
      wrap.appendChild(addBox);

      /* ── پنل ۲: لیست صورتحساب‌های باز ── */
      var listBox = el('fieldset', 'fo-box');
      listBox.appendChild(el('legend', null, '📄 لیست صورتحساب‌های باز مهمان (Open Invoices Guests List)'));
      var refreshRow = el('div', 'fo-form-row');
      var refreshBtn = el('button', 'rr-tool-btn', '↻ بازخوانی');
      refreshRow.appendChild(refreshBtn);
      listBox.appendChild(refreshRow);
      var listArea = el('div', 'fo-list');
      listBox.appendChild(listArea);
      wrap.appendChild(listBox);

      wrap.appendChild(err);
      wrap.appendChild(okMsg);
      root.appendChild(wrap);

      var openFolios = [];

      function ok(text) {
        okMsg.textContent = '✅ ' + text;
        setTimeout(function () { okMsg.textContent = ''; }, 5000);
      }

      itemSel.onchange = function () {
        unitInp.value = String(CATALOG[Number(itemSel.value)].unit);
      };

      addBtn.onclick = function () {
        err.textContent = '';
        if (!staySel.value) { err.textContent = 'اول مهمان مقیم را انتخاب کنید.'; return; }
        var qty = parseInt(qtyInp.value, 10) || 0;
        if (qty < 1) { err.textContent = 'تعداد باید حداقل ۱ باشد.'; return; }
        api('POST', '/pms/stays/' + staySel.value + '/folio-items', {
          desc: CATALOG[Number(itemSel.value)].desc,
          qty: qty,
          unitRials: String(parseInt(unitInp.value, 10) || 0),
          revenueCodeId: revIdFor(CATALOG[Number(itemSel.value)].desc),
        }).then(function (res) {
          if (res.status >= 200 && res.status < 300) {
            ok('قلم «' + CATALOG[Number(itemSel.value)].desc + '» به فولیو اضافه شد.');
            loadAll();
          } else err.textContent = failText(res);
        }).catch(function (e) { err.textContent = 'خطای شبکه: ' + e.message; });
      };

      /* پرینت فاکتور فولیو */
      function printInvoice(folioId) {
        api('GET', '/pms/stays/' + folioId + '/folio-items').then(function (res) {
          if (res.status >= 300) { err.textContent = failText(res); return; }
          var d = res.body.data;
          var w = window.open('', '_blank');
          if (!w) { err.textContent = 'پنجرهٔ چاپ بسته شد — اجازهٔ popup بدهید.'; return; }
          var rows = d.items.map(function (it) {
            return '<tr><td>' + it.desc + '</td><td>' + Num.toPersian(it.qty) + '</td><td>' + rial(it.unitRials) + '</td><td>' + rial(it.totalRials) + '</td></tr>';
          }).join('');
          w.document.write(
            '<html dir="rtl"><head><title>صورتحساب ' + d.stay.code + '</title>' +
            '<style>body{font-family:Vazirmatn,Tahoma,sans-serif;padding:24px}h2{color:#b91c1c}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #94a3b8;padding:6px 10px;text-align:center}th{background:#dbe7fa}tfoot td{font-weight:800;background:#f1f5f9}</style></head><body>' +
            '<h2>صورتحساب مهمان — فولیو ' + Num.toPersian(d.stay.code) + '</h2>' +
            '<p>مهمان: <b>' + d.stay.guestName + '</b> — اتاق(ها): <b>' + d.stay.rooms.join('، ') + '</b> — وضعیت: ' + (d.stay.status === 'OPEN' ? 'باز' : 'تسویه‌شده') + '</p>' +
            '<table><thead><tr><th>شرح</th><th>تعداد</th><th>مبلغ واحد (ریال)</th><th>جمع (ریال)</th></tr></thead><tbody>' + rows + '</tbody>' +
            '<tfoot><tr><td colspan="3">جمع کل فولیو</td><td>' + rial(d.folioRials) + '</td></tr></tfoot></table>' +
            '<p style="margin-top:30px;font-size:.9rem">امضای مهمان: ...................... — امضای پذیرش: ......................</p>' +
            '<script>setTimeout(function(){window.print()},400)<\/script>' +
            '</body></html>');
          w.document.close();
        });
      }

      function expandItems(folioId, area) {
        api('GET', '/pms/stays/' + folioId + '/folio-items').then(function (res) {
          if (res.status >= 300) { err.textContent = failText(res); return; }
          var d = res.body.data;
          area.innerHTML = '';
          if (!d.items.length) {
            area.appendChild(el('p', 'muted', 'هنوز قلمی ثبت نشده — جمع فولیو از شارژ شبانه می‌آید.'));
            return;
          }
          d.items.forEach(function (it) {
            var line = el('div', 'fo-item-line');
            var sideFa = it.chargeTo === 'COMPANY' ? ' [تور/شرکت]' : '';
            line.textContent = it.desc + ' × ' + Num.toPersian(it.qty) + ' = ' + rial(it.totalRials) + ' ریال' +
              (it.revenueCode ? ' (کد ' + Num.toPersian(String(it.revenueCode.code)) + ')' : '') + sideFa;
            area.appendChild(line);
          });
        });
      }

      function renderList() {
        listArea.innerHTML = '';
        if (!openFolios.length) {
          listArea.appendChild(el('p', 'muted', 'مقیم بازی وجود ندارد — همهٔ اقامت‌ها تسویه شده‌اند.'));
          return;
        }
        var t = el('table', 'fo-table');
        t.innerHTML = '<thead><tr><th>اتاق</th><th>مهمان</th><th>ورود</th><th>خروج برنامه‌ای</th><th>اقلام</th><th>جمع فولیو (ریال)</th><th>عملیات</th></tr></thead>';
        var tb = el('tbody');
        openFolios.forEach(function (f) {
          var tr = el('tr');
          tr.appendChild(el('td', null, Num.toPersian(f.rooms.join('، '))));
          tr.appendChild(el('td', null, f.guestName));
          tr.appendChild(el('td', null, Num.toPersian(Jalali.fromDate(new Date(f.checkInAt)))));
          tr.appendChild(el('td', null, Num.toPersian(Jalali.fromDate(new Date(f.plannedCheckOut + 'T00:00:00Z')))));
          tr.appendChild(el('td', null, Num.toPersian(f.itemsCount) + (f.lastItem ? ' — آخرین: ' + f.lastItem : '')));
          tr.appendChild(el('td', 'fo-amount', rial(f.folioRials)));
          var ops = el('td');
          var itemsBtn = el('button', 'rs-mini-btn', 'اقلام');
          var area = el('div', 'fo-expand');
          itemsBtn.onclick = function () {
            if (area.hidden) { expandItems(f.id, area); area.hidden = false; }
            else area.hidden = true;
          };
          ops.appendChild(itemsBtn);
          var printBtn = el('button', 'rs-mini-btn', '🖨 پرینت');
          printBtn.onclick = function () { printInvoice(f.id); };
          ops.appendChild(printBtn);
          var outBtn = el('button', 'rs-mini-btn fo-out-btn', 'تسویه و خروج');
          outBtn.onclick = function () {
            if (!confirm('تسویه و چک‌اوت ' + f.guestName + ' (اتاق ' + f.rooms.join('، ') + ') با جمع فولیو ' + rial(f.folioRials) + ' ریال؟')) return;
            api('POST', '/pms/stays/' + f.id + '/check-out').then(function (res) {
              if (res.status >= 200 && res.status < 300) { ok('مهمان خروج گرفت — اتاق آزاد و به وضعیت نظافت رفت.'); loadAll(); }
              else err.textContent = failText(res);
            });
          };
          ops.appendChild(outBtn);
          tr.appendChild(ops);
          tb.appendChild(tr);
          var wrapTr = el('tr');
          var wrapTd = el('td');
          wrapTd.colSpan = 7;
          wrapTd.appendChild(area);
          area.hidden = true;
          wrapTr.appendChild(wrapTd);
          tb.appendChild(wrapTr);
        });
        t.appendChild(tb);
        listArea.appendChild(t);
      }

      function loadAll() {
        err.textContent = '';
        listArea.innerHTML = '';
        listArea.appendChild(el('p', 'muted', 'در حال بارگذاری…'));
        Promise.all([
          api('GET', '/pms/stays?status=OPEN'),
          api('GET', '/pms/folios/open'),
        ]).then(function (all) {
          if (all[0].status >= 300) throw new Error(failText(all[0]));
          if (all[1].status >= 300) throw new Error(failText(all[1]));
          var stays = all[0].body.data || [];
          staySel.innerHTML = '';
          staySel.appendChild(new Option('— انتخاب مهمان مقیم —', ''));
          stays.forEach(function (s) {
            staySel.appendChild(new Option('اتاق ' + s.rooms.join('، ') + ' — ' + s.guestName, s.id));
          });
          openFolios = all[1].body.data || [];
          renderList();
        }).catch(function (e) {
          listArea.innerHTML = '';
          listArea.appendChild(el('p', 'muted', 'اتصال به سرور برقرار نیست — فولیو به API نیاز دارد (' + e.message + ').'));
        });
      }

      refreshBtn.onclick = loadAll;
      loadAll();
    },
  };
})(window);
