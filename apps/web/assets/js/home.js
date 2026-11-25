/**
 * home.js — U2 صفحهٔ اصلی به مرجع:
 * گرید سه‌دسته‌ای ۲۱ ماژول با آیکن‌های مرجع + انیمیشن flip سه‌بعدی (rotateY -80→0، scale 0.8→1،
 * transition .45s ease-in-out — استخراج‌شده از style2.php مرجع) + نوار کاربر (عکس + نام + سمت)
 * + تاریخ/ساعت شمسی + تم‌های سه‌گانه.
 */
(function (global) {
  'use strict';

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

  function avatarSrc(user) {
    if (user && user.photoUrl) return user.photoUrl;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44"><rect width="44" height="44" rx="8" fill="#dbe7fa"/><circle cx="22" cy="16" r="7" fill="#124a8f"/><path d="M8 38 q14 -14 28 0 z" fill="#124a8f"/></svg>'
    );
  }

  var CAT_TITLES = {
    front: 'فرانت‌آفیس',
    back: 'بک‌آفیس',
    other: 'خدمات جانبی',
  };

  global.Home = {
    render: function (root) {
      var Reg = global.ModuleRegistry;
      var sess = Auth.session();
      var user = (sess && sess.user) || {};

      root.innerHTML = '';
      var home = el('div', 'rx-home');

      /* ── سربرگ سیستم مرجع: لوگو + لوگوتایپ + تاریخ/ساعت + تم‌ها ── */
      var head = el('div', 'rx-head');
      var brand = el('div', 'rx-brand');
      brand.innerHTML =
        '<img class="rx-logo" src="assets/img/logo.svg" alt="لوگو">' +
        '<div><div class="rx-logotype">نرم‌افزار جامع هتلداری</div>' +
        '<div class="rx-logotype-en">Hotel ERP — Software</div></div>';
      head.appendChild(brand);

      var headLeft = el('div', 'rx-head-left');
      var themes = el('div', 'rx-themes');
      [['green', '#2e8b57'], ['blue', '#1d4ed8'], ['red', '#b91c1c']].forEach(function (t) {
        var b = el('button', 'rx-theme rx-theme-' + t[0]);
        b.style.background = t[1];
        b.title = 'تم ' + t[0];
        b.onclick = function () { document.body.dataset.rxTheme = t[0]; localStorage.setItem('hotel-erp-theme', t[0]); };
        themes.appendChild(b);
      });
      var clock = el('div', 'rx-clock');
      headLeft.appendChild(themes);
      headLeft.appendChild(clock);
      head.appendChild(headLeft);
      home.appendChild(head);

      /* ── گرید سه‌دسته‌ای ── */
      ['front', 'back', 'other'].forEach(function (cat) {
        var group = el('section', 'rx-group rx-group-' + cat);
        group.appendChild(el('div', 'rx-group-title', CAT_TITLES[cat]));
        var row = el('div', 'rx-row');
        Reg.byCat(cat).forEach(function (m) {
          var tile = el('div', 'rx-tile' + (m.ready ? '' : ' rx-tile-stub'));
          tile.dataset.view = m.view;
          tile.tabIndex = 0;
          tile.setAttribute('role', 'button');
          tile.innerHTML =
            '<div class="top"><img src="' + Reg.iconUrl(m) + '" alt="' + m.label + '"></div>' +
            '<div class="down">' + m.label + '</div>' +
            (m.ready ? '' : '<span class="rx-phase">' + m.phase + '</span>');
          function go() { global.App.go(m.view); }
          tile.onclick = go;
          tile.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
          row.appendChild(tile);
        });
        group.appendChild(row);
        home.appendChild(group);
      });

      /* ── نوار کاربر: عکس پرسنلی + نام کاربری + سمت — دقیقاً زیر فرم/گرید (الگوی مرجع) ── */
      var foot = el('div', 'rx-userbar');
      var uinfo = el('div', 'rx-userinfo');
      var img = el('img', 'rx-avatar');
      img.src = avatarSrc(user);
      img.alt = 'عکس پرسنلی';
      uinfo.appendChild(img);
      var utext = el('div', 'rx-usernames');
      utext.appendChild(el('div', 'rx-username', 'کاربر : ' + (user.fullName || user.username || '—')));
      utext.appendChild(el('div', 'rx-userpos', 'سمت : ' + (user.position || 'تعیین‌نشده')));
      uinfo.appendChild(utext);
      foot.appendChild(uinfo);

      var actions = el('div', 'rx-useractions');
      var refresh = el('button', 'rx-mini-btn', '↻ بازخوانی');
      refresh.onclick = function () { global.App.go('home'); };
      var out = el('button', 'rx-mini-btn rx-logout', 'خروج');
      out.onclick = function () {
        Auth.logout();
        document.body.classList.remove('reception-mode');
        global.App.boot();
      };
      actions.appendChild(refresh);
      actions.appendChild(out);
      foot.appendChild(actions);
      home.appendChild(foot);

      root.appendChild(home);

      /* ── ساعت زندهٔ شمسی ── */
      function tick() {
        var d = new Date();
        clock.innerHTML = '<div class="rx-clock-date">' + Num.toPersian(Jalali.fromDate(d)) + ' — ' +
          Jalali.DAY_NAMES[(d.getDay() + 1) % 7] + '</div>' +
          '<div class="rx-clock-time">' + Num.toPersian(Jalali.formatTime(d)) + '</div>';
      }
      tick();
      if (this._timer) clearInterval(this._timer);
      this._timer = setInterval(tick, 20000);

      /* تم ذخیره‌شده */
      var saved = localStorage.getItem('hotel-erp-theme');
      if (saved) document.body.dataset.rxTheme = saved;
    },
  };
})(window);
