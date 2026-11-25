/**
 * auth.js — U1 لایهٔ ورود: نشست، کپچا (API یا نمایشی)، خطاهای مرجع، آخرین ورود
 * - حالت اصلی: GET /auth/captcha + POST /auth/login (کپچای SVG سرور، یک‌بارمصرف)
 * - حالت نمایشی: اگر سرور در دسترس نبود (پیش‌نمایش استاتیک)، کپچای محلی + حساب نمایشی
 * کلیدهای localStorage: hotel-erp-session | hotel-erp-api-base | hotel-erp-token (سازگار با ماژول‌ها)
 */
(function (global) {
  'use strict';

  var SESSION_KEY = 'hotel-erp-session';
  var TOKEN_KEY = 'hotel-erp-token';
  var API_BASE_KEY = 'hotel-erp-api-base';
  var DEMO_USER = 'admin';
  var DEMO_PASS = 'Hotel@Erp2025';

  function apiBase() {
    return localStorage.getItem(API_BASE_KEY) || 'http://localhost:3000/api/v1';
  }

  function session() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; }
  }
  function saveSession(s) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    localStorage.setItem(TOKEN_KEY, s.accessToken || ''); // سازگاری با ماژول‌های موجود
  }
  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(TOKEN_KEY);
  }

  /** کپچای محلی (حالت نمایشی): کد در sessionStorage برای مقایسهٔ محلی */
  function localCaptcha() {
    var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var code = '';
    for (var i = 0; i < 5; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    var lines = '';
    for (var j = 0; j < 4; j++) {
      lines += '<line x1="' + (Math.random() * 160 | 0) + '" y1="' + (Math.random() * 48 | 0) +
        '" x2="' + (Math.random() * 160 | 0) + '" y2="' + (Math.random() * 48 | 0) +
        '" stroke="#93a7c8" stroke-width="1" opacity="0.6"/>';
    }
    var chars = '';
    for (var k = 0; k < code.length; k++) {
      var x = 22 + k * 25;
      var rot = (Math.random() * 30 - 15).toFixed(0);
      var col = ['#1d4ed8', '#0f766e', '#7c2d12', '#374151'][Math.random() * 4 | 0];
      chars += '<text x="' + x + '" y="' + (32 + (Math.random() * 8 - 4 | 0)) + '" font-size="26" font-family="monospace" font-weight="bold" fill="' + col + '" transform="rotate(' + rot + ' ' + x + ' 32)">' + code[k] + '</text>';
    }
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="48" viewBox="0 0 160 48">' +
      '<rect width="160" height="48" fill="#eef3fb"/>' + lines + chars + '</svg>';
    sessionStorage.setItem('hotel-erp-demo-captcha', code);
    return { captchaId: 'demo', svg: svg, demo: true };
  }

  function fetchCaptcha() {
    return fetch(apiBase() + '/auth/captcha', { method: 'GET' })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (j) { return j.data; })
      .catch(function () { return localCaptcha(); });
  }

  var lastError = null;

  function login(username, password, captchaId, captchaText, totp) {
    var payload = { username: username, password: password };
    if (totp) payload.totp = totp;
    if (captchaId === 'demo') {
      // حالت نمایشی — بدون سرور
      var expected = sessionStorage.getItem('hotel-erp-demo-captcha') || '';
      if ((captchaText || '').toUpperCase() !== expected) {
        return Promise.reject({ code: 'CAPTCHA_MISMATCH', message: 'حروف امنیتی مطابقت ندارند.' });
      }
      if (username !== DEMO_USER || password !== DEMO_PASS) {
        return Promise.reject({ code: 'UNAUTHORIZED', message: 'نام کاربری و رمز عبور مطابقت ندارند.' });
      }
      var s = {
        accessToken: 'demo-token',
        refreshToken: '',
        demo: true,
        user: { id: 'demo', username: DEMO_USER, fullName: 'مدیر سیستم', position: 'مدیر هتل', photoUrl: null, roles: ['admin'], mfaEnabled: false },
        lastLogin: JSON.parse(localStorage.getItem('hotel-erp-demo-last-login') || 'null'),
      };
      localStorage.setItem('hotel-erp-demo-last-login', JSON.stringify({ at: new Date().toISOString(), ip: 'localhost' }));
      saveSession(s);
      return Promise.resolve(s);
    }
    payload.captchaId = captchaId;
    payload.captchaText = captchaText;
    return fetch(apiBase() + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, body: j }; });
    }).then(function (res) {
      if (res.status !== 200 && res.status !== 201) {
        var err = (res.body && res.body.error) || res.body || {};
        var code = err.code || 'UNAUTHORIZED';
        var msg = {
          UNAUTHORIZED: 'نام کاربری و رمز عبور مطابقت ندارند.',
          CAPTCHA_MISMATCH: 'حروف امنیتی مطابقت ندارند.',
          MFA_REQUIRED: 'این نقش نیازمند کد دومرحله‌ای است.',
          MFA_INVALID: 'کد دومرحله‌ای معتبر نیست.',
          LOCKED: 'دسترسی شما به این سامانه موقتاً مسدود شده است. لطفاً با مدیر سیستم تماس بگیرید.',
        }[code] || err.message || 'خطای ' + res.status;
        throw { code: code, message: msg, status: res.status };
      }
      saveSession(res.body);
      return res.body;
    }).catch(function (e) {
      if (e && e.code) throw e;
      // شبکه در دسترس نیست → حالت نمایشی با کپچای محلی
      throw { code: 'NETWORK', message: 'سرور در دسترس نیست — ورود در حالت نمایشی', network: true };
    });
  }

  function logout() {
    var s = session();
    clearSession();
    if (s && !s.demo && s.refreshToken) {
      fetch(apiBase() + '/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: s.refreshToken }),
      }).catch(function () {});
    }
  }

  /* ── SSO (نسخهٔ ۳٫۳): نشست واحد برای همهٔ ماژول‌ها ──
     توکن دسترسی ۱۵ دقیقه عمر دارد؛ تایمر و رهگیر ۴۰۱ آن را بی‌صدا با refresh چرخشی تازه می‌کند —
     کاربر فقط یک بار در صفحهٔ ورود شل، وارد می‌شود و هیچ ماژولی دوباره نام کاربری/رمز نمی‌خواهد. */
  var refreshing = null;
  function refreshSession() {
    var s = session();
    if (!s || s.demo || !s.refreshToken) return Promise.resolve(false);
    if (refreshing) return refreshing;
    refreshing = fetch(apiBase() + '/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: s.refreshToken }),
    }).then(function (r) {
      if (r.status !== 200 && r.status !== 201) throw new Error('refresh ' + r.status);
      return r.json();
    }).then(function (j) {
      saveSession(j);
      return true;
    }).catch(function () {
      // نشست منقضی/مسروق شده → خروج تمیز و بازگشت به صفحهٔ ورود
      clearSession();
      return false;
    }).then(function (ok) {
      refreshing = null;
      return ok;
    });
    return refreshing;
  }
  function startAutoRefresh() {
    setInterval(function () {
      if (session() && !document.hidden) refreshSession();
    }, 10 * 60 * 1000);
  }
  startAutoRefresh();

  /* رهگیر fetch: هر ۴۰۱ از API با توکن بِرر → یک بار تازه‌سازی و تکرار درخواست */
  var origFetch = global.fetch;
  global.fetch = function (input, init) {
    init = init || {};
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var base = apiBase();
    var authOnly = !init.headers || typeof init.headers.Authorization !== 'string' ||
      init.headers.Authorization.indexOf('Bearer ') !== 0;
    var isAuthPath = /\/auth\/(login|refresh|logout|captcha)/.test(url);
    if (!base || url.indexOf(base) !== 0 || authOnly || isAuthPath || typeof init.body === 'object') {
      return origFetch.apply(this, arguments);
    }
    return origFetch.call(this, url, init).then(function (res) {
      if (res.status !== 401) return res;
      return refreshSession().then(function (ok) {
        if (!ok) return res;
        var s = session();
        if (!s || !s.accessToken) return res;
        var headers = {};
        for (var k in (init.headers || {})) headers[k] = init.headers[k];
        headers.Authorization = 'Bearer ' + s.accessToken;
        return origFetch.call(this, url, Object.assign({}, init, { headers: headers }));
      });
    });
  };

  global.Auth = {
    session: session,
    apiBase: apiBase,
    fetchCaptcha: fetchCaptcha,
    login: login,
    logout: logout,
    isDemo: function () { var s = session(); return !!(s && s.demo); },
    /* U1 — صفحهٔ ورود (اولین صفحهٔ برنامه) — چیدمان مودال مرجع */
    renderLogin: function (root, onSuccess) {
      root.innerHTML = '';
      var page = document.createElement('div');
      page.className = 'login-page';

      var card = document.createElement('div');
      card.className = 'login-card';

      var logoWrap = document.createElement('div');
      logoWrap.className = 'login-logo';
      logoWrap.innerHTML =
        '<img src="assets/img/logo.svg" alt="Hotel ERP" width="72" height="72">' +
        '<h1 class="login-title">نرم‌افزار جامع هتلداری</h1>' +
        '<div class="login-sub">Hotel ERP — سامانهٔ یکپارچهٔ هتلداری</div>';
      card.appendChild(logoWrap);

      var h2 = document.createElement('h2');
      h2.className = 'login-heading';
      h2.textContent = 'صفحه ورود کاربران';
      card.appendChild(h2);

      function msgBox(id, cls, text) {
        var p = document.createElement('p');
        p.id = id;
        p.className = 'login-msg ' + cls;
        p.textContent = text;
        return p;
      }
      var loader = msgBox('login-loader', 'blue', 'لطفا تامل فرمایید.');
      var errUser = msgBox('login-error', 'red', 'نام کاربری و رمز عبور مطابقت ندارند.');
      var errCaptcha = msgBox('login-error-captcha', 'red', 'حروف امنیتی مطابقت ندارند.');
      var errLock = msgBox('login-error-lock', 'red', 'دسترسی شما به این سامانه موقتاً مسدود شده است. لطفاً با مدیر سیستم تماس بگیرید.');
      var errExp = msgBox('login-error-exp', 'red', 'اعتبار حساب کاربری شما به پایان رسیده است.');
      var info = msgBox('login-info', 'SmallBlue', '');
      [loader, errUser, errCaptcha, errLock, errExp, info].forEach(function (p) { p.hidden = true; card.appendChild(p); });

      var form = document.createElement('form');
      form.className = 'ContactForm';
      form.autocomplete = 'off';

      var userInput = document.createElement('input');
      userInput.type = 'text';
      userInput.placeholder = 'نام کاربری';
      userInput.id = 'user_reg';
      userInput.dir = 'rtl';
      userInput.autocomplete = 'off';

      var passInput = document.createElement('input');
      passInput.type = 'password';
      passInput.placeholder = 'رمز عبور';
      passInput.id = 'pass_reg';
      passInput.dir = 'rtl';

      var capRow = document.createElement('div');
      capRow.className = 'captcah-images';
      var capImg = document.createElement('div');
      capImg.id = 'login-captcha';
      capImg.className = 'login-captcha-img';
      var capRefresh = document.createElement('button');
      capRefresh.type = 'button';
      capRefresh.className = 'img-refresh-reg';
      capRefresh.title = 'حروف امنیتی جدید';
      capRefresh.innerHTML = '&#x21bb;';
      capRow.appendChild(capImg);
      capRow.appendChild(capRefresh);

      var capInput = document.createElement('input');
      capInput.type = 'text';
      capInput.placeholder = 'حروف امنیتی';
      capInput.id = 'captcha_value_reg';
      capInput.dir = 'ltr';
      capInput.autocomplete = 'off';
      capInput.maxLength = 8;

      /* SSO — کد دومرحله‌ای نقش‌های حساس: فقط پس از پاسخ MFA_REQUIRED نمایش داده می‌شود */
      var totpInput = document.createElement('input');
      totpInput.type = 'text';
      totpInput.placeholder = 'کد دومرحله‌ای (TOTP)';
      totpInput.dir = 'ltr';
      totpInput.autocomplete = 'off';
      totpInput.maxLength = 10;
      totpInput.className = 'login-totp';
      totpInput.hidden = true;

      var demoNote = document.createElement('p');
      demoNote.className = 'login-demo-note';
      demoNote.hidden = true;

      var submit = document.createElement('button');
      submit.type = 'submit';
      submit.id = 'sub_reg';
      submit.className = 'submitbtn';
      submit.textContent = 'ورود';

      var hint = document.createElement('p');
      hint.className = 'login-hint';
      hint.textContent = 'سامانه به حروف کوچک و بزرگ حساس می‌باشد.';

      form.appendChild(userInput);
      form.appendChild(passInput);
      form.appendChild(capRow);
      form.appendChild(capInput);
      form.appendChild(totpInput);
      form.appendChild(demoNote);
      form.appendChild(submit);
      form.appendChild(hint);
      card.appendChild(form);

      var lastLoginBox = document.createElement('div');
      lastLoginBox.className = 'login-last';
      lastLoginBox.hidden = true;
      card.appendChild(lastLoginBox);

      page.appendChild(card);
      root.appendChild(page);

      /* ── کپچا ── */
      var captchaId = null;
      function refreshCaptcha() {
        capImg.innerHTML = '<span class="login-cap-wait">…</span>';
        Auth.fetchCaptcha().then(function (cap) {
          captchaId = cap.captchaId;
          capImg.innerHTML = cap.svg;
          demoNote.hidden = !cap.demo;
          if (cap.demo) demoNote.textContent = 'حالت نمایشی — سرور در دسترس نیست • کاربر: admin / رمز: Hotel@Erp2025';
        });
      }
      refreshCaptcha();
      capRefresh.onclick = refreshCaptcha;

      function show(el, on) { el.hidden = !on; }
      function hideAll() { [loader, errUser, errCaptcha, errLock, errExp, info].forEach(function (p) { show(p, false); }); }

      /* بازنمایی آخرین ورود ذخیره‌شده (پس از خروج) */
      var s = session();
      if (s && s.lastLogin) {
        lastLoginBox.hidden = false;
        var d = new Date(s.lastLogin.at || s.lastLogin);
        lastLoginBox.innerHTML = '<b>اطلاعات آخرین ورود شما به سیستم</b><br>زمان: ' +
          Num.toPersian(Jalali.fromDate(d)) + ' — ' + Num.toPersian(Jalali.formatTime(d));
      }

      form.onsubmit = function (ev) {
        ev.preventDefault();
        hideAll();
        show(loader, true);
        lastError = null;
        Auth.login(userInput.value, passInput.value, captchaId, capInput.value,
          totpInput.hidden ? undefined : totpInput.value).then(function (sess) {
          show(loader, false);
          if (sess.lastLogin) {
            lastLoginBox.hidden = false;
            var dd = new Date(sess.lastLogin.at);
            lastLoginBox.innerHTML = '<b>اطلاعات آخرین ورود شما به سیستم</b><br>زمان: ' +
              Num.toPersian(Jalali.fromDate(dd)) + ' — ' + Num.toPersian(Jalali.formatTime(dd));
          }
          onSuccess(sess);
        }).catch(function (e) {
          show(loader, false);
          if (e.network) {
            info.textContent = e.message;
            show(info, true);
            refreshCaptcha();
            return;
          }
          if (e.code === 'CAPTCHA_MISMATCH') { show(errCaptcha, true); refreshCaptcha(); }
          else if (e.code === 'MFA_REQUIRED' || e.code === 'MFA_INVALID') {
            errUser.textContent = e.code === 'MFA_REQUIRED'
              ? 'این نقش نیازمند کد دومرحله‌ای است — کد TOTP را وارد کنید.'
              : 'کد دومرحله‌ای معتبر نیست — کد جدید را وارد کنید.';
            show(errUser, true);
            totpInput.hidden = false;
            totpInput.focus();
            refreshCaptcha();
          }
          else if (e.code === 'LOCKED') show(errLock, true);
          else if (e.code === 'EXPIRED') show(errExp, true);
          else { show(errUser, true); refreshCaptcha(); }
        });
      };
    },
  };
})(window);
