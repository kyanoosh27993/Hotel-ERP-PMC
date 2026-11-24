/**
 * modules/housekeepingops.js — فاز ۱۰ (موج ۱): خانه‌داری کامل، تعمیرات، لاندری، اشیای جامانده
 * وظایف (تخصیص/انجام) | بازرسی | درخواست تعمیر با گردش وضعیت | بچ لاندری | جامانده‌ها.
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

  var TASK_KIND_FA = { CLEANING: 'نظافت', TURNDOWN: 'Turn-down', INSPECTION: 'بازرسی', MAINTENANCE_FOLLOWUP: 'پیگیری تعمیر' };
  var TASK_STATUS_FA = { PENDING: 'در انتظار', IN_PROGRESS: 'در انجام', DONE: 'انجام‌شده', CANCELED: 'لغو' };
  var PRIO_FA = { LOW: 'کم', NORMAL: 'عادی', HIGH: 'زیاد', URGENT: 'فوری' };
  var MNT_STATUS_FA = { OPEN: 'باز', ASSIGNED: 'تخصیص‌شده', IN_PROGRESS: 'در تعمیر', DONE: 'انجام‌شده', CANCELED: 'لغو' };
  var LF_STATUS_FA = { STORED: 'نگهداری', RETURNED: 'تحویل‌شده', DISPOSED: 'مفصول' };

  Modules.housekeepingops = {
    title: 'خانه‌داری و تعمیرات',
    icon: '🧹',
    render: function (root) {
      root.appendChild(el('h2', null, 'خانه‌داری، لاندری، تعمیرات و اشیای جامانده — فاز ۱۰'));

      var self = this;

      // ── اتصال ──
      var conn = el('div', 'panel');
      conn.appendChild(el('h3', null, 'اتصال به سرور (نقش خانه‌دار/پذیرش/مدیر)'));
      var baseIn = el('input', 'input'); baseIn.value = apiBase();
      var userIn = el('input', 'input'); userIn.placeholder = 'نام کاربری (مثلاً housekeeper)';
      var passIn = el('input', 'input'); passIn.type = 'password'; passIn.placeholder = 'گذرواژه';
      var loginBtn = el('button', 'btn btn-primary', 'ورود و ذخیره توکن');
      var connMsg = el('div', 'muted');
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
            connMsg.textContent = '✅ ورود موفق.';
            root.innerHTML = '';
            self.render(root);
          } else connMsg.textContent = '❌ ' + failText(res);
        });
      };
      root.appendChild(conn);

      // ── وظایف ──
      var taskPanel = el('div', 'panel');
      taskPanel.appendChild(el('h3', null, 'وظایف خانه‌داری (F10-T1)'));
      var roomIn = el('input', 'input'); roomIn.placeholder = 'کد اتاق: 301';
      var kindSel = el('select', 'input');
      Object.keys(TASK_KIND_FA).forEach(function (k) { var o = el('option', null, TASK_KIND_FA[k]); o.value = k; kindSel.appendChild(o); });
      var dateIn = el('input', 'input'); dateIn.value = new Date().toISOString().slice(0, 10);
      var addTaskBtn = el('button', 'btn btn-primary', 'ایجاد وظیفه');
      var taskMsg = el('div', 'muted');
      var tasksHost = el('div');
      var tasksBtn = el('button', 'btn', 'بارگیری وظایف امروز');
      taskPanel.appendChild(row('اتاق', roomIn));
      taskPanel.appendChild(row('نوع', kindSel));
      taskPanel.appendChild(row('تاریخ', dateIn));
      taskPanel.appendChild(addTaskBtn);
      taskPanel.appendChild(tasksBtn);
      taskPanel.appendChild(taskMsg);
      taskPanel.appendChild(tasksHost);
      addTaskBtn.onclick = function () {
        api('POST', '/housekeeping/tasks', {
          roomCode: roomIn.value.trim(),
          kind: kindSel.value,
          scheduledDate: dateIn.value,
        }).then(function (res) {
          if (res.status === 201 || res.status === 200) {
            taskMsg.textContent = '✅ وظیفهٔ ' + TASK_KIND_FA[res.body.kind] + ' برای اتاق ' + res.body.roomCode + ' ثبت شد.';
            tasksBtn.click();
          } else taskMsg.textContent = '❌ ' + failText(res);
        });
      };
      tasksBtn.onclick = function () {
        api('GET', '/housekeeping/tasks?limit=15').then(function (res) {
          if (res.status !== 200) { tasksHost.textContent = failText(res); return; }
          tasksHost.innerHTML = '';
          var rows = res.body.map(function (t) {
            var tr = el('tr');
            [t.roomCode, TASK_KIND_FA[t.kind] || t.kind, TASK_STATUS_FA[t.status] || t.status, PRIO_FA[t.priority] || t.priority, t.scheduledDate].forEach(function (c) {
              tr.appendChild(el('td', null, c));
            });
            var act = el('td');
            if (t.status === 'PENDING' || t.status === 'IN_PROGRESS') {
              var doneBtn = el('button', 'btn', 'انجام');
              doneBtn.onclick = function () {
                api('POST', '/housekeeping/tasks/' + t.id + '/complete', {}).then(function () { tasksBtn.click(); });
              };
              var cxBtn = el('button', 'btn btn-danger', 'لغو');
              cxBtn.onclick = function () {
                var why = window.prompt('دلیل لغو؟');
                if (!why) return;
                api('POST', '/housekeeping/tasks/' + t.id + '/cancel', { note: why }).then(function () { tasksBtn.click(); });
              };
              act.appendChild(doneBtn); act.appendChild(cxBtn);
            }
            tr.appendChild(act);
            return tr;
          });
          tasksHost.appendChild(tableOf(['اتاق', 'نوع', 'وضعیت', 'اولویت', 'تاریخ', ''], rows));
        });
      };
      root.appendChild(taskPanel);

      // ── بازرسی ──
      var insPanel = el('div', 'panel');
      insPanel.appendChild(el('h3', null, 'بازرسی اتاق (قبول → نظیف/بازبینی‌شده، رد → کثیف)'));
      var insRoomIn = el('input', 'input'); insRoomIn.placeholder = 'کد اتاق';
      var passSel = el('select', 'input');
      [{ v: '1', t: 'قبول' }, { v: '0', t: 'رد' }].forEach(function (p) { var o = el('option', null, p.t); o.value = p.v; passSel.appendChild(o); });
      var scoreIn = el('input', 'input'); scoreIn.placeholder = 'امتیاز ۰–۱۰۰ (اختیاری)';
      var insBtn = el('button', 'btn btn-primary', 'ثبت بازرسی');
      var insMsg = el('div', 'muted');
      insPanel.appendChild(row('اتاق', insRoomIn));
      insPanel.appendChild(row('نتیجه', passSel));
      insPanel.appendChild(row('امتیاز', scoreIn));
      insPanel.appendChild(insBtn);
      insPanel.appendChild(insMsg);
      insBtn.onclick = function () {
        api('POST', '/housekeeping/inspections', {
          roomCode: insRoomIn.value.trim(),
          passed: passSel.value === '1',
          score: scoreIn.value ? Number(scoreIn.value) : undefined,
        }).then(function (res) {
          if (res.status === 201 || res.status === 200) insMsg.textContent = '✅ بازرسی ثبت شد.';
          else insMsg.textContent = '❌ ' + failText(res);
        });
      };
      root.appendChild(insPanel);

      // ── تعمیرات ──
      var mntPanel = el('div', 'panel');
      mntPanel.appendChild(el('h3', null, 'درخواست تعمیر (F10-T2)'));
      var mntRoomIn = el('input', 'input'); mntRoomIn.placeholder = 'کد اتاق (اختیاری)';
      var mntAssetIn = el('input', 'input'); mntAssetIn.placeholder = 'کد دارایی FA-00001 (اختیاری)';
      var mntTitleIn = el('input', 'input'); mntTitleIn.placeholder = 'عنوان خرابی';
      var mntDescIn = el('input', 'input'); mntDescIn.placeholder = 'شرح';
      var mntAddBtn = el('button', 'btn btn-primary', 'ثبت درخواست');
      var mntMsg = el('div', 'muted');
      var mntHost = el('div');
      var mntListBtn = el('button', 'btn', 'بارگیری درخواست‌های باز');
      mntPanel.appendChild(row('اتاق', mntRoomIn));
      mntPanel.appendChild(row('دارایی', mntAssetIn));
      mntPanel.appendChild(row('عنوان', mntTitleIn));
      mntPanel.appendChild(row('شرح', mntDescIn));
      mntPanel.appendChild(mntAddBtn);
      mntPanel.appendChild(mntListBtn);
      mntPanel.appendChild(mntMsg);
      mntPanel.appendChild(mntHost);
      mntAddBtn.onclick = function () {
        api('POST', '/housekeeping/maintenance', {
          roomCode: mntRoomIn.value.trim() || undefined,
          assetCode: mntAssetIn.value.trim() || undefined,
          title: mntTitleIn.value.trim(),
          description: mntDescIn.value.trim() || mntTitleIn.value.trim(),
        }).then(function (res) {
          if (res.status === 201 || res.status === 200) {
            mntMsg.textContent = '✅ درخواست ' + res.body.requestNo + ' ثبت شد.';
            mntTitleIn.value = ''; mntDescIn.value = '';
            mntListBtn.click();
          } else mntMsg.textContent = '❌ ' + failText(res);
        });
      };
      mntListBtn.onclick = function () {
        api('GET', '/housekeeping/maintenance?limit=15').then(function (res) {
          if (res.status !== 200) { mntHost.textContent = failText(res); return; }
          mntHost.innerHTML = '';
          var rows = res.body.map(function (m) {
            var tr = el('tr');
            [m.requestNo, m.roomCode || m.assetCode || '—', m.title, PRIO_FA[m.priority] || m.priority, MNT_STATUS_FA[m.status] || m.status, m.costRials == null ? '—' : Num.toPersian(m.costRials) + ' ریال'].forEach(function (c) {
              tr.appendChild(el('td', null, c));
            });
            var act = el('td');
            if (m.status !== 'DONE' && m.status !== 'CANCELED') {
              var workBtn = el('button', 'btn', 'شروع تعمیر');
              workBtn.onclick = function () {
                api('POST', '/housekeeping/maintenance/' + m.id, { status: 'IN_PROGRESS' }).then(function () { mntListBtn.click(); });
              };
              var doneBtn = el('button', 'btn', 'بستن');
              doneBtn.onclick = function () {
                var cost = window.prompt('هزینهٔ تعمیر (ریال — اختیاری):', '0');
                api('POST', '/housekeeping/maintenance/' + m.id, {
                  status: 'DONE',
                  resolutionNote: 'انجام شد',
                  costRials: cost ? Number(cost) : undefined,
                }).then(function () { mntListBtn.click(); });
              };
              act.appendChild(workBtn); act.appendChild(doneBtn);
            }
            tr.appendChild(act);
            return tr;
          });
          mntHost.appendChild(tableOf(['شماره', 'موقعیت', 'عنوان', 'اولویت', 'وضعیت', 'هزینه', ''], rows));
        });
      };
      root.appendChild(mntPanel);

      // ── لاندری ──
      var ldyPanel = el('div', 'panel');
      ldyPanel.appendChild(el('h3', null, 'لاندری — بچ خروج/ورود (F10-T3)'));
      var ldyDirSel = el('select', 'input');
      [{ v: 'OUT_WASH', t: 'خروج برای شست‌وشو' }, { v: 'IN_RETURN', t: 'ورود مرجوعی' }].forEach(function (d) {
        var o = el('option', null, d.t); o.value = d.v; ldyDirSel.appendChild(o);
      });
      var ldyOpenBtn = el('button', 'btn btn-primary', 'باز کردن بچ');
      var ldyBatchIn = el('input', 'input'); ldyBatchIn.placeholder = 'شناسه بچ';
      var ldyItemIn = el('input', 'input'); ldyItemIn.placeholder = 'کد قلم: LIN-BED';
      var ldyQtyIn = el('input', 'input'); ldyQtyIn.placeholder = 'تعداد';
      var ldyAddBtn = el('button', 'btn', 'ثبت قلم');
      var ldyCloseBtn = el('button', 'btn', 'بستن بچ');
      var ldyMsg = el('div', 'muted');
      ldyPanel.appendChild(row('جهت', ldyDirSel));
      ldyPanel.appendChild(ldyOpenBtn);
      ldyPanel.appendChild(row('بچ', ldyBatchIn));
      ldyPanel.appendChild(row('قلم', ldyItemIn));
      ldyPanel.appendChild(row('تعداد', ldyQtyIn));
      ldyPanel.appendChild(ldyAddBtn);
      ldyPanel.appendChild(ldyCloseBtn);
      ldyPanel.appendChild(ldyMsg);
      ldyOpenBtn.onclick = function () {
        api('POST', '/housekeeping/laundry/batches', { direction: ldyDirSel.value }).then(function (res) {
          if (res.status === 201 || res.status === 200) {
            ldyBatchIn.value = res.body.id;
            ldyMsg.textContent = '✅ بچ ' + res.body.code + ' باز شد.';
          } else ldyMsg.textContent = '❌ ' + failText(res);
        });
      };
      ldyAddBtn.onclick = function () {
        api('POST', '/housekeeping/laundry/movements', {
          batchId: ldyBatchIn.value.trim(),
          linenCode: ldyItemIn.value.trim(),
          qty: Number(ldyQtyIn.value || 0),
        }).then(function (res) {
          if (res.status === 201 || res.status === 200) ldyMsg.textContent = '✅ قلم ثبت شد.';
          else ldyMsg.textContent = '❌ ' + failText(res);
        });
      };
      ldyCloseBtn.onclick = function () {
        api('POST', '/housekeeping/laundry/batches/close', { batchId: ldyBatchIn.value.trim() }).then(function (res) {
          if (res.status === 201 || res.status === 200) ldyMsg.textContent = '✅ بچ بسته شد.';
          else ldyMsg.textContent = '❌ ' + failText(res);
        });
      };
      root.appendChild(ldyPanel);

      // ── اشیای جامانده ──
      var lfPanel = el('div', 'panel');
      lfPanel.appendChild(el('h3', null, 'اشیای جامانده (F10-T4)'));
      var lfRoomIn = el('input', 'input'); lfRoomIn.placeholder = 'کد اتاق';
      var lfItemIn = el('input', 'input'); lfItemIn.placeholder = 'شرح شیء';
      var lfLocIn = el('input', 'input'); lfLocIn.placeholder = 'محل نگهداری (صندوق پذیرش…)';
      var lfAddBtn = el('button', 'btn btn-primary', 'ثبت شیء');
      var lfMsg = el('div', 'muted');
      var lfHost = el('div');
      var lfListBtn = el('button', 'btn', 'بارگیری جامانده‌ها');
      lfPanel.appendChild(row('اتاق', lfRoomIn));
      lfPanel.appendChild(row('شرح', lfItemIn));
      lfPanel.appendChild(row('محل', lfLocIn));
      lfPanel.appendChild(lfAddBtn);
      lfPanel.appendChild(lfListBtn);
      lfPanel.appendChild(lfMsg);
      lfPanel.appendChild(lfHost);
      lfAddBtn.onclick = function () {
        api('POST', '/housekeeping/lost-found', {
          roomCode: lfRoomIn.value.trim(),
          itemDesc: lfItemIn.value.trim(),
          storageLocation: lfLocIn.value.trim() || 'صندوق پذیرش',
        }).then(function (res) {
          if (res.status === 201 || res.status === 200) {
            lfMsg.textContent = '✅ ' + res.body.code + ' ثبت شد.';
            lfItemIn.value = '';
            lfListBtn.click();
          } else lfMsg.textContent = '❌ ' + failText(res);
        });
      };
      lfListBtn.onclick = function () {
        api('GET', '/housekeeping/lost-found?limit=15').then(function (res) {
          if (res.status !== 200) { lfHost.textContent = failText(res); return; }
          lfHost.innerHTML = '';
          var rows = res.body.map(function (f) {
            var tr = el('tr');
            [f.code, f.roomCode, f.itemDesc, f.storageLocation, LF_STATUS_FA[f.status] || f.status].forEach(function (c) {
              tr.appendChild(el('td', null, c));
            });
            var act = el('td');
            if (f.status === 'STORED') {
              var retBtn = el('button', 'btn', 'تحویل');
              retBtn.onclick = function () {
                var who = window.prompt('نام گیرنده؟');
                if (!who) return;
                api('POST', '/housekeeping/lost-found/' + f.id + '/resolve', { action: 'RETURNED', returnedTo: who }).then(function () { lfListBtn.click(); });
              };
              act.appendChild(retBtn);
            }
            tr.appendChild(act);
            return tr;
          });
          lfHost.appendChild(tableOf(['شماره', 'اتاق', 'شرح', 'محل', 'وضعیت', ''], rows));
        });
      };
      root.appendChild(lfPanel);

      tasksBtn.click();
      mntListBtn.click();
      lfListBtn.click();
      Num.fitAll(root);
    },
  };
})(window);
