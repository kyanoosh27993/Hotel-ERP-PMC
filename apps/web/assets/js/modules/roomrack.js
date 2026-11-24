/**
 * modules/roomrack.js — فاز R1: روم‌رک واقعی به سبک آسا (مرجع: new_room_rack.html + اسکرین‌شات کارفرما)
 * کاشی‌های پوشه‌ای با رنگ‌بندی وضعیت | نوار راهنمای عمودی | درصد اشغالی | تول‌تیپ جزئیات |
 * دو حالت چیدمان (جریانی / ستونی طبقه‌ها) | فیلتر نوع اتاق و جستجو | پنل عملیات اتاق
 * داده از API واقعی GET /api/v1/pms/rooms/map — تغییر وضعیت با PATCH /pms/rooms/:id.
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

  /* رنگ‌بندی آسا: اشغال=آبی، خالی تمیز=خاکستری، بازبینی=سبز، کثیف/نظافت=بنفش، بسته=قرمز */
  function roomVisual(room) {
    if (room.status === 'OCCUPIED') return { cls: 'rr-blue', label: 'پر' };
    if (room.status === 'OUT_OF_SERVICE') return { cls: 'rr-red', label: 'بسته' };
    if (room.status === 'DIRTY') return { cls: 'rr-purple', label: 'خروج/کثیف' };
    if (room.hkStatus === 'DIRTY') return { cls: 'rr-purple', label: 'کثیف' };
    if (room.hkStatus === 'IN_PROGRESS') return { cls: 'rr-green', label: 'در حال نظافت' };
    if (room.hkStatus === 'INSPECTED') return { cls: 'rr-green', label: 'بازبینی‌شده' };
    return { cls: 'rr-grey', label: 'خالی — تمیز' };
  }

  var STATUS_FA = { AVAILABLE: 'آزاد', OCCUPIED: 'اشغال', DIRTY: 'کثیف', OUT_OF_SERVICE: 'خارج از سرویس' };
  var HK_FA = { CLEAN: 'نظیف', DIRTY: 'کثیف', IN_PROGRESS: 'در حال نظافت', INSPECTED: 'بازبینی‌شده' };

  global.Modules = global.Modules || {};

  global.Modules.roomrack = {
    render: function (root) {
      root.innerHTML = '';
      var wrap = el('div', 'rr-wrap');

      /* ── سربرگ: درصد اشغالی + ابزارها ── */
      var bar = el('div', 'rr-bar');
      var occ = el('div', 'rr-occ');
      bar.appendChild(occ);

      var tools = el('div', 'rr-tools');
      /* نیاز ۲ کارفرما: چیدمان دلخواه — گروه‌بندی بر اساس طبقه یا نوع اتاق */
      var groupSel = el('select');
      groupSel.appendChild(new Option('گروه‌بندی: طبقه', 'floor'));
      groupSel.appendChild(new Option('گروه‌بندی: نوع اتاق', 'type'));
      var layoutBtn = el('button', 'rr-tool-btn', 'چیدمان: ستونی');
      var searchInp = el('input');
      searchInp.type = 'search';
      searchInp.placeholder = 'جستجوی اتاق…';
      var typeSel = el('select');
      typeSel.appendChild(new Option('همهٔ انواع', ''));
      var dirtyToggle = el('button', 'rr-tool-btn', 'نمایش همه');
      var setupBtn = el('button', 'rr-tool-btn', '⚙ تنظیم اتاق‌ها');
      setupBtn.onclick = function () { global.App.go('roomssetup'); };
      tools.appendChild(layoutBtn);
      tools.appendChild(groupSel);
      tools.appendChild(typeSel);
      tools.appendChild(searchInp);
      tools.appendChild(dirtyToggle);
      tools.appendChild(setupBtn);
      bar.appendChild(tools);
      wrap.appendChild(bar);

      /* ── بدنه: نقشه + راهنمای عمودی ── */
      var body = el('div', 'rr-body');
      var mapEl = el('div', 'rr-map');
      var legend = el('div', 'rr-legend');
      body.appendChild(mapEl);
      body.appendChild(legend);
      wrap.appendChild(body);

      var msg = el('div', 'muted', 'در حال بارگذاری نقشهٔ اتاق‌ها…');
      wrap.appendChild(msg);
      root.appendChild(wrap);

      var state = { floors: [], layout: 'column', groupBy: 'floor', onlyDirty: false, typeFilter: '', search: '' };
      var allRooms = [];

      function occupancyPct() {
        if (!allRooms.length) return '۰٫۰۰';
        var occN = allRooms.filter(function (r) { return r.status === 'OCCUPIED'; }).length;
        var pct = (occN / allRooms.length) * 100;
        return Num.toPersian(pct.toFixed(2)).replace('.', '٫');
      }

      function renderLegend() {
        var counts = {};
        allRooms.forEach(function (r) {
          var v = roomVisual(r);
          counts[v.label] = (counts[v.label] || 0) + 1;
        });
        legend.innerHTML = '';
        var colors = { 'پر': '#1668b8', 'خالی — تمیز': '#a9b0b8', 'بازبینی‌شده': '#1a9e56', 'در حال نظافت': '#7fc341', 'خروج/کثیف': '#b44fd8', 'کثیف': '#b44fd8', 'بسته': '#c81e1e' };
        Object.keys(counts).forEach(function (label) {
          var row = el('div', 'rr-legend-row');
          var sq = el('span', 'rr-legend-sq');
          sq.style.background = colors[label] || '#999';
          row.appendChild(sq);
          row.appendChild(el('span', null, label + ' ' + Num.toPersian(counts[label])));
          legend.appendChild(row);
        });
      }

      function roomTile(room) {
        var v = roomVisual(room);
        var tile = el('button', 'rr-tile ' + v.cls);
        tile.innerHTML = '<span class="rr-tile-no">' + Num.toPersian(room.code) + '</span>' +
          (room.status === 'OUT_OF_SERVICE' ? '<span class="rr-pin">📌</span>' : '');
        var tip = el('div', 'rr-tip');
        tip.innerHTML =
          '<b>اتاق ' + Num.toPersian(room.code) + '</b> — ' + (room.roomType && room.roomType.nameFa || '—') + '<br>' +
          'وضعیت: ' + STATUS_FA[room.status] + (room.hkStatus ? ' • نظافت: ' + HK_FA[room.hkStatus] : '') + '<br>' +
          'نرخ پایه: ' + Num.toPersian(Number(room.roomType && room.roomType.baseRateRials || 0).toLocaleString('en-US')) + ' ریال' +
          (room.note ? '<br>یادداشت: ' + room.note : '');
        tile.appendChild(tip);
        tile.onclick = function () { openRoomPanel(room); };
        return tile;
      }

      function renderMap() {
        mapEl.innerHTML = '';
        /* نیاز ۲ کارفرما: گروه‌بندی دلخواه — طبقه یا نوع اتاق (تویین‌ها زیر هم، دبل‌ها زیر هم، …) */
        var rooms = [];
        state.floors.forEach(function (f) {
          f.rooms.forEach(function (r) {
            if (state.typeFilter && (!r.roomType || r.roomType.code !== state.typeFilter)) return;
            if (state.onlyDirty && !(r.status === 'DIRTY' || r.hkStatus === 'DIRTY')) return;
            if (state.search && !String(r.code).includes(state.search)) return;
            rooms.push(r);
          });
        });
        if (!rooms.length) {
          mapEl.appendChild(el('div', 'muted', 'اتاقی با این فیلتر یافت نشد.'));
          return;
        }
        var groups = [];
        if (state.groupBy === 'floor') {
          var byFloor = {};
          rooms.forEach(function (r) {
            var fl = r.floor != null ? r.floor : parseInt(String(r.code).charAt(0), 10) || 1;
            (byFloor[fl] = byFloor[fl] || []).push(r);
          });
          Object.keys(byFloor).sort(function (a, b) { return a - b; }).forEach(function (fl) {
            groups.push({ title: 'طبقهٔ ' + Num.toPersian(fl), rooms: byFloor[fl].slice().sort(function (a, b) { return String(a.code).localeCompare(String(b.code)); }) });
          });
        } else {
          var byType = {};
          rooms.forEach(function (r) {
            var key = (r.roomType && r.roomType.code) || 'NONE';
            (byType[key] = byType[key] || []).push(r);
          });
          Object.keys(byType).forEach(function (key) {
            var sample = rooms.find(function (r) { return r.roomType && r.roomType.code === key; });
            groups.push({ title: sample && sample.roomType ? sample.roomType.nameFa : 'بدون نوع', rooms: byType[key].slice().sort(function (a, b) { return String(a.code).localeCompare(String(b.code)); }) });
          });
        }
        groups.forEach(function (g) {
          var sec = el('div', 'rr-floor');
          if (state.layout === 'column') sec.className = 'rr-floor rr-floor-col';
          sec.appendChild(el('div', 'rr-floor-title', g.title));
          g.rooms.forEach(function (r) { sec.appendChild(roomTile(r)); });
          mapEl.appendChild(sec);
        });
      }

      function renderAll() {
        occ.innerHTML = 'درصد اشغالی: <b>' + occupancyPct() + '٪</b>' +
          ' • مجموع ' + Num.toPersian(allRooms.length) + ' اتاق';
        renderLegend();
        renderMap();
      }

      function openRoomPanel(room) {
        var v = roomVisual(room);
        var overlay = el('div', 'modal-overlay');
        var panel = el('div', 'panel rr-panel');
        panel.appendChild(el('h3', null, 'اتاق ' + Num.toPersian(room.code) + ' — ' + v.label));
        panel.appendChild(el('p', 'muted', (room.roomType && room.roomType.nameFa || '—') +
          ' • نرخ پایه: ' + Number(room.roomType && room.roomType.baseRateRials || 0).toLocaleString('en-US') + ' ریال'));

        var err = el('p', 'rr-err');
        function act(label, patch, disabled) {
          var b = el('button', 'rr-act-btn', label);
          if (disabled) b.disabled = true;
          b.onclick = function () {
            api('PATCH', '/pms/rooms/' + room.id, patch).then(function (res) {
              if (res.status >= 200 && res.status < 300) {
                overlay.remove();
                load();
              } else err.textContent = failText(res);
            }).catch(function (e) { err.textContent = 'خطای شبکه: ' + e.message; });
          };
          panel.appendChild(b);
        }

        /* عملیات آسا: بستن/باز کردن اتاق | نظافت کامل | شروع نظافت | بازبینی */
        if (room.status !== 'OCCUPIED') {
          act(room.status === 'OUT_OF_SERVICE' ? '🔓 باز کردن اتاق' : '🔒 بستن اتاق',
            { status: room.status === 'OUT_OF_SERVICE' ? 'AVAILABLE' : 'OUT_OF_SERVICE' });
        }
        if (room.status === 'DIRTY' || room.hkStatus === 'DIRTY') act('🧹 نظافت کامل شد (آماده‌سازی)', { hkStatus: 'CLEAN' });
        if (room.hkStatus === 'CLEAN' || room.hkStatus === 'INSPECTED') act('🧽 شروع نظافت', { hkStatus: 'IN_PROGRESS' });
        if (room.hkStatus === 'IN_PROGRESS') act('✅ بازبینی شد', { hkStatus: 'INSPECTED' });
        act('🖨 چاپ کارت اتاق', null, true); // فاز بعد: چاپ

        /* پیغام اتاق */
        var noteRow = el('div', 'rr-note-row');
        var noteInp = el('input');
        noteInp.value = room.note || '';
        noteInp.placeholder = 'پیغام اتاق (مزاحم نشوید، ساعت بیداری…)';
        var noteBtn = el('button', 'rr-act-btn', 'ثبت پیغام');
        noteBtn.onclick = function () {
          api('PATCH', '/pms/rooms/' + room.id, { note: noteInp.value || null }).then(function (res) {
            if (res.status >= 200 && res.status < 300) { overlay.remove(); load(); }
            else err.textContent = failText(res);
          });
        };
        noteRow.appendChild(noteInp);
        noteRow.appendChild(noteBtn);
        panel.appendChild(noteRow);

        var close = el('button', 'rr-act-btn rr-act-close', 'بستن');
        close.onclick = function () { overlay.remove(); };
        panel.appendChild(close);
        panel.appendChild(err);
        overlay.appendChild(panel);
        overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
        document.body.appendChild(overlay);
      }

      function demoData() {
        /* حالت نمایشی (فقط وقتی سرور در دسترس نیست) — ساختار مطابق خروجی /rooms/map */
        var types = { STD: { code: 'STD', nameFa: 'اتاق یک خوابه ۲ تخته', baseRateRials: '3200000' }, DBL: { code: 'DBL', nameFa: 'دبل', baseRateRials: '4500000' }, SUT: { code: 'SUT', nameFa: 'سوئیت', baseRateRials: '8200000' } };
        var statuses = [
          ['AVAILABLE', 'CLEAN'], ['OCCUPIED', 'CLEAN'], ['OCCUPIED', 'CLEAN'], ['DIRTY', 'DIRTY'],
          ['AVAILABLE', 'INSPECTED'], ['OUT_OF_SERVICE', 'CLEAN'], ['OCCUPIED', 'DIRTY'], ['AVAILABLE', 'CLEAN'],
        ];
        var floors = [];
        [1, 2, 3].forEach(function (fl) {
          var rooms = [];
          for (var i = 1; i <= 8; i++) {
            var s = statuses[(fl * 8 + i) % statuses.length];
            rooms.push({
              id: 'demo-' + fl + '-' + i, code: String(fl) + '0' + i,
              status: s[0], hkStatus: s[1], note: (fl === 2 && i === 3) ? 'مزاحم نشوید' : null,
              roomType: types[(fl + i) % 3 === 0 ? 'SUT' : (fl + i) % 2 === 0 ? 'DBL' : 'STD'],
            });
          }
          floors.push({ floor: fl, rooms: rooms });
        });
        return { floors: floors };
      }

      function load() {
        msg.textContent = 'در حال بارگذاری…';
        msg.hidden = false;
        api('GET', '/pms/rooms/map').then(function (res) {
          if (res.status >= 200 && res.status < 300 && res.body.data) {
            applyData(res.body.data.floors || []);
          } else {
            msg.textContent = 'خطا در دریافت نقشه: ' + failText(res) + ' — برنامه به API نیاز دارد.';
          }
        }).catch(function () {
          /* سرور در دسترس نیست → دادهٔ نمایشی با بنر هشدار */
          var d = demoData();
          applyData(d.floors);
          msg.hidden = false;
          msg.textContent = '⚠ حالت نمایشی — سرور در دسترس نیست. در اجرای واقعی (EXE/APK) داده از API می‌آید.';
        });
      }

      function applyData(floors) {
        state.floors = floors;
        allRooms = [];
        state.floors.forEach(function (f) { allRooms = allRooms.concat(f.rooms); });
        var types = {};
        allRooms.forEach(function (r) {
          if (r.roomType && !types[r.roomType.code]) {
            types[r.roomType.code] = r.roomType.nameFa;
            typeSel.appendChild(new Option(r.roomType.nameFa, r.roomType.code));
          }
        });
        msg.hidden = true;
        renderAll();
      }

      groupSel.onchange = function () { state.groupBy = groupSel.value; renderMap(); };
      layoutBtn.onclick = function () {
        state.layout = state.layout === 'column' ? 'flow' : 'column';
        layoutBtn.textContent = state.layout === 'column' ? 'چیدمان: ستونی' : 'چیدمان: جریانی';
        renderMap();
      };
      typeSel.onchange = function () { state.typeFilter = typeSel.value; renderMap(); };
      searchInp.oninput = function () { state.search = searchInp.value.trim(); renderMap(); };
      dirtyToggle.onclick = function () {
        state.onlyDirty = !state.onlyDirty;
        dirtyToggle.textContent = state.onlyDirty ? 'نمایش همه' : 'فقط نیازمند نظافت';
        renderMap();
      };

      load();
    },
  };
})(window);
