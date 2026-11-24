/**
 * reception-shell.js — U3 شل «نرم‌افزار پذیرش» به سبک دقیق recp1.php آسا (اسکرین‌شات کارفرما):
 * سربرگ (تم‌ها + لوگو + تاریخ شمسی/میلادی + Home/Refresh/AskAI + جستجو) + ردیف تب‌های
 * «رک اتاق‌ها | رجیستر | عملیات | تور و شرکت | صندوق | گزارشات ماهانه | گزارشات روزانه |
 *  امکانات ۱ | امکانات ۲ | خروج» + پنل زرد «نرم‌افزار پذیرش — سال مالی جاری» با ۵ کارت بزرگ
 * (روم رک هتل، عملیات صندوق، دفترچه تلفن، صورت حساب، داشبورد) + نوار علاقه‌مندی‌ها عمودی
 * + نوار کاربر پایین صفحه (عکس + نام + سمت) و آیکن ثبت پلیس.
 * رفتار آسا: حالت نخست پنل = ۵ کارت؛ کلیک کارت/تب → محتوای همان تب (کارتها فقط در حالت نخست).
 * مراجع: docs/reference/asa/pages/*.html (۱۵ صفحهٔ واقعی آسا) — پیاده‌سازی کامل هر تب در فاز R.
 */
