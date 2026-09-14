// Enlil Data Hub — shared helpers for dataset records.
//
// A dataset record (KV key `datasets`) looks like:
//   { title, slug, pillars: ['Energy'], description, unit: 'USD billion',
//     frequency: 'annual', chartType: 'line', decimals: 1,
//     columns: ['Year', 'Series A', 'Series B'],       // header row; first column is the period
//     rows:    [['2010', 138.5, 3.2], ...],             // period first, numbers after (null = gap)
//     source:  { title, publisher, url, slug },         // slug links to the Sources library
//     retrievedAt: '2026-09-14', notes, file, status, updatedAt }
//
// Requires Chart.js (UMD) to be loaded before chart() is called.
(function () {
  const PALETTE = ['#047857', '#D97F0B', '#1D4ED8', '#7C3AED', '#BE123C', '#0891B2'];
  const PILLARS = ['Climate', 'Water', 'Energy', 'Economy', 'Governance'];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function safeSlug(slug, title, fallback) {
    if (slug && String(slug).trim()) return String(slug).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || (fallback || 'dataset');
  }
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  function decimalsFor(ds, values) {
    if (Number.isFinite(ds.decimals)) return ds.decimals;
    const max = Math.max(...values.filter(v => v !== null).map(Math.abs), 0);
    if (max >= 1000) return 0;
    if (max >= 100) return 1;
    return 2;
  }
  function fmt(v, decimals) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: decimals == null ? 2 : decimals });
  }
  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // Normalised view of a dataset: labels + numeric series, sorted by period.
  function series(ds) {
    const cols = Array.isArray(ds.columns) ? ds.columns : [];
    const rows = (Array.isArray(ds.rows) ? ds.rows : [])
      .filter(r => Array.isArray(r) && r.length && r[0] !== '' && r[0] != null)
      .slice()
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true }));
    const labels = rows.map(r => String(r[0]));
    const names = cols.slice(1);
    const sets = names.map((name, i) => ({ label: name || `Series ${i + 1}`, data: rows.map(r => num(r[i + 1])) }));
    return { periodLabel: cols[0] || 'Period', labels, sets };
  }

  function stats(ds, seriesIndex) {
    const s = series(ds);
    const set = s.sets[seriesIndex || 0];
    if (!set) return null;
    const pts = set.data.map((v, i) => ({ period: s.labels[i], value: v })).filter(p => p.value !== null);
    if (!pts.length) return null;
    const first = pts[0], latest = pts[pts.length - 1];
    const prev = pts.length > 1 ? pts[pts.length - 2] : null;
    const values = pts.map(p => p.value);
    const decimals = decimalsFor(ds, values);
    return {
      label: set.label, decimals,
      first, latest, prev,
      min: Math.min(...values), max: Math.max(...values),
      changeAbs: prev ? latest.value - prev.value : null,
      changePct: prev && prev.value ? ((latest.value - prev.value) / Math.abs(prev.value)) * 100 : null,
      span: `${first.period}–${latest.period}`, count: pts.length
    };
  }

  function chart(canvas, ds, opts) {
    opts = opts || {};
    if (!window.Chart || !canvas) return null;
    const s = series(ds);
    const type = opts.type || ds.chartType || 'line';
    const isBar = type === 'bar';
    const mini = !!opts.mini;
    const values = s.sets.flatMap(x => x.data);
    const decimals = decimalsFor(ds, values);
    const unit = ds.unit || '';
    const datasets = s.sets
      .filter((_, i) => !opts.only || opts.only.includes(i))
      .map((set, i) => {
        const c = PALETTE[(opts.colorOffset || 0) + i % PALETTE.length];
        return {
          label: set.label, data: set.data, borderColor: c,
          backgroundColor: isBar ? c + 'CC' : (type === 'area' ? c + '22' : c),
          fill: type === 'area', tension: 0.25, spanGaps: true,
          pointRadius: mini ? 0 : (s.labels.length > 40 ? 0 : 3), pointHoverRadius: mini ? 0 : 5,
          borderWidth: mini ? 2 : 2.5, borderRadius: isBar ? 3 : 0
        };
      });
    if (canvas._enlilChart) canvas._enlilChart.destroy();
    const inst = new Chart(canvas, {
      type: isBar ? 'bar' : 'line',
      data: { labels: s.labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: mini ? false : { duration: 400 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: !mini && datasets.length > 1, position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, font: { size: 12 } } },
          tooltip: {
            enabled: !mini,
            callbacks: { label: ctx => `${ctx.dataset.label}: ${fmt(ctx.parsed.y, decimals)}${unit ? ' ' + unit : ''}` }
          }
        },
        scales: {
          x: { display: !mini, grid: { display: false }, ticks: { maxTicksLimit: 12, font: { size: 11 }, color: '#6b7280' } },
          y: { display: !mini, grid: { color: '#f1f5f9' }, ticks: { font: { size: 11 }, color: '#6b7280', callback: v => fmt(v, decimals) },
               title: { display: !mini && !!unit, text: unit, color: '#6b7280', font: { size: 11 } } }
        }
      }
    });
    canvas._enlilChart = inst;
    return inst;
  }

  function toCSV(ds) {
    const s = series(ds);
    const q = v => {
      const t = v == null ? '' : String(v);
      return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
    };
    const lines = [[s.periodLabel, ...s.sets.map(x => x.label)].map(q).join(',')];
    s.labels.forEach((p, i) => lines.push([p, ...s.sets.map(x => x.data[i] == null ? '' : x.data[i])].map(q).join(',')));
    const src = ds.source && (ds.source.publisher || ds.source.title);
    lines.push('');
    lines.push(q(`Source: ${src || 'see enlilcenter.org'}${ds.source && ds.source.url ? ' — ' + ds.source.url : ''}`));
    lines.push(q(`Compiled by Enlil Center — https://enlilcenter.org/data/${safeSlug(ds.slug, ds.title)}${ds.retrievedAt ? ' — retrieved ' + ds.retrievedAt : ''}`));
    return lines.join('\n');
  }

  function download(ds) {
    const blob = new Blob(['﻿' + toCSV(ds)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `enlil-${safeSlug(ds.slug, ds.title)}.csv`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // Parses pasted/uploaded tabular text (CSV or tab-separated, header row first).
  function parseTable(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return null;
    const delim = lines[0].includes('\t') ? '\t' : (lines[0].split(';').length > lines[0].split(',').length ? ';' : ',');
    const split = line => {
      const out = []; let cur = '', inQ = false;
      for (const ch of line) {
        if (ch === '"') { inQ = !inQ; continue; }
        if (ch === delim && !inQ) { out.push(cur.trim()); cur = ''; continue; }
        cur += ch;
      }
      out.push(cur.trim());
      return out;
    };
    const columns = split(lines[0]);
    const rows = lines.slice(1).map(split).filter(r => r[0] !== '')
      .map(r => [r[0], ...columns.slice(1).map((_, i) => num(r[i + 1]))]);
    return { columns, rows };
  }

  function isPublished(item) {
    const st = String(item.status || 'published').toLowerCase();
    return st !== 'draft' && st !== 'unpublished';
  }

  window.EnlilData = { PALETTE, PILLARS, esc, safeSlug, num, fmt, fmtDate, series, stats, chart, toCSV, download, parseTable, isPublished, decimalsFor };
})();
