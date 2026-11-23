/**
 * app.js — شل برنامه: سایدبار ماژول‌ها، نوار بالا (تاریخ شمسی/ساعت ۲۴h)، ریسپانسیو موبایل
 * قوانین ۱، ۲، ۶، ۱۵ مالک در این شل پیاده شده‌اند.
 */
(function (global) {
  'use strict';

  var Modules = global.Modules;

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

  function moduleCalendar(root) {
    root.appendChild(el('h2', null, 'تقویم هجری شمسی'));
    root.appendChild(el('p', 'muted', 'کبیسه تا سال ۱۵۰۰ صحیح است • فرمت رسمی نمایش: YYYY/MM/DD • ساعت ۲۴ ساعته'));
    var panel = el('div', 'panel jcal-panel');
    var sel = el('div', 'jcal-out');
    var info = el('div', 'jcal-info');
    panel.appendChild(sel);
    panel.appendChild(info);
    root.appendChild(panel);
    Jalali.calendar(sel, {
      onSelect: function (s, dow) {
        info.textContent = 'انتخاب شد: ' + Num.toPersian(s) + ' (' + Jalali.DAY_NAMES[dow] + ')';
      }
    });
    var today = new Date();
    info.textContent = 'امروز: ' + Num.toPersian(Jalali.fromDate(today)) + ' (' + Jalali.DAY_NAMES[(today.getDay() + 1) % 7] + ') — ساعت ' + Num.toPersian(Jalali.formatTime(today));
  }

  var NAV = [
    { id: 'dashboard', title: 'داشبورد مدیر AI', icon: '▦' },
    { id: 'frontdesk', title: 'نقشه اتاق (فاز ۴)', icon: '🛏' },
    { id: 'treasury', title: 'خزانه‌داری و صندوق (فاز ۵)', icon: '💰' },
    { id: 'housekeepingops', title: 'خانه‌داری و تعمیرات (فاز ۱۰)', icon: '🧹' },
    { id: 'assets', title: 'دارایی ثابت (فاز ۱۰)', icon: '🏛️' },
    { id: 'ancillary', title: 'خدمات جانبی (فاز ۱۰)', icon: '🛎' },
    { id: 'restaurant', title: 'رستوران و آشپزخانه (فاز ۶)', icon: '🍽️' },
    { id: 'procurement', title: 'خرید و تدارکات (فاز ۷)', icon: '🚚' },
    { id: 'stores', title: 'انبار و کاست کنترل (فاز ۷)', icon: '📦' },
    { id: 'moadian', title: 'صورتحساب مؤدیان (فاز ۹)', icon: '🧾' },
    { id: 'quarterly', title: 'معاملات فصلی (فاز ۹)', icon: '🗂' },
    { id: 'directtax', title: 'مالیات مستقیم (فاز ۹)', icon: '🏛' },
    { id: 'workflow', title: 'گردش کار تأیید (فاز ۸)', icon: '✅' },
    { id: 'calendar', title: 'تقویم شمسی', icon: '📅' },
    { id: 'payroll', title: 'حقوق و دستمزد', icon: '₪' },
    { id: 'settings', title: 'تنظیمات', icon: '⚙' }
  ];

  function boot() {
    var shell = document.getElementById('shell');
    if (!shell) return;
    shell.innerHTML = '';

    var sidebar = el('aside', 'sidebar');
    var brand = el('div', 'brand');
    brand.appendChild(el('div', 'brand-title', 'Hotel ERP'));
    brand.appendChild(el('div', 'brand-sub', 'سامانه یکپارچه هتلداری'));
    sidebar.appendChild(brand);
    var nav = el('nav', 'nav');
    NAV.forEach(function (m) {
      var b = el('button', 'nav-item', '');
      b.innerHTML = '<span class="nav-icon">' + m.icon + '</span><span class="fit">' + m.title + '</span>';
      b.dataset.id = m.id;
      b.onclick = function () { go(m.id); closeMobile(); };
      nav.appendChild(b);
    });
    sidebar.appendChild(nav);
    var ver = el('div', 'sidebar-ver', 'نسخه ۰.۷ — فارسی/RTL');
    sidebar.appendChild(ver);

    var main = el('main', 'main');
    var topbar = el('header', 'topbar');
    var burger = el('button', 'burger', '☰');
    burger.onclick = function () { document.body.classList.toggle('sidebar-open'); };
    var title = el('h1', 'topbar-title fit', '');
    var clock = el('div', 'topbar-clock');
    topbar.appendChild(burger); topbar.appendChild(title); topbar.appendChild(clock);
    var content = el('section', 'content');
    main.appendChild(topbar); main.appendChild(content);

    shell.appendChild(sidebar); shell.appendChild(main);

    function go(id) {
      nav.querySelectorAll('.nav-item').forEach(function (b) { b.classList.toggle('active', b.dataset.id === id); });
      content.innerHTML = '';
      var mod = NAV.find(function (m) { return m.id === id; });
      title.textContent = mod.title;
      try {
        if (id === 'calendar') moduleCalendar(content);
        else Modules[id].render(content);
      } catch (e) {
        content.appendChild(el('div', 'panel', 'خطا در بارگذاری ماژول: ' + e.message));
        console.error(e);
      }
      Num.fitAll(content);
    }

    function closeMobile() { document.body.classList.remove('sidebar-open'); }
    function tick() {
      var d = new Date();
      clock.innerHTML = '';
      clock.appendChild(el('span', 'clock-date', Num.toPersian(Jalali.fromDate(d))));
      clock.appendChild(el('span', 'clock-time', Num.toPersian(Jalali.formatTime(d))));
    }
    tick(); setInterval(tick, 30000);

    go('dashboard');
    global.App = { go: go };
  }

  document.addEventListener('DOMContentLoaded', boot);
})(window);
