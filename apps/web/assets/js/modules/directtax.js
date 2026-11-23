/**
 * modules/directtax.js — فاز ۹ / F9-T5: مالیات مستقیم — برنامهٔ عملکرد، اظهارنامهٔ عملکرد،
 * شناسهٔ طرف‌های معامله. ارسال اظهارنامه فقط با تأیید انسانی (گردش کار فاز ۸).
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
      return r.arrayBuffer().then(function (buf) {
        var text = new TextDecoder('utf-8').decode(buf);
        try { return { status: r.status, body: JSON.parse(text), raw: text, bytes: new Uint8Array(buf) }; }
        catch (e) { return { status: r.status, body: null, raw: text, bytes: new Uint8Array(buf) }; }
      });
    });
  }

  function failText(res) {
    return (res.body && res.body.error && res.body.error.message) ? res.body.error.message : ('خطای ' + res.status);
  }

  function money(n) { return Number(n || 0).toLocaleString('fa-IR'); }

  function statusBadge(st) {
    var colors = { DRAFT: '#9a6700', CONFIRMED: '#0969da', SUBMITTED: '#1a7f37' };
    var fa = { DRAFT: 'پیش‌نویس', CONFIRMED: 'تأییدشده', SUBMITTED: 'ارسال‌شده' };
    var b = el('span', 'pill', fa[st] || st);
    b.style.cssText = 'padding:2px 8px;border-radius:10px;font-size:12px;background:' + (colors[st] || '#6e7781') + '20;color:' + (colors[st] || '#6e7781') + ';';
    return b;
  }

  Modules.directtax = {
    render: function (content) {
      content.innerHTML = '';
      content.appendChild(el('h2', 'panel-title', 'مالیات مستقیم (فاز ۹)'));
      content.appendChild(el('p', 'muted', 'برنامهٔ عملکرد سال مالیاتی + اظهارنامهٔ عملکرد (مادهٔ ۱۰۵ — نرخ پارامتریک از کتابخانهٔ قوانین) + شناسهٔ طرف‌های معامله. ارسال اظهارنامه فقط با تأیید انسانی.'));

      if (!apiToken()) {
        content.appendChild(el('div', 'panel', 'برای استفاده ابتدا با نقش حسابدار/تأییدکننده/مدیر وارد شوید.'));
        return;
      }

      var state = { taxYear: 1405 };
      var yearIn = el('input'); yearIn.type = 'number'; yearIn.value = state.taxYear; yearIn.style.width = '90px';
      var loadBtn = el('button', 'btn', 'بارگذاری');

      // ── برنامهٔ عملکرد ──
      var planPanel = el('div', 'panel');
      planPanel.appendChild(el('h3', '', 'برنامهٔ عملکرد سال'));
      var planRow = el('div'); planRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;';
      var roomsIn = el('input'); roomsIn.placeholder = 'ظرفیت اتاق (تعداد)'; roomsIn.style.width = '160px';
      var occIn = el('input'); occIn.placeholder = 'نرخ اشغال هدف (٪)'; occIn.style.width = '140px';
      var revIn = el('input'); revIn.placeholder = 'درآمد هدف سال (ریال)'; revIn.style.width = '200px';
      var empIn = el('input'); empIn.placeholder = 'اشتغال (نفر)'; empIn.style.width = '120px';
      var planMsg = el('span', 'muted');
      var savePlanBtn = el('button', 'btn', 'ذخیرهٔ برنامه');
      var confirmPlanBtn = el('button', 'btn', 'تأیید برنامه');
      savePlanBtn.onclick = function () {
        savePlanBtn.disabled = true;
        api('POST', '/compliance/directtax/plan', {
          taxYear: state.taxYear,
          planJson: {
            roomCapacity: Number(roomsIn.value) || 0,
            targetOccupancyPercent: Number(occIn.value) || 0,
            targetRevenueRials: String(Number(revIn.value) || 0),
            employmentHeadcount: Number(empIn.value) || 0,
          },
        }).then(function (res) {
          savePlanBtn.disabled = false;
          planMsg.textContent = [200, 201].includes(res.status) ? 'برنامهٔ عملکرد ذخیره شد ✓' : failText(res);
          loadAll();
        });
      };
      confirmPlanBtn.onclick = function () {
        confirmPlanBtn.disabled = true;
        api('POST', '/compliance/directtax/plan/confirm', { taxYear: state.taxYear }).then(function (res) {
          confirmPlanBtn.disabled = false;
          planMsg.textContent = [200, 201].includes(res.status) ? 'برنامهٔ عملکرد تأیید شد ✓' : failText(res);
          loadAll();
        });
      };
      planRow.appendChild(roomsIn); planRow.appendChild(occIn); planRow.appendChild(revIn);
      planRow.appendChild(empIn); planRow.appendChild(savePlanBtn); planRow.appendChild(confirmPlanBtn);
      planRow.appendChild(planMsg);
      planPanel.appendChild(planRow);
      var planStatus = el('div', 'muted'); planStatus.style.marginTop = '6px';
      planPanel.appendChild(planStatus);
      content.appendChild(planPanel);

      // ── اظهارنامهٔ عملکرد ──
      var retPanel = el('div', 'panel');
      retPanel.appendChild(el('h3', '', 'اظهارنامهٔ مالیات عملکرد'));
      var computeBtn = el('button', 'btn', 'محاسبه از اسناد قطعی');
      var submitBtn = el('button', 'btn', 'درخواست ارسال اظهارنامه');
      var exportBtn = el('button', 'btn', 'دریافت فایل استاندارد (CSV)');
      var reopenBtn = el('button', 'btn', 'بازگشایی (مدیر)');
      var retMsg = el('span', 'muted');
      computeBtn.onclick = function () {
        computeBtn.disabled = true;
        api('POST', '/compliance/directtax/return/compute', { taxYear: state.taxYear }).then(function (res) {
          computeBtn.disabled = false;
          retMsg.textContent = [200, 201].includes(res.status) ? 'محاسبه شد ✓' : failText(res);
          loadAll();
        });
      };
      submitBtn.onclick = function () {
        submitBtn.disabled = true;
        api('POST', '/compliance/directtax/return/submit', { taxYear: state.taxYear }).then(function (res) {
          submitBtn.disabled = false;
          retMsg.textContent = [200, 201].includes(res.status)
            ? 'نمونهٔ تأیید ارسال ساخته شد — تا تأییدکننده تأیید کند وضعیت پیش‌نویس می‌ماند.'
            : failText(res);
          loadAll();
        });
      };
      exportBtn.onclick = function () {
        api('GET', '/compliance/directtax/export?taxYear=' + state.taxYear).then(function (res) {
          if (res.status !== 200) { retMsg.textContent = failText(res); return; }
          var blob = new Blob([res.bytes], { type: 'text/csv;charset=utf-8' });
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'direct-tax-' + state.taxYear + '.csv';
          a.click();
          retMsg.textContent = 'فایل دانلود شد ✓';
        });
      };
      reopenBtn.onclick = function () {
        reopenBtn.disabled = true;
        api('POST', '/compliance/directtax/return/reopen', { taxYear: state.taxYear }).then(function (res) {
          reopenBtn.disabled = false;
          retMsg.textContent = [200, 201].includes(res.status) ? 'اظهارنامه بازگشایی شد ✓' : failText(res);
          loadAll();
        });
      };
      var retRow = el('div'); retRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;';
      retRow.appendChild(computeBtn); retRow.appendChild(submitBtn); retRow.appendChild(exportBtn);
      retRow.appendChild(reopenBtn); retRow.appendChild(retMsg);
      retPanel.appendChild(retRow);
      var cards = el('div'); cards.style.cssText = 'display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:14px;';
      retPanel.appendChild(cards);
      content.appendChild(retPanel);

      // ── شناسهٔ طرف‌های معامله ──
      var cpPanel = el('div', 'panel');
      cpPanel.appendChild(el('h3', '', 'شناسهٔ طرف‌های معامله'));
      var cpMsg = el('div', 'muted');
      cpPanel.appendChild(cpMsg);
      var cpBody = el('div');
      cpPanel.appendChild(cpBody);
      content.appendChild(cpPanel);

      function card(title, val, sub) {
        var c = el('div');
        c.style.cssText = 'border:1px solid #d0d7de;border-radius:8px;padding:8px 14px;';
        c.appendChild(el('div', 'muted', title));
        c.appendChild(el('div', '', money(val) + ' ریال'));
        if (sub) c.appendChild(el('div', 'muted', sub));
        return c;
      }

      function loadPlan() {
        api('GET', '/compliance/directtax/plan?taxYear=' + state.taxYear).then(function (res) {
          planStatus.innerHTML = '';
          var p = res.body && res.body.data;
          if (!p) { planStatus.textContent = 'برنامهٔ عملکرد این سال ثبت نشده است.'; return; }
          var wrap = el('span'); wrap.style.cssText = 'display:inline-flex;gap:6px;align-items:center;';
          wrap.appendChild(el('span', '', 'وضعیت برنامه:'));
          wrap.appendChild(statusBadge(p.status));
          if (p.plan && p.plan.roomCapacity) {
            wrap.appendChild(el('span', 'muted', ' — ظرفیت ' + money(p.plan.roomCapacity) + ' اتاق، اشغال هدف ' + money(p.plan.targetOccupancyPercent) + '٪'));
          }
          planStatus.appendChild(wrap);
        });
      }

      function loadReturn() {
        api('GET', '/compliance/directtax/return?taxYear=' + state.taxYear).then(function (res) {
          cards.innerHTML = '';
          var r = res.body && res.body.data;
          if (!r) { cards.appendChild(el('div', 'muted', 'اظهارنامهٔ این سال محاسبه نشده است.')); return; }
          cards.appendChild(card('جمع درآمد', r.revenueRials));
          cards.appendChild(card('هزینه‌های قابل قبول', r.costRials));
          cards.appendChild(card('درآمد مشمول', r.taxableIncomeRials, 'نرخ مادهٔ ۱۰۵: ' + r.taxRatePercent + '٪'));
          cards.appendChild(card('مالیات متعلق', r.taxDueRials));
          cards.appendChild(card('پیش‌پرداخت/مالیات حقوق', r.prepaidRials));
          cards.appendChild(card('قابل پرداخت', r.payableRials));
          var stWrap = el('div'); stWrap.style.cssText = 'display:flex;align-items:center;gap:6px;border:1px solid #d0d7de;border-radius:8px;padding:8px 14px;';
          stWrap.appendChild(el('div', 'muted', 'وضعیت اظهارنامه:'));
          stWrap.appendChild(statusBadge(r.status));
          cards.appendChild(stWrap);
        });
      }

      function loadCounterparties() {
        api('GET', '/compliance/directtax/counterparties?taxYear=' + state.taxYear).then(function (res) {
          cpBody.innerHTML = '';
          if (res.status !== 200) { cpMsg.textContent = failText(res); return; }
          var d = res.body.data;
          cpMsg.textContent = 'تعداد: ' + money(d.count) + ' — ناقص (بدون شناسهٔ مالیاتی): ' + money(d.incomplete);
          if (!d.rows.length) return;
          var tbl = el('table'); tbl.className = 'data-table';
          tbl.innerHTML = '<thead><tr><th>شناسهٔ ملی/کد اقتصادی</th><th>نام</th><th>فروش (ریال)</th><th>خرید (ریال)</th><th>تعداد</th><th>منبع</th><th>کامل</th></tr></thead>';
          var tb = el('tbody');
          d.rows.forEach(function (r) {
            var tr = el('tr');
            tr.innerHTML = '<td>' + (r.tin || '—') + '</td><td>' + r.name + '</td><td>' + money(r.saleRials) + '</td><td>' + money(r.purchaseRials) + '</td><td>' + money(r.transactionCount) + '</td><td>' + r.sources.join('، ') + '</td><td>' + (r.complete ? '✓' : '✗ ناقص') + '</td>';
            tb.appendChild(tr);
          });
          tbl.appendChild(tb);
          var wrap = el('div'); wrap.style.cssText = 'overflow-x:auto;'; wrap.appendChild(tbl);
          cpBody.appendChild(wrap);
        });
      }

      function loadAll() {
        state.taxYear = Number(yearIn.value) || 1405;
        loadPlan(); loadReturn(); loadCounterparties();
      }
      loadBtn.onclick = loadAll;

      var top = el('div', 'panel');
      top.style.cssText = 'display:flex;gap:8px;align-items:center;';
      top.appendChild(el('span', '', 'سال مالیاتی:'));
      top.appendChild(yearIn); top.appendChild(loadBtn);
      content.insertBefore(top, planPanel);

      loadAll();
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
