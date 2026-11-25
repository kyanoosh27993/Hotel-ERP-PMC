/**
 * modules/frontdesk.js — فاز ۴ (F4-T1…T3 + T7 + T8): پنل پذیرش و رزرواسیون
 * نقشهٔ اتاق (طبقه‌بندی رنگی) | رزرو توسعه‌یافته | لیست انتظار | ورود/خروج |
 * خانه‌داری پایه | حسابرسی شبانه — همهٔ اعداد از API واقعی (/api/v1/pms/*).
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

  var STATUS_FA = { AVAILABLE: 'آزاد', OCCUPIED: 'اشغال', DIRTY: 'کثیف', OUT_OF_SERVICE: 'خارج از سرویس' };
  var HK_FA = { CLEAN: 'نظیف', DIRTY: 'کثیف', IN_PROGRESS: 'در حال نظافت', INSPECTED: 'بازبینی‌شده' };
  var STATUS_COLOR = { AVAILABLE: '#1a7f4e', OCCUPIED: '#1d4ed8', DIRTY: '#b45309', OUT_OF_SERVICE: '#7f1d1d' };

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

  Modules.frontdesk = {
    title: 'پذیرش و رزرواسیون',
    icon: '🛎️',
    render: function (root) {
      root.appendChild(el('h2', null, 'پذیرش و رزرواسیون — فاز ۴'));

      // ── اتصال و ورود ──
      root.appendChild(App.sessionPanel());

      var status = el('div', 'muted', '');
      root.appendChild(status);

      // ── نقشه اتاق ──
      var mapPanel = el('div', 'panel');
      mapPanel.appendChild(el('h3', null, 'نقشهٔ اتاق‌ها (F4-T1) — کلیک روی اتاق = عملیات'));
      var mapHost = el('div');
      mapPanel.appendChild(mapHost);
      root.appendChild(mapPanel);

      // ── پذیرش ──
      var ciPanel = el('div', 'panel');
      ciPanel.appendChild(el('h3', null, 'پذیرش مهمان (F4-T3)'));
      var resvIn = el('input', 'input'); resvIn.placeholder = 'شناسه رزرو (اختیاری — برای ورود حضوری خالی)';
      var guestIn = el('input', 'input'); guestIn.placeholder = 'نام مهمان حضوری (در صورت نبود رزرو)';
      /* نیاز یکتایی کارفرما: گیت هویتی سخت‌گیرانه — چک‌این فقط با رکورد یکتای دارای کد ملی/شناسهٔ ملی معتبر */
      var partyIn = el('input', 'input'); partyIn.placeholder = 'رکورد یکتای مهمان (الزامی) — جستجوی زنده با نام/کد ملی';
      var ciPartyId = '';
      var ciPartyName = '';
      var ciPartyMsg = el('div', 'muted');
      Uniq.suggest(partyIn, {
        onPick: function (p) {
          ciPartyId = p.id;
          ciPartyName = Uniq.displayName(p);
          partyIn.value = ciPartyName;
          ciPartyMsg.style.color = '#1a7f37';
          ciPartyMsg.textContent = '✅ رکورد انتخاب‌شده: ' + ciPartyName + ' (' + (p.kindFa || Uniq.KIND_FA[p.kind] || '—') + ')' +
            (p.nationalId ? ' — کد ملی: ' + p.nationalId : '') + (p.natIdentifier ? ' — شناسهٔ ملی: ' + p.natIdentifier : '') +
            (p.postalCode ? ' — کد پستی: ' + p.postalCode : '');
        },
      });
      partyIn.addEventListener('input', function () {
        if (partyIn.value.trim() !== ciPartyName) {
          ciPartyId = '';
          ciPartyMsg.textContent = '';
        }
      });
      var roomsIn = el('input', 'input'); roomsIn.placeholder = 'کد اتاق‌ها با کاما: 302,303';
      var pcoIn = el('input', 'input'); pcoIn.placeholder = 'تاریخ خروج برنامه‌ریزی YYYY-MM-DD';
      pcoIn.value = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      var rateIn = el('input', 'input'); rateIn.placeholder = 'نرخ توافقی ریال/شب (اختیاری)';
      var ciBtn = el('button', 'btn btn-primary', 'ثبت ورود');
      var ciMsg = el('div', 'muted');
      ciPanel.appendChild(row('رزرو', resvIn));
      ciPanel.appendChild(row('مهمان', guestIn));
      ciPanel.appendChild(row('رکورد یکتای مهمان', partyIn));
      ciPanel.appendChild(ciPartyMsg);
      ciPanel.appendChild(row('اتاق‌ها', roomsIn));
      ciPanel.appendChild(row('خروج', pcoIn));
      ciPanel.appendChild(row('نرخ', rateIn));
      ciPanel.appendChild(ciBtn);
      ciPanel.appendChild(ciMsg);
      root.appendChild(ciPanel);

      // ── اقامت‌های باز ──
      var staysPanel = el('div', 'panel');
      staysPanel.appendChild(el('h3', null, 'اقامت‌های جاری — خروج و فاکتور'));
      var staysHost = el('div');
      staysPanel.appendChild(staysHost);
      root.appendChild(staysPanel);

      // ── رزروها ──
      var resvPanel = el('div', 'panel');
      resvPanel.appendChild(el('h3', null, 'رزروهای اخیر (F4-T2)'));
      var resvHost = el('div');
      resvPanel.appendChild(resvHost);
      root.appendChild(resvPanel);

      // ── حسابرسی شبانه ──
      var naPanel = el('div', 'panel');
      naPanel.appendChild(el('h3', null, 'حسابرسی شبانه (F4-T8)'));
      var naDate = el('input', 'input'); naDate.value = new Date().toISOString().slice(0, 10);
      var naBtn = el('button', 'btn', 'اجرای حسابرسی برای تاریخ امروز');
      var naMsg = el('pre'); naMsg.style.whiteSpace = 'pre-wrap';
      naPanel.appendChild(row('تاریخ', naDate));
      naPanel.appendChild(naBtn);
      naPanel.appendChild(naMsg);
      naBtn.onclick = function () {
        api('POST', '/pms/night-audit', { businessDate: naDate.value.trim() }).then(function (res) {
          naMsg.textContent = res.status === 201
            ? JSON.stringify(res.body.data, null, 2)
            : '❌ ' + failText(res);
          loadMap();
        });
      };
      root.appendChild(naPanel);

      function rootClear(r) { while (r.firstChild) r.removeChild(r.firstChild); return r; }

      function roomChip(room) {
        var c = el('button', 'btn');
        c.style.cssText = 'border:2px solid ' + (STATUS_COLOR[room.status] || '#666') + ';min-width:96px;text-align:center;margin:3px;';
        c.innerHTML = '<b>' + room.code + '</b><br><span class="fit">' + STATUS_FA[room.status] + ' / ' + HK_FA[room.hkStatus] + '</span>';
        c.title = room.note ? ('یادداشت: ' + room.note) : room.code;
        c.onclick = function () { roomMenu(room); };
        return c;
      }

      function roomMenu(room) {
        var act = prompt(
          'اتاق ' + room.code + ' — وضعیت: ' + STATUS_FA[room.status] + ' / ' + HK_FA[room.hkStatus] +
          '\nعملیات:\n1) نظافت کامل (CLEAN)\n2) در حال نظافت\n3) بازبینی‌شده\n4) خارج از سرویس\n5) آزاد کردن (بدون نظافت)\n6) یادداشت تعمیر',
          '1'
        );
        if (!act) return;
        var patch = {};
        if (act === '1') patch.hkStatus = 'CLEAN';
        else if (act === '2') patch.hkStatus = 'IN_PROGRESS';
        else if (act === '3') patch.hkStatus = 'INSPECTED';
        else if (act === '4') patch.status = 'OUT_OF_SERVICE';
        else if (act === '5') patch.status = 'AVAILABLE';
        else if (act === '6') patch.note = prompt('یادداشت:') || '';
        if (!Object.keys(patch).length) return;
        api('PATCH', '/pms/rooms/' + room.id, patch).then(function (res) {
          status.textContent = res.status === 200 ? ('اتاق ' + room.code + ' به‌روزرسانی شد ✅') : ('❌ ' + failText(res));
          loadMap();
        });
      }

      function loadMap() {
        mapHost.textContent = '';
        api('GET', '/pms/rooms/map').then(function (res) {
          if (res.status !== 200) { status.textContent = '❌ نقشه: ' + failText(res); return; }
          var d = res.body.data;
          status.textContent = 'آزاد: ' + d.summary.AVAILABLE + ' | اشغال: ' + d.summary.OCCUPIED +
            ' | کثیف: ' + d.summary.DIRTY + ' | خارج از سرویس: ' + d.summary.OUT_OF_SERVICE;
          d.floors.forEach(function (f) {
            var line = el('div');
            line.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;align-items:center;margin:6px 0;';
            line.appendChild(el('b', null, 'طبقهٔ ' + f.floor + ':'));
            f.rooms.forEach(function (r) { line.appendChild(roomChip(r)); });
            mapHost.appendChild(line);
          });
        });
      }

      ciBtn.onclick = function () {
        if (!ciPartyId) {
          ciMsg.textContent = '❌ انتخاب رکورد یکتای مهمان الزامی است — با تایپ نام یا کد ملی از جستجوی زنده انتخاب کنید (رزروهای قدیمی هم باید پیش از چک‌این به رکورد یکتا با کد ملی/شناسهٔ ملی معتبر متصل شوند).';
          return;
        }
        var roomCodes = roomsIn.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        var roomIdsPromises = api('GET', '/pms/rooms/map').then(function (res) {
          var ids = [];
          (res.body.data ? res.body.data.floors : []).forEach(function (f) {
            f.rooms.forEach(function (r) { if (roomCodes.indexOf(r.code) >= 0) ids.push(r.id); });
          });
          return ids;
        });
        roomIdsPromises.then(function (ids) {
          var body = {
            idempotencyKey: 'web-ci-' + Date.now() + '-' + Math.floor(Math.random() * 1e6),
            roomIds: ids,
            plannedCheckOut: pcoIn.value.trim(),
            partyId: ciPartyId, /* گیت هویتی: رکورد یکتا — رزرو قدیمی هم در همین لحظه پیوند می‌خورد */
          };
          if (resvIn.value.trim()) body.reservationId = resvIn.value.trim();
          if (guestIn.value.trim()) body.guestName = guestIn.value.trim();
          if (rateIn.value.trim()) body.rateOverrideRials = rateIn.value.trim().replace(/\D/g, '');
          api('POST', '/pms/stays/check-in', body).then(function (res) {
            if (res.status === 201) {
              ciMsg.textContent = '✅ ورود ثبت شد — کد اقامت: ' + res.body.data.code + ' (اتاق‌ها: ' + res.body.data.rooms.join('،') + ')';
              loadMap(); loadStays();
            } else {
              ciMsg.textContent = '❌ ' + failText(res);
            }
          });
        });
      };

      function loadStays() {
        staysHost.textContent = '';
        api('GET', '/pms/stays').then(function (res) {
          if (res.status !== 200) return;
          var open = res.body.data.filter(function (s) { return s.status === 'OPEN'; });
          if (!open.length) { staysHost.appendChild(el('div', 'muted', 'اقامت بازی وجود ندارد.')); return; }
          open.forEach(function (s) {
            var line = el('div');
            line.style.cssText = 'display:flex;gap:8px;align-items:center;margin:4px 0;flex-wrap:wrap;';
            line.appendChild(el('span', 'fit', s.code + ' — ' + s.guestName + ' | اتاق: ' + s.rooms.join('،') + ' | خروج: ' + s.plannedCheckOut));
            var b = el('button', 'btn', 'ثبت خروج');
            b.onclick = function () {
              api('POST', '/pms/stays/' + s.id + '/check-out').then(function (r2) {
                status.textContent = r2.status === 201
                  ? ('خروج ' + s.code + ' ✅ فاکتور: ' + r2.body.data.folioRials + ' ریال (' + r2.body.data.nights + ' شب)')
                  : ('❌ ' + failText(r2));
                loadMap(); loadStays();
              });
            };
            line.appendChild(b);
            staysHost.appendChild(line);
          });
        });
      }

      function loadReservations() {
        resvHost.textContent = '';
        api('GET', '/pms/reservations').then(function (res) {
          if (res.status !== 200) { resvHost.appendChild(el('div', 'muted', 'برای مشاهده رزروها وارد شوید.')); return; }
          res.body.data.slice(0, 12).forEach(function (r) {
            var line = el('div', 'muted fit');
            line.textContent = r.code + ' | ' + r.guestName + ' | ' + r.checkIn + ' → ' + r.checkOut +
              ' (' + r.nights + ' شب) | ' + r.totalRials + ' ریال | کانال: ' + r.source + ' | ' + r.status +
              (r.groupName ? ' | گروه: ' + r.groupName : '');
            resvHost.appendChild(line);
          });
          if (!res.body.data.length) resvHost.appendChild(el('div', 'muted', 'رزروی ثبت نشده است.'));
        });
      }

      loadMap();
      loadStays();
      loadReservations();
    },
  };
})(window);
