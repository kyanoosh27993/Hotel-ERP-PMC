/**
 * data-table.js — جدول استاندارد برنامه (قانون ۱۲ و ۱۳ مالک)
 * الزامات: هدر ستون‌ها سورت‌شونده، جستجوی هر ستون، فیلتر مقادیر،
 * سطر جمع پویا هم‌گام با فیلتر/جستجو، ریسپانسیو، shrink-to-fit.
 */
(function (global) {
  'use strict';

  /**
   * createDataTable(host, opts)
   * opts.columns: [{key, label, type:'text'|'num'|'date', sum:false, width}]
   * opts.rows: آرایه آبجکت‌ها (مقادیر عددی انگلیسی ذخیره‌شده)
   * opts.pageSize: اختیاری (پیش‌فرض 200)
   */
  function createDataTable(host, opts) {
    var cols = opts.columns, rows = opts.rows || [];
    var pageSize = opts.pageSize || 200;
    var st = { sortKey: null, sortDir: 1, page: 1, query: {}, filters: {} };

    host.classList.add('dt-wrap');
    var scroll = document.createElement('div'); scroll.className = 'dt-scroll';
    var table = document.createElement('table'); table.className = 'dt';
    scroll.appendChild(table); host.appendChild(scroll);
    var pager = document.createElement('div'); pager.className = 'dt-pager';
    host.appendChild(pager);

    function val(row, key) { return row[key]; }

    function filtered() {
      return rows.filter(function (r) {
        for (var k in st.query) {
          if (!st.query[k]) continue;
          var c = cols.find(function (x) { return x.key === k; });
          var v = val(r, k);
          var sv = Num.toEnglish(String(st.query[k])).toLowerCase();
          var cell = (c && c.type === 'num') ? String(v) : String(v == null ? '' : v).toLowerCase();
          if (cell.indexOf(sv) < 0) return false;
        }
        for (var k2 in st.filters) {
          if (!st.filters[k2]) continue;
          if (String(val(r, k2)) !== String(st.filters[k2])) return false;
        }
        return true;
      });
    }

    function sorted(list) {
      if (!st.sortKey) return list;
      var c = cols.find(function (x) { return x.key === st.sortKey; });
      return list.slice().sort(function (a, b) {
        var va = val(a, st.sortKey), vb = val(b, st.sortKey);
        if (c && c.type === 'num') return ((Number(va) || 0) - (Number(vb) || 0)) * st.sortDir;
        return String(va == null ? '' : va).localeCompare(String(vb == null ? '' : vb), 'fa') * st.sortDir;
      });
    }

    function build() {
      table.innerHTML = '';
      // هدر + ردیف جستجو/فیلتر (قانون ۱۲)
      var thead = document.createElement('thead');
      var trh = document.createElement('tr'), trf = document.createElement('tr');
      cols.forEach(function (c) {
        var th = document.createElement('th');
        th.innerHTML = '<span class="dt-label fit">' + c.label + '</span><span class="dt-arrow"></span>';
        th.style.cursor = 'pointer';
        if (c.width) th.style.minWidth = c.width;
        if (st.sortKey === c.key) {
          th.classList.add('dt-sorted');
          th.querySelector('.dt-arrow').textContent = st.sortDir > 0 ? '▲' : '▼';
        }
        th.onclick = function () {
          if (st.sortKey === c.key) st.sortDir = -st.sortDir; else { st.sortKey = c.key; st.sortDir = 1; }
          build();
        };
        trh.appendChild(th);

        var tdf = document.createElement('td');
        tdf.className = 'dt-filter-cell';
        var inp = document.createElement('input');
        inp.className = 'dt-search';
        inp.placeholder = 'جستجو…';
        inp.value = st.query[c.key] || '';
        var tmr = null;
        inp.oninput = function () {
          clearTimeout(tmr);
          tmr = setTimeout(function () { st.query[c.key] = inp.value; st.page = 1; buildBody(); }, 220);
        };
        tdf.appendChild(inp);
        // فیلتر مقادیر متمایز (برای ستون‌های متنی کم‌مقدار)
        var distinct = Array.from(new Set(rows.map(function (r) { return String(val(r, c.key)); }))).filter(Boolean);
        if (distinct.length && distinct.length <= 30) {
          var sel = document.createElement('select');
          sel.className = 'dt-select';
          sel.innerHTML = '<option value="">همه</option>';
          distinct.sort().forEach(function (d) {
            var o = document.createElement('option');
            o.value = d; o.textContent = (c.type === 'num') ? Num.fmt(d, Themes.displayLang()) : d;
            sel.appendChild(o);
          });
          sel.value = st.filters[c.key] || '';
          sel.onchange = function () { st.filters[c.key] = sel.value; st.page = 1; buildBody(); };
          tdf.appendChild(sel);
        }
        trf.appendChild(tdf);
      });
      thead.appendChild(trh); thead.appendChild(trf);
      table.appendChild(thead);

      var tbody = document.createElement('tbody');
      var tfoot = document.createElement('tfoot');
      table.appendChild(tbody); table.appendChild(tfoot);
      buildBody();
    }

    function buildBody() {
      var tbody = table.querySelector('tbody');
      var tfoot = table.querySelector('tfoot');
      var list = sorted(filtered());
      var start = (st.page - 1) * pageSize;
      var pageRows = list.slice(start, start + pageSize);
      var lang = Themes.displayLang();

      tbody.innerHTML = '';
      if (!pageRows.length) {
        var tr0 = document.createElement('tr');
        tr0.innerHTML = '<td class="dt-empty" colspan="' + cols.length + '">موردی مطابق جستجو/فیلتر یافت نشد</td>';
        tbody.appendChild(tr0);
      }
      pageRows.forEach(function (r, i) {
        var tr = document.createElement('tr');
        cols.forEach(function (c) {
          var td = document.createElement('td');
          var v = val(r, c.key);
          if (c.render) {
            var cell = c.render(r, v);
            if (cell) td.appendChild(cell);
          } else {
            var inner = document.createElement('div');
            inner.className = 'fit';
            if (c.type === 'num') inner.textContent = Num.fmt(v, lang);
            else if (c.type === 'date') inner.textContent = v || '';
            else inner.textContent = v == null ? '' : v;
            td.appendChild(inner);
          }
          tr.appendChild(td);
        });
        tr.className = i % 2 ? 'dt-odd' : '';
        tbody.appendChild(tr);
      });

      // سطر جمع پویا — هم‌گام با فیلتر/جستجو (قانون ۱۲)
      tfoot.innerHTML = '';
      var trs = document.createElement('tr');
      var anySum = cols.some(function (c) { return c.sum; });
      cols.forEach(function (c) {
        var td = document.createElement('td');
        if (c.sum) {
          var s = 0;
          list.forEach(function (r) { s += Number(val(r, c.key)) || 0; });
          td.innerHTML = '<b class="fit">' + (c.label + ': ') + Num.fmt(Math.round(s * 100) / 100, lang) + '</b>';
          td.classList.add('dt-sum');
        } else if (c.key === cols[0].key) {
          td.innerHTML = '<b>جمع فیلترشده: ' + Num.fmt(list.length, lang) + ' ردیف</b>';
        }
        trs.appendChild(td);
      });
      if (anySum || true) tfoot.appendChild(trs);

      // صفحه‌بندی
      var pages = Math.max(1, Math.ceil(list.length / pageSize));
      pager.innerHTML = '';
      var info = document.createElement('span');
      info.textContent = 'نمایش ' + Num.fmt(Math.min(pageSize, list.length - start), lang) + ' از ' +
        Num.fmt(list.length, lang) + ' • صفحه ' + Num.fmt(st.page, lang) + ' از ' + Num.fmt(pages, lang);
      pager.appendChild(info);
      for (var p = 1; p <= pages; p++) {
        var b = document.createElement('button');
        b.className = 'dt-page' + (p === st.page ? ' active' : '');
        b.textContent = Num.fmt(p, lang);
        (function (pp) { b.onclick = function () { st.page = pp; buildBody(); }; })(p);
        pager.appendChild(b);
      }
      Num.fitAll(table);
      if (opts.onSum) opts.onSum(list);
    }

    build();
    return {
      update: function (newRows) { rows = newRows || rows; st.page = 1; buildBody(); },
      getFiltered: function () { return sorted(filtered()); },
      refresh: function () { buildBody(); }
    };
  }

  global.DataTable = { create: createDataTable };
})(window);
