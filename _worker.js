// Cloudflare Pages worker for enlilcenter.org
//
// Responsibilities:
//   • Clean URLs for content:  /articles/:slug  /research/:slug  /projects/:slug  /data/:slug  /authors/:slug
//   • Server-side rendering: the homepage and every detail page are filled with real
//     content before they leave the edge, so search engines and social crawlers see
//     titles, body text, JSON-LD and Open Graph tags without running JavaScript.
//     The page's own script then takes over and re-renders identically (hydration-lite).
//   • /sitemap.xml built live from the CMS.
//   • /admin/token — Access-gated route that hands the CMS its write token.

const API = 'https://enlil-cms-api.osmanalikareem.workers.dev';
const SITE = 'https://enlilcenter.org';
const ORG = 'Enlil Center for Environment and Sustainable Development';
const PILLARS = ['Climate', 'Water', 'Energy', 'Economy', 'Governance'];

const SECTIONS = {
  articles: { key: 'articles', template: '/articles/article.html' },
  research: { key: 'research', template: '/research/research-item.html' },
  projects: { key: 'projects', template: '/projects/project-item.html' },
  data:     { key: 'datasets', template: '/datasets/dataset.html' },
  authors:  { key: 'authors',  template: '/authors/author.html' }
};

// ── helpers ──────────────────────────────────────────────────────────────────
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const attr = s => esc(s).replace(/\n/g, ' ');
const strip = html => String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const xmlEscape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function safeSlug(s, title, fallback) {
  if (s && String(s).trim()) return String(s).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || fallback || 'item';
}
const itemSlug = (item, fb) => safeSlug(item.seo?.slug || item.slug, item.title || item.name, fb);
const authorSlug = n => String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const isPublished = it => { const s = String(it.status || it.publishStatus || 'published').toLowerCase(); return s !== 'draft' && s !== 'unpublished'; };
function fmtDate(iso) { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? String(iso) : d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' }); }
const isoDate = v => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? '' : d.toISOString().slice(0, 10); };
const authorName = it => (it.leadAuthor && it.leadAuthor.name) || it.author || 'Enlil Center';
const authorLink = it => { const n = authorName(it); return n === 'Enlil Center' ? n : `<a href="/authors/${authorSlug(n)}">${esc(n)}</a>`; };
const kickerOf = (it, fb) => (it.pillars || []).find(p => PILLARS.includes(p)) || fb;
const snippet = (it, n) => it.seo?.description || it.seoDescription || it.description || (strip(it.abstract || it.content).slice(0, n || 160) + '…');
function normaliseHeadings(html) {
  let h = String(html || '').replace(/<(\/?)h1\b/gi, '<$1h2');
  if (!/<h2\b/i.test(h) && /<h3\b/i.test(h)) h = h.replace(/<(\/?)h3\b/gi, '<$1h2');
  return h;
}
const byDateDesc = (a, b) => String(b.date || b.year || '').localeCompare(String(a.date || a.year || ''));

