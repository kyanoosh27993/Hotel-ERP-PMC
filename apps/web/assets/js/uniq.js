/**
 * assets/js/uniq.js — نیاز یکتایی کارفرما: پیشنهاددهندهٔ زندهٔ مشابه‌ها (ثبت یکتای اشخاص/شرکت‌ها).
 * با تایپ هر کاراکتر در فیلدهای هوشمند (نام، نام خانوادگی، کد ملی، شناسه ملی، کد اقتصادی،
 * موبایل، کد پستی) برنامه به‌صورت زنده چک می‌کند که آیا این اطلاعات قبلاً ثبت شده است و
 * فهرست مشابه‌ها (با تطبیق زیررشته در هرجای کلمه) را پیشنهاد می‌دهد؛
 * انتخاب کاربر → اطلاعات قبلی در فرم بارگذاری می‌شود تا فقط اصلاح شود (ثبت دوباره ممنوع).
 * استفاده:
 *   var s = Uniq.suggest(inputEl, { onPick: function (party) { ... } });
 *   s.hide();
 */
(function (global) {
  'use strict';

  var API_BASE_KEY = 'hotel-erp-api-base';
  var TOKEN_KEY = 'hotel-erp-token';

  function apiGet(path) {
    var base = localStorage.getItem(API_BASE_KEY) || 'http://localhost:3000/api/v1';
    var token = localStorage.getItem(TOKEN_KEY) || '';
    return fetch(base + path, {
      method: 'GET',
      headers: token ? { Authorization: 'Bearer ' + token } : {},
    }).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, body: j }; });
    });
  }

  var KIND_FA = { GUEST: 'مهمان', SUPPLIER: 'فروشنده', COUNTERPARTY: 'طرف حساب', OTHER: 'شخص/شرکت' };

  function displayName(p) {
    if (p.companyName) return p.companyName;
    return ((p.lastName || '') + ' ' + (p.firstName || '')).trim() || '—';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** هایلایت بخش تطبیق‌شدهٔ زیررشته */
  function hl(text, q) {
    var t = String(text == null ? '' : text);
    if (!q) return esc(t);
    var i = t.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return esc(t);
    return esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + q.length)) + '</mark>' + esc(t.slice(i + q.length));
  }

  /** تبدیل ارقام فارسی/عربی به لاتین (برای فیلدهای کدی) */
  function latinDigits(s) {
    return String(s == null ? '' : s).replace(/[\u06F0-\u06F9\u0660-\u0669]/g, function (d) {
      return String(d.charCodeAt(0) & 0xf);
    });
  }

  /** کد ملی ۱۰ رقمی — رد ارقام یکسان + رقم کنترل mod 11 (ضرایب ۱۰..۲) — راستی‌آزمایی‌شده */
  function mellicodeOk(code) {
    code = latinDigits(code).replace(/\D/g, '');
    if (!/^\d{10}$/.test(code)) return false;
    if (new Set(code.split('')).size === 1) return false;
    var s = 0;
    for (var i = 0; i < 9; i++) s += Number(code[i]) * (10 - i);
    var r = s % 11;
    return (r < 2 ? r : 11 - r) === Number(code[9]);
  }

  /** شناسهٔ ملی حقوقی ۱۱ رقمی — ضرایب چرخشی 29,27,23,19,17 + دهگان+۲ + mod 11 — راستی‌آزمایی با ۵ بانک واقعی */
  function legalIdOk(code) {
    code = latinDigits(code).replace(/\D/g, '');
    if (!/^\d{11}$/.test(code)) return false;
    if (new Set(code.split('')).size === 1) return false;
    var w = [29, 27, 23, 19, 17, 29, 27, 23, 19, 17];
    var dec = Number(code[9]);
    var s = 0;
    for (var i = 0; i < 10; i++) s += (Number(code[i]) + dec + 2) * w[i];
    var r = s % 11;
    if (r === 10) r = 0;
    return r === Number(code[10]);
  }

  /** کد پستی ۱۰ رقمی معتبر */
  function postalOk(code) {
    code = latinDigits(code).replace(/\D/g, '');
    return /^\d{10}$/.test(code) && new Set(code.split('')).size > 1;
  }

  /** کد اقتصادی ۱۱ تا ۱۴ رقمی */
  function econOk(code) {
    code = latinDigits(code).replace(/\D/g, '');
    return /^\d{11,14}$/.test(code);
  }

  function UniqSuggest(input, opts) {
    opts = opts || {};
    var box = document.createElement('div');
    box.className = 'uniq-box';
    box.style.display = 'none';
    document.body.appendChild(box);

    var timer = null;
    var items = [];
    var active = -1;
    var lastQuery = '';
    var seq = 0;

    function position() {
      var r = input.getBoundingClientRect();
      box.style.left = r.left + 'px';
      box.style.top = (r.bottom + 2 + window.scrollY) + 'px';
      box.style.width = Math.max(r.width, 300) + 'px';
    }

    function hide() {
      box.style.display = 'none';
      active = -1;
    }

    function pick(i) {
      var p = items[i];
      if (!p) return;
      hide();
      if (opts.onPick) opts.onPick(p);
    }

    function renderRows() {
      var q = lastQuery;
      var html = '';
      for (var i = 0; i < items.length; i++) {
        var p = items[i];
        var bits = [];
        if (p.nationalId) bits.push('کد ملی: ' + p.nationalId);
        if (p.natIdentifier) bits.push('شناسه ملی: ' + p.natIdentifier);
        if (p.economicCode) bits.push('کد اقتصادی: ' + p.economicCode);
        if (!bits.length && p.mobile) bits.push('موبایل: ' + p.mobile);
        if (!bits.length && p.postalCode) bits.push('کد پستی: ' + p.postalCode);
        html += '<div class="uniq-row' + (i === active ? ' uniq-active' : '') + '" data-i="' + i + '">' +
          '<span class="uniq-badge uniq-k-' + esc(p.kind) + '">' + esc(p.kindFa || KIND_FA[p.kind] || '—') + '</span>' +
          '<span class="uniq-name">' + hl(p.displayName, q) + '</span>' +
          '<span class="uniq-meta">' + (bits.length ? esc(bits.join(' | ')) : '') + '</span>' +
          '</div>';
      }
      box.innerHTML = html +
        '<div class="uniq-foot">اگر جزو این‌ها نیست، با ادامهٔ ثبت به‌عنوان دادهٔ جدید ذخیره می‌شود.</div>';
      Array.prototype.forEach.call(box.querySelectorAll('.uniq-row'), function (row) {
        row.addEventListener('mousedown', function (ev) {
          ev.preventDefault(); /* قبل از blur */
          pick(Number(row.getAttribute('data-i')));
        });
      });
    }

    function runSearch() {
      var q = latinDigits(input.value).trim();
      lastQuery = q;
      if (q.length < 1) { hide(); return; }
      var mySeq = ++seq;
      position();
      apiGet('/parties/search?q=' + encodeURIComponent(q) + '&limit=10').then(function (res) {
        if (mySeq !== seq) return; /* پاسخ کهنه */
        if (res.status === 200 && res.body && res.body.data && res.body.data.length) {
          items = res.body.data;
          active = -1;
          position();
          renderRows();
          box.style.display = 'block';
          if (opts.onFound) opts.onFound(items, q);
        } else {
          items = [];
          if (opts.onNone) opts.onNone(q);
          hide();
        }
      }).catch(function () { hide(); });
    }

    input.addEventListener('input', function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(runSearch, 220); /* debounce ملایم — تایپ هر کاراکتر جستجو می‌شود */
    });
    input.addEventListener('focus', function () {
      if (input.value.trim().length >= 1) runSearch();
    });
    input.addEventListener('blur', function () { setTimeout(hide, 160); });
    input.addEventListener('keydown', function (ev) {
      if (box.style.display === 'none') return;
      if (ev.key === 'ArrowDown') { active = Math.min(active + 1, items.length - 1); renderRows(); ev.preventDefault(); }
      else if (ev.key === 'ArrowUp') { active = Math.max(active - 1, 0); renderRows(); ev.preventDefault(); }
      else if (ev.key === 'Enter') { if (active >= 0) { ev.preventDefault(); pick(active); } }
      else if (ev.key === 'Escape') { hide(); }
    });
    window.addEventListener('resize', function () { if (box.style.display === 'block') position(); });

    return { hide: hide, refresh: runSearch };
  }

  global.Uniq = {
    suggest: UniqSuggest,
    KIND_FA: KIND_FA,
    displayName: displayName,
    latinDigits: latinDigits,
    mellicodeOk: mellicodeOk,
    legalIdOk: legalIdOk,
    postalOk: postalOk,
    econOk: econOk,
  };
})(window);
