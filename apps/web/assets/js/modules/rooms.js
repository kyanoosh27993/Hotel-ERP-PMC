/**
 * modules/rooms.js — نقشه اتاق زنده (فاز ۴ — F4-T1…T3)
 * اتصال به API واقعی: GET /rooms، PATCH /rooms/:id/status، لیست انتظار.
 * از همان توکن/آدرس پنل زنده داشبورد استفاده می‌کند (localStorage مشترک).
 * رنگ وضعیت: سبز=آماده، نارنجی=نیازمند نظافت، خاکستری=خارج از سرویس، آبی=اشغال‌شده.
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
  function apiBase() { return localStorage.getItem('hotel-erp-api-base') || 'http://localhost:3000/api/v1'; }
  function apiToken() { return localStorage.getItem('hotel-erp-token') || ''; }
  function authHeaders() { return { Authorization: 'Bearer ' + apiToken(), 'Content-Type': 'application/json' }; }

  var STATUS_FA = { AVAILABLE: 'آماده', OCCUPIED: 'اشغال‌شده', DIRTY: 'نیازمند نظافت', OUT_OF_SERVICE: 'خارج از سرویس' };
  var STATUS_CLASS = { AVAILABLE: 'room-available', OCCUPIED: 'room-occupied', DIRTY: 'room-dirty', OUT_OF_SERVICE: 'room-oos' };

  function toast(root, msg) {
    var t = el('div', 'muted', msg);
    t.style.padding = '6px 0';
    root.appendChild(t);
    setTimeout(function () { t.remove(); }, 4000);
  }

  Modules.rooms = {
    title: 'نقشه اتاق (فاز ۴)',
    render: function (root) {
      root.appendChild(el('h2', null, 'نقشه اتاق — وضعیت لحظه‌ای از سرور'));
      root.appendChild(el('p', 'muted', 'تغییر وضعیت اتاق بلافاصله در ظرفیت رزرو و داشبوردها اثر می‌گذارد (F4-T1). خارج از سرویس نیازمند دلیل است.'));

      var grid = el('div', 'room-grid');
      grid.style.display = 'grid';
      grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(120px, 1fr))';
      grid.style.gap = '8px';
      root.appendChild(grid);

      var status = el('div', 'muted', '');
      root.appendChild(status);

      // لیست انتظار
      var wlPanel = el('div', 'panel');
      wlPanel.appendChild(el('h3', null, 'لیست انتظار (F4-T2)'));
      var wlHost = el('div');
      wlPanel.appendChild(wlHost);
      root.appendChild(wlPanel);

      function loadRooms() {
        fetch(apiBase() + '/rooms', { headers: authHeaders() })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function (j) {
            grid.textContent = '';
            status.textContent = '';
            (j.data || []).forEach(function (room) {
              var card = el('div', 'room-card ' + (STATUS_CLASS[room.status] || ''));
              card.style.border = '1px solid var(--border, #ccc)';
              card.style.borderRadius = '8px';
              card.style.padding = '10px';
              card.style.textAlign = 'center';
              card.appendChild(el('div', null, room.code + ' — طبقه ' + room.floor));
              card.appendChild(el('div', 'muted', room.roomTypeFa));
              card.appendChild(el('div', 'kpi-value', STATUS_FA[room.status] || room.status));
              if (room.note) card.appendChild(el('div', 'muted', room.note));
              ['AVAILABLE', 'DIRTY', 'OUT_OF_SERVICE'].forEach(function (st) {
                if (st === room.status) return;
                var b = el('button', 'btn', STATUS_FA[st]);
                b.style.margin = '2px';
                b.addEventListener('click', function () {
                  var note = st === 'OUT_OF_SERVICE' ? prompt('دلیل خارج از سرویس (تعمیرات):', 'تعمیرات') : undefined;
                  if (st === 'OUT_OF_SERVICE' && !note) return;
                  fetch(apiBase() + '/rooms/' + room.id + '/status', {
                    method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ status: st, note: note })
                  }).then(function (r) { return r.json().then(function (jj) { return { ok: r.ok, jj: jj }; }); })
                    .then(function (res) {
                      if (!res.ok) { toast(root, 'خطا: ' + (res.jj.error && res.jj.error.message || res.jj.message || 'نامشخص')); return; }
                      toast(root, 'وضعیت ' + room.code + ' → ' + STATUS_FA[st] + ' ✓');
                      loadRooms();
                    });
                });
                card.appendChild(b);
              });
              grid.appendChild(card);
            });
          })
          .catch(function (e) { status.textContent = 'دریافت اتاق‌ها ناموفق: ' + e.message + ' — توکن/آدرس API را در داشبورد تنظیم کنید'; });
      }

      function loadWaitlist() {
        fetch(apiBase() + '/waiting-list', { headers: authHeaders() })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function (j) {
            wlHost.textContent = '';
            (j.data || []).forEach(function (w) {
              var row = el('div');
              row.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 0;border-bottom:1px dashed var(--border,#ddd)';
              row.appendChild(el('span', null, w.guestName + ' (' + w.roomTypeFa + ') ' + w.fromDate + '→' + w.toDate));
              row.appendChild(el('span', 'muted', STATUS_FA[w.status] ? (w.status === 'WAITING' ? 'در انتظار' : w.status === 'CONVERTED' ? 'تبدیل‌شده' : 'لغو‌شده') : w.status));
              if (w.status === 'WAITING') {
                var cv = el('button', 'btn', 'تبدیل به رزرو');
                cv.addEventListener('click', function () {
                  fetch(apiBase() + '/waiting-list/' + w.id + '/convert', { method: 'POST', headers: authHeaders() })
                    .then(function (r) { return r.json().then(function (jj) { return { ok: r.ok, jj: jj }; }); })
                    .then(function (res) {
                      toast(root, res.ok ? 'تبدیل به رزرو انجام شد ✓' : 'تبدیل ناموفق (ظرفیت پر است): ' + (res.jj.error && res.jj.error.message || ''));
                      loadWaitlist();
                    });
                });
                var cn = el('button', 'btn', 'لغو');
                cn.addEventListener('click', function () {
                  fetch(apiBase() + '/waiting-list/' + w.id + '/cancel', { method: 'PATCH', headers: authHeaders() })
                    .then(function () { loadWaitlist(); });
                });
                row.appendChild(cv);
                row.appendChild(cn);
              }
              wlHost.appendChild(row);
            });
            if (!(j.data || []).length) wlHost.appendChild(el('p', 'muted', 'لیست انتظار خالی است.'));
          })
          .catch(function (e) { wlHost.textContent = 'دریافت لیست انتظار ناموفق: ' + e.message; });
      }

      loadRooms();
      loadWaitlist();
      Num.fitAll(root);
    }
  };
})(window);
