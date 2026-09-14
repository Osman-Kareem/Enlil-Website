export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    const slugMatch = path.match(/^\/(projects|articles|research|data)\/([^/.]+)$/);
    if (slugMatch) {
      const section = slugMatch[1];
      const slug = slugMatch[2];

      const templates = {
        projects: '/projects/project-item.html',
        articles: '/articles/article.html',
        research: '/research/research-item.html',
        data: '/datasets/dataset.html'
      };
      // Datasets live under the KV key `datasets` but are served at /data/:slug
      const apiKey = section === 'data' ? 'datasets' : section;

      // Fetch the static HTML template
      const templateReq = new Request(new URL(templates[section], url.origin));
      const templateRes = await env.ASSETS.fetch(templateReq);
      let html = await templateRes.text();

      // Fetch project data from API
      try {
        const apiRes = await fetch(`https://enlil-cms-api.osmanalikareem.workers.dev/data/${apiKey}`);
        const items = await apiRes.json();

        function safeSlug(s, title) {
          if (s && s.trim()) return s.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-');
          return (title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || section.slice(0,-1);
        }

        const item = items.find(i => safeSlug(i.seo?.slug || i.slug, i.title) === slug);

        if (item) {
          const title = `Enlil Center | ${item.title || 'Project'}`;
          const desc = item.seo?.description || item.seoDescription || item.description ||
            (item.content ? item.content.replace(/<[^>]+>/g, '').slice(0, 160) + '…' : 'Enlil Center for Environment and Sustainable Development.');
          const image = item.cover || 'https://enlilcenter.org/image/og-hero.jpg';
          const canonical = `https://enlilcenter.org/${section}/${slug}`;

          html = html
            .replace(/<title>.*?<\/title>/, `<title>${title}</title>`)
            .replace(/(<meta name="description" content=")([^"]*)(")/,  `$1${desc}$3`)
            .replace(/(<meta id="ogTitle"[^>]*content=")([^"]*)(")/,    `$1${title}$3`)
            .replace(/(<meta id="ogDescription"[^>]*content=")([^"]*)(")/,`$1${desc}$3`)
            .replace(/(<meta id="ogUrl"[^>]*content=")([^"]*)(")/,      `$1${canonical}$3`)
            .replace(/(<meta id="ogImage"[^>]*content=")([^"]*)(")/,    `$1${image}$3`)
            .replace(/(<meta id="twTitle"[^>]*content=")([^"]*)(")/,    `$1${title}$3`)
            .replace(/(<meta id="twDescription"[^>]*content=")([^"]*)(")/,`$1${desc}$3`)
            .replace(/(<meta id="twImage"[^>]*content=")([^"]*)(")/,    `$1${image}$3`)
            .replace(/(<link id="canonicalLink"[^>]*href=")([^"]*)(")/,  `$1${canonical}$3`);
        }
      } catch(e) {
        // fallback: serve template as-is
      }

      return new Response(html, {
        headers: { 'content-type': 'text/html;charset=UTF-8' }
      });
    }

    // Sitemap - built live from the CMS so every published article, research
    // report, and project is always included without a manual step.
    if (path === '/sitemap.xml') {
      function safeSlug(s, title, fallback) {
        if (s && s.trim()) return s.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-');
        return (title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
      }
      function xmlEscape(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }
      function isPublished(item) {
        const s = (item.status || item.publishStatus || 'published').toLowerCase();
        return s !== 'draft' && s !== 'unpublished';
      }

      const sections = ['articles', 'research', 'projects', 'datasets'];
      const pathFor = { articles: 'articles', research: 'research', projects: 'projects', datasets: 'data' };
      let bySection = {};
      try {
        const results = await Promise.all(sections.map(s =>
          fetch(`https://enlil-cms-api.osmanalikareem.workers.dev/data/${s}`).then(r => r.json())
        ));
        sections.forEach((s, i) => { bySection[s] = Array.isArray(results[i]) ? results[i] : []; });
      } catch (e) {
        sections.forEach(s => { bySection[s] = []; });
      }

      const staticUrls = [
        { loc: 'https://enlilcenter.org/', priority: '1.0' },
        { loc: 'https://enlilcenter.org/articles.html', priority: '0.8' },
        { loc: 'https://enlilcenter.org/research.html', priority: '0.8' },
        { loc: 'https://enlilcenter.org/projects.html', priority: '0.8' },
        { loc: 'https://enlilcenter.org/data.html', priority: '0.8' },
        { loc: 'https://enlilcenter.org/sources.html', priority: '0.7' },
      ];

      const dynamicUrls = [];
      for (const section of sections) {
        for (const item of bySection[section]) {
          if (!isPublished(item)) continue;
          const slug = safeSlug(item.seo?.slug || item.slug, item.title, section.slice(0, -1));
          const rawDate = item.seo?.publishedDate || item.date || item.updatedAt || item.retrievedAt || (item.year ? `${item.year}-01-01` : null);
          const lastmod = rawDate && !isNaN(Date.parse(rawDate)) ? new Date(rawDate).toISOString().slice(0, 10) : null;
          dynamicUrls.push({ loc: `https://enlilcenter.org/${pathFor[section]}/${slug}`, lastmod, priority: '0.6' });
        }
      }

      const allUrls = [...staticUrls, ...dynamicUrls];
      const body = allUrls.map(u => `  <url>
    <loc>${xmlEscape(u.loc)}</loc>${u.lastmod ? `
    <lastmod>${u.lastmod}</lastmod>` : ''}
    <priority>${u.priority}</priority>
  </url>`).join('\n');

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>`;

      return new Response(xml, {
        headers: { 'content-type': 'application/xml;charset=UTF-8', 'Cache-Control': 'public, max-age=3600' }
      });
    }

    // Admin token endpoint - Cloudflare Access already gates /admin* on this
    // hostname, so by the time this code runs the caller is verified as an
    // allowed Enlil admin. This exists so admin.html never needs to ship the
    // CMS write-token as a hardcoded constant in a public repo again.
    if (path === '/admin/token' && request.method === 'GET') {
      return new Response(JSON.stringify({ token: env.ADMIN_TOKEN || null }), {
        headers: { 'content-type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }

    return env.ASSETS.fetch(request);
  }
};
