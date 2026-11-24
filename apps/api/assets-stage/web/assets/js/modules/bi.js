/**
 * modules/bi.js — موج ۴ / فاز ۱۱: BI و هوش مصنوعی گسترده.
 * تحلیل بخش‌ها + بودجه/واریانس | دستیار مدیر با منبع داده | پیش‌بینی جریان نقد ۱۳ هفته |
 * سندزنی هوشمند (فقط پیش‌نویس — تأیید انسانی) | پیشنهاد نرخ با تصمیم مدیر | ناهنجاری + احساسات.
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
      return r.arrayBuffer().then(function (buf) {
        var text = new TextDecoder('utf-8').decode(buf);
        try { return { status: r.status, body: JSON.parse(text), raw: text, bytes: new Uint8Array(buf) }; }
        catch (e) { return { status: r.status, body: null, raw: text, bytes: new Uint8Array(buf) }; }
      });
    });
  }

  function failText(res) {
    return (res.body && res.body.error && res.body.error.message) ? res.body.error.message : ('خطای ' + res.status);
  }

  function money(n) { return Number(n || 0).toLocaleString('fa-IR'); }
  function todayStr() { return new Date().toISOString().slice(0, 10); }
  function monthStartStr() {
    var d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
  }

  function row(label, input) {
    var wrap = el('div', 'form-row');
    var l = el('label', null, label);
    wrap.appendChild(l);
    wrap.appendChild(input);
    return wrap;
  }

  function pill(text, color) {
    var b = el('span', 'pill', text);
    b.style.cssText = 'padding:2px 8px;border-radius:10px;font-size:12px;background:' + color + '20;color:' + color + ';';
    return b;
  }

  function connPanel(root, rerender) {
    var panel = el('div', 'panel');
    panel.appendChild(el('h3', null, 'اتصال به سرور (مدیر/حسابدار)'));
    var baseIn = el('input', 'input'); baseIn.placeholder = 'آدرس API'; baseIn.value = apiBase();
    var userIn = el('input', 'input'); userIn.placeholder = 'نام کاربری (admin/accountant)';
    var passIn = el('input', 'input'); passIn.type = 'password'; passIn.placeholder = 'گذرواژه';
    var totpIn = el('input', 'input'); totpIn.placeholder = 'کد TOTP (نقش حساس)';
    var btn = el('button', 'btn btn-primary', 'ورود و ذخیره توکن');
    var msg = el('div', 'muted', 'ورود با نقش مدیر/حسابدار — توکن در حافظهٔ مرورگر ذخیره می‌شود.');
    panel.appendChild(row('آدرس API', baseIn));
    panel.appendChild(row('کاربر', userIn));
    panel.appendChild(row('گذرواژه', passIn));
    panel.appendChild(row('TOTP', totpIn));
    panel.appendChild(btn);
    panel.appendChild(msg);
    btn.onclick = function () {
      localStorage.setItem(API_BASE_KEY, baseIn.value.trim());
      var body = { username: userIn.value.trim(), password: passIn.value };
      if (totpIn.value.trim()) body.totp = totpIn.value.trim();
      api('POST', '/auth/login', body).then(function (res) {
        if (res.status === 200 || res.status === 201) {
          localStorage.setItem(TOKEN_KEY, res.body.accessToken);
          msg.textContent = '✅ ورود موفق — توکن ذخیره شد.';
          rerender();
        } else msg.textContent = '❌ ورود ناموفق: ' + failText(res);
      });
    };
    root.appendChild(panel);
  }

  function budgetPanel(root) {
    var panel = el('div', 'panel');
    panel.appendChild(el('h3', null, 'F11-T1 — تحلیل بخش‌ها: بودجه در برابر عملکرد (واریانس هر مرکز هزینه)'));
    var fromIn = el('input', 'input'); fromIn.value = monthStartStr();
    var toIn = el('input', 'input'); toIn.value = todayStr();
    var periodIn = el('input', 'input'); periodIn.placeholder = 'دورهٔ بودجه (مثلاً 1405-09)';
    var ccIn = el('input', 'input'); ccIn.placeholder = 'مرکز هزینه: CC-ROOMS';
    var revIn = el('input', 'input'); revIn.placeholder = 'بودجهٔ درآمد (ریال)';
    var costIn = el('input', 'input'); costIn.placeholder = 'بودجهٔ هزینه (ریال)';
    var saveBtn = el('button', 'btn', 'ذخیرهٔ بودجه');
    var loadBtn = el('button', 'btn btn-primary', 'بارگیری واریانس بخش‌ها');
    var out = el('div', null); var msg = el('div', 'muted');
    panel.appendChild(row('از', fromIn));
    panel.appendChild(row('تا', toIn));
    panel.appendChild(row('دورهٔ بودجه', periodIn));
    panel.appendChild(row('مرکز هزینه', ccIn));
    panel.appendChild(row('بودجهٔ درآمد', revIn));
    panel.appendChild(row('بودجهٔ هزینه', costIn));
    panel.appendChild(saveBtn);
    panel.appendChild(loadBtn);
    panel.appendChild(out);
    panel.appendChild(msg);

    function renderRows(rows) {
      out.innerHTML = '';
      var tbl = el('table');
      var thead = el('thead');
      var trh = el('tr');
      ['بخش', 'درآمد واقعی', 'هزینهٔ واقعی', 'سود', 'بودجهٔ درآمد', 'واریانس درآمد', 'بودجهٔ هزینه', 'واریانس هزینه'].forEach(function (h) {
        trh.appendChild(el('th', null, h));
      });
      thead.appendChild(trh);
      tbl.appendChild(thead);
      var tbody = el('tbody');
      rows.forEach(function (r) {
        var tr = el('tr');
        function td(t, warn) {
          var c = el('td', null, t);
          if (warn) c.style.color = '#cf222e';
          return c;
        }
        tr.appendChild(td(r.labelFa));
        tr.appendChild(td(money(r.revenueRials)));
        tr.appendChild(td(money(r.costRials)));
        tr.appendChild(td(money(r.profitRials)));
        tr.appendChild(td(r.budgetRevenueRials != null ? money(r.budgetRevenueRials) : '—'));
        var vr = r.varianceRevenueRials != null ? money(r.varianceRevenueRials) : '—';
        tr.appendChild(td(vr, r.varianceRevenueRials != null && Number(r.varianceRevenueRials) < 0));
        tr.appendChild(td(r.budgetCostRials != null ? money(r.budgetCostRials) : '—'));
        var vc = r.varianceCostRials != null ? money(r.varianceCostRials) : '—';
        tr.appendChild(td(vc, r.varianceCostRials != null && Number(r.varianceCostRials) > 0));
        tbody.appendChild(tr);
      });
      tbl.appendChild(tbody);
      out.appendChild(tbl);
    }

    loadBtn.onclick = function () {
      api('GET', '/bi/departments?from=' + fromIn.value.trim() + '&to=' + toIn.value.trim() + (periodIn.value.trim() ? '&periodCode=' + encodeURIComponent(periodIn.value.trim()) : ''))
        .then(function (res) {
          if (res.status === 200) {
            renderRows(res.body.data.rows);
            var t = res.body.data.totals;
            msg.textContent = 'جمع درآمد ' + money(t.revenueRials) + ' | جمع هزینه ' + money(t.costRials) + ' | سود ' + money(t.profitRials) + ' ریال';
          } else msg.textContent = '❌ ' + failText(res);
        });
    };
    saveBtn.onclick = function () {
      if (!periodIn.value.trim() || !ccIn.value.trim()) { msg.textContent = 'دوره و مرکز هزینه را وارد کنید.'; return; }
      api('POST', '/bi/budget', {
        taxYear: 1405,
        periodCode: periodIn.value.trim(),
        costCenterCode: ccIn.value.trim(),
        revenueRials: String(Number(revIn.value.trim() || 0)),
        costRials: String(Number(costIn.value.trim() || 0)),
      }).then(function (res) {
        if (res.status === 200 || res.status === 201) msg.textContent = '✅ بودجهٔ ' + res.body.data.costCenterCode + ' ذخیره شد.';
        else msg.textContent = '❌ ' + failText(res);
      });
    };
    root.appendChild(panel);
    return { loadBtn: loadBtn };
  }

  function assistantPanel(root) {
    var panel = el('div', 'panel');
    panel.appendChild(el('h3', null, 'F11-T2 — دستیار مدیر (پرسش‌وپاسخ با منبع داده — بدون عدد حدسی)'));
    var qIn = el('input', 'input'); qIn.placeholder = 'مثلاً: اشغال امروز چقدر است؟';
    var askBtn = el('button', 'btn btn-primary', 'پرسش');
    var answerBox = el('div', null);
    var srcBox = el('div', 'muted');
    panel.appendChild(row('پرسش', qIn));
    panel.appendChild(askBtn);
    panel.appendChild(answerBox);
    panel.appendChild(srcBox);
    var samples = ['اشغال امروز چقدر است؟', 'درآمد امروز چقدر شد؟', 'ماندهٔ صندوق چند است؟', 'وضعیت اتاق‌ها', 'جریان نقد ۱۳ هفته'];
    var hint = el('div', 'muted', 'نمونه‌ها: ' + samples.join(' | '));
    panel.appendChild(hint);
    askBtn.onclick = function () {
      api('POST', '/bi/assistant', { question: qIn.value.trim() }).then(function (res) {
        if (res.status === 200 || res.status === 201) {
          answerBox.textContent = '🤖 ' + res.body.data.answer;
          srcBox.textContent = 'منابع: ' + (res.body.data.sources || []).map(function (s) { return s.label + '=' + s.value; }).join(' | ') || '—';
        } else {
          answerBox.textContent = '❌ ' + failText(res);
          srcBox.textContent = '';
        }
      });
    };
    root.appendChild(panel);
  }

  function cashflowPanel(root) {
    var panel = el('div', 'panel');
    panel.appendChild(el('h3', null, 'F11-T3 — پیش‌بینی جریان وجوه ۱۳ هفته + هشدار کسری'));
    var btn = el('button', 'btn btn-primary', 'محاسبهٔ پیش‌بینی');
    var out = el('div', null);
    var warn = el('div', null);
    panel.appendChild(btn);
    panel.appendChild(out);
    panel.appendChild(warn);
    btn.onclick = function () {
      api('GET', '/bi/cashflow-forecast').then(function (res) {
        if (res.status !== 200) { warn.textContent = '❌ ' + failText(res); return; }
        var d = res.body.data;
        out.innerHTML = '';
        var head = el('p', 'muted', 'ماندهٔ آغازین ' + money(d.startBalanceRials) + ' | مطالبات ' + money(d.receivablesRials) + ' | بدهی‌ها ' + money(d.payablesRials) + ' | هزینهٔ ثابت هفته ' + money(d.weeklyFixedCostRials));
        out.appendChild(head);
        var tbl = el('table');
        var trh = el('tr');
        ['هفته', 'تا تاریخ', 'ورودی', 'خروجی', 'ماندهٔ پایان', 'وضعیت'].forEach(function (h) { trh.appendChild(el('th', null, h)); });
        var thead = el('thead'); thead.appendChild(trh); tbl.appendChild(thead);
        var tbody = el('tbody');
        d.weeks.forEach(function (w) {
          var tr = el('tr');
          [String(w.weekNo), w.to, money(w.inflowRials), money(w.outflowRials), money(w.endBalanceRials)].forEach(function (v) {
            tr.appendChild(el('td', null, v));
          });
          var st = el('td', null, w.deficit ? 'کسری ⚠️' : 'سلامت');
          st.style.color = w.deficit ? '#cf222e' : '#1a7f37';
          tr.appendChild(st);
          tbody.appendChild(tr);
        });
        tbl.appendChild(tbody);
        out.appendChild(tbl);
        warn.innerHTML = '';
        (d.warnings || []).forEach(function (w) {
          var p = el('p', null, '⚠️ ' + w);
          p.style.color = '#9a6700';
          warn.appendChild(p);
        });
        if (!(d.warnings || []).length) warn.appendChild(el('p', 'muted', 'هیچ هفتهٔ کسری در افق ۱۳ هفته پیش‌بینی نشد.'));
      });
    };
    root.appendChild(panel);
    return { loadBtn: btn };
  }

  function smartDocPanel(root) {
    var panel = el('div', 'panel');
    panel.appendChild(el('h3', null, 'F11-T4 — سندزنی هوشمند (متن فاکتور → استخراج → پیش‌نویس → تأیید انسانی)'));
    var txt = el('textarea');
    txt.style.cssText = 'width:100%;min-height:90px;';
    txt.placeholder = 'متن فاکتور را بچسبانید: فروشنده … مبلغ ۱٬۲۵۰٬۰۰۰ ریال مالیات ۱۲۵٬۰۰۰ ریال فاکتور INV-123 تاریخ 2026-11-23';
    var extractBtn = el('button', 'btn btn-primary', 'استخراج و پیشنهاد سطرها');
    var loadBtn = el('button', 'btn', 'بارگیری پیش‌نویس‌ها');
    var out = el('div', null);
    var msg = el('div', 'muted');
    panel.appendChild(txt);
    panel.appendChild(extractBtn);
    panel.appendChild(loadBtn);
    panel.appendChild(out);
    panel.appendChild(msg);

    function renderList(rows) {
      out.innerHTML = '';
      rows.forEach(function (r) {
        var box = el('div');
        box.style.cssText = 'border:1px solid #d0d7de;border-radius:8px;padding:8px;margin:6px 0;';
        var ex = r.extractedJson || {};
        var title = el('p', null, '🧾 ' + (ex.supplierNameFa || 'تأمین‌کنندهٔ ناشناس') + ' — مبلغ ' + money(ex.amountRials) + ' | مالیات ' + money(ex.taxRials) + ' | فاکتور ' + (ex.invoiceNo || '—') + ' ' + pill(r.status, r.status === 'DRAFT' ? '#9a6700' : r.status === 'DRAFTED' ? '#1a7f37' : '#6e7781'));
        box.appendChild(title);
        (r.suggestedLinesJson || []).forEach(function (l) {
          box.appendChild(el('p', 'muted', (l.accountCode) + ' — بدهکار ' + money(l.debit) + ' / بستانکار ' + money(l.credit) + ' — ' + (l.note || '')));
        });
        if (r.status === 'DRAFT') {
          var b1 = el('button', 'btn', 'تولید پیش‌نویس سند حسابداری');
          var b2 = el('button', 'btn', 'کنارگذاری');
          b1.style.marginLeft = '8px';
          b1.onclick = function () {
            api('POST', '/bi/smart-document/' + r.id + '/approve', {}).then(function (res) {
              if (res.status === 200 || res.status === 201) { msg.textContent = '✅ ' + res.body.data.entryNo + ' ساخته شد (پیش‌نویس) — تأیید نهایی با تأییدکننده.'; loadBtn.click(); }
              else msg.textContent = '❌ ' + failText(res);
            });
          };
          b2.onclick = function () {
            api('POST', '/bi/smart-document/' + r.id + '/discard', {}).then(function () { loadBtn.click(); });
          };
          box.appendChild(b1);
          box.appendChild(b2);
        } else if (r.draftEntryId) {
          box.appendChild(el('p', 'muted', 'سند پیش‌نویس حسابداری متصل شد — در ماژول حسابداری تأیید شود.'));
        }
        out.appendChild(box);
      });
      if (!rows.length) out.appendChild(el('p', 'muted', 'پیش‌نویسی وجود ندارد.'));
    }

    extractBtn.onclick = function () {
      api('POST', '/bi/smart-document', { text: txt.value }).then(function (res) {
        if (res.status === 200 || res.status === 201) {
          var ex = res.body.data.extracted;
          msg.textContent = 'استخراج شد: مبلغ ' + money(ex.amountRials) + ' | مالیات ' + money(ex.taxRials) + ' | فروشنده ' + (ex.supplierNameFa || 'ناشناس');
          loadBtn.click();
        } else msg.textContent = '❌ ' + failText(res);
      });
    };
    loadBtn.onclick = function () {
      api('GET', '/bi/smart-document').then(function (res) {
        if (res.status === 200) renderList(res.body.data);
        else msg.textContent = '❌ ' + failText(res);
      });
    };
    root.appendChild(panel);
    return { loadBtn: loadBtn };
  }

  function revenuePanel(root) {
    var panel = el('div', 'panel');
    panel.appendChild(el('h3', null, 'F11-T5 — Revenue AI: پیش‌بینی تقاضا و پیشنهاد نرخ (بازهٔ اطمینان + تصمیم مدیر)'));
    var btn = el('button', 'btn btn-primary', 'محاسبهٔ پیشنهاد نرخ امروز');
    var out = el('div', null);
    var msg = el('div', 'muted');
    panel.appendChild(btn);
    panel.appendChild(out);
    panel.appendChild(msg);
    function render(rows) {
      out.innerHTML = '';
      var tbl = el('table');
      var trh = el('tr');
      ['نوع اتاق', 'نرخ پایه', 'پیشنهاد', 'کران اطمینان', 'تحلیل', 'وضعیت', 'تصمیم'].forEach(function (h) { trh.appendChild(el('th', null, h)); });
      var thead = el('thead'); thead.appendChild(trh); tbl.appendChild(thead);
      var tbody = el('tbody');
      rows.forEach(function (r) {
        var tr = el('tr');
        [r.roomTypeCode, money(r.baseRials), money(r.suggestedRials), money(r.confidenceLow) + ' … ' + money(r.confidenceHigh), (r.reasonJson && r.reasonJson.occupancyRatio != null ? 'اشغال ' + Math.round(r.reasonJson.occupancyRatio * 100) + '٪' : r.reason || '')].forEach(function (v) {
          tr.appendChild(el('td', null, v));
        });
        tr.appendChild(el('td', null, r.status === 'DRAFT' ? 'در انتظار مدیر' : r.status === 'APPROVE' ? 'پذیرفته شد' : r.status === 'APPROVED' ? 'پذیرفته شد' : 'رد شد'));
        if (r.status === 'DRAFT') {
          var act = el('td');
          var ok = el('button', 'btn', 'پذیرش');
          var no = el('button', 'btn', 'رد');
          ok.style.marginLeft = '6px';
          ok.onclick = function () { decide(r.id, 'APPROVE'); };
          no.onclick = function () { decide(r.id, 'REJECT'); };
          act.appendChild(ok);
          act.appendChild(no);
          tr.appendChild(act);
        } else tr.appendChild(el('td', null, '—'));
        tbody.appendChild(tr);
      });
      tbl.appendChild(tbody);
      out.appendChild(tbl);
    }
    function decide(id, action) {
      api('POST', '/bi/rate-suggestions/' + id + '/decide', { action: action }).then(function (res) {
        if (res.status === 200 || res.status === 201) { msg.textContent = action === 'APPROVE' ? '✅ پیشنهاد پذیرفته شد (ثبت تصمیم — اعمال نرخ با مدیر).' : '✅ پیشنهاد رد شد.'; btn.click(); }
        else msg.textContent = '❌ ' + failText(res);
      });
    }
    btn.onclick = function () {
      api('GET', '/bi/revenue-forecast').then(function (res) {
        if (res.status === 200) { render(res.body.data.suggestions); msg.textContent = 'پیشنهادها به‌روز شد — تصمیم نهایی با مدیر است.'; }
        else msg.textContent = '❌ ' + failText(res);
      });
    };
    root.appendChild(panel);
  }

  function anomalyPanel(root) {
    var panel = el('div', 'panel');
    panel.appendChild(el('h3', null, 'F11-T6 — هشدار ناهنجاری مالی + تحلیل احساسات رخدادها'));
    var btn = el('button', 'btn btn-primary', 'اسکن ناهنجاری‌ها');
    var out = el('div', null);
    panel.appendChild(btn);
    panel.appendChild(out);
    btn.onclick = function () {
      api('GET', '/bi/anomalies').then(function (res) {
        if (res.status !== 200) { out.textContent = '❌ ' + failText(res); return; }
        var d = res.body.data;
        out.innerHTML = '';
        out.appendChild(el('p', null, '🔍 ' + (d.findings.length ? (d.findings.length + ' یافته') : 'یافته‌ای ثبت نشد')));
        d.findings.forEach(function (f) {
          var p = el('p', null, (f.severity === 'critical' ? '🔴 ' : f.severity === 'warning' ? '🟠 ' : '🟡 ') + f.messageFa);
          out.appendChild(p);
        });
        var s = d.sentiment;
        out.appendChild(el('p', 'muted', 'احساسات ۷ روز اخیر: منفی ' + s.negativeCount + ' / مثبت ' + s.positiveCount + ' (نسبت منفی ' + s.ratio + ')'));
        (s.samples || []).forEach(function (x) { out.appendChild(el('p', 'muted', '— ' + x)); });
      });
    };
    root.appendChild(panel);
  }

  Modules.bi = {
    render: function (content) {
      content.innerHTML = '';
      content.appendChild(el('h2', 'panel-title', 'BI و هوش مصنوعی (فاز ۱۱)'));
      content.appendChild(el('p', 'muted', 'تحلیل جامع بخش‌ها، دستیار مدیر با منبع داده، پیش‌بینی جریان نقد، سندزنی هوشمند و پیشنهاد نرخ. همهٔ خروجی‌های AI فقط پیش‌نویس/پیشنهاد هستند — قطعی‌سازی با تأیید انسانی.'));

      var rerender = function () {
        connPanel(content, rerender);
        budgetPanel(content);
        assistantPanel(content);
        cashflowPanel(content);
        smartDocPanel(content);
        revenuePanel(content);
        anomalyPanel(content);
      };
      rerender();
    },
  };
})(window);
