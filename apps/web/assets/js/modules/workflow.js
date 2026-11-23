/**
 * modules/workflow.js — فاز ۸ / F8-T6: موتور گردش کار تأیید چندمرحله‌ای
 * شروع نمونه | لیست با وضعیت | تأیید/رد مرحله | راستی‌آزمایی زنجیرهٔ امضای الکترونیکی.
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
      return r.json().then(function (j) { return { status: r.status, body: j }; }).catch(function () { return { status: r.status, body: null }; });
    });
  }

  function failText(res) {
    return (res.body && res.body.error && res.body.error.message) ? res.body.error.message : ('خطای ' + res.status);
  }

  function statusBadge(st) {
    var colors = { APPROVED: '#1a7f37', REJECTED: '#cf222e', CANCELLED: '#b35900', IN_PROGRESS: '#0969da' };
    var b = el('span', 'pill', st);
    b.style.cssText = 'padding:2px 8px;border-radius:10px;font-size:12px;background:' + (colors[st] || '#6e7781') + '20;color:' + (colors[st] || '#6e7781') + ';';
    return b;
  }

  Modules.workflow = {
    render: function (content) {
      content.innerHTML = '';
      content.appendChild(el('h2', 'panel-title', 'گردش کار تأیید (فاز ۸)'));
      content.appendChild(el('p', 'muted', 'گردش کار چندمرحله‌ای با قاعدهٔ «تأییدکننده ≠ ثبت‌کننده» و امضای الکترونیکی ضد دست‌کاری. تکمیل نمونه رویداد workflow.completed می‌فرستد.'));

      if (!apiToken()) {
        var warn = el('div', 'panel', 'برای استفاده ابتدا با نقش حسابدار/تأییدکننده/مدیر وارد شوید.');
        content.appendChild(warn);
        return;
      }

      // ── شروع نمونه ──
      var startPanel = el('div', 'panel');
      startPanel.appendChild(el('h3', '', 'شروع نمونهٔ گردش کار'));
      var defSel = el('select');
      var entityInput = el('input'); entityInput.placeholder = 'شناسهٔ نهاد (UUID) — مثلاً شناسهٔ سند یا PO';
      var entityType = el('input'); entityType.placeholder = 'نوع نهاد — مثلاً journal_entry';
      var titleInput = el('input'); titleInput.placeholder = 'عنوان نمونه';
      var startBtn = el('button', 'btn', 'شروع');
      var startMsg = el('div', 'muted');
      startBtn.onclick = function () {
        if (!entityInput.value.trim() || !titleInput.value.trim()) {
          startMsg.textContent = 'شناسهٔ نهاد و عنوان الزامی است'; startMsg.style.color = '#cf222e'; return;
        }
        startBtn.disabled = true;
        api('POST', '/workflows', {
          defCode: defSel.value, entityType: entityType.value.trim() || 'generic',
          entityId: entityInput.value.trim(), title: titleInput.value.trim(),
        }).then(function (res) {
          startBtn.disabled = false;
          if ([200, 201].includes(res.status)) {
            startMsg.style.color = '#1a7f37';
            startMsg.textContent = 'نمونه شروع شد (مرحلهٔ ۱).';
            loadList();
          } else {
            startMsg.style.color = '#cf222e';
            startMsg.textContent = failText(res);
          }
        });
      };
      api('GET', '/workflows/defs').then(function (res) {
        (res.body && res.body.data || []).forEach(function (d) {
          var o = el('option'); o.value = d.code; o.textContent = d.title + ' (' + d.code + ')';
          defSel.appendChild(o);
        });
      });
      var form = el('div');
      form.style.cssText = 'display:grid;gap:6px;max-width:520px;';
      form.appendChild(defSel); form.appendChild(entityType); form.appendChild(entityInput); form.appendChild(titleInput); form.appendChild(startBtn);
      startPanel.appendChild(form); startPanel.appendChild(startMsg);
      content.appendChild(startPanel);

      // ── لیست نمونه‌ها ──
      var listPanel = el('div', 'panel');
      listPanel.appendChild(el('h3', '', 'نمونه‌های گردش کار'));
      var sel = el('select');
      ['', 'IN_PROGRESS', 'APPROVED', 'REJECTED', 'CANCELLED'].forEach(function (s) {
        var o = el('option'); o.value = s; o.textContent = s || 'همه'; sel.appendChild(o);
      });
      var loadBtn = el('button', 'btn', 'بارگذاری');
      var listBody = el('div');
      loadBtn.onclick = loadList;
      var filterRow = el('div');
      filterRow.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px;';
      filterRow.appendChild(el('span', '', 'وضعیت:')); filterRow.appendChild(sel); filterRow.appendChild(loadBtn);
      listPanel.appendChild(filterRow); listPanel.appendChild(listBody);
      content.appendChild(listPanel);

      function loadList() {
        var q = sel.value ? ('?status=' + sel.value) : '';
        api('GET', '/workflows' + q).then(function (res) {
          listBody.innerHTML = '';
          if (res.status !== 200) { listBody.appendChild(el('div', 'muted', failText(res))); return; }
          var rows = res.body.data || [];
          if (!rows.length) { listBody.appendChild(el('div', 'muted', 'نمونه‌ای نیست.')); return; }
          var tbl = el('table'); tbl.className = 'data-table';
          tbl.innerHTML = '<thead><tr><th>عنوان</th><th>نوع</th><th>گردش کار</th><th>مرحله</th><th>وضعیت</th><th>اقدام‌ها</th></tr></thead>';
          var tb = el('tbody');
          rows.forEach(function (r) {
            var tr = el('tr');
            tr.innerHTML = '<td>' + r.title + '</td><td>' + r.entityType + '</td><td>' + r.def.code + '</td>' +
              '<td>' + r.currentStep + ' / ' + (r.def.steps || []).length + '</td><td></td><td></td>';
            var stCell = tr.children[4]; stCell.appendChild(statusBadge(r.status));
            var actCell = tr.children[5]; actCell.style.whiteSpace = 'nowrap';
            if (r.status === 'IN_PROGRESS') {
              var ap = el('button', 'btn btn-sm', 'تأیید');
              ap.onclick = function () {
                var cm = window.prompt('توضیح تأیید (اختیاری):') || '';
                api('POST', '/workflows/' + r.id + '/approve', { comment: cm }).then(function (res2) {
                  if ([200, 201].includes(res2.status)) loadList(); else window.alert(failText(res2));
                });
              };
              var rj = el('button', 'btn btn-sm', 'رد');
              rj.style.marginRight = '4px';
              rj.onclick = function () {
                var rs = window.prompt('دلیل رد (اجباری):');
                if (!rs || !rs.trim()) return;
                api('POST', '/workflows/' + r.id + '/reject', { reason: rs }).then(function (res2) {
                  if ([200, 201].includes(res2.status)) loadList(); else window.alert(failText(res2));
                });
              };
              actCell.appendChild(ap); actCell.appendChild(rj);
            }
            var vf = el('button', 'btn btn-sm', 'راستی‌آزمایی');
            vf.style.marginRight = '4px';
            vf.onclick = function () {
              api('GET', '/workflows/' + r.id + '/verify').then(function (res2) {
                var d = res2.body && res2.body.data;
                var msg = d && d.valid
                  ? 'زنجیرهٔ امضا سالم است (' + d.actionsChecked + ' اقدام بررسی شد).'
                  : 'زنجیره شکسته است در مرحلهٔ ' + d.brokenAtStep + ': ' + d.reason;
                window.alert(msg);
              });
            };
            actCell.appendChild(vf);
            tb.appendChild(tr);
          });
          tbl.appendChild(tb);
          var wrap = el('div'); wrap.style.cssText = 'overflow-x:auto;'; wrap.appendChild(tbl);
          listBody.appendChild(wrap);
        });
      }
      loadList();
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
