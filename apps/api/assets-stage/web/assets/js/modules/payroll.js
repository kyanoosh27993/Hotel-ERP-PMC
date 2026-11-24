/**
 * modules/payroll.js — ماژول حقوق و دستمزد (فاز ۲)
 * پرسنل، قرارداد/احکام، محاسبه دوره، و سه لیست الزامی مالک:
 * لیست مالیات حقوق، لیست بیمه، لیست بانک (طبق سورس مرجع payroll-releases)
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

  var NUM_COLS = { type: 'num', width: '110px' };

  var PAY_COLS = [
    { key: 'code', label: 'کد پرسنلی', width: '90px' },
    { key: 'name', label: 'نام و نام خانوادگی', width: '150px' },
    { key: 'mizan', label: 'مزد مبنا (ریال)', sum: true, type: 'num', width: '130px' },
    { key: 'overtime', label: 'اضافه‌کاری', sum: true, type: 'num', width: '110px' },
    { key: 'night', label: 'شب‌کاری', sum: true, type: 'num', width: '100px' },
    { key: 'housing', label: 'حق مسکن', sum: true, type: 'num', width: '110px' },
    { key: 'gross', label: 'ناخالص', sum: true, type: 'num', width: '130px' },
    { key: 'insEmployee', label: 'بیمه سهم کارگر', sum: true, type: 'num', width: '120px' },
    { key: 'tax', label: 'مالیات حقوق', sum: true, type: 'num', width: '110px' },
    { key: 'net', label: 'خالص پرداختی', sum: true, type: 'num', width: '130px' }
  ];

  function renderTabs(host, tabs) {
    var bar = el('div', 'tabbar');
    var body = el('div', 'tabbody');
    host.appendChild(bar); host.appendChild(body);
    function activate(i) {
      bar.querySelectorAll('.tabbtn').forEach(function (b, j) { b.classList.toggle('active', i === j); });
      body.innerHTML = ''; tabs[i].render(body);
      Num.fitAll(body);
    }
    tabs.forEach(function (t, i) {
      var b = el('button', 'tabbtn', t.title);
      b.onclick = function () { activate(i); };
      bar.appendChild(b);
    });
    activate(0);
  }

  function exportCsv(rows, cols, name) {
    var sep = '\t';
    var head = cols.map(function (c) { return c.label; }).join(sep);
    var body = rows.map(function (r) {
      return cols.map(function (c) { return Num.toEnglish(String(r[c.key] == null ? '' : r[c.key])); }).join(sep);
    }).join('\n');
    var blob = new Blob(['\ufeff' + head + '\n' + body], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name + '.csv';
    a.click();
  }

  function printTable(title, rows, cols) {
    var w = window.open('', '_blank');
    var lang = Themes.displayLang();
    var period = (rows && rows[0] && rows[0].period) ? ' — دوره ' + rows[0].period : '';
    var html = '<html dir="rtl"><head><meta charset="utf-8"><title>' + title + '</title>' +
      '<style>body{font-family:' + getComputedStyle(document.documentElement).getPropertyValue('--font-text') + ';} table{width:100%;border-collapse:collapse} th,td{border:1px solid #888;padding:6px;font-size:12px;text-align:center} th{background:#eee}</style></head><body>';
    html += '<h2>' + title + period + '</h2>';
    html += '<table><thead><tr>';
    cols.forEach(function (c) { html += '<th>' + c.label + '</th>'; });
    html += '</tr></thead><tbody>';
    rows.forEach(function (r) {
      html += '<tr>';
      cols.forEach(function (c) {
        var v = r[c.key];
        html += '<td>' + (c.type === 'num' ? Num.fmt(v, lang) : (v == null ? '' : v)) + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></body></html>';
    w.document.write(html);
    w.document.close();
    setTimeout(function () { w.print(); }, 400);
  }

  function listTab(title, cols, getRows, csvName) {
    return {
      title: title,
      render: function (body) {
        var btns = el('div', 'row-actions');
        var bPrint = el('button', 'btn', 'چاپ');
        var bCsv = el('button', 'btn', 'خروجی CSV');
        btns.appendChild(bPrint); btns.appendChild(bCsv);
        body.appendChild(btns);
        var host = el('div', 'dt-host');
        body.appendChild(host);
        var rows = getRows();
        DataTable.create(host, { columns: cols, rows: rows });
        bPrint.onclick = function () { printTable(title, rows, cols); };
        bCsv.onclick = function () { exportCsv(rows, cols, csvName); };
      }
    };
  }

  Modules.payroll = {
    title: 'حقوق و دستمزد',
    render: function (root) {
      var tabs = [];

      // ۱) پرسنل
      tabs.push({
        title: 'پرسنل',
        render: function (body) {
          var add = el('button', 'btn btn-primary', '+ پرسنل جدید');
          add.onclick = function () { personForm(null, function () { body.innerHTML = ''; render(body); }); };
          var actions = el('div', 'row-actions'); actions.appendChild(add);
          body.appendChild(actions);
          var host = el('div', 'dt-host'); body.appendChild(host);
          var rows = Store.get('personnel').slice();
          DataTable.create(host, {
            columns: [
              { key: 'code', label: 'کد پرسنلی', width: '90px' },
              { key: 'fullName', label: 'نام', width: '150px', type: 'text' },
              { key: 'jobTitle', label: 'شغل', width: '120px' },
              { key: 'baseSalary', label: 'مزد شغل (ریال)', sum: true, type: 'num', width: '130px' },
              { key: 'housing', label: 'حق مسکن', sum: true, type: 'num', width: '110px' },
              { key: 'seniority', label: 'پایه سنوات', sum: true, type: 'num', width: '110px' },
              { key: 'hire', label: 'تاریخ استخدام', type: 'date', width: '110px' },
              { key: 'contract', label: 'قرارداد از', type: 'date', width: '100px' },
              { key: 'contractEnd', label: 'قرارداد تا', type: 'date', width: '100px' },
              { key: 'iban', label: 'شبا / حساب', width: '230px' }
            ],
            rows: rows.map(function (p) { p.fullName = p.firstName + ' ' + p.lastName; return p; })
          });
        }
      });

      // ۲) قرارداد و احکام
      tabs.push({
        title: 'قرارداد و احکام',
        render: function (body) {
          body.appendChild(el('p', 'muted', 'قراردادها و حکم پرسنلی — سربرگ و قالب چاپ در فاز بعد کامل می‌شود (الگوی payroll-releases).'));
          var host = el('div', 'dt-host'); body.appendChild(host);
          DataTable.create(host, {
            columns: [
              { key: 'code', label: 'کد', width: '80px' },
              { key: 'fullName', label: 'نام', width: '150px' },
              { key: 'jobTitle', label: 'شغل (حکم)', width: '120px' },
              { key: 'baseSalary', label: 'مزد حکم (ریال)', sum: true, type: 'num', width: '130px' },
              { key: 'contract', label: 'از', type: 'date', width: '100px' },
              { key: 'contractEnd', label: 'تا', type: 'date', width: '100px' },
              { key: 'education', label: 'تحصیلات', width: '110px' }
            ],
            rows: Store.get('personnel').map(function (p) { p.fullName = p.firstName + ' ' + p.lastName; return p; })
          });
        }
      });

      // ۳) محاسبه دوره
      tabs.push({
        title: 'محاسبه دوره',
        render: function (body) {
          var form = el('div', 'form-row');
          var lblPeriod = el('label', null, 'دوره (YYYY/MM):');
          var period = el('input'); period.value = '1405/09'; period.placeholder = '1405/09'; period.dir = 'ltr';
          var lblOt = el('label', null, 'اضافه‌کاری پیش‌فرض (ساعت):');
          var ot = el('input'); ot.value = '0';
          var bRun = el('button', 'btn btn-primary', 'محاسبه و ثبت دوره');
          form.appendChild(lblPeriod); form.appendChild(period);
          form.appendChild(lblOt); form.appendChild(ot);
          form.appendChild(bRun);
          body.appendChild(form);
          var summary = el('div', 'kpi-row'); body.appendChild(summary);
          var host = el('div', 'dt-host'); body.appendChild(host);
          var current = null;

          function showRun(run) {
            current = run;
            summary.innerHTML = '';
            var cards = [
              ['پرسنل محاسبه‌شده', run.totals.count],
              ['جمع خالص پرداختی (ریال)', run.totals.net],
              ['جمع مالیات دوره (ریال)', run.totals.tax],
              ['جمع حق بیمه (ریال)', run.totals.insurance]
            ];
            cards.forEach(function (c) {
              var card = el('div', 'kpi');
              card.appendChild(el('div', 'kpi-label fit', c[0]));
              card.appendChild(el('div', 'kpi-value fit', Num.fmt(c[1], Themes.displayLang())));
              summary.appendChild(card);
            });
            DataTable.create(host, { columns: PAY_COLS, rows: run.slips });
            Num.fitAll(summary);
          }

          bRun.onclick = function () {
            var pd = Num.toEnglish(period.value);
            if (!/^\d{4}\/\d{1,2}$/.test(pd)) { alert('دوره را به شکل YYYY/MM وارد کنید'); return; }
            var run = PayrollEngine.runPeriod(Store.get('personnel'), pd, {});
            Store.get('payrollRuns')[pd] = run;
            Store.persist();
            // گزارش دوره‌ای به داشبورد مدیر (قانون ۱۷)
            Store.push('dailyReports', {
              date: Jalali.fromDate(new Date()), time: Jalali.formatTime(new Date()),
              module: 'حقوق و دستمزد', kind: 'محاسبه دوره ' + pd,
              metrics: { پرسنل: run.totals.count, 'خالص (ریال)': run.totals.net, 'مالیات (ریال)': run.totals.tax },
              note: 'دوره محاسبه و برای تسویه آماده شد.'
            });
            showRun(run);
          };

          var runs = Store.get('payrollRuns');
          var keys = Object.keys(runs);
          if (keys.length) showRun(runs[keys[keys.length - 1]]);
        }
      });

      // ۴) لیست مالیات حقوق
      tabs.push({
        title: 'لیست مالیات حقوق',
        render: function (body) {
          var runs = Store.get('payrollRuns');
          var keys = Object.keys(runs);
          if (!keys.length) { body.appendChild(el('p', 'muted', 'ابتدا در تب «محاسبه دوره» یک دوره را محاسبه کنید.')); return; }
          var run = runs[keys[keys.length - 1]];
          var cols = [
            { key: 'code', label: 'کد پرسنلی', width: '90px' },
            { key: 'name', label: 'نام', width: '150px' },
            { key: 'monthlyTaxable', label: 'درآمد مشمول ماه (ریال)', sum: true, type: 'num', width: '160px' },
            { key: 'exemption', label: 'معافیت ماه (ریال)', type: 'num', width: '140px' },
            { key: 'tax', label: 'مالیات ماه (ریال)', sum: true, type: 'num', width: '130px' },
            { key: 'period', label: 'دوره', width: '90px' }
          ];
          var btns = el('div', 'row-actions');
          var bp = el('button', 'btn', 'چاپ'), bc = el('button', 'btn', 'خروجی CSV');
          bp.onclick = function () { printTable('لیست مالیات حقوق', PayrollEngine.taxList(run.slips), cols); };
          bc.onclick = function () { exportCsv(PayrollEngine.taxList(run.slips), cols, 'tax-list-' + run.period); };
          btns.appendChild(bp); btns.appendChild(bc); body.appendChild(btns);
          var host = el('div', 'dt-host'); body.appendChild(host);
          DataTable.create(host, { columns: cols, rows: PayrollEngine.taxList(run.slips) });
        }
      });

      // ۵) لیست بیمه
      tabs.push({
        title: 'لیست بیمه',
        render: function (body) {
          var runs = Store.get('payrollRuns');
          var keys = Object.keys(runs);
          if (!keys.length) { body.appendChild(el('p', 'muted', 'ابتدا یک دوره را محاسبه کنید.')); return; }
          var run = runs[keys[keys.length - 1]];
          var cols = [
            { key: 'code', label: 'کد پرسنلی', width: '90px' },
            { key: 'name', label: 'نام', width: '150px' },
            { key: 'base', label: 'دستمزد مشمول (ریال)', sum: true, type: 'num', width: '150px' },
            { key: 'employee7', label: 'سهم کارگر ۷٪', sum: true, type: 'num', width: '120px' },
            { key: 'employer23', label: 'سهم کارفرما ۲۳٪', sum: true, type: 'num', width: '130px' },
            { key: 'total', label: 'جمع حق بیمه ۳۰٪', sum: true, type: 'num', width: '130px' },
            { key: 'period', label: 'دوره', width: '90px' }
          ];
          var btns = el('div', 'row-actions');
          var bp = el('button', 'btn', 'چاپ'), bc = el('button', 'btn', 'خروجی CSV');
          bp.onclick = function () { printTable('لیست بیمه تأمین اجتماعی', PayrollEngine.insuranceList(run.slips), cols); };
          bc.onclick = function () { exportCsv(PayrollEngine.insuranceList(run.slips), cols, 'insurance-list-' + run.period); };
          btns.appendChild(bp); btns.appendChild(bc); body.appendChild(btns);
          var host = el('div', 'dt-host'); body.appendChild(host);
          DataTable.create(host, { columns: cols, rows: PayrollEngine.insuranceList(run.slips) });
        }
      });

      // ۶) لیست بانک
      tabs.push({
        title: 'لیست بانک',
        render: function (body) {
          var runs = Store.get('payrollRuns');
          var keys = Object.keys(runs);
          if (!keys.length) { body.appendChild(el('p', 'muted', 'ابتدا یک دوره را محاسبه کنید.')); return; }
          var run = runs[keys[keys.length - 1]];
          var cols = [
            { key: 'code', label: 'کد پرسنلی', width: '90px' },
            { key: 'name', label: 'نام', width: '150px' },
            { key: 'iban', label: 'شماره شبا', width: '250px' },
            { key: 'net', label: 'خالص پرداختی (ریال)', sum: true, type: 'num', width: '150px' },
            { key: 'period', label: 'دوره', width: '90px' }
          ];
          var btns = el('div', 'row-actions');
          var bp = el('button', 'btn', 'چاپ'), bc = el('button', 'btn', 'خروجی CSV');
          bp.onclick = function () { printTable('لیست پرداخت بانکی', PayrollEngine.bankList(run.slips), cols); };
          bc.onclick = function () { exportCsv(PayrollEngine.bankList(run.slips), cols, 'bank-list-' + run.period); };
          btns.appendChild(bp); btns.appendChild(bc); body.appendChild(btns);
          var host = el('div', 'dt-host'); body.appendChild(host);
          DataTable.create(host, { columns: cols, rows: PayrollEngine.bankList(run.slips) });
        }
      });

      renderTabs(root, tabs);
    }
  };

  /** فرم پرسنل — ورود اعداد فارسی/انگلیسی، ذخیره انگلیسی (قانون ۱۴) */
  function personForm(existing, onDone) {
    var p = existing || {};
    var fields = [
      ['code', 'کد پرسنلی', p.code], ['firstName', 'نام', p.firstName], ['lastName', 'نام خانوادگی', p.lastName],
      ['nationalId', 'کد ملی', p.nationalId], ['jobTitle', 'شغل', p.jobTitle], ['jobCode', 'کد شغل', p.jobCode],
      ['baseSalary', 'مزد شغل (ریال)', p.baseSalary], ['housing', 'حق مسکن (ریال)', p.housing],
      ['seniority', 'پایه سنوات (ریال)', p.seniority], ['hire', 'تاریخ استخدام', p.hire],
      ['contract', 'قرارداد از', p.contract], ['contractEnd', 'قرارداد تا', p.contractEnd],
      ['iban', 'شماره شبا', p.iban], ['education', 'تحصیلات', p.education]
    ];
    var modal = el('div', 'modal-back');
    var box = el('div', 'modal');
    var grid = el('div', 'form-grid');
    var inputs = {};
    fields.forEach(function (f) {
      var w = el('div', 'form-item');
      w.appendChild(el('label', null, f[1]));
      var i = el('input');
      i.value = f[2] == null ? '' : f[2];
      if (['baseSalary', 'housing', 'seniority'].indexOf(f[0]) >= 0) i.onblur = function () { i.value = Num.toEnglish(i.value); };
      inputs[f[0]] = i;
      w.appendChild(i);
      grid.appendChild(w);
    });
    var marital = el('input'); marital.type = 'checkbox'; marital.checked = !!p.marital;
    var dep = el('input'); dep.value = p.dependents == null ? '0' : p.dependents;
    var mrow = el('div', 'form-row');
    var l1 = el('label', null, 'متأهل'); l1.insertBefore(marital, l1.firstChild);
    var l2 = el('label', null, 'تعداد فرزند'); l2.insertBefore(dep, l2.firstChild);
    mrow.appendChild(l1); mrow.appendChild(l2);
    grid.appendChild(mrow);
    var brow = el('div', 'form-row');
    var bSave = el('button', 'btn btn-primary', 'ذخیره');
    var bCancel = el('button', 'btn', 'انصراف');
    bSave.onclick = function () {
      var rec = { marital: marital.checked, dependents: Num.toEnglish(dep.value) };
      Object.keys(inputs).forEach(function (k) { rec[k] = Num.toEnglish(inputs[k].value); });
      var arr = Store.get('personnel');
      if (existing) {
        var idx = arr.findIndex(function (x) { return x.code === existing.code; });
        arr[idx] = rec;
      } else arr.push(rec);
      Store.set('personnel', arr);
      document.body.removeChild(modal);
      onDone && onDone();
    };
    bCancel.onclick = function () { document.body.removeChild(modal); };
    brow.appendChild(bSave); brow.appendChild(bCancel);
    box.appendChild(el('h3', null, existing ? 'ویرایش پرسنل' : 'پرسنل جدید'));
    box.appendChild(grid); box.appendChild(brow);
    modal.appendChild(box);
    document.body.appendChild(modal);
  }

  Modules._personForm = personForm;
})(window);