(function (global) {
  'use strict';

  /* توجه: ماژول‌ها بعد از این فایل ثبت می‌شوند — همیشه در زمان فراخوانی از global خوانده شود */

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

  var RICON = 'assets/icons/asa-reception/';

  /* تب‌های ردیف بالا — به ترتیب اسکرین‌شات آسا */
  var TABS = [
    { id: 'rack',     label: 'رک اتاق‌ها',     icon: RICON + 'room_rack.png',       render: rackTab },
    { id: 'register', label: 'رجیستر',         icon: RICON + 'contacts.png',        render: registerTab },
    { id: 'ops',      label: 'عملیات',         icon: RICON + 'cash_new.png',        render: opsTab },
    { id: 'tours',    label: 'تور و شرکت',     icon: RICON + 'contacts.png',        render: toursTab },
    { id: 'cash',     label: 'صندوق',          icon: RICON + 'bill.png',            render: cashTab },
    { id: 'reportsM', label: 'گزارشات ماهانه', icon: RICON + 'dashboard_gauge.png', render: reportsMTab },
    { id: 'reportsD', label: 'گزارشات روزانه', icon: RICON + 'dashboard_gauge.png', render: reportsDTab },
    { id: 'fac1',     label: 'امکانات ۱',      icon: RICON + 'sopervisory.png',     render: fac1Tab },
    { id: 'fac2',     label: 'امکانات ۲',      icon: RICON + 'sopervisory.png',     render: fac2Tab },
    { id: 'exit',     label: 'خروج',           icon: RICON + 'home.png',            render: null },
  ];

  /* ۵ کارت بزرگ پنل پذیرش — به ترتیب اسکرین‌شات آسا */
  var CARDS = [
    { label: 'روم رک هتل',   icon: RICON + 'room_rack.png',       tab: 'rack' },
    { label: 'عملیات صندوق', icon: RICON + 'cash_new.png',        tab: 'ops' },
    { label: 'دفترچه تلفن',  icon: RICON + 'contacts.png',        tab: 'tours' },
    { label: 'صورت حساب',    icon: RICON + 'bill.png',            tab: 'cash' },
    { label: 'داشبورد',      icon: RICON + 'dashboard_gauge.png', tab: 'reportsD' },
  ];

  /* ── محتوای تب‌ها ── */

  function stubNote(refFile, phase) {
    return 'پیاده‌سازی کامل با مرجع «' + refFile + '» در فاز ' + phase +
      ' — فایل مرجع در docs/reference/asa/pages/ ذخیره شده است.';
  }

  function panelStub(panel, title, refFile, phase, bullets) {
    panel.innerHTML = '';
    var box = el('div', 'rec-stub');
    box.appendChild(el('h3', null, title));
    box.appendChild(el('p', 'muted', stubNote(refFile, phase)));
    var ul = el('ul', 'rec-stub-list');
    bullets.forEach(function (b) { ul.appendChild(el('li', null, b)); });
    box.appendChild(ul);
    panel.appendChild(box);
  }

  function mountModule(panel, moduleId, fallbackTitle) {
    panel.innerHTML = '';
    var mod = global.Modules && global.Modules[moduleId];
    if (mod && typeof mod.render === 'function') {
      var wrap = el('div', 'rec-module-mount');
      panel.appendChild(wrap);
      try { mod.render(wrap); } catch (e) { panel.appendChild(el('div', 'panel', 'خطا در ماژول: ' + e.message)); }
    } else {
      panelStub(panel, fallbackTitle, '—', 'بعدی', ['ماژول داخلی یافت نشد.']);
    }
  }

  function rackTab(panel) {
    /* R1 — روم‌رک واقعی آسا (کاشی‌های پوشه‌ای + عملیات اتاق)؛ اگر ماژول نبود، پذیرش فعلی */
    panel.innerHTML = '';
    if (global.Modules && global.Modules.roomrack) {
      var wrap = el('div', 'rec-module-mount');
      panel.appendChild(wrap);
      global.Modules.roomrack.render(wrap);
    } else mountModule(panel, 'frontdesk', 'رک اتاق‌ها');
  }
  function cashTab(panel) { mountModule(panel, 'treasury', 'صندوق'); }
  function reportsMTab(panel) { mountModule(panel, 'bi', 'گزارشات ماهانه'); }
  function reportsDTab(panel) { mountModule(panel, 'dashboard', 'گزارشات روزانه'); }
  function fac1Tab(panel) { mountModule(panel, 'ancillary', 'امکانات ۱'); }
  function fac2Tab(panel) { panelStub(panel, 'امکانات ۲', '—', 'بعدی', ['امکانات تکمیلی پذیرش']); }
  function toursTab(panel) {
    panelStub(panel, 'تور و شرکت', 'Register_Card_Active_List.html', 'R2', [
      'شرکت‌ها و آژانس‌های همکار با قرارداد و نرخ',
      'تورها و گروه‌ها + تخصیص اتاق گروهی',
      'کلیه هزینه‌ها روی حساب شرکت (City Ledger)',
    ]);
  }
  function opsTab(panel) {
    panelStub(panel, 'عملیات — Room Sharge Menu', 'Room_Sharge_Menu.html', 'R4', [
      'چارج اتاق: انتقال شارژ خدمات به حساب مهمان',
      'عملیات صندوق پذیرش: دریافت/پرداخت سریع',
      'پیغام کاربران و محاسبهٔ خودکار شارژها',
    ]);
  }
  function registerTab(panel) {
    /* R3 — فرم ثبت رجیستر جدید با فیلدهای دقیق آسا؛ ثبت به POST /pms/reservations یا پیش‌نویس */
    panel.innerHTML = '';
    if (global.Modules && global.Modules.register) {
      var wrap = el('div', 'rec-module-mount');
      panel.appendChild(wrap);
      global.Modules.register.render(wrap);
    } else {
      panelStub(panel, 'رجیستر — ثبت کارت مهمان جدید', 'New_Registration.html', 'R3', [
        'مشخصات کامل مهمان: نام/نام‌خانوادگی لاتین، کد ملی/پاسپورت، ملیت، تلفن',
        'اقامت: تاریخ ورود/خروج، اتاق، نرخ، نفرات، همراهان',
        'چاپ کارت مهمان + ثبت پلیس (ادارهٔ اتباع)',
      ]);
    }
  }

  /* ── شل اصلی ── */

  var currentTab = 'home'; /* home = پنل ۵ کارت (حالت نخست آسا) */

  global.AsaReception = {
    render: function (root) {
      document.body.classList.add('reception-mode');
      root.innerHTML = '';
      var shell = el('div', 'rec-shell');

      var panel = el('div', 'rec-panel');
      var tabsRow = null;

      function switchTab(id) {
        if (id === 'exit') {
          document.body.classList.remove('reception-mode');
          global.App.go('home');
          return;
        }
        currentTab = id;
        tabsRow.querySelectorAll('.rec-tab').forEach(function (t) {
          t.classList.toggle('active', t.dataset.tab === id);
        });
        if (id === 'home') {
          panel.innerHTML = '';
          var cap = el('div', 'rec-panel-cap');
          cap.innerHTML = '<span class="rec-panel-title">نرم افزار پذیرش</span>' +
            '<span class="rec-panel-sub">سال مالی جاری : هتل نمونه — آزمایشی ۱۴۰۵</span>';
          panel.appendChild(cap);
          CARDS.forEach(function (c) {
            var card = el('button', 'rec-card');
            card.innerHTML = '<div class="rec-card-top"><img src="' + c.icon + '" alt="' + c.label + '"></div>' +
              '<div class="rec-card-down">' + c.label + '</div>';
            card.onclick = function () { switchTab(c.tab); };
            panel.appendChild(card);
          });
        } else {
          var tab = TABS.find(function (t) { return t.id === id; });
          if (tab && typeof tab.render === 'function') tab.render(panel);
        }
      }

      /* ── سربرگ ── */
      var head = el('div', 'rec-head');
      var hrow1 = el('div', 'rec-head-row');

      var themes = el('div', 'asa-themes');
      [['green', '#2e8b57'], ['blue', '#1d4ed8'], ['red', '#b91c1c']].forEach(function (t) {
        var b = el('button', 'asa-theme asa-theme-' + t[0]);
        b.style.background = t[1];
        b.title = 'تم ' + t[0];
        b.onclick = function () { document.body.dataset.asaTheme = t[0]; localStorage.setItem('hotel-erp-asa-theme', t[0]); };
        themes.appendChild(b);
      });
      hrow1.appendChild(themes);

      var brand = el('div', 'rec-brand');
      brand.innerHTML = '<img class="asa-logo" src="assets/img/logo.svg" alt="لوگو">' +
        '<div><div class="rec-logotype">نرم‌افزار پذیرش</div><div class="rec-logotype-en">Reception — Hotel ERP</div></div>';
      hrow1.appendChild(brand);

      var headLeft = el('div', 'rec-head-left');
      var clock = el('div', 'rec-clock');
      headLeft.appendChild(clock);
      hrow1.appendChild(headLeft);
      head.appendChild(hrow1);

      var hrow2 = el('div', 'rec-head-row rec-toolbar');
      var btnHome = el('button', 'rec-tool');
      btnHome.innerHTML = '<img src="' + RICON + 'home.png" alt=""> <span>Home</span>';
      btnHome.onclick = function () { switchTab('home'); };
      var btnRefresh = el('button', 'rec-tool');
      btnRefresh.innerHTML = '<img src="' + RICON + 'refresh.png" alt=""> <span>Refresh</span>';
      btnRefresh.onclick = function () { switchTab(currentTab); };
      var btnAi = el('button', 'rec-tool rec-ai');
      btnAi.innerHTML = '<img src="' + RICON + 'openAI_purple.png" alt=""> <span>Ask AI</span>';
      btnAi.onclick = function () { panelStub(panel, 'دستیار هوشمند پذیرش', '—', 'بعدی', ['پرسش‌وپاسخ روی دادهٔ اقامت‌ها، اشغال و درآمد']); };

      var search = el('div', 'rec-search');
      var inp = el('input');
      inp.type = 'search';
      inp.placeholder = 'جستجو در منوها';
      var btnGo = el('button', 'rec-search-btn', 'بگرد');
      search.appendChild(inp);
      search.appendChild(btnGo);
      btnGo.onclick = function () { filterTabs(inp.value); };
      inp.onkeydown = function (e) { if (e.key === 'Enter') filterTabs(inp.value); };
      function filterTabs(q) {
        q = (q || '').trim();
        tabsRow.querySelectorAll('.rec-tab').forEach(function (t) {
          t.hidden = !!q && !t.textContent.trim().includes(q);
        });
      }

      hrow2.appendChild(btnHome);
      hrow2.appendChild(btnRefresh);
      hrow2.appendChild(btnAi);
      hrow2.appendChild(search);
      head.appendChild(hrow2);
      shell.appendChild(head);

      function tick() {
        var d = new Date();
        clock.innerHTML = '<div class="rec-clock-date">' + Num.toPersian(Jalali.fromDate(d)) + ' — ' +
          Jalali.DAY_NAMES[(d.getDay() + 1) % 7] + '</div>' +
          '<div class="rec-clock-time">' + Num.toPersian(Jalali.formatTime(d)) + ' • ' + d.getFullYear() + '/' +
          (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1) + '/' + (d.getDate() < 10 ? '0' : '') + d.getDate() + '</div>';
      }
      tick();
      if (AsaReception._t) clearInterval(AsaReception._t);
      AsaReception._t = setInterval(tick, 20000);

      /* ── ردیف تب‌ها ── */
      tabsRow = el('div', 'rec-tabs');
      TABS.forEach(function (t) {
        var b = el('button', 'rec-tab');
        b.dataset.tab = t.id;
        b.innerHTML = '<img src="' + t.icon + '" alt=""> <span>' + t.label + '</span>';
        b.onclick = function () { switchTab(t.id); };
        tabsRow.appendChild(b);
      });
      shell.appendChild(tabsRow);

      /* ── پنل زرد اصلی ── */
      shell.appendChild(panel);

      /* ── نوار عمودی علاقه‌مندی‌ها (الگوی آسا: + / فهرست / منو) ── */
      var strip = el('div', 'rec-strip');
      var addBtn = el('button', 'rec-strip-btn rec-strip-add', '+');
      addBtn.title = 'اضافه کردن صفحه جدید';
      addBtn.onclick = function () {
        var tab = TABS.find(function (t) { return t.id === currentTab; });
        if (!tab) return;
        var list = JSON.parse(localStorage.getItem('hotel-erp-rec-favorites') || '[]');
        if (list.some(function (f) { return f.id === tab.id; })) return;
        list.push({ id: tab.id, label: tab.label });
        localStorage.setItem('hotel-erp-rec-favorites', JSON.stringify(list));
        refreshStrip();
      };
      strip.appendChild(addBtn);

      var listWrap = el('div', 'rec-strip-list');
      strip.appendChild(listWrap);
      var menuBtn = el('button', 'rec-strip-btn rec-strip-menu', '☰');
      menuBtn.title = 'دسترسی سریع به منوها';
      menuBtn.onclick = function () { listWrap.classList.toggle('open'); };
      strip.appendChild(menuBtn);

      function refreshStrip() {
        var list = JSON.parse(localStorage.getItem('hotel-erp-rec-favorites') || '[]');
        listWrap.innerHTML = '';
        list.forEach(function (f) {
          var b = el('button', 'rec-strip-fav', f.label);
          b.onclick = function () { switchTab(f.id); };
          listWrap.appendChild(b);
        });
      }
      refreshStrip();
      shell.appendChild(strip);

      /* ── نوار پایین: ثبت پلیس (چپ) + کاربر (راست) — الگوی آسا ── */
      var sess = Auth.session();
      var user = (sess && sess.user) || {};
      var foot = el('div', 'rec-foot');
      var police = el('button', 'rec-police');
      police.innerHTML = '<span class="rec-police-ico">🛂</span><span>ثبت پلیس</span>';
      police.onclick = function () { panelStub(panel, 'ثبت پلیس (ادارهٔ اتباع)', '—', 'R3', ['ثبت اقامت بیگانگان برای ادارهٔ اتباع']); };
      foot.appendChild(police);

      var uinfo = el('div', 'asa-userinfo rec-userinfo');
      var img = el('img', 'asa-avatar');
      img.src = user.photoUrl || 'data:image/svg+xml;utf8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44"><rect width="44" height="44" rx="8" fill="#dbe7fa"/><circle cx="22" cy="16" r="7" fill="#124a8f"/><path d="M8 38 q14 -14 28 0 z" fill="#124a8f"/></svg>'
      );
      uinfo.appendChild(img);
      var utext = el('div');
      utext.appendChild(el('div', 'asa-username', 'کاربر : ' + (user.fullName || user.username || '—')));
      utext.appendChild(el('div', 'asa-userpos', 'سمت : ' + (user.position || '—')));
      uinfo.appendChild(utext);
      foot.appendChild(uinfo);
      shell.appendChild(foot);

      root.appendChild(shell);
      switchTab(currentTab);

      var saved = localStorage.getItem('hotel-erp-asa-theme');
      if (saved) document.body.dataset.asaTheme = saved;
    },
  };
})(window);
