/**
 * modules/register.js — فاز R3: «ثبت رجیستر جدید» به سبک دقیق آسا
 * (مراجع: New_Registration.html + اسکرین‌شات‌های جزئیات رجیستر کارت ۱ و ۲)
 * بخش‌ها: اقامت (رزرو/عضویت/آور/پلن/اتاق) | نرخات و تخفیفات و مبالغ | مشخصات میهمان
 * (کد ملی، شناسنامه، جنسیت، نام پدر، تولد، شغل، وسیله سفر، شهر مبدا/مقصد) | تماس و شرح
 * ثبت → POST /api/v1/pms/reservations (source=WALK_IN) — بدون سرور: پیش‌نویس در Store.
 */
(function (global) {
  'use strict';

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

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

  /* فیلد ساده با برچسب سمت راست (چیدمان آسا) */
  function field(label, input, opts) {
    var row = el('div', 'reg-row' + (opts && opts.tall ? ' reg-row-tall' : ''));
    var lab = el('label', 'reg-label', label + ' :');
    row.appendChild(lab);
    row.appendChild(input);
    return { row: row, input: input };
  }

  function textInp(placeholder, dir) {
    var i = el('input');
    i.type = 'text';
    i.placeholder = placeholder || '';
    i.dir = dir || 'rtl';
    return i;
  }

  function numInp() {
    var i = textInp('۰', 'ltr');
    i.className = 'reg-num';
    return i;
  }

  function jalaliToIso(v) {
    /* YYYY/MM/DD شمسی → ISO میلادی (برای API) */
    var m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec((v || '').trim());
    if (!m) return null;
    var g = Jalali.toGregorian(Number(m[1]), Number(m[2]), Number(m[3]));
    var mm = String(g.gm).padStart(2, '0');
    var dd = String(g.gd).padStart(2, '0');
    return g.gy + '-' + mm + '-' + dd;
  }

  global.Modules = global.Modules || {};

  global.Modules.register = {
    render: function (root) {
      root.innerHTML = '';
      var form = el('div', 'reg-form');
      var head = el('div', 'reg-head');
      head.appendChild(el('h3', null, 'ثبت رجیستر جدید'));
      var today = Jalali.fromDate(new Date());
      head.appendChild(el('span', 'reg-date', Num.toPersian(today) + ' — ' + new Date().toISOString().slice(0, 10)));
      form.appendChild(head);

      var err = el('p', 'reg-err');
      var ok = el('p', 'reg-ok');

      /* ── بخش ۱: اقامت ── */
      var s1 = el('fieldset', 'reg-section');
      s1.appendChild(el('legend', null, 'اقامت'));
      var g1 = el('div', 'reg-grid');

      var fReserve = textInp('جستجوی رزرو…');
      fReserve.type = 'search';
      var fMember = textInp('کد عضویت / شرکت');
      var fPrintType = el('select');
      fPrintType.appendChild(new Option('فارسی'));
      fPrintType.appendChild(new Option('عادی'));
      var fHonor = el('input'); fHonor.type = 'checkbox';
      var honorWrap = el('label', 'reg-inline');
      honorWrap.appendChild(fHonor);
      honorWrap.appendChild(document.createTextNode(' افتخاری'));
      var fAvar = textInp('مرجع ورود (آور)');
      var fPlan = textInp('پلن');
      var fRoom = el('select');
      fRoom.appendChild(new Option('— انتخاب نوع اتاق —', ''));

      g1.appendChild(field('رزرو', fReserve).row);
      g1.appendChild(field('عضویت', fMember).row);
      g1.appendChild(field('چاپ', fPrintType).row);
      g1.appendChild(honorWrap);
      g1.appendChild(field('آور', fAvar).row);
      g1.appendChild(field('پلن', fPlan).row);
      g1.appendChild(field('اتاق', fRoom).row);
      s1.appendChild(g1);
      form.appendChild(s1);

      /* ── بخش ۲: نرخات / تخفیفات / مبالغ ── */
      var s2 = el('fieldset', 'reg-section');
      s2.appendChild(el('legend', null, 'نرخات، تخفیفات و مبالغ'));
      var rateTable = el('table', 'reg-rate-table');
      rateTable.innerHTML =
        '<thead><tr><th></th><th>نرخ فارسی</th><th>نرخ نیم‌بها</th><th>نرخ خارجی</th><th>تخفیف فارسی ٪</th><th>تخفیف خارجی ٪</th><th>ربال</th><th>دلار</th></tr></thead><tbody></tbody>';
      var tbody = rateTable.querySelector('tbody');
      [['نور', 'per-person'], ['میهمان', 'guest'], ['جمع', 'total']].forEach(function (r) {
        var tr = el('tr');
        tr.appendChild(el('th', null, r[0]));
        for (var i = 0; i < 7; i++) {
          var td = el('td');
          var inp = numInp();
          if (r[1] === 'total') { inp.readOnly = true; inp.className += ' reg-total'; }
          td.appendChild(inp);
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      });
      s2.appendChild(rateTable);

      var g2 = el('div', 'reg-grid');
      var fStayDays = numInp(); fStayDays.readOnly = true;
      var fCheckOut = textInp('۱۴۰۵/۰۹/۰۳');
      var fCheckIn = textInp(Jalali.fromDate(new Date()));
      var fDiscSerial = numInp();
      var fDollarRate = textInp('250,000', 'ltr');
      g2.appendChild(field('تاریخ ورود', fCheckIn).row);
      g2.appendChild(field('تاریخ خروج', fCheckOut).row);
      g2.appendChild(field('روز اقامت', fStayDays).row);
      g2.appendChild(field('سریال تخفیف', fDiscSerial).row);
      g2.appendChild(field('نرخ دلار', fDollarRate).row);
      s2.appendChild(g2);
      form.appendChild(s2);

      /* ── بخش ۳: مشخصات میهمان ── */
      var s3 = el('fieldset', 'reg-section');
      s3.appendChild(el('legend', null, 'مشخصات میهمان'));
      var g3 = el('div', 'reg-grid');

      var fLast = textInp('نام خانوادگی');
      var fFirst = textInp('نام میهمان');
      var fLatin = textInp('نام لاتین (اختیاری)', 'ltr');
      var fNationalId = textInp('کد ملی', 'ltr');
      var fIdDoc = textInp('شماره شناسنامه/پاسپورت', 'ltr');
      var fGender = el('select');
      fGender.appendChild(new Option('مرد'));
      fGender.appendChild(new Option('زن'));
      var fFather = textInp('نام پدر');
      var fBirth = textInp('____/__/__');
      var fJob = textInp('شغل');
      var fTravel = el('select');
      ['هوایی', 'زمینی', 'دریایی', 'ندارد'].forEach(function (o) { fTravel.appendChild(new Option(o)); });
      var fFromCity = textInp('شهر مبدا');
      var fToCity = el('input'); fToCity.value = 'رفسنجان'; /* پیش‌فرض مرجع آسا */
      var fPurpose = textInp('قصد از سفر');
      var fIssuePlace = textInp('محل صدور');
      var fAddress = textInp('آدرس');
      var fEmail = textInp('ایمیل', 'ltr');
      fEmail.type = 'email';
      var fMobile = textInp('موبایل', 'ltr');
      var fPhone = textInp('تلفن', 'ltr');
      var fDesc1 = el('textarea');
      fDesc1.rows = 2;
      var fDesc2 = textInp('شرح ۲');

      g3.appendChild(field('نام خانوادگی *', fLast).row);
      g3.appendChild(field('نام *', fFirst).row);
      g3.appendChild(field('نام لاتین', fLatin).row);
      g3.appendChild(field('کد ملی', fNationalId).row);
      g3.appendChild(field('شناسنامه/پاسپورت', fIdDoc).row);
      g3.appendChild(field('جنسیت', fGender).row);
      g3.appendChild(field('نام پدر', fFather).row);
      g3.appendChild(field('تاریخ تولد', fBirth).row);
      g3.appendChild(field('شغل', fJob).row);
      g3.appendChild(field('وسیله سفر', fTravel).row);
      g3.appendChild(field('شهر مبدا', fFromCity).row);
      g3.appendChild(field('شهر مقصد', fToCity).row);
      g3.appendChild(field('قصد از سفر', fPurpose).row);
      g3.appendChild(field('محل صدور', fIssuePlace).row);
      g3.appendChild(field('موبایل', fMobile).row);
      g3.appendChild(field('تلفن', fPhone).row);
      g3.appendChild(field('ایمیل', fEmail).row);
      g3.appendChild(field('آدرس', fAddress).row);
      g3.appendChild(field('شرح ۱', fDesc1, { tall: true }).row);
      g3.appendChild(field('شرح ۲', fDesc2).row);
      s3.appendChild(g3);
      form.appendChild(s3);

      /* ── ثبت ── */
      var actions = el('div', 'reg-actions');
      var submit = el('button', 'submitbtn', 'ثبت شود');
      var toRack = el('button', 'rr-act-btn', 'Room Rack');
      toRack.type = 'button';
      toRack.onclick = function () { global.App.go('roomrack'); };
      var toHome = el('button', 'rr-act-btn', 'Home');
      toHome.type = 'button';
      toHome.onclick = function () { global.App.go('home'); };
      actions.appendChild(submit);
      actions.appendChild(toRack);
      actions.appendChild(toHome);
      form.appendChild(actions);
      form.appendChild(err);
      form.appendChild(ok);
      root.appendChild(form);

      /* محاسبهٔ زندهٔ روز اقامت */
      function calcDays() {
        var a = jalaliToIso(fCheckIn.value);
        var b = jalaliToIso(fCheckOut.value);
        if (a && b) {
          var d = Math.round((new Date(b) - new Date(a)) / 86400000);
          fStayDays.value = d >= 0 ? String(d) : '';
        }
      }
      fCheckIn.oninput = calcDays;
      fCheckOut.oninput = calcDays;
      calcDays();

      /* انتخاب نوع اتاق: فهرست از API برای roomTypeId */
      var roomTypeId = '';
      api('GET', '/rooms/map').then(function (res) {
        if (res.status >= 200 && res.status < 300 && res.body.data) {
          var seen = {};
          (res.body.data.floors || []).forEach(function (f) {
            f.rooms.forEach(function (r) {
              if (r.roomType && !seen[r.roomType.code]) {
                seen[r.roomType.code] = true;
                fRoom.appendChild(new Option(r.roomType.nameFa, r.roomType.code));
              }
            });
          });
        }
      }).catch(function () { /* بدون سرور — حالت پیش‌نویس */ });

      submit.onclick = function () {
        err.textContent = '';
        ok.textContent = '';
        if (!fLast.value.trim() || !fFirst.value.trim()) {
          err.textContent = 'نام و نام خانوادگی میهمان الزامی است.';
          return;
        }
        var checkIn = jalaliToIso(fCheckIn.value);
        var checkOut = jalaliToIso(fCheckOut.value) || jalaliToIso(fCheckIn.value);
        if (!checkIn) {
          err.textContent = 'تاریخ ورود باید به شکل ۱۴۰۵/۰۹/۰۳ باشد.';
          return;
        }
        var rateRial = Number(tbody.rows[1].querySelectorAll('input')[0].value.replace(/[^\d]/g, '')) || null;
        var body = {
          roomTypeId: roomTypeId || '',
          guestName: (fFirst.value + ' ' + fLast.value).trim(),
          checkInDate: checkIn,
          checkOutDate: checkOut,
          idempotencyKey: 'reg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
          source: 'WALK_IN',
          adults: 1,
          note: (fDesc1.value || '') + (fDesc2.value ? ' — ' + fDesc2.value : ''),
        };
        /* roomTypeId از انتخاب اتاق (کد نوع) — اگر خالی بود اولین نوع از API */
        function send(typeId) {
          body.roomTypeId = typeId;
          if (!body.roomTypeId) {
            /* حالت پیش‌نویس بدون سرور */
            var drafts = JSON.parse(localStorage.getItem('hotel-erp-register-drafts') || '[]');
            drafts.push(Object.assign({ savedAt: new Date().toISOString() }, body, {
              nationalId: fNationalId.value, idDoc: fIdDoc.value, mobile: fMobile.value,
              gender: fGender.value, fatherName: fFather.value, birthDate: fBirth.value,
            }));
            localStorage.setItem('hotel-erp-register-drafts', JSON.stringify(drafts));
            ok.textContent = 'سرور در دسترس نیست — رجیستر به‌عنوان پیش‌نویس ذخیره شد (پس از اتصال، از اینجا ثبت نهایی می‌شود).';
            return;
          }
          api('POST', '/pms/reservations', body).then(function (res) {
            if (res.status >= 200 && res.status < 300) {
              ok.textContent = '✅ رجیستر ثبت شد — رزرو ' + (res.body.data && res.body.data.code ? Num.toPersian(res.body.data.code) : '') +
                ' ایجاد شد. برای پذیرش (چک‌این) به تب «رک اتاق‌ها» بروید.';
            } else {
              err.textContent = (res.body && res.body.error && res.body.error.message) || ('خطای ' + res.status);
            }
          }).catch(function (e) {
            /* شبکه قطع → پیش‌نویس */
            var drafts = JSON.parse(localStorage.getItem('hotel-erp-register-drafts') || '[]');
            drafts.push(Object.assign({ savedAt: new Date().toISOString() }, body));
            localStorage.setItem('hotel-erp-register-drafts', JSON.stringify(drafts));
            ok.textContent = 'اتصال قطع شد — پیش‌نویس ذخیره شد.';
          });
        }
        /* پیدا کردن roomTypeId: از select اتاق */
        roomTypeId = fRoom.value;
        if (roomTypeId) { send(roomTypeId); return; }
        api('GET', '/rooms/map').then(function (res) {
          var fl = (res.body.data && res.body.data.floors) || [];
          var firstType = '';
          for (var i = 0; i < fl.length && !firstType; i++) {
            for (var j = 0; j < fl[i].rooms.length && !firstType; j++) {
              if (fl[i].rooms[j].roomType) firstType = fl[i].rooms[j].roomType.code;
            }
          }
          send(firstType);
        }).catch(function () { send(''); });
      };
    },
  };
})(window);
