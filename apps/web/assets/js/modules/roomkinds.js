/**
 * modules/roomkinds.js — نسخهٔ ۳٫۴: «لیست انواع اتاقها» + «مشخصه های اضافی اتاق» + «اتاقها»
 * طبق فرم‌های مرجع کارفرما: نرخ‌های ۴گانهٔ ریالی/دلاری + فصلی + تخت اضافه + ستون‌های زندهٔ
 * «تعداد اتاق / تعداد پر / تخت اضافه» با drill-down (کلیک روی ستون = لیست اتاق‌های همان).
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

  function rial(v) {
    if (!v || v === '0') return '۰';
    return Num.toPersian(String(Number(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
  }

  function row(label, input) {
    var d = el('div');
    d.style.cssText = 'display:flex;gap:6px;align-items:center;margin:4px 0;flex-wrap:wrap;';
    var l = el('label', null, label);
    l.style.minWidth = '150px';
    d.appendChild(l);
    d.appendChild(input);
    return d;
  }

  function rialInputs(prefix) {
    // چهار فیلد ریالی: یک نفره/دوئبل/سه نفره/نرخ کامل + چهار دلاری
    var wrap = el('div');
    function mk(k, label) {
      var i = el('input'); i.type = 'number'; i.min = '0'; i.style.width = '130px';
      i.dataset[prefix] = k;
      var d = el('div', 'form-row');
      d.appendChild(el('span', 'muted', label));
      d.appendChild(i);
      wrap.appendChild(d);
      return i;
    }
    var out = {
      single: mk('rateSingleRials', 'یک نفره (ریال)'),
      double: mk('rateDoubleRials', 'دوئبل (ریال)'),
      triple: mk('rateTripleRials', 'سه نفره (ریال)'),
      full: mk('rateFullRials', 'نرخ کامل (ریال)'),
    };
    var usd = el('div', 'form-row');
    ['rateSingleUsd|یک نفره ($)', 'rateDoubleUsd|دوئبل ($)', 'rateTripleUsd|سه نفره ($)', 'rateFullUsd|نرخ کامل ($)'].forEach(function (pair) {
      var p = pair.split('|');
      var i = el('input'); i.type = 'number'; i.step = '0.01'; i.min = '0'; i.style.width = '110px';
      i.dataset[prefix] = p[0];
      usd.appendChild(el('span', 'muted', p[1]));
      usd.appendChild(i);
      out[p[0]] = i;
    });
    wrap.appendChild(usd);
    return out;
  }

  Modules.roomkinds = {
    title: 'انواع اتاق‌ها',
    icon: '🛏',
    render: function (root) {
      var state = { tab: 'kinds', kinds: [], amenities: [] };

      root.appendChild(el('h2', null, 'اتاق‌های هتل — انواع اتاق، مشخصه‌های اضافی و اتاق‌ها'));
      root.appendChild(App.sessionPanel());

      var tabsBar = el('div', 'panel users-tabs');
      var tabs = [
        { id: 'kinds', label: 'لیست انواع اتاقها' },
        { id: 'amenities', label: 'مشخصه های اضافی اتاق' },
        { id: 'rooms', label: 'اتاقها (Rooms List)' },
      ];
      var tabBtns = {};
      tabs.forEach(function (t) {
        var b = el('button', 'btn', t.label);
        tabBtns[t.id] = b;
        b.onclick = function () { state.tab = t.id; drawTabs(); renderTab(body); };
        tabsBar.appendChild(b);
      });
      root.appendChild(tabsBar);
      var body = el('div');
      root.appendChild(body);

      function drawTabs() {
        tabs.forEach(function (t) { tabBtns[t.id].classList.toggle('btn-primary', state.tab === t.id); });
      }

      function reload(cb) {
        Promise.all([api('GET', '/pms/room-kinds'), api('GET', '/pms/room-amenities')]).then(function (res) {
          state.kinds = (res[0].status === 200 && res[0].body.data) || [];
          state.amenities = (res[1].status === 200 && res[1].body.data) || [];
          if (res[0].status !== 200) {
            body.innerHTML = '';
            body.appendChild(el('div', 'panel', '❌ ' + failText(res[0])));
            return;
          }
          if (cb) cb();
          else renderTab(body);
        });
      }

      /* ── تب ۱: انواع اتاق ── */
      function renderKinds(host) {
        var addBtn = el('button', 'btn btn-primary', '＋ نوع اتاق جدید');
        addBtn.onclick = function () { kindForm(host, null); };
        var bar = el('div', 'form-row');
        bar.appendChild(addBtn);
        host.appendChild(bar);
        host.appendChild(el('p', 'muted', 'با کلیک روی «تعداد پر» اتاق‌های اشغال‌شدهٔ آن نوع و با کلیک روی «تخت اضافه» اتاق‌های دارای تخت اضافه نمایش داده می‌شود.'));

        var tbl = el('table', 'dt');
        var thead = el('thead');
        var tr = el('tr');
        ['ردیف', 'نام', 'نام لاتین', 'مشخصه', 'تخت', 'یک نفره', 'دوئبل', 'سه نفره', 'نرخ کامل (ریال)', 'تعداد اتاق', 'تعداد پر', 'تخت اضافه', 'نرخ تخت اضافه', 'فول برد', 'فعالیت', 'عملیات'].forEach(function (h) {
          var th = el('th', null, h);
          tr.appendChild(th);
        });
        thead.appendChild(tr);
        tbl.appendChild(thead);
        var tbody = el('tbody');
        state.kinds.forEach(function (k, i) {
          var trow = el('tr');
          function td(child) { var t = el('td'); t.appendChild(child); trow.appendChild(t); }
          td(el('span', 'fit', Num.toPersian(String(i + 1))));
          td(el('span', 'fit', k.nameFa));
          td(el('span', 'fit', k.nameLatin || k.nameEn || '—'));
          td(el('span', 'fit', Num.toPersian(String(k.capacity))));
          td(el('span', 'fit', Num.toPersian(String(k.bedCount))));
          td(el('span', 'fit', rial(k.rateSingleRials)));
          td(el('span', 'fit', rial(k.rateDoubleRials)));
          td(el('span', 'fit', rial(k.rateTripleRials)));
          td(el('span', 'fit', rial(k.rateFullRials)));
          // ستون زندهٔ تعداد اتاق — کلیک = لیست همهٔ اتاق‌های نوع
          var cTotal = el('button', 'btn roomcount-btn', Num.toPersian(String(k.roomsCount)));
          cTotal.style.padding = '2px 8px';
          cTotal.onclick = function () { kindRooms(host, k, {}); };
          td(cTotal);
          // ستون زندهٔ تعداد پر — کلیک = اتاق‌های اشغال‌شده
          var cOcc = el('button', 'btn roomcount-btn', Num.toPersian(String(k.occupiedCount)));
          cOcc.style.cssText = 'padding:2px 8px;font-weight:700;';
          cOcc.onclick = function () { kindRooms(host, k, { occupied: 1 }); };
          td(cOcc);
          // ستون زندهٔ تخت اضافه — کلیک = اتاق‌های دارای تخت اضافه
          var cExtra = el('button', 'btn roomcount-btn', Num.toPersian(String(k.extraBedsCount)));
          cExtra.style.cssText = 'padding:2px 8px;font-weight:700;color:#1a7f4e;';
          cExtra.onclick = function () { kindRooms(host, k, { extraBeds: 1 }); };
          td(cExtra);
          td(el('span', 'fit', rial(k.extraBedRials)));
          td(el('span', 'fit', rial(k.fullBoardRials)));
          td(el('span', 'fit', k.isActive ? 'فعال' : 'غیرفعال'));
          var ops = el('div');
          ops.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;';
          var bEdit = el('button', 'btn', 'تصحیح');
          bEdit.onclick = function () { kindForm(host, k); };
          var bDel = el('button', 'btn', 'حذف');
          bDel.onclick = function () {
            if (!confirm('نوع اتاق «' + k.nameFa + '» حذف شود؟')) return;
            api('DELETE', '/pms/room-kinds/' + k.id).then(function (res) {
              if ([200, 201].includes(res.status)) reload(function () { renderTab(host); });
              else alert('❌ ' + failText(res));
            });
          };
          ops.appendChild(bEdit);
          ops.appendChild(bDel);
          td(ops);
          tbody.appendChild(trow);
        });
        tbl.appendChild(tbody);
        var wrap = el('div', 'dt-wrap');
        wrap.appendChild(tbl);
        host.appendChild(wrap);
        Num.fitAll(tbl);
      }

      function kindRooms(host, kind, query) {
        var qs = Object.keys(query).map(function (k) { return k + '=' + query[k]; }).join('&');
        api('GET', '/pms/room-kinds/' + kind.id + '/rooms' + (qs ? '?' + qs : '')).then(function (res) {
          host.innerHTML = '';
          var back = el('button', 'btn', 'بازگشت به انواع اتاق');
          back.onclick = function () { renderTab(host); };
          var title = 'اتاق‌های نوع «' + kind.nameFa + '»' +
            (query.occupied ? ' — اشغال‌شده (تعداد پر)' : query.extraBeds ? ' — دارای تخت اضافه' : ' — همه');
          host.appendChild(el('h3', null, title));
          host.appendChild(back);
          var tbl = el('table', 'dt');
          var thead = el('thead');
          var tr = el('tr');
          ['اتاق', 'نوع', 'تخت', 'تخت اضافه', 'وضعیت', 'طبقه', 'تاریخ ورود', 'تاریخ خروج', 'مهمان', 'تور/شرکت', 'نرخ کامل (ریال)', 'توضیحات'].forEach(function (h) { tr.appendChild(el('th', null, h)); });
          thead.appendChild(tr);
          tbl.appendChild(thead);
          var tbody = el('tbody');
          (res.body?.data?.rooms ?? []).forEach(function (r) {
            var trow = el('tr');
            function td(child) { var t = el('td'); t.appendChild(child); trow.appendChild(t); }
            td(el('span', 'fit', Num.toPersian(r.code)));
            td(el('span', 'fit', kind.nameFa));
            td(el('span', 'fit', Num.toPersian(String(r.bedCount))));
            td(el('span', 'fit', Num.toPersian(String(r.extraBeds))));
            var stFa = { AVAILABLE: 'آزاد', OCCUPIED: 'پر', DIRTY: 'کثیف', OUT_OF_SERVICE: 'خارج از سرویس' };
            td(el('span', 'fit', stFa[r.status] || r.status));
            td(el('span', 'fit', Num.toPersian(String(r.floor))));
            td(el('span', 'fit', r.checkInDate ? Num.toPersian(Jalali.fromDate(new Date(r.checkInDate))) : '—'));
            td(el('span', 'fit', r.checkOutDate ? Num.toPersian(Jalali.fromDate(new Date(r.checkOutDate))) : '—'));
            td(el('span', 'fit', r.guestName || '—'));
            td(el('span', 'fit', r.tourCompany || '—'));
            td(el('span', 'fit', rial(r.rateFullRials)));
            td(el('span', 'fit', r.note || '—'));
            tbody.appendChild(trow);
          });
          tbl.appendChild(tbody);
          var wrap = el('div', 'dt-wrap');
          wrap.appendChild(tbl);
          host.appendChild(wrap);
          Num.fitAll(tbl);
        });
      }

      function kindForm(host, kind) {
        var panel = el('div', 'panel');
        panel.appendChild(el('h3', null, kind ? ('تصحیح نوع اتاق — ' + kind.nameFa) : 'نوع اتاق جدید'));
        var code = el('input', 'input'); code.value = kind ? kind.code : '';
        if (kind) code.disabled = true;
        var nameFa = el('input', 'input'); nameFa.value = kind ? kind.nameFa : '';
        var nameEn = el('input', 'input'); nameEn.value = kind ? (kind.nameEn || '') : '';
        var nameLatin = el('input', 'input'); nameLatin.value = kind ? (kind.nameLatin || '') : '';
        var cap = el('input'); cap.type = 'number'; cap.min = '1'; cap.value = kind ? kind.capacity : 2;
        var beds = el('input'); beds.type = 'number'; beds.min = '0'; beds.value = kind ? kind.bedCount : 2;
        var extraCount = el('input'); extraCount.type = 'number'; extraCount.min = '0'; extraCount.value = kind ? kind.extraBedCount : 0;
        var extraRate = el('input'); extraRate.type = 'number'; extraRate.min = '0'; extraRate.value = kind ? Number(kind.extraBedRials) : 0;
        var peak1 = el('input'); peak1.type = 'number'; peak1.min = '0'; peak1.value = kind ? Number(kind.ratePeak1Rials) : 0;
        var peak2 = el('input'); peak2.type = 'number'; peak2.min = '0'; peak2.value = kind ? Number(kind.ratePeak2Rials) : 0;
        var peak3 = el('input'); peak3.type = 'number'; peak3.min = '0'; peak3.value = kind ? Number(kind.ratePeak3Rials) : 0;
        var fullBoard = el('input'); fullBoard.type = 'number'; fullBoard.min = '0'; fullBoard.value = kind ? Number(kind.fullBoardRials) : 0;
        var picture = el('input', 'input'); picture.value = kind ? (kind.pictureUrl || '') : '';
        var active = el('input'); active.type = 'checkbox'; active.checked = kind ? !!kind.isActive : true;
        var rates = rialInputs('kindrate');
        if (kind) {
          rates.single.value = Number(kind.rateSingleRials);
          rates.double.value = Number(kind.rateDoubleRials);
          rates.triple.value = Number(kind.rateTripleRials);
          rates.full.value = Number(kind.rateFullRials);
          rates.rateSingleUsd.value = kind.rateSingleUsd || 0;
          rates.rateDoubleUsd.value = kind.rateDoubleUsd || 0;
          rates.rateTripleUsd.value = kind.rateTripleUsd || 0;
          rates.rateFullUsd.value = kind.rateFullUsd || 0;
        }

        panel.appendChild(row('کد نوع', code));
        panel.appendChild(row('نام (فارسی)', nameFa));
        panel.appendChild(row('شرح انگلیسی', nameEn));
        panel.appendChild(row('نام لاتین', nameLatin));
        panel.appendChild(row('مشخصه (ظرفیت نفر)', cap));
        panel.appendChild(row('تخت', beds));
        panel.appendChild(row('تخت اضافه (سقف مجاز)', extraCount));
        panel.appendChild(row('نرخ تخت اضافه (ریال)', extraRate));
        panel.appendChild(row('نرخ پیک ۱ (ریال)', peak1));
        panel.appendChild(row('نرخ پیک ۲ (ریال)', peak2));
        panel.appendChild(row('نرخ پیک ۳ (ریال)', peak3));
        panel.appendChild(row('نرخ فول برد (ریال)', fullBoard));
        panel.appendChild(row('تصویر (آدرس)', picture));
        panel.appendChild(row('فعالیت', active));
        panel.appendChild(el('h4', null, 'نرخ ایرانی اتاق (ریال) و نرخ دلاری ($):'));
        panel.appendChild(rates.single.parentElement);
        panel.appendChild(rates.double.parentElement);
        panel.appendChild(rates.triple.parentElement);
        panel.appendChild(rates.full.parentElement);
        panel.appendChild(rates.rateSingleUsd.parentElement.parentElement === rates.rateSingleUsd.parentElement ? rates.rateSingleUsd.parentElement : rates.rateSingleUsd.parentElement);

        var save = el('button', 'btn btn-primary', 'ثبت شود');
        var msg = el('div', 'muted');
        var cancel = el('button', 'btn', 'بازگشت');
        cancel.onclick = function () { renderTab(host); };
        var btns = el('div', 'form-row');
        btns.appendChild(save);
        btns.appendChild(cancel);
        panel.appendChild(btns);
        panel.appendChild(msg);

        save.onclick = function () {
          var payload = {
            nameFa: nameFa.value.trim(),
            nameEn: nameEn.value.trim() || undefined,
            nameLatin: nameLatin.value.trim() || undefined,
            capacity: Number(cap.value) || 2,
            bedCount: Number(beds.value) || 0,
            rateSingleRials: String(Number(rates.single.value) || 0),
            rateDoubleRials: String(Number(rates.double.value) || 0),
            rateTripleRials: String(Number(rates.triple.value) || 0),
            rateFullRials: String(Number(rates.full.value) || 0),
            rateSingleUsd: Number(rates.rateSingleUsd.value) || 0,
            rateDoubleUsd: Number(rates.rateDoubleUsd.value) || 0,
            rateTripleUsd: Number(rates.rateTripleUsd.value) || 0,
            rateFullUsd: Number(rates.rateFullUsd.value) || 0,
            ratePeak1Rials: String(Number(peak1.value) || 0),
            ratePeak2Rials: String(Number(peak2.value) || 0),
            ratePeak3Rials: String(Number(peak3.value) || 0),
            fullBoardRials: String(Number(fullBoard.value) || 0),
            extraBedCount: Number(extraCount.value) || 0,
            extraBedRials: String(Number(extraRate.value) || 0),
            pictureUrl: picture.value.trim() || undefined,
            isActive: active.checked,
          };
          var p;
          if (kind) p = api('PATCH', '/pms/room-types/' + kind.id, payload);
          else { payload.code = code.value.trim(); p = api('POST', '/pms/room-types', payload); }
          p.then(function (res) {
            if ([200, 201].includes(res.status)) {
              msg.textContent = '✅ ثبت شد.';
              reload(function () { renderTab(host); });
            } else msg.textContent = '❌ ' + failText(res);
          });
        };
        host.innerHTML = '';
        host.appendChild(panel);
        Num.fitAll(panel);
      }

      /* ── تب ۲: مشخصه‌های اضافی ── */
      function renderAmenities(host) {
        var panel = el('div', 'panel');
        panel.appendChild(el('h3', null, 'مشخصه اضافی جدید'));
        var code = el('input', 'input'); code.placeholder = 'کد انگلیسی (مثلاً BALCONY)';
        var fa = el('input', 'input'); fa.placeholder = 'نام مشخصه (فارسی)';
        var latin = el('input', 'input'); latin.placeholder = 'نام لاتین';
        var short = el('input', 'input'); short.placeholder = 'نام خلاصه (مثلاً B)';
        var add = el('button', 'btn btn-primary', 'اضافه');
        panel.appendChild(row('کد', code));
        panel.appendChild(row('نام', fa));
        panel.appendChild(row('لاتین', latin));
        panel.appendChild(row('خلاصه', short));
        panel.appendChild(add);
        var msg = el('div', 'muted');
        panel.appendChild(msg);
        add.onclick = function () {
          api('POST', '/pms/room-amenities', { code: code.value.trim(), nameFa: fa.value.trim(), nameLatin: latin.value.trim() || undefined, shortName: short.value.trim() || undefined }).then(function (res) {
            if ([200, 201].includes(res.status)) reload(function () { renderTab(host); });
            else msg.textContent = '❌ ' + failText(res);
          });
        };
        host.appendChild(panel);

        var tbl = el('table', 'dt');
        var thead = el('thead');
        var tr = el('tr');
        ['ردیف', 'نام مشخصه', 'نام لاتین', 'نام خلاصه', 'اتاق‌ها', 'عملیات'].forEach(function (h) { tr.appendChild(el('th', null, h)); });
        thead.appendChild(tr);
        tbl.appendChild(thead);
        var tbody = el('tbody');
        state.amenities.forEach(function (a, i) {
          var trow = el('tr');
          function td(child) { var t = el('td'); t.appendChild(child); trow.appendChild(t); }
          td(el('span', 'fit', Num.toPersian(String(i + 1))));
          td(el('span', 'fit', a.nameFa));
          td(el('span', 'fit', a.nameLatin || '—'));
          td(el('span', 'fit', a.shortName || '—'));
          td(el('span', 'fit', Num.toPersian(String(a.roomsCount))));
          var ops = el('div');
          ops.style.cssText = 'display:flex;gap:4px;';
          var bDel = el('button', 'btn', 'حذف');
          bDel.onclick = function () {
            if (!confirm('مشخصه «' + a.nameFa + '» حذف شود؟')) return;
            api('DELETE', '/pms/room-amenities/' + a.id).then(function (res) {
              if ([200, 201].includes(res.status)) reload(function () { renderTab(host); });
              else alert('❌ ' + failText(res));
            });
          };
          ops.appendChild(bDel);
          td(ops);
          tbody.appendChild(trow);
        });
        tbl.appendChild(tbody);
        var wrap = el('div', 'dt-wrap');
        wrap.appendChild(tbl);
        host.appendChild(wrap);
        Num.fitAll(tbl);
      }

      /* ── تب ۳: اتاق‌ها ── */
      function renderRooms(host) {
        var filters = el('div', 'panel');
        filters.appendChild(el('h3', null, 'فیلترها'));
        var stSel = el('select');
        [['', 'همه'], ['AVAILABLE', 'آزاد'], ['OCCUPIED', 'پر'], ['DIRTY', 'کثیف'], ['OUT_OF_SERVICE', 'خارج از سرویس']].forEach(function (p) {
          var o = el('option', null, p[1]); o.value = p[0]; stSel.appendChild(o);
        });
        var flIn = el('input'); flIn.type = 'number'; flIn.placeholder = 'طبقه';
        var amSel = el('select');
        amSel.appendChild(el('option', null, 'همهٔ مشخصه‌ها'));
        state.amenities.forEach(function (a) {
          var o = el('option', null, a.nameFa); o.value = a.id; amSel.appendChild(o);
        });
        var kSel = el('select');
        kSel.appendChild(el('option', null, 'همهٔ انواع'));
        state.kinds.forEach(function (k) {
          var o = el('option', null, k.nameFa); o.value = k.id; kSel.appendChild(o);
        });
        var load = el('button', 'btn btn-primary', 'نمایش');
        filters.appendChild(row('وضعیت', stSel));
        filters.appendChild(row('طبقه', flIn));
        filters.appendChild(row('امکانات', amSel));
        filters.appendChild(row('تنوع اتاق', kSel));
        filters.appendChild(load);
        host.appendChild(filters);

        var listHost = el('div');
        host.appendChild(listHost);
        var addBtn = el('button', 'btn btn-primary', '＋ ثبت اتاق جدید');
        addBtn.onclick = function () { roomForm(host, null); };
        var bar = el('div', 'form-row');
        bar.appendChild(addBtn);
        host.appendChild(bar);

        function loadRooms() {
          api('GET', '/pms/rooms-admin').then(function (res) {
            listHost.innerHTML = '';
            var rooms = (res.body?.data ?? []).filter(function (r) {
              if (stSel.value && r.status !== stSel.value) return false;
              if (flIn.value !== '' && String(r.floor) !== String(Number(flIn.value))) return false;
              if (kSel.value && r.roomTypeId !== kSel.value) return false;
              if (amSel.value) return (r.amenityIds || []).indexOf(amSel.value) >= 0;
              return true;
            });
            var tbl = el('table', 'dt');
            var thead = el('thead');
            var tr = el('tr');
            ['اتاق', 'نوع اتاق', 'تخت', 'وضعیت', 'طبقه', 'نرخ کامل (ریال)', 'خانه‌داری', 'تور/شرکت', 'عملیات'].forEach(function (h) { tr.appendChild(el('th', null, h)); });
            thead.appendChild(tr);
            tbl.appendChild(thead);
            var tbody = el('tbody');
            rooms.forEach(function (r) {
              var trow = el('tr');
              function td(child) { var t = el('td'); t.appendChild(child); trow.appendChild(t); }
              td(el('span', 'fit', Num.toPersian(r.code)));
              td(el('span', 'fit', r.roomTypeFa || '—'));
              td(el('span', 'fit', Num.toPersian(String(r.bedCount ?? 2))));
              var stFa = { AVAILABLE: 'آزاد', OCCUPIED: 'پر', DIRTY: 'کثیف', OUT_OF_SERVICE: 'خارج از سرویس' };
              td(el('span', 'fit', stFa[r.status] || r.status));
              td(el('span', 'fit', Num.toPersian(String(r.floor))));
              td(el('span', 'fit', rial(r.rateFullRials || r.baseRateRials)));
              var hkFa = { CLEAN: 'نظیف', DIRTY: 'کثیف', IN_PROGRESS: 'در حال نظافت', INSPECTED: 'بازبینی‌شده' };
              td(el('span', 'fit', hkFa[r.hkStatus] || r.hkStatus));
              td(el('span', 'fit', r.tourCompany || '—'));
              var ops = el('div');
              ops.style.cssText = 'display:flex;gap:4px;';
              var bEdit = el('button', 'btn', 'تصحیح');
              bEdit.onclick = function () { roomForm(host, r); };
              ops.appendChild(bEdit);
              td(ops);
              tbody.appendChild(trow);
            });
            tbl.appendChild(tbody);
            var wrap = el('div', 'dt-wrap');
            wrap.appendChild(tbl);
            listHost.appendChild(wrap);
            Num.fitAll(tbl);
          });
        }
        load.onclick = loadRooms;
        loadRooms();
      }

      function roomForm(host, room) {
        var panel = el('div', 'panel');
        panel.appendChild(el('h3', null, room ? ('تصحیح مشخصات اتاق — ' + room.code) : 'ثبت اتاق جدید'));
        var code = el('input', 'input'); code.value = room ? room.code : '';
        var kSel = el('select');
        state.kinds.forEach(function (k) {
          var o = el('option', null, k.nameFa); o.value = k.id;
          if (room && room.roomTypeId === k.id) o.selected = true;
          kSel.appendChild(o);
        });
        var nameFa = el('input', 'input'); nameFa.value = room ? (room.nameFa || '') : '';
        var nameLatin = el('input', 'input'); nameLatin.value = room ? (room.nameLatin || '') : '';
        var beds = el('input'); beds.type = 'number'; beds.min = '0'; beds.value = room ? room.bedCount : 2;
        var floor = el('input'); floor.type = 'number'; floor.min = '0'; floor.value = room ? room.floor : 0;
        var order = el('input'); order.type = 'number'; order.min = '0'; order.value = room ? room.orderInFloor : 0;
        var extra = el('input'); extra.type = 'number'; extra.min = '0'; extra.value = room ? room.extraBeds : 0;
        var rates = rialInputs('roomrate');
        var note = el('input', 'input'); note.value = room ? (room.note || '') : '';
        var reg = el('input'); reg.type = 'number'; reg.min = '0'; reg.value = room && room.registerNo ? room.registerNo : '';
        var saleBlocked = el('input'); saleBlocked.type = 'checkbox'; saleBlocked.checked = room ? !!room.saleBlocked : false;
        if (room) {
          rates.single.value = Number(room.rateSingleRials) || 0;
          rates.double.value = Number(room.rateDoubleRials) || 0;
          rates.triple.value = Number(room.rateTripleRials) || 0;
          rates.full.value = Number(room.rateFullRials) || 0;
        }
        var status = el('select');
        [['AVAILABLE', 'خالی'], ['DIRTY', 'کثیف'], ['OUT_OF_SERVICE', 'خارج از سرویس']].forEach(function (p) {
          var o = el('option', null, p[1]); o.value = p[0];
          if (room && room.status === p[0]) o.selected = true;
          status.appendChild(o);
        });
        var amBox = el('div', 'form-row');
        amBox.style.cssText = 'gap:12px;flex-wrap:wrap;';
        state.amenities.forEach(function (a) {
          var lbl = el('label');
          lbl.style.cssText = 'display:flex;gap:4px;align-items:center;';
          var cb = el('input'); cb.type = 'checkbox'; cb.value = a.id;
          if (room && (room.amenityIds || []).indexOf(a.id) >= 0) cb.checked = true;
          lbl.appendChild(cb);
          lbl.appendChild(el('span', 'fit', a.nameFa));
          amBox.appendChild(lbl);
        });

        panel.appendChild(row('شماره اتاق', code));
        panel.appendChild(row('تنوع اتاق', kSel));
        panel.appendChild(row('نام فارسی اتاق', nameFa));
        panel.appendChild(row('نام لاتین اتاق', nameLatin));
        panel.appendChild(row('تعداد تخت', beds));
        panel.appendChild(row('طبقه', floor));
        panel.appendChild(row('ردیف در طبقه', order));
        panel.appendChild(row('تخت اضافه', extra));
        panel.appendChild(row('وضعیت', room ? status : el('span', 'muted', 'پذیرش با رجیستر')));
        panel.appendChild(row('توضیحات اتاق', note));
        panel.appendChild(row('رجیستر فعال', reg));
        panel.appendChild(row('غیرقابل فروش', saleBlocked));
        panel.appendChild(row('مشخصات اتاق', amBox));
        panel.appendChild(el('h4', null, 'نرخ ایرانی اتاق (ریال) — نرخ کامل باید متناسب با تعداد تخت باشد:'));
        panel.appendChild(rates.single.parentElement);
        panel.appendChild(rates.double.parentElement);
        panel.appendChild(rates.triple.parentElement);
        panel.appendChild(rates.full.parentElement);

        var save = el('button', 'btn btn-primary', 'ثبت شود');
        var msg = el('div', 'muted');
        var cancel = el('button', 'btn', 'بازگشت');
        cancel.onclick = function () { renderTab(host); };
        var btns = el('div', 'form-row');
        btns.appendChild(save);
        btns.appendChild(cancel);
        panel.appendChild(btns);
        panel.appendChild(msg);

        save.onclick = function () {
          var amenityIds = Array.prototype.slice.call(amBox.querySelectorAll('input[type=checkbox]:checked')).map(function (c) { return c.value; });
          var payload = {
            nameFa: nameFa.value.trim() || undefined,
            nameLatin: nameLatin.value.trim() || undefined,
            bedCount: Number(beds.value) || 0,
            orderInFloor: Number(order.value) || 0,
            extraBeds: Number(extra.value) || 0,
            rateSingleRials: String(Number(rates.single.value) || 0),
            rateDoubleRials: String(Number(rates.double.value) || 0),
            rateTripleRials: String(Number(rates.triple.value) || 0),
            rateFullRials: String(Number(rates.full.value) || 0),
            rateSingleUsd: Number(rates.rateSingleUsd.value) || 0,
            rateDoubleUsd: Number(rates.rateDoubleUsd.value) || 0,
            rateTripleUsd: Number(rates.rateTripleUsd.value) || 0,
            rateFullUsd: Number(rates.rateFullUsd.value) || 0,
            note: note.value.trim() || undefined,
            registerNo: reg.value ? Number(reg.value) : undefined,
            saleBlocked: saleBlocked.checked,
            amenityIds: amenityIds,
          };
          var p;
          if (room) {
            payload.status = room.status === 'OCCUPIED' ? undefined : status.value;
            p = api('PATCH', '/pms/rooms/' + room.id, payload);
          } else {
            payload.code = code.value.trim();
            payload.floor = Number(floor.value) || 0;
            payload.roomTypeId = kSel.value;
            p = api('POST', '/pms/rooms', payload);
          }
          p.then(function (res) {
            if ([200, 201].includes(res.status)) {
              msg.textContent = '✅ ثبت شد.';
              reload(function () { renderTab(host); });
            } else msg.textContent = '❌ ' + failText(res);
          });
        };
        host.innerHTML = '';
        host.appendChild(panel);
        Num.fitAll(panel);
      }

      function renderTab(host) {
        host.innerHTML = '';
        if (state.tab === 'kinds') renderKinds(host);
        else if (state.tab === 'amenities') renderAmenities(host);
        else renderRooms(host);
        drawTabs();
        Num.fitAll(host);
      }

      reload();
    },
  };
})(window);
