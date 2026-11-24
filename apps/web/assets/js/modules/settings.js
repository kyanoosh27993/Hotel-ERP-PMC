/**
 * modules/settings.js — تنظیمات: تم‌ها، فونت متن/عدد، واحدها، پارامترهای قانونی (قانون ۱۱ و ۱۶)
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

  Modules.settings = {
    title: 'تنظیمات و شخصی‌سازی',
    render: function (root) {
      root.appendChild(el('h2', null, 'تنظیمات و شخصی‌سازی ظاهر'));

      // ── اتصال و ورود مرکزی (موج ۶ — یافتهٔ تست زندهٔ #۱) ──
      var TOKEN_KEY = 'hotel-erp-token';
      var API_BASE_KEY = 'hotel-erp-api-base';
      var conn = el('div', 'panel');
      conn.appendChild(el('h3', null, 'اتصال به سرور و ورود (همهٔ نقش‌ها)'));
      var apiBase = el('input', 'input'); apiBase.placeholder = 'آدرس API'; apiBase.value = localStorage.getItem(API_BASE_KEY) || 'http://localhost:3000/api/v1';
      var userIn = el('input', 'input'); userIn.placeholder = 'نام کاربری';
      var passIn = el('input', 'input'); passIn.type = 'password'; passIn.placeholder = 'گذرواژه';
      var totpIn = el('input', 'input'); totpIn.placeholder = 'کد TOTP (نقش حساس)';
      var loginBtn = el('button', 'btn btn-primary', 'ورود و ذخیره توکن');
      var logoutBtn = el('button', 'btn', 'خروج (پاک‌سازی توکن)');
      var connMsg = el('div', 'muted', localStorage.getItem(TOKEN_KEY) ? 'وضعیت: وارد شده (توکن موجود).' : 'وضعیت: بدون توکن — برای ماژول‌ها وارد شوید.');
      function crow(l, i) { var w = el('div', 'form-row'); w.appendChild(el('label', null, l)); w.appendChild(i); return w; }
      conn.appendChild(crow('آدرس API', apiBase));
      conn.appendChild(crow('کاربر', userIn));
      conn.appendChild(crow('گذرواژه', passIn));
      conn.appendChild(crow('TOTP', totpIn));
      var cbtns = el('div', 'form-row'); cbtns.appendChild(loginBtn); cbtns.appendChild(logoutBtn);
      conn.appendChild(cbtns);
      conn.appendChild(connMsg);
      loginBtn.onclick = function () {
        localStorage.setItem(API_BASE_KEY, apiBase.value.trim());
        var body = { username: userIn.value.trim(), password: passIn.value };
        if (totpIn.value.trim()) body.totp = totpIn.value.trim();
        fetch(apiBase.value.trim() + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
          .then(function (r) { return r.json().then(function (j) { return { s: r.status, j: j }; }); })
          .then(function (res) {
            if ((res.s === 200 || res.s === 201) && res.j.accessToken) {
              localStorage.setItem(TOKEN_KEY, res.j.accessToken);
              connMsg.textContent = '✅ ورود موفق — نقش‌ها: ' + (res.j.user && res.j.user.roles ? res.j.user.roles.join('، ') : '—');
              Modules.settings.render(root);
            } else connMsg.textContent = '❌ ورود ناموفق: ' + ((res.j.error && res.j.error.message) || ('خطای ' + res.s));
          })
          .catch(function (e) { connMsg.textContent = '❌ عدم اتصال: ' + e.message; });
      };
      logoutBtn.onclick = function () {
        localStorage.removeItem(TOKEN_KEY);
        connMsg.textContent = 'توکن پاک شد.';
        Modules.settings.render(root);
      };
      root.appendChild(conn);

      // تم‌ها
      var panel1 = el('div', 'panel');
      panel1.appendChild(el('h3', null, 'تم برنامه (حداقل ۳ تم — قانون ۱۱)'));
      var trow = el('div', 'form-row');
      Themes.list().forEach(function (t) {
        var b = el('button', 'btn' + (Themes.state.theme === t.id ? ' btn-primary' : ''), t.name);
        b.onclick = function () { Themes.set({ theme: t.id }); Modules.settings.render(root); };
        trow.appendChild(b);
      });
      panel1.appendChild(trow);
      root.appendChild(panel1);

      // فونت‌ها
      var panel2 = el('div', 'panel');
      panel2.appendChild(el('h3', null, 'فونت‌ها (فونت متن و فونت اعداد مستقل — قانون ۱۱)'));
      var frow = el('div', 'form-row');
      var l1 = el('label', null, 'فونت متن‌ها:');
      var fsel1 = el('select');
      var l2 = el('label', null, 'فونت اعداد:');
      var fsel2 = el('select');
      [fsel1, fsel2].forEach(function (sel, idx) {
        Themes.fonts.forEach(function (f) {
          var o = el('option', null, f.name);
          o.value = f.id;
          sel.appendChild(o);
        });
        sel.value = idx === 0 ? Themes.state.fontText : Themes.state.fontNumber;
        sel.onchange = function () {
          if (idx === 0) Themes.set({ fontText: sel.value });
          else Themes.set({ fontNumber: sel.value });
        };
      });
      frow.appendChild(l1); frow.appendChild(fsel1);
      frow.appendChild(l2); frow.appendChild(fsel2);
      panel2.appendChild(frow);

      var frow2 = el('div', 'form-row');
      var l3 = el('label', null, 'اندازه پایه فونت:');
      var sz = el('input'); sz.type = 'number'; sz.min = 11; sz.max = 22; sz.value = Themes.state.fontSize;
      sz.onchange = function () { Themes.set({ fontSize: +sz.value }); };
      var l4 = el('label', null, 'گردی گوشه‌ها (px):');
      var rd = el('input'); rd.type = 'number'; rd.min = 0; rd.max = 24; rd.value = Themes.state.radius;
      rd.onchange = function () { Themes.set({ radius: +rd.value }); };
      var l5 = el('label', null, 'نمایش پول:');
      var md = el('select');
      [['rial', 'ریال'], ['toman', 'تومان']].forEach(function (x) {
        var o = el('option', null, x[1]); o.value = x[0]; md.appendChild(o);
      });
      md.value = Themes.state.displayMoney;
      md.onchange = function () { Themes.set({ displayMoney: md.value }); };
      frow2.appendChild(l3); frow2.appendChild(sz);
      frow2.appendChild(l4); frow2.appendChild(rd);
      frow2.appendChild(l5); frow2.appendChild(md);
      panel2.appendChild(frow2);

      var bReset = el('button', 'btn', 'بازگشت به پیش‌فرض');
      bReset.onclick = function () { Themes.reset(); Modules.settings.render(root); };
      panel2.appendChild(bReset);
      root.appendChild(panel2);

      // پارامترهای قانونی
      var panel3 = el('div', 'panel');
      panel3.appendChild(el('h3', null, 'پارامترهای قانونی سال ' + Num.fmt(LAWS.year, 'fa') + ' (قانون ۱۶)'));
      var ul = el('ul', 'note-list');
      [
        'حداقل دستمزد روزانه: ' + Num.fmt(LAWS.labor.minimumDailyWage.value, 'fa') + ' ریال ✓ منبع‌دار',
        'حق مسکن: ' + Num.fmt(LAWS.labor.housingAllowance.value, 'fa') + ' ریال ✓',
        'معافیت مالیات حقوق ماهانه: ' + Num.fmt(LAWS.incomeTax.monthlyExemption.value, 'fa') + ' ریال ✓',
        'بیمه: کارگر ' + Num.fmt(LAWS.insurance.employeeRate.value * 100, 'fa') + '٪ / کارفرما ' + Num.fmt(LAWS.insurance.employerRate.value * 100, 'fa') + '٪ ✓',
        'ارزش افزوده: ' + Num.fmt(LAWS.vat.generalRate.value * 100, 'fa') + '٪ ✓',
        '⚠️ مرز پله‌های مالیات حقوق و سقف بیمه: [نیازمند بخشنامه رسمی ۱۴۰۵] — پله‌ها در کد پارامتریک‌اند'
      ].forEach(function (t) { ul.appendChild(el('li', null, t)); });
      panel3.appendChild(ul);
      panel3.appendChild(el('p', 'muted', 'مرجع: docs/11-iran-compliance/IRAN-LAWS.md — تغییر سال مالی فقط از طریق همین فایل‌ها انجام می‌شود تا منبع و تاریخ بازیابی ثبت بماند.'));
      root.appendChild(panel3);

      // بک‌آپ
      var panel4 = el('div', 'panel');
      panel4.appendChild(el('h3', null, 'پشتیبان‌گیری و بازیابی داده'));
      var brow = el('div', 'form-row');
      var bDl = el('button', 'btn', 'دانلود نسخه پشتیبان (JSON)');
      bDl.onclick = function () {
        var blob = new Blob([JSON.stringify(Store.backup(), null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'hotel-erp-backup-' + Jalali.fromDate(new Date()).replace(/\//g, '-') + '.json';
        a.click();
      };
      var up = el('input'); up.type = 'file'; up.accept = '.json';
      var bRest = el('button', 'btn', 'بازیابی از فایل');
      bRest.onclick = function () { up.click(); };
      up.onchange = function () {
        var f = up.files[0]; if (!f) return;
        var r = new FileReader();
        r.onload = function () {
          try {
            if (Store.restore(JSON.parse(r.result))) alert('بازیابی موفق بود');
            else alert('فایل پشتیبان معتبر نیست');
          } catch (e) { alert('فایل نامعتبر'); }
        };
        r.readAsText(f);
      };
      brow.appendChild(bDl); brow.appendChild(bRest); brow.appendChild(up);
      panel4.appendChild(brow);
      root.appendChild(panel4);

      Num.fitAll(root);
    }
  };
})(window);
