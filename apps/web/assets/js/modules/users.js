/**
 * modules/users.js — نسخهٔ ۳٫۳: کاربران، گروه‌های کاربری و ماتریس دسترسی (درخواست کارفرما)
 * الگوی عکس‌های مرجع: ۱) لیست کاربران با گروه/وضعیت/آخرین ورود؛ ۲) گروه کاربری با افزودن/کم‌کردن اعضا؛
 * ۳) ماتریس دسترسی به‌تفکیک ماژول و هر جزء؛ ۴) فرم ویرایش کامل کاربر حتی نام کاربری و رمز.
 * همهٔ عملیات سمت سرور با مجوز users.manage کنترل می‌شود (PermissionsGuard).
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

  var ROLE_FA = {
    admin: 'مدیر سیستم', accountant: 'حسابدار', approver: 'تأییدکننده مالی', front_desk: 'پذیرش',
    housekeeper: 'خانه‌داری', cashier: 'صندوق‌دار', chef: 'آشپزخانه', storekeeper: 'انباردار',
  };
  function roleFa(name) { return ROLE_FA[name] || name; }

  function jdate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return Num.toPersian(Jalali.fromDate(d)) + ' — ' + Num.toPersian(Jalali.formatTime(d));
  }

  function row(label, input) {
    var d = el('div');
    d.style.cssText = 'display:flex;gap:6px;align-items:center;margin:4px 0;flex-wrap:wrap;';
    var l = el('label', null, label);
    l.style.minWidth = '130px';
    d.appendChild(l);
    d.appendChild(input);
    return d;
  }

  Modules.users = {
    title: 'کاربران و گروه‌ها',
    icon: '👥',
    render: function (root) {
      var state = {
        tab: 'users',       // users | groups | matrix
        users: [],
        roles: [],
        catalog: [],
        currentRole: null,   // گروه انتخابی در تب گروه‌ها/ماتریس
        matrixCodes: {},     // کد مجوز → true
      };

      root.appendChild(el('h2', null, 'مدیریت کاربران، گروه‌های کاربری و دسترسی‌ها'));
      root.appendChild(App.sessionPanel());

      var tabsBar = el('div', 'panel users-tabs');
      var tabs = [
        { id: 'users', label: 'کاربران برنامه' },
        { id: 'groups', label: 'گروه‌های کاربری' },
        { id: 'matrix', label: 'ماتریس دسترسی گروه‌ها' },
      ];
      var tabBtns = {};
      tabs.forEach(function (t) {
        var b = el('button', 'btn', t.label);
        tabBtns[t.id] = b;
        b.onclick = function () { state.tab = t.id; drawTabs(); body.innerHTML = ''; renderTab(body); };
        tabsBar.appendChild(b);
      });
      root.appendChild(tabsBar);

      function drawTabs() {
        tabs.forEach(function (t) { tabBtns[t.id].classList.toggle('btn-primary', state.tab === t.id); });
      }

      var body = el('div');
      root.appendChild(body);

      function reload(cb) {
        var u = api('GET', '/admin/users');
        var r = api('GET', '/admin/roles');
        var c = api('GET', '/admin/permission-catalog');
        Promise.all([u, r, c]).then(function (res) {
          state.users = (res[0].status === 200 && res[0].body.data) || [];
          state.roles = (res[1].status === 200 && res[1].body.data) || [];
          state.catalog = (res[2].status === 200 && res[2].body.data) || [];
          if (res[0].status !== 200) {
            body.innerHTML = '';
            body.appendChild(el('div', 'panel', '❌ ' + failText(res[0]) + ' — این بخش نیازمند مجوز «مدیریت کاربران» است.'));
            return;
          }
          if (state.currentRole) {
            var fresh = state.roles.find(function (x) { return x.id === state.currentRole.id; });
            state.currentRole = fresh || null;
          }
          if (cb) cb();
          else renderTab(body);
        });
      }

      /* ── تب ۱: کاربران ── */
      function renderUsers(host) {
        var addBtn = el('button', 'btn btn-primary', '＋ کاربر جدید');
        addBtn.onclick = function () { userForm(host, null); };
        var bar = el('div', 'form-row');
        bar.appendChild(addBtn);
        host.appendChild(bar);

        var host2 = el('div');
        host.appendChild(host2);
        DataTable.create(host2, {
          columns: [
            { key: 'username', label: 'نام کاربری' },
            { key: 'fullName', label: 'نام کامل' },
            { key: 'rolesText', label: 'گروه‌های کاربری' },
            { key: 'position', label: 'سمت' },
            { key: 'statusText', label: 'وضعیت' },
            { key: 'lastLoginText', label: 'آخرین ورود' },
            {
              key: 'actions', label: 'عملیات', render: function (r) {
                var w = el('div');
                w.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;';
                var edit = el('button', 'btn', 'ویرایش');
                edit.onclick = function () { userForm(host, r.raw); };
                var del = el('button', 'btn', 'غیرفعال');
                del.title = 'حذف = غیرفعال‌سازی (اسناد مالی به کاربر ارجاع دارند و حذف فیزیکی ندارند)';
                del.onclick = function () {
                  if (!confirm('کاربر «' + r.username + '» غیرفعال شود؟ همهٔ نشست‌های فعال او باطل می‌شود.')) return;
                  api('DELETE', '/admin/users/' + r.raw.id).then(function (res) {
                    if ([200, 201].includes(res.status)) reload(function () { renderTab(host); });
                    else alert('❌ ' + failText(res));
                  });
                };
                w.appendChild(edit);
                w.appendChild(del);
                return w;
              },
            },
          ],
          rows: state.users.map(function (u) {
            return {
              raw: u,
              username: u.username,
              fullName: u.fullName,
              rolesText: (u.roles || []).map(function (r) { return r.displayNameFa || roleFa(r.name); }).join('، ') || '—',
              position: u.position || '—',
              statusText: u.isActive ? 'فعال' : 'غیرفعال',
              lastLoginText: jdate(u.lastLoginAt),
            };
          }),
        });
      }

      function userForm(host, user) {
        var panel = el('div', 'panel');
        panel.appendChild(el('h3', null, user ? ('تصحیح کاربر — ' + user.username) : 'کاربر جدید'));
        var username = el('input', 'input'); username.value = user ? user.username : '';
        username.placeholder = 'نام کاربری انگلیسی (قابل تغییر)';
        var fullName = el('input', 'input'); fullName.value = user ? user.fullName : '';
        var email = el('input', 'input'); email.value = user && user.email ? user.email : '';
        var position = el('input', 'input'); position.value = user && user.position ? user.position : '';
        var password = el('input', 'input'); password.type = 'password';
        password.placeholder = user ? 'رمز عبور جدید — خالی = بدون تغییر' : 'رمز عبور (حداقل ۸ نویسه)';

        panel.appendChild(row('نام کاربری', username));
        panel.appendChild(row('نام کامل', fullName));
        panel.appendChild(row('ایمیل', email));
        panel.appendChild(row('سمت شغلی', position));
        panel.appendChild(row(user ? 'رمز عبور جدید' : 'رمز عبور', password));

        var rolesBox = el('div', 'form-row');
        rolesBox.style.cssText = 'gap:12px;flex-wrap:wrap;';
        state.roles.forEach(function (r) {
          var lbl = el('label');
          lbl.style.cssText = 'display:flex;gap:4px;align-items:center;';
          var cb = el('input');
          cb.type = 'checkbox';
          cb.value = r.id;
          if (user) cb.checked = (user.roles || []).some(function (x) { return x.id === r.id; });
          lbl.appendChild(cb);
          lbl.appendChild(el('span', 'fit', (r.displayNameFa || roleFa(r.name)) + (r.isSystem ? ' •' : '')));
          rolesBox.appendChild(lbl);
        });
        panel.appendChild(row('گروه‌های کاربری', rolesBox));
        panel.appendChild(el('p', 'muted', '• گروه‌های سیستمی seed هستند — تغییر ماتریس دسترسی آن‌ها در تب «ماتریس دسترسی» ممکن است و seed دیگر آن را بازنویسی نمی‌کند.'));

        if (user) {
          var active = el('input'); active.type = 'checkbox'; active.checked = !!user.isActive;
          panel.appendChild(row('حساب فعال', active));
          panel.appendChild(el('p', 'muted', 'آخرین ورود: ' + jdate(user.lastLoginAt)));
        }

        var save = el('button', 'btn btn-primary', 'ثبت');
        var msg = el('div', 'muted');
        var btns = el('div', 'form-row');
        var cancel = el('button', 'btn', 'بازگشت');
        cancel.onclick = function () { renderTab(host); };
        btns.appendChild(save);
        btns.appendChild(cancel);
        panel.appendChild(btns);
        panel.appendChild(msg);

        save.onclick = function () {
          var chosen = Array.prototype.slice.call(rolesBox.querySelectorAll('input[type=checkbox]:checked')).map(function (c) { return c.value; });
          var payload = {
            username: username.value.trim(),
            fullName: fullName.value.trim(),
            email: email.value.trim() || null,
            position: position.value.trim() || null,
            roleIds: chosen,
          };
          if (password.value) payload.password = password.value;
          if (user) {
            payload.isActive = active.checked;
            api('PATCH', '/admin/users/' + user.id, payload).then(function (res) {
              if ([200, 201].includes(res.status)) {
                msg.textContent = '✅ تغییرات ثبت شد.' + (password.value ? ' (نشست‌های کاربر باطل شد)' : '');
                reload(function () { renderUsers(host); });
              } else msg.textContent = '❌ ' + failText(res);
            });
          } else {
            if (!password.value) { msg.textContent = '❌ برای کاربر جدید، رمز عبور الزامی است.'; return; }
            api('POST', '/admin/users', payload).then(function (res) {
              if ([200, 201].includes(res.status)) {
                msg.textContent = '✅ کاربر ساخته شد.';
                reload(function () { renderUsers(host); });
              } else msg.textContent = '❌ ' + failText(res);
            });
          }
        };
        host.innerHTML = '';
        host.appendChild(panel);
        Num.fitAll(panel);
      }

      /* ── تب ۲: گروه‌های کاربری ── */
      function renderGroups(host) {
        var addBtn = el('button', 'btn btn-primary', '＋ گروه کاربری جدید');
        addBtn.onclick = function () { groupForm(host, null); };
        var bar = el('div', 'form-row');
        bar.appendChild(addBtn);
        host.appendChild(bar);

        var tbl = el('table', 'dt');
        tbl.innerHTML = '<thead><tr>' +
          '<th>گروه</th><th>نام سیستمی</th><th>نوع</th><th>اعضا</th><th>مجوزها</th><th>MFA</th><th>عملیات</th>' +
          '</tr></thead>';
        var tbody = el('tbody');
        tbl.appendChild(tbody);
        var wrap = el('div', 'dt-wrap');
        wrap.appendChild(tbl);
        host.appendChild(wrap);

        state.roles.forEach(function (r) {
          var tr = el('tr');
          function td(child) { var t = el('td'); t.appendChild(child); tr.appendChild(t); }
          td(el('span', 'fit', r.displayNameFa || r.name));
          td(el('span', 'fit', r.name));
          td(el('span', 'fit', r.isSystem ? 'سیستمی' : 'سفارشی'));
          td(el('span', 'fit', Num.fmt(r.memberCount, 'fa')));
          td(el('span', 'fit', Num.fmt((r.permissionCodes || []).length, 'fa')));
          td(el('span', 'fit', r.sensitiveMfa ? 'دارد' : '—'));
          var ops = el('div');
          ops.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;';
          var bMembers = el('button', 'btn', 'اعضا');
          bMembers.onclick = function () { state.currentRole = r; renderMembers(host, r); };
          var bMatrix = el('button', 'btn', 'ماتریس دسترسی');
          bMatrix.onclick = function () { state.currentRole = r; state.tab = 'matrix'; drawTabs(); renderMatrix(host, r); };
          ops.appendChild(bMembers);
          ops.appendChild(bMatrix);
          if (!r.isSystem) {
            var bEdit = el('button', 'btn', 'ویرایش');
            bEdit.onclick = function () { groupForm(host, r); };
            var bDel = el('button', 'btn', 'حذف');
            bDel.onclick = function () {
              if (!confirm('گروه «' + (r.displayNameFa || r.name) + '» حذف شود؟')) return;
              api('DELETE', '/admin/roles/' + r.id).then(function (res) {
                if ([200, 201].includes(res.status)) reload(function () { renderTab(host); });
                else alert('❌ ' + failText(res));
              });
            };
            ops.appendChild(bEdit);
            ops.appendChild(bDel);
          }
          td(ops);
          tbody.appendChild(tr);
        });
        Num.fitAll(tbl);
      }

      function groupForm(host, role) {
        var panel = el('div', 'panel');
        panel.appendChild(el('h3', null, role ? ('تصحیح گروه — ' + (role.displayNameFa || role.name)) : 'گروه کاربری جدید'));
        var name = el('input', 'input'); name.value = role ? role.name : '';
        if (role && role.isSystem) { name.disabled = true; }
        name.placeholder = 'نام انگلیسی کوچک (مثلاً restaurant_waiters)';
        var fa = el('input', 'input'); fa.value = role ? role.displayNameFa : '';
        var en = el('input', 'input'); en.value = role ? role.displayNameEn : '';
        var mfa = el('input'); mfa.type = 'checkbox'; mfa.checked = role ? !!role.sensitiveMfa : false;
        panel.appendChild(row('نام سیستمی', name));
        panel.appendChild(row('نام نمایشی (فارسی)', fa));
        panel.appendChild(row('نام نمایشی (انگلیسی)', en));
        panel.appendChild(row('ورود نیازمند TOTP', mfa));
        if (role && role.isSystem) panel.appendChild(el('p', 'muted', 'گروه سیستمی: نام سیستمی تغییر نمی‌کند و حذف ممنوع است.'));

        var save = el('button', 'btn btn-primary', 'ثبت');
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
            displayNameFa: fa.value.trim(),
            displayNameEn: en.value.trim() || name.value.trim(),
            sensitiveMfa: mfa.checked,
          };
          var p;
          if (role) {
            if (!name.disabled) payload.name = name.value.trim();
            p = api('PATCH', '/admin/roles/' + role.id, payload);
          } else {
            payload.name = name.value.trim();
            p = api('POST', '/admin/roles', payload);
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

      function renderMembers(host, role) {
        host.innerHTML = '';
        host.appendChild(el('h3', null, 'اعضای گروه «' + (role.displayNameFa || role.name) + '»'));
        var back = el('button', 'btn', 'بازگشت به فهرست گروه‌ها');
        back.onclick = function () { renderTab(host); };
        host.appendChild(back);

        var membersHost = el('div');
        host.appendChild(membersHost);
        var addHost = el('div', 'panel');
        addHost.appendChild(el('h3', null, 'افزودن کاربر به گروه'));

        api('GET', '/admin/roles/' + role.id + '/members').then(function (res) {
          if (res.status !== 200) {
            membersHost.appendChild(el('div', 'panel', '❌ ' + failText(res)));
            return;
          }
          var members = res.body.data || [];
          var tbl = el('table', 'dt');
          tbl.innerHTML = '<thead><tr><th>نام کاربری</th><th>نام کامل</th><th>وضعیت</th><th>آخرین ورود</th><th>عملیات</th></tr></thead>';
          var tbody = el('tbody');
          tbl.appendChild(tbody);
          members.forEach(function (m) {
            var tr = el('tr');
            function td(child) { var t = el('td'); t.appendChild(child); tr.appendChild(t); }
            td(el('span', 'fit', m.username));
            td(el('span', 'fit', m.fullName));
            td(el('span', 'fit', m.isActive ? 'فعال' : 'غیرفعال'));
            td(el('span', 'fit', jdate(m.lastLoginAt)));
            var ops = el('div');
            var rm = el('button', 'btn', 'حذف از گروه');
            rm.onclick = function () {
              api('DELETE', '/admin/roles/' + role.id + '/members/' + m.id).then(function (r2) {
                if ([200, 201].includes(r2.status)) renderMembers(host, role);
                else alert('❌ ' + failText(r2));
              });
            };
            ops.appendChild(rm);
            td(ops);
            tbody.appendChild(tr);
          });
          tbl.appendChild(tbody);
          var wrap = el('div', 'dt-wrap');
          wrap.appendChild(tbl);
          membersHost.appendChild(wrap);
          Num.fitAll(tbl);

          // انتخاب کاربرِ افزودنی — فقط کاربرانی که عضو این گروه نیستند
          var sel = el('select');
          var candidates = state.users.filter(function (u) {
            return !members.some(function (m) { return m.id === u.id; });
          });
          sel.appendChild(el('option', null, '— انتخاب کاربر —'));
          candidates.forEach(function (u) {
            var o = el('option', null, u.username + ' — ' + u.fullName);
            o.value = u.id;
            sel.appendChild(o);
          });
          var addBtn = el('button', 'btn btn-primary', 'افزودن به گروه');
          var msg = el('div', 'muted');
          addBtn.onclick = function () {
            if (!sel.value) { msg.textContent = 'ابتدا کاربر را انتخاب کنید.'; return; }
            api('POST', '/admin/roles/' + role.id + '/members', { userId: sel.value }).then(function (r2) {
              if ([200, 201].includes(r2.status)) renderMembers(host, role);
              else msg.textContent = '❌ ' + failText(r2);
            });
          };
          addHost.appendChild(row('کاربر', sel));
          var b2 = el('div', 'form-row');
          b2.appendChild(addBtn);
          addHost.appendChild(b2);
          addHost.appendChild(msg);
          host.appendChild(addHost);
          Num.fitAll(addHost);
        });
      }

      /* ── تب ۳: ماتریس دسترسی (الگوی عکس ۲-۲) ── */
      function renderMatrix(host, role) {
        host.innerHTML = '';
        var bar = el('div', 'form-row');
        var sel = el('select');
        state.roles.forEach(function (r) {
          var o = el('option', null, (r.displayNameFa || roleFa(r.name)) + ' (' + r.name + ')');
          o.value = r.id;
          sel.appendChild(o);
        });
        sel.value = role.id;
        sel.onchange = function () {
          var next = state.roles.find(function (x) { return x.id === sel.value; });
          state.currentRole = next;
          renderMatrix(host, next);
        };
        bar.appendChild(el('label', null, 'گروه کاربری:'));
        bar.appendChild(sel);
        host.appendChild(bar);

        if (role.matrixOverridden) {
          host.appendChild(el('p', 'muted', 'ℹ️ ماتریس این گروه از رابط کاربری تغییر کرده و با اجرای seed بازنویسی نمی‌شود.'));
        }

        state.matrixCodes = {};
        (role.permissionCodes || []).forEach(function (c) { state.matrixCodes[c] = true; });

        var form = el('div');
        var catalogHost = el('div');
        state.catalog.forEach(function (g) {
          var sec = el('div', 'panel matrix-module');
          var head = el('div', 'form-row');
          head.appendChild(el('h4', null, g.fa + ' (' + g.en + ')'));
          var allBtn = el('button', 'btn', 'همه');
          var noneBtn = el('button', 'btn', 'هیچ');
          allBtn.onclick = function () {
            g.items.forEach(function (it) { state.matrixCodes[it.code] = true; });
            sec.querySelectorAll('input[type=checkbox]').forEach(function (c) { c.checked = true; });
          };
          noneBtn.onclick = function () {
            g.items.forEach(function (it) { state.matrixCodes[it.code] = false; });
            sec.querySelectorAll('input[type=checkbox]').forEach(function (c) { c.checked = false; });
          };
          var hb = el('div', 'form-row');
          hb.appendChild(allBtn);
          hb.appendChild(noneBtn);
          head.appendChild(hb);
          sec.appendChild(head);

          var table = el('table', 'dt matrix-table');
          var tbody = el('tbody');
          g.items.forEach(function (it) {
            var tr = el('tr');
            var tdName = el('td');
            tdName.appendChild(el('span', 'fit', it.fa));
            tr.appendChild(tdName);
            var tdEn = el('td');
            tdEn.appendChild(el('span', 'fit muted', it.code));
            tr.appendChild(tdEn);
            var tdCk = el('td');
            var lbl = el('label', 'matrix-check');
            var cb = el('input');
            cb.type = 'checkbox';
            cb.checked = !!state.matrixCodes[it.code];
            cb.onchange = function () { state.matrixCodes[it.code] = cb.checked; };
            lbl.appendChild(cb);
            lbl.appendChild(el('span', null, 'دسترسی دارد'));
            tdCk.appendChild(lbl);
            tr.appendChild(tdCk);
            tbody.appendChild(tr);
          });
          table.appendChild(tbody);
          sec.appendChild(table);
          catalogHost.appendChild(sec);
        });
        form.appendChild(catalogHost);

        var saveBar = el('div', 'form-row');
        var save = el('button', 'btn btn-primary', 'ذخیرهٔ ماتریس «' + (role.displayNameFa || role.name) + '»');
        var msg = el('div', 'muted');
        var back = el('button', 'btn', 'بازگشت');
        back.onclick = function () { renderTab(host); };
        save.onclick = function () {
          var codes = Object.keys(state.matrixCodes).filter(function (k) { return state.matrixCodes[k]; });
          api('PUT', '/admin/roles/' + role.id + '/permissions', { codes: codes }).then(function (res) {
            if ([200, 201].includes(res.status)) {
              msg.textContent = '✅ ماتریس ذخیره شد — تغییرات سمت سرور بلافاصله اعمال می‌شود.';
              reload(function () { renderMatrix(host, state.currentRole || role); });
            } else msg.textContent = '❌ ' + failText(res);
          });
        };
        saveBar.appendChild(save);
        saveBar.appendChild(back);
        saveBar.appendChild(msg);
        host.appendChild(saveBar);
        host.appendChild(form);
        Num.fitAll(host);
      }

      /* ── رندر تب جاری ── */
      function renderTab(host) {
        host.innerHTML = '';
        if (state.tab === 'users') renderUsers(host);
        else if (state.tab === 'groups') renderGroups(host);
        else if (state.tab === 'matrix') {
          if (state.currentRole) renderMatrix(host, state.currentRole);
          else {
            host.appendChild(el('p', 'muted', 'ابتدا از تب «گروه‌های کاربری» گروهی را انتخاب کنید یا از دکمهٔ «ماتریس دسترسی» هر گروه استفاده کنید.'));
            renderGroups(host);
          }
        }
        drawTabs();
        Num.fitAll(host);
      }

      reload();
    },
  };
})(window);
