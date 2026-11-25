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

      // ── فروشندگان — ثبت یکتا (نیاز کارفرما): جستجوی زنده + اصلاح رکورد قبلی، ثبت دوباره ممنوع ──
      var supPanel = el('div', 'panel');
      supPanel.appendChild(el('h3', null, 'فروشندگان — ثبت یکتا (شخص حقوقی: شناسهٔ ملی و کد اقتصادی الزامی)'));
      var supSearch = el('input', 'input'); supSearch.placeholder = 'جستجوی زندهٔ فروشنده/شخص قبلی… (نام، شناسه ملی، کد اقتصادی، موبایل)';
      var supBanner = el('div', 'uniq-banner');
      supBanner.style.display = 'none';
      var sNameFa = el('input', 'input'); sNameFa.placeholder = 'نام فروشنده (فارسی) *';
      var sNameEn = el('input', 'input'); sNameEn.placeholder = 'نام لاتین *';
      var sNatId = el('input', 'input'); sNatId.placeholder = 'شناسهٔ ملی (۱۱ رقم) *'; sNatId.dir = 'ltr';
      var sEcon = el('input', 'input'); sEcon.placeholder = 'کد اقتصادی (۱۱ تا ۱۴ رقم) *'; sEcon.dir = 'ltr';
      var sMobile = el('input', 'input'); sMobile.placeholder = 'موبایل'; sMobile.dir = 'ltr';
      var sPhone = el('input', 'input'); sPhone.placeholder = 'تلفن'; sPhone.dir = 'ltr';
      var sPostal = el('input', 'input'); sPostal.placeholder = 'کد پستی (۱۰ رقم)'; sPostal.dir = 'ltr';
      var sAddr = el('input', 'input'); sAddr.placeholder = 'آدرس';
      var supSave = el('button', 'btn btn-primary', 'ثبت فروشنده جدید');
      var supMsg = el('div', 'muted');
      var supPartyId = '';
      var supList = el('div');

      function resetSupParty() {
        supPartyId = '';
        supBanner.style.display = 'none';
        supSave.textContent = 'ثبت فروشنده جدید';
      }
      function loadSupParty(p) {
        supPartyId = p.id;
        sNameFa.value = p.companyName || p.displayName || sNameFa.value;
        sNameEn.value = sNameEn.value || (p.companyName || '');
        sNatId.value = p.natIdentifier || '';
        sEcon.value = p.economicCode || '';
        sMobile.value = p.mobile || '';
        sPhone.value = p.phone || '';
        sPostal.value = p.postalCode || '';
        sAddr.value = p.address || '';
        supBanner.className = 'uniq-banner';
        supBanner.textContent = '⚠️ این ' + (p.kindFa || Uniq.KIND_FA[p.kind] || 'فروشنده') +
          ' قبلاً ثبت شده است (' + Uniq.displayName(p) + ') — اطلاعات قبلی بارگذاری شد؛ فقط «ثبت تغییرات رکورد موجود» مجاز است.';
        supBanner.style.display = 'block';
        supSave.textContent = 'ثبت تغییرات رکورد موجود';
      }
      Uniq.suggest(supSearch, { onPick: loadSupParty });
      [sNatId, sEcon, sPostal].forEach(function (inp) {
        inp.addEventListener('change', function () {
          var v = Uniq.latinDigits(inp.value).replace(/\D/g, '');
          var fn = inp === sNatId ? Uniq.legalIdOk : (inp === sEcon ? Uniq.econOk : Uniq.postalOk);
          if (!v || fn(v)) { inp.style.borderColor = ''; return; }
          inp.style.borderColor = '#cf222e';
        });
      });

      function loadSuppliers() {
        return api('GET', '/procurement/suppliers').then(function (res) {
          if (res.status !== 200 || !Array.isArray(res.body)) { supList.textContent = failText(res); return; }
          supList.innerHTML = '';
          if (!res.body.length) { supList.appendChild(el('div', 'muted', 'فروشنده‌ای ثبت نشده است.')); return; }
          var tbl = tableOf(['کد', 'نام', 'موبایل/تلفن', ''], res.body.map(function (s) {
            var tr = document.createElement('tr');
            [s.code, s.nameFa, s.phone || '—', ''].forEach(function (c) { var td = el('td', null, c); tr.appendChild(td); });
            var editBtn = el('button', 'btn', 'اصلاح');
            editBtn.onclick = function () {
              resetSupParty();
              sNameFa.value = s.nameFa; sNameEn.value = s.nameEn || s.nameFa; sPhone.value = s.phone || '';
              if (s.partyId) {
                api('GET', '/parties/' + s.partyId).then(function (r2) {
                  if (r2.status === 200 && r2.body.data) loadSupParty(r2.body.data);
                });
              }
            };
            tr.lastChild.appendChild(editBtn);
            return tr;
          }));
          supList.appendChild(tbl);
        });
      }

      supSave.onclick = function () {
        supMsg.textContent = '';
        var natId = Uniq.latinDigits(sNatId.value).replace(/\D/g, '');
        var econ = Uniq.latinDigits(sEcon.value).replace(/\D/g, '');
        var post = Uniq.latinDigits(sPostal.value).replace(/\D/g, '');
        if (!sNameFa.value.trim() || !sNameEn.value.trim()) { supMsg.textContent = '❌ نام فارسی و لاتین فروشنده الزامی است.'; return; }
        if (!Uniq.legalIdOk(natId)) { supMsg.textContent = '❌ شناسهٔ ملی نامعتبر است — باید ۱۱ رقم با رقم کنترل صحیح باشد.'; sNatId.focus(); return; }
        if (!Uniq.econOk(econ)) { supMsg.textContent = '❌ کد اقتصادی باید ۱۱ تا ۱۴ رقم باشد.'; sEcon.focus(); return; }
        if (post && !Uniq.postalOk(post)) { supMsg.textContent = '❌ کد پستی باید ۱۰ رقم معتبر باشد.'; sPostal.focus(); return; }
        var payload = {
          kind: 'SUPPLIER',
          companyName: sNameFa.value.trim(),
          natIdentifier: natId,
          economicCode: econ,
          mobile: Uniq.latinDigits(sMobile.value).replace(/\D/g, '') || undefined,
          phone: sPhone.value.trim() || undefined,
          postalCode: post || undefined,
          address: sAddr.value.trim() || undefined,
        };
        function syncSupplier(party) {
          return api('GET', '/procurement/suppliers').then(function (res) {
            var rows = (res.status === 200 && Array.isArray(res.body)) ? res.body : [];
            var linked = rows.find(function (s) { return s.partyId === party.id; });
            var supBody = { code: linked ? linked.code : 'SUP-' + Date.now().toString(36).slice(-6).toUpperCase(), nameEn: sNameEn.value.trim(), nameFa: sNameFa.value.trim(), phone: sPhone.value.trim() || null, partyId: party.id };
            var call = linked
              ? api('PATCH', '/procurement/suppliers/' + linked.code, supBody)
              : api('POST', '/procurement/suppliers', supBody);
            return call.then(function (r2) {
              if (r2.status >= 200 && r2.status < 300) {
                supMsg.textContent = '✅ اطلاعات فروشنده ذخیره شد (' + (supPartyId ? 'اصلاح رکورد موجود' : 'ثبت جدید') + ') — کد تأمین‌کننده: ' + r2.body.code;
                resetSupParty();
                supSearch.value = ''; sNameFa.value = ''; sNameEn.value = ''; sNatId.value = ''; sEcon.value = '';
                sMobile.value = ''; sPhone.value = ''; sPostal.value = ''; sAddr.value = '';
                loadSuppliers();
              } else supMsg.textContent = '❌ ' + failText(r2);
            });
          });
        }
        if (supPartyId) {
          api('PATCH', '/parties/' + supPartyId, payload).then(function (res) {
            if (res.status >= 200 && res.status < 300) syncSupplier(res.body.data);
            else if (res.status === 409) { var ex = res.body.error && res.body.error.details && res.body.error.details.existing; if (ex) loadSupParty(ex); supMsg.textContent = '❌ ' + (res.body.error ? res.body.error.message : 'رکورد تکراری'); }
            else supMsg.textContent = '❌ ' + failText(res);
          }).catch(function () { supMsg.textContent = '❌ خطای شبکه.'; });
        } else {
          api('POST', '/parties', payload).then(function (res) {
            if (res.status >= 200 && res.status < 300) syncSupplier(res.body.data);
            else if (res.status === 409) {
              var ex2 = res.body.error && res.body.error.details && res.body.error.details.existing;
              if (ex2) loadSupParty(ex2);
              supMsg.textContent = '⚠️ ' + (res.body.error ? res.body.error.message : 'قبلاً ثبت شده') + ' — اطلاعات قبلی بارگذاری شد؛ پس از اصلاح «ثبت تغییرات رکورد موجود» را بزنید.';
            } else supMsg.textContent = '❌ ' + failText(res);
          }).catch(function () { supMsg.textContent = '❌ خطای شبکه.'; });
        }
      };

      supPanel.appendChild(row('جستجوی یکتا', supSearch));
      supPanel.appendChild(supBanner);
      supPanel.appendChild(row('نام فارسی *', sNameFa));
      supPanel.appendChild(row('نام لاتین *', sNameEn));
      supPanel.appendChild(row('شناسهٔ ملی *', sNatId));
      supPanel.appendChild(row('کد اقتصادی *', sEcon));
      supPanel.appendChild(row('موبایل', sMobile));
      supPanel.appendChild(row('تلفن', sPhone));
      supPanel.appendChild(row('کد پستی', sPostal));
      supPanel.appendChild(row('آدرس', sAddr));
      supPanel.appendChild(supSave);
      supPanel.appendChild(supMsg);
      supPanel.appendChild(el('h4', null, 'فروشنده‌های ثبت‌شده'));
      supPanel.appendChild(supList);
      root.appendChild(supPanel);
      loadSuppliers();

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
