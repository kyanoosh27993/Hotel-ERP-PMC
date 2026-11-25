/**
 * modules/plans.js — نسخهٔ ۳٫۴: «لیست انواع پلانی هتل» (الگوی مرجع کارفرما)
 * پلان = الگوی تقسیم هزینهٔ تور/شرکت و میهمان؛ هر قلم = کد درآمدی + سهم (میهمان یا تور/شرکت).
 * تب‌ها: پلان‌ها | جزئیات و کدینگ درآمدی پلان | کدینگ درآمدی (دیکشنری مشترک)
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

  function jdate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return Num.toPersian(Jalali.fromDate(d));
  }

  Modules.plans = {
    title: 'پلان‌های تور',
    icon: '🧳',
    render: function (root) {
      var state = { plans: [], codes: [], currentPlan: null };

      root.appendChild(el('h2', null, 'پلان‌های تور و شرکت — تفکیک هزینهٔ شرکت و میهمان'));
      root.appendChild(App.sessionPanel());
      root.appendChild(el('p', 'muted', 'هر پلان تعیین می‌کند چه خدماتی بر عهدهٔ تور/شرکت است (روی فولیو شرکت و فاکتور رسمی به نام شرکت) و چه خدماتی بر عهدهٔ میهمان (فاکتور به نام میهمان). پلان در ثبت رجیستر/رزرو انتخاب می‌شود.'));

      var tabsBar = el('div', 'panel users-tabs');
      var tabs = [
        { id: 'plans', label: 'لیست انواع پلانی هتل' },
        { id: 'detail', label: 'جزئیات و کدینگ درآمدی پلان' },
        { id: 'codes', label: 'کدینگ درآمدی (دیکشنری)' },
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
        Promise.all([api('GET', '/pms/plans'), api('GET', '/pms/revenue-codes')]).then(function (res) {
          state.plans = (res[0].status === 200 && res[0].body.data) || [];
          state.codes = (res[1].status === 200 && res[1].body.data) || [];
          if (res[0].status !== 200) {
            body.innerHTML = '';
            body.appendChild(el('div', 'panel', '❌ ' + failText(res[0])));
            return;
          }
          if (state.currentPlan) {
            var fresh = state.plans.find(function (x) { return x.id === state.currentPlan.id; });
            state.currentPlan = fresh || null;
          }
          if (cb) cb();
          else renderTab(body);
        });
      }

      /* ── تب ۱: لیست پلان‌ها ── */
      function renderPlans(host) {
        var panel = el('div', 'panel');
        panel.appendChild(el('h3', null, 'پلان جدید'));
        var fa = el('input', 'input'); fa.placeholder = 'نام پلان (مثلاً اتاق و صبحانه بعهده تور/شرکت)';
        var latin = el('input', 'input'); latin.placeholder = 'نام لاتین (مثلاً Room & Breakfast Ch To)';
        var active = el('input'); active.type = 'checkbox'; active.checked = true;
        var add = el('button', 'btn btn-primary', '＋ افزودن پلان');
        panel.appendChild(row('نام پلان', fa));
        panel.appendChild(row('نام لاتین', latin));
        panel.appendChild(row('فعال', active));
        panel.appendChild(add);
        var msg = el('div', 'muted');
        panel.appendChild(msg);
        add.onclick = function () {
          api('POST', '/pms/plans', { nameFa: fa.value.trim(), nameLatin: latin.value.trim() || undefined, isActive: active.checked }).then(function (res) {
            if ([200, 201].includes(res.status)) reload(function () { renderTab(host); });
            else msg.textContent = '❌ ' + failText(res);
          });
        };
        host.appendChild(panel);

        var tbl = el('table', 'dt');
        var thead = el('thead');
        var tr = el('tr');
        ['ردیف', 'نام پلان', 'نام لاتین', 'اقلام', 'رزروها', 'اقامت‌ها', 'تاریخ ثبت', 'وضعیت', 'عملیات'].forEach(function (h) { tr.appendChild(el('th', null, h)); });
        thead.appendChild(tr);
        tbl.appendChild(thead);
        var tbody = el('tbody');
        state.plans.forEach(function (p, i) {
          var trow = el('tr');
          function td(child) { var t = el('td'); t.appendChild(child); trow.appendChild(t); }
          td(el('span', 'fit', Num.toPersian(String(p.code))));
          td(el('span', 'fit', p.nameFa));
          td(el('span', 'fit', p.nameLatin || '—'));
          td(el('span', 'fit', Num.toPersian(String(p.itemsCount))));
          td(el('span', 'fit', Num.toPersian(String(p.reservationsCount))));
          td(el('span', 'fit', Num.toPersian(String(p.staysCount))));
          td(el('span', 'fit', jdate(p.createdAt)));
          td(el('span', 'fit', p.isActive ? 'فعال' : 'غیرفعال'));
          var ops = el('div');
          ops.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;';
          var bDetail = el('button', 'btn', 'جزئیات');
          bDetail.onclick = function () { state.currentPlan = p; state.tab = 'detail'; drawTabs(); renderTab(host); };
          var bToggle = el('button', 'btn', p.isActive ? 'غیرفعال' : 'فعال');
          bToggle.onclick = function () {
            api('PATCH', '/pms/plans/' + p.id, { isActive: !p.isActive }).then(function (res) {
              if ([200, 201].includes(res.status)) reload(function () { renderTab(host); });
              else alert('❌ ' + failText(res));
            });
          };
          var bDel = el('button', 'btn', 'حذف');
          bDel.onclick = function () {
            if (!confirm('پلان «' + p.nameFa + '» حذف شود؟')) return;
            api('DELETE', '/pms/plans/' + p.id).then(function (res) {
              if ([200, 201].includes(res.status)) reload(function () { renderTab(host); });
              else alert('❌ ' + failText(res));
            });
          };
          ops.appendChild(bDetail);
          ops.appendChild(bToggle);
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

      function row(label, input) {
        var d = el('div');
        d.style.cssText = 'display:flex;gap:6px;align-items:center;margin:4px 0;flex-wrap:wrap;';
        var l = el('label', null, label);
        l.style.minWidth = '150px';
        d.appendChild(l);
        d.appendChild(input);
        return d;
      }

      /* ── تب ۲: جزئیات پلان (کدینگ درآمدی پلان) ── */
      function renderDetail(host) {
        host.innerHTML = '';
        if (!state.currentPlan) {
          host.appendChild(el('p', 'muted', 'ابتدا از تب «لیست انواع پلانی هتل» پلانی را انتخاب کنید.'));
          renderPlans(host);
          return;
        }
        var plan = state.currentPlan;
        host.appendChild(el('h3', null, 'ریز مشخصات کد پلان: ' + Num.toPersian(String(plan.code)) + ' (' + plan.nameFa + ')' + (plan.nameLatin ? ' (' + plan.nameLatin + ')' : '')));

        var addPanel = el('div', 'panel');
        addPanel.appendChild(el('h3', null, 'افزودن قلم به پلان'));
        var sel = el('select');
        state.codes.forEach(function (c) {
          var o = el('option', null, c.code + ' — ' + c.nameFa); o.value = c.id;
          sel.appendChild(o);
        });
        var side = el('select');
        var og = el('option', null, 'میهمان'); og.value = 'GUEST';
        var oc = el('option', null, 'تور / شرکت'); oc.value = 'COMPANY';
        side.appendChild(og);
        side.appendChild(oc);
        var addBtn = el('button', 'btn btn-primary', 'افزودن قلم');
        var msg = el('div', 'muted');
        addBtn.onclick = function () {
          api('POST', '/pms/plans/' + plan.id + '/items', { revenueCodeId: sel.value, chargeTo: side.value }).then(function (res) {
            if ([200, 201].includes(res.status)) reload(function () { renderDetail(host); });
            else msg.textContent = '❌ ' + failText(res);
          });
        };
        addPanel.appendChild(row('نام درآمد', sel));
        addPanel.appendChild(row('درص درصورتحساب', side));
        addPanel.appendChild(addBtn);
        addPanel.appendChild(msg);
        host.appendChild(addPanel);

        api('GET', '/pms/plans/' + plan.id + '/items').then(function (res) {
          if (res.status !== 200) {
            host.appendChild(el('div', 'panel', '❌ ' + failText(res)));
            return;
          }
          var data = res.body.data;
          function section(title, items, chargeTo) {
            var sec = el('div', 'panel');
            sec.appendChild(el('h4', null, title + ' — ' + Num.toPersian(String(items.length)) + ' قلم'));
            var tbl = el('table', 'dt');
            var thead = el('thead');
            var tr = el('tr');
            ['کد درآمدی', 'نام کد درآمدی', 'درص درصورتحساب', 'عملیات'].forEach(function (h) { tr.appendChild(el('th', null, h)); });
            thead.appendChild(tr);
            tbl.appendChild(thead);
            var tbody = el('tbody');
            items.forEach(function (it) {
              var trow = el('tr');
              function td(child) { var t = el('td'); t.appendChild(child); trow.appendChild(t); }
              td(el('span', 'fit', Num.toPersian(String(it.code))));
              td(el('span', 'fit', it.nameFa));
              var sel2 = el('select');
              var g = el('option', null, 'میهمان'); g.value = 'GUEST';
              var c = el('option', null, 'تور / شرکت'); c.value = 'COMPANY';
              sel2.appendChild(g);
              sel2.appendChild(c);
              sel2.value = it.chargeTo;
              sel2.onchange = function () {
                api('PATCH', '/pms/plan-items/' + it.id, { chargeTo: sel2.value }).then(function (r2) {
                  if (![200, 201].includes(r2.status)) alert('❌ ' + failText(r2));
                });
              };
              td(sel2);
              var rm = el('button', 'btn', 'حذف');
              rm.onclick = function () {
                api('DELETE', '/pms/plan-items/' + it.id).then(function (r2) {
                  if ([200, 201].includes(r2.status)) renderDetail(host);
                  else alert('❌ ' + failText(r2));
                });
              };
              td(rm);
              tbody.appendChild(trow);
            });
            tbl.appendChild(tbody);
            sec.appendChild(tbl);
            Num.fitAll(tbl);
            return sec;
          }
          host.appendChild(section('سهم میهمان (روی فولیو میهمان — فاکتور به نام میهمان)', data.guest, 'GUEST'));
          host.appendChild(section('سهم تور / شرکت (روی فولیو شرکت — فاکتور رسمی به نام شرکت)', data.company, 'COMPANY'));
          var back = el('button', 'btn', 'بازگشت به فهرست پلان‌ها');
          back.onclick = function () { state.tab = 'plans'; drawTabs(); renderTab(host); };
          host.appendChild(back);
        });
      }

      /* ── تب ۳: دیکشنری کدینگ درآمدی ── */
      function renderCodes(host) {
        var panel = el('div', 'panel');
        panel.appendChild(el('h3', null, 'کد درآمدی جدید (شماره‌گذاری خودکار)'));
        var fa = el('input', 'input'); fa.placeholder = 'نام فارسی (مثلاً صبحانه اتاق)';
        var en = el('input', 'input'); en.placeholder = 'نام انگلیسی';
        var add = el('button', 'btn btn-primary', 'افزودن کد');
        panel.appendChild(row('نام فارسی', fa));
        panel.appendChild(row('نام انگلیسی', en));
        panel.appendChild(add);
        var msg = el('div', 'muted');
        panel.appendChild(msg);
        add.onclick = function () {
          api('POST', '/pms/revenue-codes', { nameFa: fa.value.trim(), nameEn: en.value.trim() || undefined }).then(function (res) {
            if ([200, 201].includes(res.status)) reload(function () { renderTab(host); });
            else msg.textContent = '❌ ' + failText(res);
          });
        };
        host.appendChild(panel);

        var tbl = el('table', 'dt');
        var thead = el('thead');
        var tr = el('tr');
        ['کد', 'نام کد درآمدی', 'نام انگلیسی', 'فعال', 'عملیات'].forEach(function (h) { tr.appendChild(el('th', null, h)); });
        thead.appendChild(tr);
        tbl.appendChild(thead);
        var tbody = el('tbody');
        state.codes.forEach(function (c) {
          var trow = el('tr');
          function td(child) { var t = el('td'); t.appendChild(child); trow.appendChild(t); }
          td(el('span', 'fit', Num.toPersian(String(c.code))));
          td(el('span', 'fit', c.nameFa));
          td(el('span', 'fit', c.nameEn || '—'));
          td(el('span', 'fit', c.isActive ? 'فعال' : 'غیرفعال'));
          var ops = el('div');
          var bDel = el('button', 'btn', 'حذف');
          bDel.onclick = function () {
            if (!confirm('کد «' + c.nameFa + '» حذف شود؟')) return;
            api('DELETE', '/pms/revenue-codes/' + c.id).then(function (res) {
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

      function renderTab(host) {
        host.innerHTML = '';
        if (state.tab === 'plans') renderPlans(host);
        else if (state.tab === 'detail') renderDetail(host);
        else renderCodes(host);
        drawTabs();
        Num.fitAll(host);
      }

      reload();
    },
  };
})(window);
