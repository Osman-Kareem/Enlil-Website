// Shared renderer for the optional blocks every article / research report /
// project can carry: an embedded video, downloadable attachments, and the
// "Sources & Citations" list. Loaded by the three detail templates.
//
// Usage: renderItemExtras(item)  — safe to call with any CMS item; each block
// stays hidden unless the item actually has data for it.
(function () {
  const API_BASE = 'https://enlil-cms-api.osmanalikareem.workers.dev';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function safeUrl(u) {
    const s = String(u || '').trim();
    return /^https?:\/\//i.test(s) ? s : '';
  }
  function fmtBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }
  function fileIcon(ext) {
    ext = String(ext || '').toLowerCase();
    if (ext === 'pdf') return 'fa-file-pdf text-rose-600';
    if (ext === 'doc' || ext === 'docx') return 'fa-file-word text-blue-600';
    if (ext === 'xls' || ext === 'xlsx' || ext === 'csv') return 'fa-file-excel text-emerald-600';
    if (ext === 'ppt' || ext === 'pptx') return 'fa-file-powerpoint text-orange-600';
    return 'fa-file-lines text-gray-500';
  }
  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // Turns a YouTube / Vimeo page URL into a privacy-friendly embed URL.
  // Anything else is shown as a plain outbound link rather than embedded.
  function videoEmbedUrl(raw) {
    const u = safeUrl(raw);
    if (!u) return null;
    let url;
    try { url = new URL(u); } catch { return null; }
    const host = url.hostname.replace(/^www\.|^m\./, '');
    let id = '';
    if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (url.pathname === '/watch') id = url.searchParams.get('v') || '';
      else {
        const m = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?]+)/);
        if (m) id = m[1];
      }
    }
    if (id && /^[A-Za-z0-9_-]{6,20}$/.test(id)) {
      return `https://www.youtube-nocookie.com/embed/${id}`;
    }
    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
      const m = url.pathname.match(/(\d{6,})/);
      if (m) return `https://player.vimeo.com/video/${m[1]}`;
    }
    return null;
  }

  function renderVideo(item) {
    const wrap = document.getElementById('videoWrapper');
    const box = document.getElementById('videoEmbed');
    if (!wrap || !box) return;
    const raw = safeUrl(item.videoUrl);
    if (!raw) return;
    const embed = videoEmbedUrl(raw);
    if (embed) {
      box.innerHTML = `<iframe src="${esc(embed)}" title="${esc(item.title || 'Video')}" loading="lazy"
        allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowfullscreen referrerpolicy="strict-origin-when-cross-origin"
        class="w-full h-full border-0"></iframe>`;
    } else {
      box.className = 'rounded-2xl border border-gray-200 bg-gray-50 p-5';
      box.innerHTML = `<a href="${esc(raw)}" target="_blank" rel="noopener"
        class="inline-flex items-center gap-2 text-sm font-medium text-emerald-700 hover:text-emerald-800">
        <i class="fa-solid fa-circle-play"></i> Watch the video <i class="fa-solid fa-arrow-up-right-from-square text-xs"></i></a>`;
    }
    wrap.classList.remove('hidden');
  }

  function renderAttachments(item) {
    const wrap = document.getElementById('attachmentsWrapper');
    const list = document.getElementById('attachmentsList');
    if (!wrap || !list) return;
    const files = (Array.isArray(item.attachments) ? item.attachments : []).filter(f => f && safeUrl(f.url));
    if (!files.length) return;
    list.innerHTML = files.map(f => `
      <li>
        <a href="${esc(f.url)}" target="_blank" rel="noopener"
           class="flex items-center gap-3 p-4 rounded-2xl border border-gray-200 bg-white hover:border-emerald-300 hover:bg-emerald-50 transition">
          <i class="fa-solid ${fileIcon(f.ext)} text-2xl w-7 text-center"></i>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium text-gray-900 truncate">${esc(f.name || 'Download')}</span>
            <span class="block text-xs text-gray-500 uppercase">${esc(f.ext || '')}${f.size ? ' · ' + fmtBytes(f.size) : ''}</span>
          </span>
          <i class="fa-solid fa-download text-gray-400"></i>
        </a>
      </li>`).join('');
    wrap.classList.remove('hidden');
  }

  async function renderSources(item) {
    const wrap = document.getElementById('sourcesWrapper');
    const list = document.getElementById('sourcesList');
    if (!wrap || !list) return;
    const cited = (Array.isArray(item.sources) ? item.sources : []).filter(c => c && c.slug);
    if (!cited.length) return;

    // The citing item stores a snapshot of each source; refresh it against the
    // live library so edits to a source (new URL, corrected publisher) show up.
    let library = [];
    try {
      const res = await fetch(`${API_BASE}/data/sources`);
      if (res.ok) library = await res.json();
    } catch { /* fall back to the snapshot */ }
    const bySlug = new Map((Array.isArray(library) ? library : []).map(s => [s.slug, s]));

    list.innerHTML = cited.map((c, i) => {
      const s = Object.assign({}, c, bySlug.get(c.slug) || {});
      const url = safeUrl(s.url);
      const local = s.file && safeUrl(s.file.url);
      const meta = [s.publisher, s.type, s.datePublished ? fmtDate(s.datePublished) : ''].filter(Boolean).map(esc).join(' · ');
      return `
        <li class="flex gap-4">
          <span class="text-xs font-semibold text-gray-400 tabular-nums pt-1 w-6 shrink-0">[${i + 1}]</span>
          <div class="min-w-0">
            ${url
              ? `<a href="${esc(url)}" target="_blank" rel="noopener" class="text-sm font-medium text-gray-900 hover:text-emerald-700 hover:underline">${esc(s.title || c.slug)}</a>`
              : `<span class="text-sm font-medium text-gray-900">${esc(s.title || c.slug)}</span>`}
            ${meta ? `<p class="text-xs text-gray-500 mt-0.5">${meta}</p>` : ''}
            ${s.note ? `<p class="text-xs text-gray-600 mt-1">${esc(s.note)}</p>` : ''}
            <p class="text-xs mt-1 flex flex-wrap gap-3">
              <a href="../sources.html#${encodeURIComponent(c.slug)}" class="text-emerald-700 hover:underline">In the sources library</a>
              ${local ? `<a href="${esc(local)}" target="_blank" rel="noopener" class="text-emerald-700 hover:underline"><i class="fa-solid fa-download text-[10px]"></i> Archived copy</a>` : ''}
            </p>
          </div>
        </li>`;
    }).join('');
    wrap.classList.remove('hidden');
  }

  window.renderItemExtras = function (item) {
    if (!item) return;
    try { renderVideo(item); } catch (e) { console.error('video block', e); }
    try { renderAttachments(item); } catch (e) { console.error('attachments block', e); }
    renderSources(item).catch(e => console.error('sources block', e));
  };
})();