async function api(key) {
  try {
    const r = await fetch(`${API}/data/${key}`, { cf: { cacheTtl: 120, cacheEverything: true } });
    const j = await r.json();
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}

// Replace the inner HTML of the element carrying id="…" (first match). Assumes the
// element does not contain a nested element of the same tag — true for every target here.
function setInner(html, id, inner) {
  const re = new RegExp(`(<([a-z0-9]+)\\b[^>]*\\sid="${id}"[^>]*>)([\\s\\S]*?)(</\\2>)`);
  return html.replace(re, (m, open, tag, _old, close) => `${open}${inner}${close}`);
}
function setAttr(html, id, name, value) {
  const tagRe = new RegExp(`<[a-z0-9]+\\b[^>]*\\sid="${id}"[^>]*>`);
  return html.replace(tagRe, tag => {
    const cleaned = tag.replace(new RegExp(`\\s${name}="[^"]*"`), '');
    return cleaned.replace(/\s*\/?>$/, m => ` ${name}="${attr(value)}"${m.trim() === '/>' ? ' />' : '>'}`);
  });
}
function unhide(html, id) {
  const re = new RegExp(`(<[a-z0-9]+\\b[^>]*\\sid="${id}"[^>]*?)\\s(?:hidden|class="([^"]*)\\bhidden\\b([^"]*)")([^>]*>)`);
  return html.replace(re, (m, open, a, b, end) => (a !== undefined ? `${open} class="${(a + ' ' + b).replace(/\s+/g, ' ').trim()}"${end}` : `${open}${end}`));
}
function setMeta(html, { title, desc, image, canonical, extraHead }) {
  return html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/(<meta name="description" content=")([^"]*)(")/, `$1${attr(desc)}$3`)
    .replace(/(<meta id="ogTitle"[^>]*content=")([^"]*)(")/, `$1${attr(title)}$3`)
    .replace(/(<meta id="ogDescription"[^>]*content=")([^"]*)(")/, `$1${attr(desc)}$3`)
    .replace(/(<meta id="ogUrl"[^>]*content=")([^"]*)(")/, `$1${canonical}$3`)
    .replace(/(<meta id="ogImage"[^>]*content=")([^"]*)(")/, `$1${attr(image)}$3`)
    .replace(/(<meta id="twTitle"[^>]*content=")([^"]*)(")/, `$1${attr(title)}$3`)
    .replace(/(<meta id="twDescription"[^>]*content=")([^"]*)(")/, `$1${attr(desc)}$3`)
    .replace(/(<meta id="twImage"[^>]*content=")([^"]*)(")/, `$1${attr(image)}$3`)
    .replace(/(<link id="canonicalLink"[^>]*href=")([^"]*)(")/, `$1${canonical}$3`)
    .replace('</head>', `${extraHead || ''}</head>`);
}
const ld = obj => JSON.stringify(obj).replace(/</g, '\\u003c');
const publisher = { "@type": "Organization", "name": ORG, "url": SITE, "logo": { "@type": "ImageObject", "url": `${SITE}/image/logo.png` } };

function htmlResponse(html, maxAge = 300) {
  return new Response(html, {
    headers: {
      'content-type': 'text/html;charset=UTF-8',
      'cache-control': `public, max-age=60, s-maxage=${maxAge}, stale-while-revalidate=600`
    }
  });
}

// ── card markup shared by the homepage SSR (mirrors index.html's card()) ─────
function card(item, section, kickerFallback, extraBadge) {
  const url = `/${section}/${itemSlug(item, section)}`;
  const date = fmtDate(item.date || (item.year ? `${item.year}-01-01` : ''));
  const meta = section === 'projects'
    ? [item.sponsor, item.year].filter(Boolean).map(esc).join(' · ')
    : [authorLink(item), date].filter(Boolean).join(' · ');
  return `
        <article class="card">
          <a class="thumb" href="${url}" aria-label="${attr(item.title)}">${item.cover ? `<img src="${attr(item.cover)}" alt="" loading="lazy" decoding="async">` : ''}</a>
          <div style="display:flex;gap:8px;align-items:center"><span class="kicker">${esc(kickerOf(item, kickerFallback))}</span>${extraBadge || ''}</div>
          <h3><a href="${url}">${esc(item.title)}</a></h3>
          <p>${esc(snippet(item))}</p>
          <div class="meta">${meta}</div>
        </article>`;
}

// ── homepage ─────────────────────────────────────────────────────────────────
async function renderHome(html) {
  const [articles, research, projects, partners, datasets] = await Promise.all(['articles', 'research', 'projects', 'partners', 'datasets'].map(api));
  const arts = articles.filter(isPublished).sort(byDateDesc);
  const res = research.filter(isPublished).sort(byDateDesc);
  const proj = projects.filter(isPublished).sort((a, b) => String(b.year || '').localeCompare(String(a.year || '')));
  const data = datasets.filter(isPublished);

  if (arts.length) {
    const a = arts[0];
    const url = `/articles/${itemSlug(a, 'article')}`;
    const words = strip(a.content).split(' ').length;
    const mins = words > 80 ? Math.max(1, Math.round(words / 220)) + ' min read' : '';
    html = setInner(html, 'leadKicker', esc(kickerOf(a, 'Latest analysis')));
    html = setInner(html, 'leadTitle', `<a href="${url}">${esc(a.title)}</a>`);
    html = setInner(html, 'leadDek', esc(snippet(a, 200)));
    html = setInner(html, 'leadMeta', [authorLink(a), fmtDate(a.date), mins].filter(Boolean).join(' · '));
    html = setInner(html, 'leadActions', `<a class="btn btn-amber" href="${url}">Read the article</a><a class="btn btn-outline-light" href="/data">Explore the Data Hub</a>`);
    const strip3 = arts.slice(1, 4);
    if (strip3.length) {
      html = unhide(html, 'subStrip');
      html = setInner(html, 'subStrip', strip3.map(x => `
          <div class="sub-card">
            <a class="thumb" href="/articles/${itemSlug(x, 'article')}" aria-label="${attr(x.title)}">${x.cover ? `<img src="${attr(x.cover)}" alt="" loading="lazy">` : ''}</a>
            <div><span class="kicker">${esc(kickerOf(x, 'Analysis'))}</span><h2><a href="/articles/${itemSlug(x, 'article')}">${esc(x.title)}</a></h2></div>
          </div>`).join(''));
    }
  }
  const rest = arts.length > 4 ? arts.slice(4, 7) : arts.slice(0, 3);
  html = setInner(html, 'articlesContainer', rest.map(a => card(a, 'articles', 'Analysis')).join('') || '<p class="empty">No articles yet.</p>');
  html = setInner(html, 'researchContainer', res.slice(0, 3).map(r => card(r, 'research', 'Report', (r.pdfUrl || r.pdfBase64 || r.pdf) ? '<span class="badge pdf"><i class="fa-solid fa-file-pdf"></i> PDF</span>' : '')).join('') || '<p class="empty">No research published yet.</p>');
  html = setInner(html, 'projectsContainer', proj.slice(0, 3).map(p => card(p, 'projects', 'Project', p.status && p.status !== 'published' ? `<span class="badge amber">${esc(p.status)}</span>` : '')).join('') || '<p class="empty">No projects yet.</p>');
  html = setInner(html, 'dataContainer', data.slice(0, 3).map((d, i) => `<a class="data-card" href="/data/${itemSlug(d, 'dataset')}">
          <span class="kicker">${esc((d.pillars || [])[0] || 'Data')}</span>
          <h3>${esc(d.title)}</h3>
          <div class="spark"><canvas data-i="${i}"></canvas></div>
          <span class="src"><span>${esc((d.source && d.source.publisher) || 'Enlil Center')}</span></span>
        </a>`).join('') || '<p class="empty">Datasets are being added.</p>');
  html = setInner(html, 'partnersContainer', partners.map(p => `
        <a class="partner" href="${attr(p.url || '#')}" ${p.url ? 'target="_blank" rel="noopener"' : ''}>
          ${p.logo ? `<img src="${attr(p.logo)}" alt="${attr(p.name || '')}" loading="lazy">` : ''}<span>${esc(p.name || '')}</span>
        </a>`).join(''));
  html = setInner(html, 'statPubs', String(arts.length + res.length));
  html = setInner(html, 'statData', String(data.length));
  html = setInner(html, 'statPartners', String(partners.length));

  const list = {
    "@context": "https://schema.org", "@type": "ItemList",
    "itemListElement": arts.slice(0, 10).map((a, i) => ({ "@type": "ListItem", "position": i + 1, "url": `${SITE}/articles/${itemSlug(a, 'article')}`, "name": a.title }))
  };
  return html.replace('</head>', `  <script type="application/ld+json">${ld(list)}</script>\n</head>`);
}

// ── listing pages ────────────────────────────────────────────────────────────
const LISTINGS = { articles: { key: 'articles', fb: 'Analysis' }, research: { key: 'research', fb: 'Report' }, projects: { key: 'projects', fb: 'Project' } };
async function renderListing(html, section) {
  const cfg = LISTINGS[section];
  let items = (await api(cfg.key)).filter(isPublished);
  items.sort(section === 'projects' ? (a, b) => String(b.year || '').localeCompare(String(a.year || '')) : byDateDesc);
  const badge = it => section === 'research' && (it.pdfUrl || it.pdfBase64 || it.pdf) ? '<span class="badge pdf"><i class="fa-solid fa-file-pdf"></i> PDF</span>'
    : section === 'projects' && it.status && it.status !== 'published' ? `<span class="badge amber">${esc(it.status)}</span>` : '';
  html = setInner(html, 'listGrid', items.slice(0, 12).map(it => card(it, section, cfg.fb, badge(it))).join('') || '<p class="empty">Nothing published here yet.</p>');
  html = setInner(html, 'count', items.length ? `${Math.min(12, items.length)} of ${items.length}` : '');
  const list = { "@context": "https://schema.org", "@type": "ItemList", "numberOfItems": items.length,
    "itemListElement": items.slice(0, 50).map((it, i) => ({ "@type": "ListItem", "position": i + 1, "url": `${SITE}/${section}/${itemSlug(it, section)}`, "name": it.title })) };
  return html.replace('</head>', `  <script type="application/ld+json">${ld(list)}</script>\n</head>`);
}

// ── detail pages ─────────────────────────────────────────────────────────────
function findItem(items, section, slug) {
  if (section === 'authors') return items.find(a => safeSlug(a.slug, a.name, '') === slug || authorSlug(a.name) === slug);
  return items.find(i => itemSlug(i, section) === slug);
}


// New detail templates: hero photo class, kicker and dek.
function heroBits(html, item, fallbackKicker) {
  html = setInner(html, 'kicker', esc(kickerOf(item, fallbackKicker)));
  const dek = item.seo?.description || item.seoDescription || '';
  if (dek) { html = unhide(html, 'dek'); html = setInner(html, 'dek', esc(dek)); }
  if (item.cover) html = setAttr(html, 'artHero', 'class', 'art-hero has-photo');
  return html;
}

function renderArticle(html, item, slug) {
  html = heroBits(html, item, 'Analysis');
  const url = `${SITE}/articles/${slug}`;
  const title = `Enlil Center | ${item.title}`;
  const desc = snippet(item);
  const image = item.cover || `${SITE}/image/og-hero.jpg`;
  const name = authorName(item);
  html = setMeta(html, { title, desc, image, canonical: url, extraHead: `  <meta property="article:published_time" content="${attr(isoDate(item.date))}">\n  <meta property="article:author" content="${attr(name)}">\n  <meta property="article:section" content="${attr(kickerOf(item, 'Analysis'))}">\n` });
  html = setInner(html, 'heroTitle', esc(item.title));
  html = setInner(html, 'breadcrumbTitle', esc(item.title));
  html = setInner(html, 'articleTitle', esc(item.title));
  html = setInner(html, 'metaLine', `${authorLink(item)}${item.date ? ` <span> · </span><time datetime="${attr(item.date)}">${esc(fmtDate(item.date))}</time>` : ''}`);
  if (item.cover) { html = unhide(html, 'coverWrapper'); html = setAttr(html, 'articleCover', 'src', item.cover); html = setAttr(html, 'articleCover', 'alt', item.title); }
  html = setInner(html, 'articleBody', normaliseHeadings(item.content || ''));
  html = setAttr(html, 'articleBody', 'data-ssr', '1');
  html = setInner(html, 'ldJson', ld({
    "@context": "https://schema.org", "@type": "NewsArticle", "headline": item.title, "description": desc,
    "datePublished": isoDate(item.date), "dateModified": isoDate(item.updatedAt || item.date),
    "author": { "@type": "Person", "name": name, "url": name === 'Enlil Center' ? SITE : `${SITE}/authors/${authorSlug(name)}` },
    "image": image, "mainEntityOfPage": { "@type": "WebPage", "@id": url }, "articleSection": kickerOf(item, 'Analysis'),
    "keywords": (item.pillars || []).concat(item.seo?.keywords ? String(item.seo.keywords).split(',').map(s => s.trim()) : []).filter(Boolean),
    "wordCount": strip(item.content).split(' ').length, "inLanguage": "en", "publisher": publisher
  }));
  return html;
}

function renderResearch(html, item, slug) {
  html = heroBits(html, item, 'Report');
  const url = `${SITE}/research/${slug}`;
  const title = `Enlil Center | ${item.title}`;
  const desc = snippet(item);
  const image = item.cover || `${SITE}/image/og-hero.jpg`;
  const pdf = item.pdfUrl || (String(item.pdf || '').startsWith('http') ? item.pdf : '');
  html = setMeta(html, { title, desc, image, canonical: url, extraHead: `  <meta property="article:published_time" content="${attr(isoDate(item.date))}">\n` });
  html = setInner(html, 'heroTitle', esc(item.title));
  html = setInner(html, 'breadcrumbTitle', esc(item.title));
  html = setInner(html, 'reportTitle', esc(item.title));
  html = setInner(html, 'metaLine', `${authorLink(item)}${item.date ? ` <span> · </span><time datetime="${attr(item.date)}">${esc(fmtDate(item.date))}</time>` : ''}`);
  if (item.cover) { html = unhide(html, 'coverWrapper'); html = setAttr(html, 'reportCover', 'src', item.cover); html = setAttr(html, 'reportCover', 'alt', item.title); }
  if (item.abstract) { html = unhide(html, 'abstractWrapper'); html = setInner(html, 'abstractBody', item.abstract); }
  if (pdf) { html = unhide(html, 'pdfWrapper'); html = setAttr(html, 'pdfDownloadBtn', 'href', pdf); }
  html = setInner(html, 'reportBody', normaliseHeadings(item.content || ''));
  html = setAttr(html, 'reportBody', 'data-ssr', '1');
  html = setInner(html, 'ldJson', ld({
    "@context": "https://schema.org", "@type": "Report", "headline": item.title, "name": item.title, "description": desc,
    "abstract": strip(item.abstract).slice(0, 500) || undefined, "datePublished": isoDate(item.date),
    "author": { "@type": "Person", "name": authorName(item) }, "image": image, "url": url,
    "mainEntityOfPage": { "@type": "WebPage", "@id": url }, "keywords": (item.pillars || []).filter(Boolean),
    "encoding": pdf ? { "@type": "MediaObject", "contentUrl": pdf, "encodingFormat": "application/pdf" } : undefined,
    "inLanguage": "en", "publisher": publisher
  }));
  return html;
}

function renderProject(html, item, slug) {
  html = heroBits(html, item, 'Project');
  const url = `${SITE}/projects/${slug}`;
  const title = `Enlil Center | ${item.title}`;
  const desc = snippet(item);
  const image = item.cover || `${SITE}/image/og-hero.jpg`;
  html = setMeta(html, { title, desc, image, canonical: url });
  html = setInner(html, 'heroTitle', esc(item.title));
  html = setInner(html, 'breadcrumbTitle', esc(item.title));
  html = setInner(html, 'projectTitle', esc(item.title));
  if (item.cover) { html = unhide(html, 'coverWrapper'); html = setAttr(html, 'projectCover', 'src', item.cover); html = setAttr(html, 'projectCover', 'alt', item.title); }
  html = setInner(html, 'projectBody', normaliseHeadings(item.content || ''));
  html = setAttr(html, 'projectBody', 'data-ssr', '1');
  html = setInner(html, 'ldJson', ld({
    "@context": "https://schema.org", "@type": "CreativeWork", "name": item.title, "headline": item.title, "description": desc,
    "image": image, "url": url, "mainEntityOfPage": { "@type": "WebPage", "@id": url },
    "funder": item.sponsor ? { "@type": "Organization", "name": item.sponsor } : undefined,
    "temporalCoverage": item.year ? String(item.year) : undefined, "keywords": (item.pillars || []).filter(Boolean),
    "creativeWorkStatus": item.status || undefined, "inLanguage": "en", "publisher": publisher
  }));
  return html;
}

function renderDataset(html, item, slug) {
  const url = `${SITE}/data/${slug}`;
  const title = `Enlil Center | ${item.title}`;
  const src = item.source || {};
  const srcName = src.publisher || src.title || '';
  const desc = item.description || `${item.title} — Iraq data series${srcName ? ' from ' + srcName : ''}, charted and downloadable from Enlil Center.`;
  const rows = Array.isArray(item.rows) ? item.rows.filter(r => Array.isArray(r) && r.length) : [];
  const periods = rows.map(r => String(r[0])).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  html = setMeta(html, { title, desc, image: `${SITE}/image/og-hero.jpg`, canonical: url });
  html = setInner(html, 'heroTitle', esc(item.title));
  html = setInner(html, 'breadcrumbTitle', esc(item.title));
  html = setInner(html, 'pillarLine', esc((item.pillars || []).filter(p => PILLARS.includes(p)).join(' · ')));
  html = unhide(html, 'dataset');
  html = setInner(html, 'description', esc(desc));
  const ldObj = {
    "@context": "https://schema.org", "@type": "Dataset", "name": item.title, "description": desc, "url": url,
    "keywords": (item.pillars || []).concat(['Iraq']), "spatialCoverage": "Iraq",
    "temporalCoverage": periods.length ? `${periods[0]}/${periods[periods.length - 1]}` : undefined,
    "variableMeasured": (item.columns || []).slice(1), "license": "https://creativecommons.org/licenses/by/4.0/", "isAccessibleForFree": true,
    "distribution": [{ "@type": "DataDownload", "encodingFormat": "text/csv", "contentUrl": url }],
    "creator": { "@type": "Organization", "name": srcName || "Enlil Center" }, "publisher": publisher,
    "dateModified": isoDate(item.updatedAt || item.retrievedAt) || undefined, "isBasedOn": src.url || undefined
  };
  html = setInner(html, 'ldJson', ld(ldObj));
  return html;
}

function renderAuthor(html, item, slug) {
  const url = `${SITE}/authors/${slug}`;
  const title = `Enlil Center | ${item.name}`;
  const desc = strip(item.bio).slice(0, 160) || `${item.name}${item.role ? ', ' + item.role : ''} at Enlil Center.`;
  html = setMeta(html, { title, desc, image: item.photo || `${SITE}/image/og-hero.jpg`, canonical: url });
  html = setInner(html, 'heroName', esc(item.name));
  html = setInner(html, 'breadcrumbName', esc(item.name));
  html = setInner(html, 'authorName', esc(item.name));
  if (item.role) html = setInner(html, 'authorRole', esc(item.role));
  if (item.bio) html = setInner(html, 'authorBio', item.bio);
  html = setInner(html, 'ldJson', ld({
    "@context": "https://schema.org", "@type": "Person", "name": item.name, "jobTitle": item.role || undefined,
    "description": desc, "image": item.photo || undefined, "url": url, "affiliation": { "@type": "Organization", "name": ORG, "url": SITE }
  }));
  return html;
}

const RENDER = { articles: renderArticle, research: renderResearch, projects: renderProject, data: renderDataset, authors: renderAuthor };

// ── sitemap ──────────────────────────────────────────────────────────────────
async function sitemap() {
  const [articles, research, projects, datasets, authors] = await Promise.all(['articles', 'research', 'projects', 'datasets', 'authors'].map(api));
  const urls = [
    { loc: `${SITE}/`, priority: '1.0' },
    { loc: `${SITE}/research`, priority: '0.8' },
    { loc: `${SITE}/articles`, priority: '0.8' },
    { loc: `${SITE}/projects`, priority: '0.8' },
    { loc: `${SITE}/data`, priority: '0.8' },
    { loc: `${SITE}/sources`, priority: '0.7' }
  ];
  const add = (items, section, fb) => items.filter(isPublished).forEach(item => {
    const raw = item.seo?.publishedDate || item.date || item.updatedAt || item.retrievedAt || (item.year ? `${item.year}-01-01` : null);
    urls.push({ loc: `${SITE}/${section}/${itemSlug(item, fb)}`, lastmod: isoDate(raw) || null, priority: '0.6' });
  });
  add(articles, 'articles', 'article'); add(research, 'research', 'report'); add(projects, 'projects', 'project'); add(datasets, 'data', 'dataset');
  authors.forEach(a => { if (a && a.name) urls.push({ loc: `${SITE}/authors/${safeSlug(a.slug, a.name, 'author')}`, lastmod: null, priority: '0.4' }); });
  const body = urls.map(u => `  <url>\n    <loc>${xmlEscape(u.loc)}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ''}\n    <priority>${u.priority}</priority>\n  </url>`).join('\n');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>`, {
    headers: { 'content-type': 'application/xml;charset=UTF-8', 'cache-control': 'public, max-age=3600' }
  });
}

// ── router ───────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/sitemap.xml') return sitemap();

    // Cloudflare Access gates /admin* on this hostname, so by the time this runs the
    // caller is a verified Enlil admin. Lets admin.html fetch the CMS write token at
    // runtime instead of shipping it in a public repo.
    if (path === '/admin/token' && request.method === 'GET') {
      return new Response(JSON.stringify({ token: env.ADMIN_TOKEN || null }), {
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
      });
    }

    // Homepage — server-rendered lead story, strips, cards and stats.
    if (path === '/' || path === '/index.html') {
      const res = await env.ASSETS.fetch(new Request(new URL('/index.html', url.origin)));
      let html = await res.text();
      try { html = await renderHome(html); } catch (e) { /* serve the static page if the API is unavailable */ }
      return htmlResponse(html, 300);
    }

    // Listing pages — server-rendered first page of cards + ItemList schema.
    const lm = path.match(/^\/(articles|research|projects)(?:\.html)?\/?$/);
    if (lm) {
      const res = await env.ASSETS.fetch(new Request(new URL(`/${lm[1]}.html`, url.origin)));
      let html = await res.text();
      try { html = await renderListing(html, lm[1]); } catch (e) { /* static fallback */ }
      return htmlResponse(html, 300);
    }

    // Detail pages — /articles/:slug etc.
    const m = path.match(/^\/(articles|research|projects|data|authors)\/([^/.]+)\/?$/);
    if (m) {
      const section = m[1], slug = m[2].toLowerCase();
      const cfg = SECTIONS[section];
      const res = await env.ASSETS.fetch(new Request(new URL(cfg.template, url.origin)));
      let html = await res.text();
      let status = 200;
      try {
        const items = await api(cfg.key);
        const item = findItem(items, section, slug);
        if (item && (section === 'authors' || isPublished(item))) html = RENDER[section](html, item, slug);
        else status = 404;
      } catch (e) { /* template as-is; the page's own script will try again client-side */ }
      const r = htmlResponse(html, status === 200 ? 300 : 60);
      return status === 200 ? r : new Response(html, { status: 404, headers: r.headers });
    }

    return env.ASSETS.fetch(request);
  }
};
