export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    const slugMatch = path.match(/^\/(projects|articles|research)\/([^/.]+)$/);
    if (slugMatch) {
      const section = slugMatch[1];
      const slug = slugMatch[2];

      const templates = {
        projects: '/projects/project-item.html',
        articles: '/articles/article.html',
        research: '/research/research-item.html'
      };

      // Fetch the static HTML template
      const templateReq = new Request(new URL(templates[section], url.origin));
      const templateRes = await env.ASSETS.fetch(templateReq);
      let html = await templateRes.text();

      // Fetch project data from API
      try {
        const apiRes = await fetch(`https://enlil-cms-api.osmanalikareem.workers.dev/data/${section}`);
        const items = await apiRes.json();

        function safeSlug(s, title) {
          if (s && s.trim()) return s.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-');
          return (title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || section.slice(0,-1);
        }

        const item = items.find(i => safeSlug(i.seo?.slug, i.title) === slug);

        if (item) {
          const title = `Enlil Center | ${item.title || 'Project'}`;
          const desc = item.seo?.description ||
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

    return env.ASSETS.fetch(request);
  }
};
