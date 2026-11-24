/**
 * modules/rooms-setup.js — نیاز ۱ کارفرما: مدیریت خودی طبقات/اتاق‌ها/نوع‌ها/نرخ‌ها
 * CRUD کامل روی API واقعی: POST/PATCH/DELETE /pms/rooms + /pms/room-types
 * هر تغییری بلافاصله در روم‌رک دیده می‌شود (چون روم‌رک از /pms/rooms/map می‌خواند).
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

  var STATUS_FA = { AVAILABLE: 'آزاد', OCCUPIED: 'اشغال', DIRTY: 'کثیف', OUT_OF_SERVICE: 'بسته' };

  global.Modules = global.Modules || {};

  global.Modules.roomssetup = {
    render: function (root) {
      root.innerHTML = '';
      var wrap = el('div', 'rs-wrap');
      var head = el('div', 'rs-head');
      var back = el('button', 'rr-act-btn rs-back', '→ بازگشت به رک اتاق‌ها');
      back.style.width = 'auto';
      back.onclick = function () { global.App.go('roomrack'); };
      head.appendChild(el('h3', null, '⚙ تنظیم اتاق‌ها و نرخ‌ها'));
      head.appendChild(back);
      wrap.appendChild(head);
      var msg = el('p', 'rs-msg', 'در حال بارگذاری…');
      var err = el('p', 'rs-err');
      wrap.appendChild(msg);
      wrap.appendChild(err);

      var typesBox = el('div', 'rs-box');
      var roomsBox = el('div', 'rs-box');
      wrap.appendChild(typesBox);
      wrap.appendChild(roomsBox);
      root.appendChild(wrap);

      var roomTypes = [];

      function load() {
        msg.hidden = false;
        err.textContent = '';
        Promise.all([
          api('GET', '/pms/room-types'),
          api('GET', '/pms/rooms/map'),
        ]).then(function (all) {
          var tRes = all[0], mRes = all[1];
          if (tRes.status >= 300) throw new Error(failText(tRes));
          if (mRes.status >= 300) throw new Error(failText(mRes));
          roomTypes = (tRes.body.data || []);
          var floors = (mRes.body.data && mRes.body.data.floors) || [];
          msg.hidden = true;
          renderTypes();
          renderRooms(floors);
        }).catch(function (e) {
          msg.hidden = true;
          err.textContent = 'اتصال به سرور برقرار نیست — مدیریت اتاق‌ها به API نیاز دارد (' + e.message + ').';
        });
      }

      /* ── انواع اتاق و نرخ‌ها ── */
      function renderTypes() {
        typesBox.innerHTML = '';
        typesBox.appendChild(el('h4', null, 'انواع اتاق و نرخ پایه (ریال/شب)'));
        var t = el('table', 'rs-table');
        t.innerHTML = '<thead><tr><th>کد</th><th>نام</th><th>ظرفیت</th><th>نرخ پایه (ریال)</th><th>تعداد اتاق</th><th>ذخیره</th></tr></thead>';
        var tb = el('tbody');
        roomTypes.forEach(function (rt) {
          var tr = el('tr');
          tr.appendChild(el('td', null, rt.code));
          var nameInp = el('input'); nameInp.value = rt.nameFa;
          var nameTd = el('td'); nameTd.appendChild(nameInp); tr.appendChild(nameTd);
          var capInp = el('input'); capInp.type = 'number'; capInp.min = '1'; capInp.max = '10'; capInp.value = rt.capacity;
          var capTd = el('td'); capTd.appendChild(capInp); tr.appendChild(capTd);
          var rateInp = el('input'); rateInp.type = 'number'; rateInp.min = '0'; rateInp.step = '10000'; rateInp.value = Number(rt.baseRateRials);
          var rateTd = el('td'); rateTd.appendChild(rateInp); tr.appendChild(rateTd);
          tr.appendChild(el('td', null, Num.toPersian(rt.roomsCount)));
          var saveTd = el('td');
          var save = el('button', 'rs-save-btn', 'ثبت');
          save.onclick = function () {
            err.textContent = '';
            api('PATCH', '/pms/room-types/' + rt.id, {
              nameFa: nameInp.value.trim(),
              capacity: parseInt(capInp.value, 10) || undefined,
              baseRateRials: String(parseInt(rateInp.value, 10) || 0),
            }).then(function (res) {
              if (res.status >= 200 && res.status < 300) { ok('نرخ/نام «' + rt.code + '» به‌روزرسانی شد — روم‌رک بلافاصله نشان می‌دهد.'); load(); }
              else err.textContent = failText(res);
            }).catch(function (e) { err.textContent = 'خطای شبکه: ' + e.message; });
          };
          saveTd.appendChild(save);
          tr.appendChild(saveTd);
          tb.appendChild(tr);
        });
        t.appendChild(tb);
        typesBox.appendChild(t);

        /* فرم نوع جدید */
        var row = el('div', 'rs-form-row');
        var cInp = el('input'); cInp.placeholder = 'کد (مثل TWIN)';
        var fInp = el('input'); fInp.placeholder = 'نام فارسی (مثل تویین)';
        var eInp = el('input'); eInp.placeholder = 'نام انگلیسی';
        var c2Inp = el('input'); c2Inp.type = 'number'; c2Inp.value = '2'; c2Inp.min = '1'; c2Inp.max = '10';
        var rInp = el('input'); rInp.type = 'number'; rInp.placeholder = 'نرخ پایه ریال';
        var add = el('button', 'rs-save-btn', '+ افزودن نوع');
        add.onclick = function () {
          err.textContent = '';
          if (!cInp.value.trim() || !fInp.value.trim() || !rInp.value) { err.textContent = 'کد، نام فارسی و نرخ پایه الزامی است.'; return; }
          api('POST', '/pms/room-types', {
            code: cInp.value.trim().toUpperCase(),
            nameFa: fInp.value.trim(),
            nameEn: eInp.value.trim() || cInp.value.trim().toUpperCase(),
            capacity: parseInt(c2Inp.value, 10) || 2,
            baseRateRials: String(parseInt(rInp.value, 10)),
          }).then(function (res) {
            if (res.status >= 200 && res.status < 300) { ok('نوع اتاق «' + fInp.value.trim() + '» ساخته شد.'); load(); }
            else err.textContent = failText(res);
          }).catch(function (e) { err.textContent = 'خطای شبکه: ' + e.message; });
        };
        row.appendChild(cInp); row.appendChild(fInp); row.appendChild(eInp); row.appendChild(c2Inp); row.appendChild(rInp); row.appendChild(add);
        typesBox.appendChild(row);
      }

      /* ── اتاق‌ها بر اساس طبقه ── */
      function renderRooms(floors) {
        roomsBox.innerHTML = '';
        roomsBox.appendChild(el('h4', null, 'اتاق‌ها (کد، طبقه، نوع — همه قابل ویرایش)'));
        var t = el('table', 'rs-table');
        t.innerHTML = '<thead><tr><th>کد اتاق</th><th>طبقه</th><th>نوع اتاق</th><th>وضعیت</th><th>ذخیره</th><th>عملیات</th></tr></thead>';
        var tb = el('tbody');
        floors.forEach(function (f) {
          f.rooms.forEach(function (r) {
            var tr = el('tr');
            var codeInp = el('input'); codeInp.value = r.code;
            var codeTd = el('td'); codeTd.appendChild(codeInp); tr.appendChild(codeTd);
            var floorInp = el('input'); floorInp.type = 'number'; floorInp.min = '0'; floorInp.max = '99'; floorInp.value = f.floor;
            var floorTd = el('td'); floorTd.appendChild(floorInp); tr.appendChild(floorTd);
            var typeSel = el('select');
            roomTypes.forEach(function (rt) { typeSel.appendChild(new Option(rt.nameFa + ' (' + rt.code + ')', rt.id)); });
            typeSel.value = r.roomTypeId;
            var typeTd = el('td'); typeTd.appendChild(typeSel); tr.appendChild(typeTd);
            tr.appendChild(el('td', null, STATUS_FA[r.status] || r.status));
            var saveTd = el('td');
            var save = el('button', 'rs-save-btn', 'ثبت');
            save.onclick = function () {
              err.textContent = '';
              api('PATCH', '/pms/rooms/' + r.id, {
                code: codeInp.value.trim(),
                floor: parseInt(floorInp.value, 10),
                roomTypeId: typeSel.value,
              }).then(function (res) {
                if (res.status >= 200 && res.status < 300) { ok('اتاق ' + codeInp.value.trim() + ' ذخیره شد.'); load(); }
                else err.textContent = failText(res);
              }).catch(function (e) { err.textContent = 'خطای شبکه: ' + e.message; });
            };
            saveTd.appendChild(save);
            tr.appendChild(saveTd);
            var opTd = el('td');
            var closeBtn = el('button', 'rs-mini-btn', r.status === 'OUT_OF_SERVICE' ? 'باز کردن' : 'بستن');
            closeBtn.onclick = function () {
              api('PATCH', '/pms/rooms/' + r.id, { status: r.status === 'OUT_OF_SERVICE' ? 'AVAILABLE' : 'OUT_OF_SERVICE' })
                .then(function (res) { if (res.status < 300) load(); else err.textContent = failText(res); });
            };
            opTd.appendChild(closeBtn);
            var delBtn = el('button', 'rs-mini-btn rs-del-btn', 'حذف');
            delBtn.onclick = function () {
              if (!confirm('اتاق ' + r.code + ' حذف شود؟ (فقط اتاق بدون سابقهٔ اقامت)')) return;
              api('DELETE', '/pms/rooms/' + r.id)
                .then(function (res) { if (res.status < 300) { ok('اتاق ' + r.code + ' حذف شد.'); load(); } else err.textContent = failText(res); });
            };
            opTd.appendChild(delBtn);
            tr.appendChild(opTd);
            tb.appendChild(tr);
          });
        });
        t.appendChild(tb);
        roomsBox.appendChild(t);

        /* فرم اتاق جدید */
        var row = el('div', 'rs-form-row');
        var cInp = el('input'); cInp.placeholder = 'کد اتاق (مثل 105)';
        var fInp = el('input'); fInp.type = 'number'; fInp.placeholder = 'طبقه'; fInp.value = '1'; fInp.min = '0';
        var tSel = el('select');
        roomTypes.forEach(function (rt) { tSel.appendChild(new Option(rt.nameFa + ' (' + rt.code + ')', rt.id)); });
        var add = el('button', 'rs-save-btn', '+ افزودن اتاق');
        add.onclick = function () {
          err.textContent = '';
          if (!cInp.value.trim() || !roomTypes.length) { err.textContent = 'کد اتاق و وجود حداقل یک نوع اتاق الزامی است.'; return; }
          api('POST', '/pms/rooms', {
            code: cInp.value.trim(),
            floor: parseInt(fInp.value, 10) || 0,
            roomTypeId: tSel.value,
          }).then(function (res) {
            if (res.status >= 200 && res.status < 300) { ok('اتاق ' + cInp.value.trim() + ' ساخته شد — در روم‌رک دیده می‌شود.'); load(); }
            else err.textContent = failText(res);
          }).catch(function (e) { err.textContent = 'خطای شبکه: ' + e.message; });
        };
        row.appendChild(cInp); row.appendChild(fInp); row.appendChild(tSel); row.appendChild(add);
        roomsBox.appendChild(row);
      }

      function ok(text) {
        msg.hidden = false;
        msg.textContent = '✅ ' + text;
        setTimeout(function () { msg.hidden = true; }, 4000);
      }

      load();
    },
  };
})(window);
