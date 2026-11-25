/**
 * modules/dashboard.js — داشبورد مدیریتی هوش مصنوعی (قانون ۱۷ مالک)
 * الگو: سورس مرجع hoteldashboard-5.1 (docs/18-module-references/hoteldashboard-notes.md)
 * مفهوم: AI = مدیر؛ سایر ماژول‌ها = کارمند؛ هر بخش روزانه گزارش می‌دهد؛
 * مدیر (AI آفلاین) تحلیل می‌کند، KPI می‌سازد و پیشنهاد بهبود فرایند می‌دهد.
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

  /** نمودار میله‌ای ساده روی canvas — آفلاین و بدون وابستگی */
  function barChart(canvas, data, opts) {
    opts = opts || {};
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    var max = Math.max.apply(null, data.map(function (d) { return d.value; }).concat([1]));
    var pad = 28, n = data.length, bw = (w - pad * 2) / n;
    var styles = getComputedStyle(document.documentElement);
    var primary = styles.getPropertyValue('--primary').trim() || '#0e7c66';
    var muted = styles.getPropertyValue('--muted').trim() || '#666';
    ctx.font = '11px sans-serif';
    data.forEach(function (d, i) {
      var bh = (h - pad * 2) * (d.value / max);
      var x = pad + i * bw + bw * 0.15, y = h - pad - bh;
      ctx.fillStyle = primary;
      ctx.fillRect(x, y, bw * 0.7, Math.max(bh, 1));
      ctx.fillStyle = muted;
      ctx.save();
      ctx.translate(x + bw * 0.35, h - pad + 12);
      ctx.fillText(String(d.label).substr(0, 10), 0, 0);
      ctx.restore();
      ctx.fillText(Num.fmt(d.value, 'fa'), x, y - 4);
    });
  }

  /** موتور تحلیل مدیر AI آفلاین — بر اساس داده گزارش‌ها و قواعد کسب‌وکار */
  function analyze(reports) {
    var today = Jalali.fromDate(new Date());
    var todays = reports.filter(function (r) { return r.date === today; });
    var notes = [];
    var kpis = [];

    // KPI حقوق و دستمزد از آخرین دوره
    var runs = Store.get('payrollRuns');
    var keys = Object.keys(runs);
    if (keys.length) {
      var run = runs[keys[keys.length - 1]];
      kpis.push(['پرسنل فعال', run.totals.count]);
      kpis.push(['خالص پرداختی دوره (ریال)', run.totals.net]);
      kpis.push(['مالیات دوره (ریال)', run.totals.tax]);
      kpis.push(['حق بیمه دوره (ریال)', run.totals.insurance]);
      notes.push('دوره ' + run.period + ' محاسبه شده است؛ جمع خالص ' + Num.fmt(run.totals.net, 'fa') + ' ریال برای ' + Num.fmt(run.totals.count, 'fa') + ' نفر.');
      // قاعده: معوق بودن دوره جاری
      var cur = Jalali.fromDate(new Date()).slice(0, 7);
      if (!runs[cur]) notes.push('⚠️ دوره جاری (' + cur + ') هنوز محاسبه نشده — طبق قانون کار مهلت پرداخت حقوق تا پایان ماه است؛ درخواست گزارش از بخش حقوق.');
      else notes.push('دوره جاری به‌موقع محاسبه شده ✓');
    } else {
      notes.push('هنوز هیچ دوره حقوقی محاسبه نشده است — درخواست گزارش از بخش حقوق و دستمزد.');
    }

    // تحلیل گزارش‌های امروز
    var byModule = {};
    todays.forEach(function (r) { byModule[r.module] = (byModule[r.module] || 0) + 1; });
    Object.keys(byModule).forEach(function (m) {
      notes.push('گزارش امروز از «' + m + '»: ' + Num.fmt(byModule[m], 'fa') + ' مورد.');
    });
    if (!todays.length) notes.push('امروز هیچ گزارش روزانه‌ای از بخش‌ها دریافت نشده است — یادآوری به همه واحدها (قانون ۱۷).');

    // پیشنهادهای بهبود فرایند
    var suggestions = [];
    suggestions.push('برای کاهش هزینه نیروی انسانی، ساعات اضافه‌کاری پرسنل پذیرش را با ترافیک ورودی هتل تطبیق دهید (طبق ماده ۵۹ قانون کار هزینه هر ساعت ۱٫۴ برابر است).');
    suggestions.push('لیست بیمه هر ماه تا مهلت قانونی تأمین اجتماعی ارسال شود تا از جرائم عدم ارسال جلوگیری شود.');
    suggestions.push('معافیت مالیات حقوق ۱۴۰۵ ماهانه ۴۰۰ میلیون ریال است؛ پرسنل زیر سقف معاف‌اند — در فرم‌ها پیش‌نمایش مالیات نشان دهید.');
    return { kpis: kpis, notes: notes, suggestions: suggestions };
  }

  /** تولید داده دمو گزارش روزانه (برای نسخه 0.1) */
  function seedReports() {
    var today = Jalali.fromDate(new Date());
    var rep = Store.get('dailyReports');
    if (rep.some(function (r) { return r.date === today && r.module === 'پذیرش'; })) return;
    Store.push('dailyReports', { date: today, time: Jalali.formatTime(new Date()), module: 'پذیرش', kind: 'گزارش اشغال', metrics: { 'اشغال (٪)': 72, 'ورودی': 14, 'خروجی': 11 }, note: 'اشغال مطلوب؛ ۳ اتاق در بازسازی.' });
    Store.push('dailyReports', { date: today, time: Jalali.formatTime(new Date()), module: 'رستوران', kind: 'گزارش فروش', metrics: { 'فروش (ریال)': 48500000, 'تعداد فاکتور': 96 }, note: 'شام‌ها پرترافیک بود؛ ۲ ابطال با مجوز.' });
    Store.push('dailyReports', { date: today, time: Jalali.formatTime(new Date()), module: 'انبار', kind: 'گزارش مصرف', metrics: { 'رسید': 5, 'حواله': 9 }, note: 'کالای بحرانی: مرغ (۲ روز موجودی).' });
  }


  /* ── پنل زنده از API (فاز ۳ — F3-T1…T3): همه اعداد از کوئری واقعی سرور ── */
  var API_BASE_KEY = 'hotel-erp-api-base';
  var TOKEN_KEY = 'hotel-erp-token';
  function apiBase() { return localStorage.getItem(API_BASE_KEY) || 'http://localhost:3000/api/v1'; }
  function apiToken() { return localStorage.getItem(TOKEN_KEY) || ''; }

  function kpiCard(label, value) {
    var card = el('div', 'kpi');
    card.appendChild(el('div', 'kpi-label fit', label));
    card.appendChild(el('div', 'kpi-value fit', value));
    return card;
  }
  function rial(x) { return Num.fmt(x, Themes.displayLang()) + ' ریال'; }

  /** گرفتن یک داشبورد از سرور — خروجی: داده یا null با پیام خطا */
  function fetchDash(name, status) {
    return fetch(apiBase() + '/dashboards/' + name, { headers: { Authorization: 'Bearer ' + apiToken() } })
      .then(function (r) {
        if (r.status === 403) throw new Error('مجوز مشاهده این پنل را ندارید (۴۰۳)');
        if (!r.ok) throw new Error('پاسخ نامعتبر سرور: ' + r.status);
        return r.json();
      })
      .then(function (j) { status.textContent = ''; return j.data; })
      .catch(function (e) {
        status.textContent = 'پنل «' + name + '»: ' + (e.message || 'خطا') + ' — توکن/آدرس API را بررسی کنید';
        return null;
      });
  }

  function renderLive(root) {
    var panel = el('div', 'panel');
    panel.appendChild(el('h3', null, 'پنل زنده سرور — KPI از کوئری واقعی (فاز ۳)'));
    /* SSO (نسخهٔ ۳٫۳): توکن و آدرس از نشست مشترک شل — بدون فرم دستی */
    var row = el('div', 'live-controls');
    row.style.display = 'flex'; row.style.gap = '8px'; row.style.flexWrap = 'wrap'; row.style.margin = '8px 0';
    var btn = el('button', 'btn', 'بارگذاری مجدد پنل‌ها');
    row.appendChild(btn);
    panel.appendChild(row);
    var status = el('div', 'muted', 'مقادیر از GET /dashboards/{ceo,finance,restaurant,housekeeping} خوانده می‌شود — هیچ عددی هاردکد نیست.');
    panel.appendChild(status);
    var host = el('div', 'live-host');
    panel.appendChild(host);
    root.appendChild(panel);

    btn.addEventListener('click', function () {
      load();
    });

    function load() {
      host.textContent = '';
      var ceoP = fetchDash('ceo', status);
      var finP = fetchDash('finance', status);
      var restP = fetchDash('restaurant', status);
      var hkP = fetchDash('housekeeping', status);
      Promise.all([ceoP, finP, restP, hkP]).then(function (res) {
        var ceo = res[0], fin = res[1], rest = res[2], hk = res[3];

        if (ceo) {
          var sec = el('div'); sec.appendChild(el('h4', null, 'مدیرعامل — ' + ceo.asOf));
          var kr = el('div', 'kpi-row');
          kr.appendChild(kpiCard('اشغال امروز (٪)', Num.fmt(ceo.occupancy.pct, 'fa')));
          kr.appendChild(kpiCard('اتاق اشغال‌شده / کل', Num.fmt(ceo.occupancy.occupiedUnits, 'fa') + ' / ' + Num.fmt(ceo.occupancy.totalRooms, 'fa')));
          kr.appendChild(kpiCard('درآمد امروز', rial(ceo.revenueTodayRials)));
          kr.appendChild(kpiCard('درآمد ماه (شمسی)', rial(ceo.revenueMonthRials)));
          kr.appendChild(kpiCard('سود ماه (درآمد−هزینه)', rial(ceo.profitMonthRials)));
          kr.appendChild(kpiCard('جریان نقد ماه', rial(ceo.cashFlowMonthRials)));
          kr.appendChild(kpiCard('مانده صندوق+بانک', rial(ceo.cashBalanceRials)));
          sec.appendChild(kr);
          host.appendChild(sec);
        }
        if (fin) {
          var sec2 = el('div'); sec2.appendChild(el('h4', null, 'مدیر مالی — ' + fin.asOf));
          var kr2 = el('div', 'kpi-row');
          fin.cashBoxes.forEach(function (c) { kr2.appendChild(kpiCard('صندوق ' + c.code, rial(c.balanceRials))); });
          fin.bankAccounts.forEach(function (c) { kr2.appendChild(kpiCard(c.nameFa + ' ' + c.code, rial(c.balanceRials))); });
          kr2.appendChild(kpiCard('مطالبات مهمانان (۱۲۰۱)', rial(fin.receivablesRials)));
          kr2.appendChild(kpiCard('پرداختنی تأمین‌کنندگان (۲۱۰۱)', rial(fin.payablesRials)));
          kr2.appendChild(kpiCard('اسناد پیش‌نویس (ثبت‌نشده)', Num.fmt(fin.unpostedDrafts, 'fa')));
          sec2.appendChild(kr2);
          if (fin.staleItems && fin.staleItems.length) {
            var warn = el('ul', 'note-list');
            fin.staleItems.forEach(function (w) { warn.appendChild(el('li', null, '⚠️ ' + w.messageFa)); });
            sec2.appendChild(warn);
          } else {
            sec2.appendChild(el('p', 'muted', 'هشدار اقلام معلق: موردی یافت نشد ✓'));
          }
          host.appendChild(sec2);
        }
        if (rest) {
          var sec3 = el('div'); sec3.appendChild(el('h4', null, 'رستوران — ' + rest.asOf));
          var kr3 = el('div', 'kpi-row');
          kr3.appendChild(kpiCard('سفارش امروز', Num.fmt(rest.todayOrders, 'fa')));
          kr3.appendChild(kpiCard('فروش امروز', rial(rest.todaySalesRials)));
          kr3.appendChild(kpiCard('خالص فروش', rial(rest.todayNetRials)));
          kr3.appendChild(kpiCard('ارزش افزوده امروز', rial(rest.todayTaxRials)));
          kr3.appendChild(kpiCard('میانگین فاکتور', rial(rest.avgTicketRials)));
          sec3.appendChild(kr3);
          sec3.appendChild(el('p', 'muted', 'ضایعات: ' + rest.waste.note));
          host.appendChild(sec3);
        }
        if (hk) {
          var sec4 = el('div'); sec4.appendChild(el('h4', null, 'خانه‌داری — ' + hk.asOf));
          var kr4 = el('div', 'kpi-row');
          hk.roomsByStatus.forEach(function (r2) { kr4.appendChild(kpiCard(r2.labelFa, Num.fmt(r2.count, 'fa'))); });
          kr4.appendChild(kpiCard('ورودی امروز', Num.fmt(hk.arrivalsToday, 'fa')));
          kr4.appendChild(kpiCard('خروجی امروز', Num.fmt(hk.departuresToday, 'fa')));
          sec4.appendChild(kr4);
          host.appendChild(sec4);
        }
        Num.fitAll(host);
      });
    }
  }

  Modules.dashboard = {
    title: 'داشبورد مدیر AI',
    render: function (root) {
      renderLive(root);
      if (apiToken()) load(); /* SSO — بارگذاری خودکار با نشست مشترک */
      seedReports();
      root.appendChild(el('h2', null, 'داشبورد مدیریتی — تحلیل هوش مصنوعی آفلاین'));
      root.appendChild(el('p', 'muted', 'مدیر (AI) گزارش روزانه بخش‌ها (کارمندان) را دریافت، تجزیه‌وتحلیل و به‌صورت KPI و پیشنهاد بهبود ارائه می‌کند.'));

      var rep = Store.get('dailyReports');
      var a = analyze(rep);

      // KPIها
      var kpiRow = el('div', 'kpi-row');
      a.kpis.forEach(function (k) {
        var card = el('div', 'kpi');
        card.appendChild(el('div', 'kpi-label fit', k[0]));
        card.appendChild(el('div', 'kpi-value fit', Num.fmt(k[1], Themes.displayLang())));
        kpiRow.appendChild(card);
      });
      root.appendChild(kpiRow);

      // تحلیل مدیر
      var analysis = el('div', 'panel');
      analysis.appendChild(el('h3', null, 'تحلیل مدیر (AI آفلاین)'));
      var ul = el('ul', 'note-list');
      a.notes.forEach(function (n) { ul.appendChild(el('li', null, n)); });
      analysis.appendChild(ul);
      root.appendChild(analysis);

      // پیشنهادهای بهبود
      var sug = el('div', 'panel');
      sug.appendChild(el('h3', null, 'پیشنهادهای بهبود فرایند'));
      var ul2 = el('ul', 'note-list');
      a.suggestions.forEach(function (s) { ul2.appendChild(el('li', null, s)); });
      sug.appendChild(ul2);
      root.appendChild(sug);

      // نمودار فروش ۷ روز اخیر (داده دمو گزارش‌ها)
      var chartPanel = el('div', 'panel');
      chartPanel.appendChild(el('h3', null, 'روند فروش رستوران (۷ روز اخیر — ریال)'));
      var cv = el('canvas', 'chart');
      chartPanel.appendChild(cv);
      root.appendChild(chartPanel);
      var days = [], sales = [];
      for (var i = 6; i >= 0; i--) {
        var d = new Date(); d.setDate(d.getDate() - i);
        days.push({ label: Jalali.fromDate(d).slice(5), value: 38000000 + Math.round(Math.abs(Math.sin(i)) * 22000000) });
      }
      requestAnimationFrame(function () { barChart(cv, days); });

      // جدول گزارش‌های روزانه با فیلتر
      var panel = el('div', 'panel');
      panel.appendChild(el('h3', null, 'گزارش‌های دریافتی از بخش‌ها'));
      var host = el('div', 'dt-host'); panel.appendChild(host);
      root.appendChild(panel);
      DataTable.create(host, {
        columns: [
          { key: 'date', label: 'تاریخ (شمسی)', type: 'date', width: '110px' },
          { key: 'time', label: 'ساعت', width: '70px' },
          { key: 'module', label: 'بخش (کارمند)', width: '120px' },
          { key: 'kind', label: 'نوع گزارش', width: '140px' },
          { key: 'metricsStr', label: 'شاخص‌ها', width: '260px' },
          { key: 'note', label: 'ملاحظات', width: '200px' }
        ],
        rows: rep.map(function (r) {
          r.metricsStr = Object.keys(r.metrics || {}).map(function (k) { return k + ': ' + Num.fmt(r.metrics[k], 'fa'); }).join(' | ');
          return r;
        })
      });
      Num.fitAll(root);
    }
  };
})(window);
