// Shared renderer for the optional blocks every article / research report /
// project can carry: video, downloads, "Data behind this article", Sources &
// citations, and the cover credit. Loaded by the three detail templates.
//
// Usage: renderItemExtras(item) — each block stays hidden unless the item has data for it.
(function () {
  const API_BASE = 'https://enlil-cms-api.osmanalikareem.workers.dev';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = u => /^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '';
  const fmtBytes = n => { n = Number(n) || 0; return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; };
  const fileIcon = ext => ({ pdf: 'fa-file-pdf', doc: 'fa-file-word', docx: 'fa-file-word', xls: 'fa-file-excel', xlsx: 'fa-file-excel', csv: 'fa-file-csv', ppt: 'fa-file-powerpoint', pptx: 'fa-file-powerpoint' })[String(ext || '').toLowerCase()] || 'fa-file-lines';
  const fmtDate = iso => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? String(iso) : d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' }); };
  const show = el => { if (el) { el.hidden = false; el.classList.remove('hidden'); } };

  function videoEmbedUrl(raw) {
    const u = safeUrl(raw); if (!u) return null;
    let url; try { url = new URL(u); } catch { return null; }
    const host = url.hostname.replace(/^www\.|^m\./, '');
    let id = '';
    if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (url.pathname === '/watch') id = url.searchParams.get('v') || '';
      else { const m = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?]+)/); if (m) id = m[1]; }
    }
    if (id && /^[A-Za-z0-9_-]{6,20}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}`;
    if (host === 'vimeo.com' || host === 'player.vimeo.com') { const m = url.pathname.match(/(\d{6,})/); if (m) return `https://player.vimeo.com/video/${m[1]}`; }
    return null;
  }

  function renderVideo(item) {
    const wrap = document.getElementById('videoWrapper'), box = document.getElementById('videoEmbed');
    if (!wrap || !box) return;
    const raw = safeUrl(item.videoUrl); if (!raw) return;
    const embed = videoEmbedUrl(raw);
    box.innerHTML = embed
      ? `<iframe src="${esc(embed)}" title="${esc(item.title || 'Video')}" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`
      : `<a class="more-link" style="padding:24px;display:inline-flex" href="${esc(raw)}" target="_blank" rel="noopener"><i class="fa-solid fa-circle-play"></i> Watch the video</a>`;
    if (!embed) box.classList.remove('video');
    show(wrap);
  }

  function renderAttachments(item) {
    const wrap = document.getElementById('attachmentsWrapper'), list = document.getElementById('attachmentsList');
    if (!wrap || !list) return;
    const files = (Array.isArray(item.attachments) ? item.attachments : []).filter(f => f && safeUrl(f.url));
    if (!files.length) return;
    list.innerHTML = files.map(f => `<li><a href="${esc(f.url)}" target="_blank" rel="noopener">
        <i class="fa-solid ${fileIcon(f.ext)}" style="font-size:1.4rem;color:var(--green)"></i>
        <span style="min-width:0"><span class="name">${esc(f.name || 'Download')}</span><span class="type">${esc(f.ext || '')}${f.size ? ' · ' + fmtBytes(f.size) : ''}</span></span>
        <i class="fa-solid fa-download" style="margin-left:auto;color:var(--ink-mute)"></i></a></li>`).join('');
    show(wrap);
  }

  async function renderSources(item) {
    const wrap = document.getElementById('sourcesWrapper'), list = document.getElementById('sourcesList');
    if (!wrap || !list) return;
    const cited = (Array.isArray(item.sources) ? item.sources : []).filter(c => c && c.slug);
    if (!cited.length) return;
    let library = [];
    try { const res = await fetch(`${API_BASE}/data/sources`); if (res.ok) library = await res.json(); } catch { /* snapshot only */ }
    const bySlug = new Map((Array.isArray(library) ? library : []).map(s => [s.slug, s]));
    list.innerHTML = cited.map((c, i) => {
      const s = Object.assign({}, c, bySlug.get(c.slug) || {});
      const url = safeUrl(s.url), local = s.file && safeUrl(s.file.url);
      const meta = [s.publisher, s.type, s.datePublished ? fmtDate(s.datePublished) : ''].filter(Boolean).map(esc).join(' · ');
      return `<li><span class="n">[${i + 1}]</span><div style="min-width:0">
          <div class="t">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(s.title || c.slug)}</a>` : esc(s.title || c.slug)}</div>
          ${meta ? `<div class="m">${meta}</div>` : ''}${s.note ? `<div class="m">${esc(s.note)}</div>` : ''}
          <div class="links"><a href="/sources#${encodeURIComponent(c.slug)}">In the sources library</a>${local ? `<a href="${esc(local)}" target="_blank" rel="noopener"><i class="fa-solid fa-download"></i> Archived copy</a>` : ''}</div>
        </div></li>`;
    }).join('');
    show(wrap);
  }

  async function renderDatasets(item) {
    const wrap = document.getElementById('datasetsWrapper'), list = document.getElementById('datasetsList');
    if (!wrap || !list) return;
    const slugs = (Array.isArray(item.datasets) ? item.datasets : []).filter(Boolean);
    if (!slugs.length) return;
    let all = [];
    try { const r = await fetch(`${API_BASE}/data/datasets`); if (r.ok) all = await r.json(); } catch { return; }
    const bySlug = new Map((Array.isArray(all) ? all : []).map(d => [d.slug, d]));
    const picked = slugs.map(sl => bySlug.get(sl)).filter(Boolean);
    if (!picked.length) return;
    list.innerHTML = picked.map(d => {
      const st = window.EnlilData ? EnlilData.stats(d, 0) : null;
      return `<a class="data-link" href="/data/${esc(d.slug)}">
        <span class="k">${esc((d.pillars || [])[0] || 'Data')}</span>
        <span class="t">${esc(d.title)}</span>
        ${st ? `<span class="v">${EnlilData.fmt(st.latest.value, st.decimals)} <small>${esc(d.unit || '')} · ${esc(st.latest.period)}</small></span>` : ''}
        <span class="s">${esc((d.source && d.source.publisher) || 'Enlil Center')} · chart &amp; CSV <i class="fa-solid fa-arrow-right"></i></span>
      </a>`;
    }).join('');
    show(wrap);
  }

  window.renderItemExtras = function (item) {
    if (!item) return;
    const cap = document.getElementById('coverCaption');
    if (cap && item.coverCredit) { cap.textContent = item.coverCredit; cap.hidden = false; }
    try { renderVideo(item); } catch (e) { console.error('video block', e); }
    try { renderAttachments(item); } catch (e) { console.error('attachments block', e); }
    renderDatasets(item).catch(e => console.error('datasets block', e));
    renderSources(item).catch(e => console.error('sources block', e));
  };
})();
