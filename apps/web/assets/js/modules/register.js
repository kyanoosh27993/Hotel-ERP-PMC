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

  /* ── حافظهٔ مدارک: IndexedDB (hotel-erp-docs) — اسکن/ذخیره/پرینت/حذف ── */
  function docDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open('hotel-erp-docs', 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('docs', { keyPath: 'id', autoIncrement: true }); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function idbReq(store, mode, fn) {
    return docDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var r = fn(db.transaction('docs', mode).objectStore(store));
        r.onsuccess = function () { resolve(r.result); };
        r.onerror = function () { reject(r.error); };
      });
    });
  }
  function compressImage(file, cb) {
    var img = new Image();
    var url = URL.createObjectURL(file);
    img.onload = function () {
      var max = 1400;
      var scale = Math.min(1, max / Math.max(img.width, img.height));
      var c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      cb(c.toDataURL('image/jpeg', 0.72));
    };
    img.src = url;
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
      var fPersonType = el('select'); /* نیاز کارفرما: نوع شخص — حقیقی/حقوقی */
      fPersonType.appendChild(new Option('شخص حقیقی', 'NATURAL'));
      fPersonType.appendChild(new Option('شخص حقوقی (شرکت)', 'LEGAL'));
      var fNationalId = textInp('کد ملی (۱۰ رقم)', 'ltr'); /* شخص حقیقی */
      var fNatIdentifier = textInp('شناسهٔ ملی (۱۱ رقم)', 'ltr'); /* شخص حقوقی */
      var fEconCode = textInp('کد اقتصادی (۱۱ تا ۱۴ رقم)', 'ltr'); /* شخص حقوقی */
      var fIdDoc = textInp('شماره شناسنامه/پاسپورت', 'ltr');
      var fGender = el('select');
      fGender.appendChild(new Option('مرد'));
      fGender.appendChild(new Option('زن'));
      /* نیاز ۳ کارفرما: تفکیک مهمان ایرانی/خارجی */
      var fNat = el('select');
      fNat.appendChild(new Option('— انتخاب ملت —', ''));
      fNat.appendChild(new Option('ایرانی', 'IRANIAN'));
      fNat.appendChild(new Option('خارجی', 'FOREIGNER'));
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
      var fPostal = textInp('کد پستی', 'ltr');
      var fEmail = textInp('ایمیل', 'ltr');
      fEmail.type = 'email';
      var fMobile = textInp('موبایل', 'ltr');
      var fPhone = textInp('تلفن', 'ltr');
      var fDesc1 = el('textarea');
      fDesc1.rows = 2;
      var fDesc2 = textInp('شرح ۲');

      /* نیاز یکتایی کارفرما: با تایپ هر کاراکتر در فیلدهای هوشمند، رکوردهای قبلی پیشنهاد می‌شود */
      var uniqBar = el('div', 'uniq-banner');
      uniqBar.style.display = 'none';
      var partyId = ''; /* خالی = مهمان جدید؛ مقدار = رکورد قبلی (فقط اصلاح) */
      function loadParty(p) {
        partyId = p.id;
        fFirst.value = p.firstName || fFirst.value;
        fLast.value = p.lastName || fLast.value;
        fNationalId.value = p.nationalId || '';
        fNatIdentifier.value = p.natIdentifier || '';
        fEconCode.value = p.economicCode || '';
        fIdDoc.value = p.idDocNo || '';
        fMobile.value = p.mobile || '';
        fPhone.value = p.phone || '';
        fPostal.value = p.postalCode || '';
        fAddress.value = p.address || '';
        fEmail.value = p.email || '';
        if (p.nationality) fNat.value = p.nationality;
        fPersonType.value = (p.natIdentifier || p.economicCode) ? 'LEGAL' : 'NATURAL';
        applyPersonType();
        uniqBar.className = 'uniq-banner';
        uniqBar.textContent = '⚠️ اطلاعات این ' + (p.kindFa || Uniq.KIND_FA[p.kind] || 'شخص') +
          ' قبلاً در برنامه ثبت شده است (' + Uniq.displayName(p) + ') — اطلاعات قبلی در فرم بارگذاری شد. ' +
          'در صورت نیاز همان اطلاعات قبلی را اصلاح کنید و «ثبت تغییرات رکورد موجود» را بزنید؛ ثبت دوباره مجاز نیست.';
        uniqBar.style.display = 'block';
        submit.textContent = 'ثبت تغییرات رکورد موجود';
      }
      function resetParty() {
        partyId = '';
        uniqBar.style.display = 'none';
        submit.textContent = 'ثبت شود';
      }
      var uniqFields = [[fFirst, 'firstName'], [fLast, 'lastName'], [fNationalId, 'nationalId'],
        [fNatIdentifier, 'natIdentifier'], [fEconCode, 'economicCode'], [fMobile, 'mobile'], [fPostal, 'postalCode']];
      var KEY_FIELDS = ['nationalId', 'natIdentifier', 'economicCode', 'mobile', 'postalCode'];
      uniqFields.forEach(function (pair) {
        var inp = pair[0];
        var prev = inp.value;
        Uniq.suggest(inp, {
          onPick: loadParty,
          onFound: function (list, q) {
            /* فقط هشدار مشابه‌ها؛ بارگذاری خودکار فقط با انتخاب کاربر */
            void list; void q;
          },
        });
        inp.addEventListener('input', function () {
          /* اگر کاربر مقدار فیلد کلیدی را پاک/تغییر داد و از انتخاب قبلی خارج شد، حالت جدید فعال شود */
          if (partyId && inp.value.trim() !== prev.trim() && KEY_FIELDS.indexOf(pair[1]) >= 0) {
            var sameKey = KEY_FIELDS.some(function (k) {
              var elx = { nationalId: fNationalId, natIdentifier: fNatIdentifier, economicCode: fEconCode, mobile: fMobile, postalCode: fPostal }[k];
              return elx.value.trim();
            });
            if (!sameKey) resetParty();
          }
        });
      });

      /* نوع شخص: حقیقی → کد ملی/کد پستی | حقوقی → شناسهٔ ملی/کد اقتصادی (الزام کامل در گیت چک‌این) */
      var rowMelli = field('کد ملی', fNationalId).row;
      var rowNatId = field('شناسهٔ ملی', fNatIdentifier).row;
      var rowEcon = field('کد اقتصادی', fEconCode).row;
      function applyPersonType() {
        var legal = fPersonType.value === 'LEGAL';
        rowMelli.style.display = legal ? 'none' : '';
        rowNatId.style.display = legal ? '' : 'none';
        rowEcon.style.display = legal ? '' : 'none';
      }
      fPersonType.addEventListener('change', applyPersonType);
      applyPersonType();

      /* اعتبارسنجی ساختاری لحظه‌ای کدها — جلوگیری از ورود کد ملی/شناسهٔ ملی فیک (وارنینگ مرز قرمز) */
      function bindValidator(inp, fn, msg) {
        inp.addEventListener('change', function () {
          var v = Uniq.latinDigits(inp.value).trim();
          if (!v || fn(v)) { inp.style.borderColor = ''; inp.title = ''; return; }
          inp.style.borderColor = '#cf222e';
          inp.title = msg;
        });
      }
      bindValidator(fNationalId, Uniq.mellicodeOk, 'کد ملی نامعتبر است (۱۰ رقم + رقم کنترل)');
      bindValidator(fNatIdentifier, Uniq.legalIdOk, 'شناسهٔ ملی نامعتبر است (۱۱ رقم + رقم کنترل)');
      bindValidator(fEconCode, Uniq.econOk, 'کد اقتصادی باید ۱۱ تا ۱۴ رقم باشد');
      bindValidator(fPostal, Uniq.postalOk, 'کد پستی باید ۱۰ رقم معتبر باشد');

      g3.appendChild(field('نام خانوادگی *', fLast).row);
      g3.appendChild(field('نام *', fFirst).row);
      g3.appendChild(field('نام لاتین', fLatin).row);
      g3.appendChild(field('نوع شخص', fPersonType).row);
      g3.appendChild(rowMelli);
      g3.appendChild(rowNatId);
      g3.appendChild(rowEcon);
      g3.appendChild(field('شناسنامه/پاسپورت', fIdDoc).row);
      g3.appendChild(field('جنسیت', fGender).row);
      g3.appendChild(field('ملت', fNat).row);
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
      g3.appendChild(field('کد پستی', fPostal).row);
      g3.appendChild(field('شرح ۱', fDesc1, { tall: true }).row);
      g3.appendChild(field('شرح ۲', fDesc2).row);
      s3.appendChild(uniqBar);
      s3.appendChild(g3);
      form.appendChild(s3);

      /* ── بخش ۴: اسکن مدارک شناسایی (نیاز ۴ کارفرما) — ذخیرهٔ محلی IndexedDB + چاپ ── */
      var s4 = el('fieldset', 'reg-section');
      s4.appendChild(el('legend', null, 'اسکن مدارک شناسایی (کارت ملی / شناسنامه / پاسپورت)'));
      var docRow = el('div', 'reg-doc-row');
      [['national_card', 'کارت ملی'], ['id_booklet', 'شناسنامه'], ['passport', 'پاسپورت']].forEach(function (d) {
        var label = el('label', 'reg-doc-btn', '📷 اسکن ' + d[1]);
        var fi = el('input');
        fi.type = 'file';
        fi.accept = 'image/*';
        fi.setAttribute('capture', 'environment');
        fi.hidden = true;
        fi.onchange = function () { if (fi.files && fi.files[0]) saveDoc(d[0], d[1], fi.files[0]); };
        label.appendChild(fi);
        docRow.appendChild(label);
      });
      s4.appendChild(docRow);
      s4.appendChild(el('p', 'muted', 'تصویر به‌صورت فشرده در حافظهٔ برنامه ذخیره می‌شود و هر وقت لازم شد از همین‌جا پرینت می‌گیرید.'));
      var docList = el('div', 'reg-doc-list');
      s4.appendChild(docList);
      form.appendChild(s4);

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

      /* ── اسکن مدارک: ذخیره، فهرست، پرینت، حذف ── */
      function saveDoc(kind, kindLabel, file) {
        compressImage(file, function (dataUrl) {
          idbReq('docs', 'readwrite', function (st) { return st.add({ kind: kind, kindLabel: kindLabel, guestName: (fFirst.value + ' ' + fLast.value).trim(), dataUrl: dataUrl, at: new Date().toISOString() }); })
            .then(function () { renderDocs(); ok('تصویر «' + kindLabel + '» ذخیره شد.'); })
            .catch(function (e) { err.textContent = 'ذخیرهٔ مدرک ناموفق: ' + e.message; });
        });
      }
      function renderDocs() {
        idbReq('docs', 'readonly', function (st) { return st.getAll(); }).then(function (list) {
          docList.innerHTML = '';
          if (!list.length) {
            docList.appendChild(el('p', 'muted', 'هنوز مدارکی ذخیره نشده است.'));
            return;
          }
          list.slice().sort(function (a, b) { return b.id - a.id; }).slice(0, 30).forEach(function (d) {
            var row = el('div', 'reg-doc-item');
            row.appendChild(el('span', 'reg-doc-name', '📄 ' + d.kindLabel + ' — ' + (d.guestName || '—') + ' — ' + Num.toPersian(Jalali.fromDate(new Date(d.at)))));
            var pv = el('img', 'reg-doc-thumb');
            pv.src = d.dataUrl;
            pv.onclick = function () { openDocPrint(d); };
            row.appendChild(pv);
            var printB = el('button', 'rs-mini-btn', '🖨 پرینت');
            printB.onclick = function () { openDocPrint(d); };
            row.appendChild(printB);
            var delB = el('button', 'rs-mini-btn rs-del-btn', 'حذف');
            delB.onclick = function () { idbReq('docs', 'readwrite', function (st) { return st.delete(d.id); }).then(renderDocs); };
            row.appendChild(delB);
            docList.appendChild(row);
          });
        }).catch(function (e) {
          docList.appendChild(el('p', 'muted', 'حافظهٔ مدارک در دسترس نیست: ' + e.message));
        });
      }
      function openDocPrint(d) {
        var w = window.open('', '_blank');
        if (!w) { err.textContent = 'اجازهٔ popup را بدهید تا پرینت باز شود.'; return; }
        w.document.write('<html dir="rtl"><head><title>چاپ مدرک — ' + (d.guestName || '') + '</title>' +
          '<style>body{font-family:Tahoma,sans-serif;padding:16px}img{max-width:100%;height:auto;border:1px solid #ccc}h3{color:#b91c1c}</style></head><body>' +
          '<h3>مدرک ' + d.kindLabel + ' — مهمان: ' + (d.guestName || '—') + '</h3>' +
          '<img src="' + d.dataUrl + '">' +
          '<scr' + 'ipt>setTimeout(function(){window.print()},400)</scr' + 'ipt></body></html>');
        w.document.close();
      }
      renderDocs();

      /* انتخاب نوع اتاق: فهرست از API — مقدار option باید UUID نوع باشد (نه کد) */
      var roomTypeId = '';
      function loadRoomTypes() {
        return api('GET', '/pms/room-types').then(function (res) {
          if (res.status >= 200 && res.status < 300 && res.body.data) {
            res.body.data.forEach(function (rt) {
              fRoom.appendChild(new Option(rt.nameFa + ' (' + rt.code + ') — نرخ ' + Num.toPersian(Number(rt.baseRateRials).toLocaleString('en-US')), rt.id));
            });
          }
          return res;
        });
      }
      loadRoomTypes().catch(function () { /* بدون سرور — حالت پیش‌نویس */ });

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
        /* نیاز کارفرما: اعتبارسنجی ساختاری کدها — هیچ کد ملی/شناسهٔ ملی فیک ذخیره نمی‌شود */
        var nid = Uniq.latinDigits(fNationalId.value).replace(/\D/g, '');
        var npost = Uniq.latinDigits(fPostal.value).replace(/\D/g, '');
        var nidn = Uniq.latinDigits(fNatIdentifier.value).replace(/\D/g, '');
        var neco = Uniq.latinDigits(fEconCode.value).replace(/\D/g, '');
        var legal = fPersonType.value === 'LEGAL';
        if (!legal && nid && !Uniq.mellicodeOk(nid)) {
          err.textContent = 'کد ملی واردشده معتبر نیست — ساختار و رقم کنترل کد ملی (۱۰ رقم) رعایت نشده است.';
          fNationalId.focus();
          return;
        }
        if (!legal && npost && !Uniq.postalOk(npost)) {
          err.textContent = 'کد پستی باید ۱۰ رقم معتبر باشد.';
          fPostal.focus();
          return;
        }
        if (legal && nidn && !Uniq.legalIdOk(nidn)) {
          err.textContent = 'شناسهٔ ملی معتبر نیست — ساختار و رقم کنترل شناسهٔ ملی (۱۱ رقم) رعایت نشده است.';
          fNatIdentifier.focus();
          return;
        }
        if (legal && neco && !Uniq.econOk(neco)) {
          err.textContent = 'کد اقتصادی باید ۱۱ تا ۱۴ رقم باشد.';
          fEconCode.focus();
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
        if (fNat.value) body.nationality = fNat.value;
        if (rateRial) body.rateOverrideRials = String(rateRial);

        /* نیاز یکتایی کارفرما: ثبت یکتا — یا اصلاح رکورد قبلی (PATCH) یا ثبت جدید؛ ثبت دوباره ممنوع */
        var partyPayload = {
          kind: 'GUEST',
          firstName: fFirst.value.trim(),
          lastName: fLast.value.trim(),
          nationalId: nid || undefined,
          natIdentifier: nidn || undefined,
          economicCode: neco || undefined,
          idDocNo: fIdDoc.value.trim() || undefined,
          mobile: Uniq.latinDigits(fMobile.value).replace(/\D/g, '') || undefined,
          phone: fPhone.value.trim() || undefined,
          postalCode: npost || undefined,
          address: fAddress.value.trim() || undefined,
          email: fEmail.value.trim() || undefined,
          nationality: fNat.value || undefined,
        };
        function saveParty() {
          if (partyId) {
            return api('PATCH', '/parties/' + partyId, partyPayload).then(function (res) {
              if (res.status >= 200 && res.status < 300) return { blocked: false };
              if (res.status === 409) {
                var ex = res.body && res.body.error && res.body.error.details && res.body.error.details.existing;
                if (ex) loadParty(ex);
                err.textContent = (res.body && res.body.error && res.body.error.message) || 'رکورد تکراری است.';
                return { blocked: true };
              }
              err.textContent = (res.body && res.body.error && res.body.error.message) || ('خطای ' + res.status);
              return { blocked: true };
            }).catch(function () { return { blocked: false }; /* شبکه قطع → ادامه با پیش‌نویس */ });
          }
          return api('POST', '/parties', partyPayload).then(function (res) {
            if (res.status >= 200 && res.status < 300) {
              partyId = res.body.data.id;
              return { blocked: false };
            }
            if (res.status === 409) {
              /* قبلاً ثبت شده — رکورد قبلی در فرم بارگذاری می‌شود؛ کاربر اصلاح می‌کند و دوباره ثبت می‌زند */
              var ex = res.body && res.body.error && res.body.error.details && res.body.error.details.existing;
              if (ex) loadParty(ex);
              err.textContent = (res.body && res.body.error && res.body.error.message) || 'این مهمان قبلاً ثبت شده است.';
              return { blocked: true };
            }
            err.textContent = (res.body && res.body.error && res.body.error.message) || ('خطای ' + res.status);
            return { blocked: true };
          }).catch(function () { return { blocked: false }; /* شبکه قطع → پیش‌نویس */ });
        }

        /* roomTypeId از انتخاب اتاق (کد نوع) — اگر خالی بود اولین نوع از API */
        function send(typeId) {
          body.roomTypeId = typeId;
          if (!body.roomTypeId) {
            /* حالت پیش‌نویس بدون سرور */
            var drafts = JSON.parse(localStorage.getItem('hotel-erp-register-drafts') || '[]');
            drafts.push(Object.assign({ savedAt: new Date().toISOString() }, body, {
              nationalId: fNationalId.value, idDoc: fIdDoc.value, mobile: fMobile.value,
              natIdentifier: fNatIdentifier.value, economicCode: fEconCode.value, personType: fPersonType.value,
              postalCode: fPostal.value,
              gender: fGender.value, fatherName: fFather.value, birthDate: fBirth.value,
              nationality: fNat.value || null, toCity: fToCity.value, job: fJob.value,
              travel: fTravel.value, fromCity: fFromCity.value, purpose: fPurpose.value,
            }));
            localStorage.setItem('hotel-erp-register-drafts', JSON.stringify(drafts));
            ok.textContent = 'سرور در دسترس نیست — رجیستر به‌عنوان پیش‌نویس ذخیره شد (پس از اتصال، از اینجا ثبت نهایی می‌شود).';
            return;
          }
          saveParty().then(function (r) {
            if (r && r.blocked) return; /* ثبت دوباره مسدود شد — اطلاعات قبلی بارگذاری شد */
            if (partyId) body.partyId = partyId;
            api('POST', '/pms/reservations', body).then(function (res) {
              if (res.status >= 200 && res.status < 300) {
                ok.textContent = '✅ رجیستر ثبت شد — رزرو ' + (res.body.data && res.body.data.code ? Num.toPersian(res.body.data.code) : '') +
                  ' ایجاد شد. برای پذیرش (چک‌این) به تب «رک اتاق‌ها» بروید.';
              } else {
                err.textContent = (res.body && res.body.error && res.body.error.message) || ('خطای ' + res.status);
              }
            }).catch(function (e) {
              /* شبکه قطع → پیش‌نویس */
              void e;
              var drafts = JSON.parse(localStorage.getItem('hotel-erp-register-drafts') || '[]');
              drafts.push(Object.assign({ savedAt: new Date().toISOString() }, body));
              localStorage.setItem('hotel-erp-register-drafts', JSON.stringify(drafts));
              ok.textContent = 'اتصال قطع شد — پیش‌نویس ذخیره شد.';
            });
          });
        }
        /* پیدا کردن roomTypeId: از select؛ اگر خالی بود اولین نوع از API */
        roomTypeId = fRoom.value;
        if (roomTypeId) { send(roomTypeId); return; }
        loadRoomTypes().then(function () {
          roomTypeId = fRoom.value;
          send(roomTypeId);
        }).catch(function () { send(''); });
      };
    },
  };
})(window);
