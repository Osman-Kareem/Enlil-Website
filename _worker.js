export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Redirect clean slug URLs to template with ?slug= query param
    const slugMatch = path.match(/^\/(projects|articles|research)\/([^/.]+)$/);
    if (slugMatch) {
      const section = slugMatch[1];
      const slug = slugMatch[2];
      const templates = {
        projects: '/projects/project-item.html',
        articles: '/articles/article.html',
        research: '/research/research-item.html'
      };
      return Response.redirect(
        `https://enlilcenter.org${templates[section]}?slug=${encodeURIComponent(slug)}`, 302
      );
    }

    // Everything else — serve static file
    return env.ASSETS.fetch(request);
  }
};
