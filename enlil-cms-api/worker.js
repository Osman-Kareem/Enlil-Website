// enlil-cms-api — Cloudflare Worker backing the Enlil Center CMS.
//
// Bindings (set in the Cloudflare dashboard, not in this file):
//   CMS_DATA                      KV namespace, one JSON array per content type
//   IMAGES_BUCKET                 R2 bucket for images   (public: R2_PUBLIC_DOMAIN)
//   FILES_BUCKET                  R2 bucket for documents (public: FILES_R2BUCKET_PUBLIC_DOMAIN)
//   ADMIN_TOKEN                   secret; required on every write
//
// /admin/* is additionally gated by Cloudflare Access at the edge.

const ALLOWED_ORIGINS = [
  'https://enlilcenter.org',
  'https://www.enlilcenter.org',
  'https://enlilcenter.pages.dev'
];

const ALLOWED_KEYS = ['authors', 'articles', 'research', 'projects', 'partners', 'sources', 'datasets'];

const TEMPLATES = {
  projects: '/projects/project-item.html',
  articles: '/articles/article.html',
  research: '/research/research-item.html'
};

// Document types any content item may attach for readers to download.
const FILE_TYPES = {
  pdf:  ['application/pdf'],
  doc:  ['application/msword'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xls:  ['application/vnd.ms-excel'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  csv:  ['text/csv', 'application/csv'],
  ppt:  ['application/vnd.ms-powerpoint'],
  pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation']
};
const MAX_FILE_BYTES = 25 * 1024 * 1024;

export default {
  async fetch(request, env) {
    const url  = new URL(request.url);
    const path = url.pathname;

    // ── Handle clean slug URLs ───────────────────────────────────────────────
    const slugMatch = path.match(/^\/(projects|articles|research)\/([^/.]+)$/);
    if (slugMatch) {
      const section  = slugMatch[1];
      const slug     = slugMatch[2];
      const template = TEMPLATES[section];
      return Response.redirect(
        `https://enlilcenter.osmanalikareem.workers.dev${template}?slug=${encodeURIComponent(slug)}`, 302
      );
    }

    // ── CORS setup ───────────────────────────────────────────────────────────
    const origin     = request.headers.get('Origin') || '';
    const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : '*';

    const corsHeaders = {
      'Access-Control-Allow-Origin':  corsOrigin,
      'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS, POST',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token, X-Filename',
      'Vary': 'Origin'
    };
    const json = (body, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
    const isAdmin = () => env.ADMIN_TOKEN && request.headers.get('X-Admin-Token') === env.ADMIN_TOKEN;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // ── Admin token — this path is gated by Cloudflare Access at the edge ─────
    if (path === '/admin/token' && request.method === 'GET') {
      return json({ token: env.ADMIN_TOKEN || null });
    }

    // ── R2 document uploads ─────────────────────────────────────────────────
    if (path === '/upload/pdf' && request.method === 'POST') {
      return handleFileUpload(request, env, json, isAdmin, ['pdf']);
    }
    if (path === '/upload/file' && request.method === 'POST') {
      return handleFileUpload(request, env, json, isAdmin, Object.keys(FILE_TYPES));
    }

    // ── R2 Image Upload ───────────────────────────────────────────────────────
    if (path === '/upload-image' && request.method === 'POST') {
      if (!isAdmin()) return json({ error: 'Unauthorized' }, 401);

      const requested   = request.headers.get('X-Filename') || `image-${Date.now()}.jpg`;
      const filename    = requested.replace(/[^a-zA-Z0-9/_.-]+/g, '-').replace(/^\/+/, '');
      const contentType = request.headers.get('Content-Type') || 'image/jpeg';
      if (!contentType.startsWith('image/')) return json({ error: 'Only images are accepted here' }, 400);
      const imageData   = await request.arrayBuffer();
      if (imageData.byteLength > 10 * 1024 * 1024) return json({ error: 'Image exceeds the 10 MB limit' }, 400);

      await env.IMAGES_BUCKET.put(filename, imageData, { httpMetadata: { contentType } });
      return json({ url: `${env.R2_PUBLIC_DOMAIN}/${filename}` });
    }

    // ── KV Data API ───────────────────────────────────────────────────────────
    const match = path.match(/^\/data\/([a-z]+)$/);

    if (!match) {
      return fetch(request);
    }

    const key = match[1];
    if (!ALLOWED_KEYS.includes(key)) {
      return new Response('Forbidden', { status: 403, headers: corsHeaders });
    }

    if (request.method === 'GET') {
      const value = await env.CMS_DATA.get(key);
      return new Response(value || '[]', {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (request.method === 'PUT') {
      if (!isAdmin()) return json({ error: 'Unauthorized' }, 401);
      const body = await request.text();
      let parsed;
      try { parsed = JSON.parse(body); } catch {
        return new Response('Invalid JSON', { status: 400, headers: corsHeaders });
      }
      if (!Array.isArray(parsed)) return json({ error: 'Expected a JSON array' }, 400);
      await env.CMS_DATA.put(key, body);
      return json({ ok: true, count: parsed.length });
    }

    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }
};


// ── Document Upload Handler ────────────────────────────────────────────────────
// multipart/form-data: file (required), folder (default "attachments"), slug (default "document").
// Returns { success, key, url, name, size, type, ext }.
async function handleFileUpload(request, env, json, isAdmin, allowedExts) {
  if (!isAdmin()) return json({ success: false, error: 'Unauthorized' }, 401);

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return json({ success: false, error: 'Invalid form data' }, 400);
  }

  const file   = formData.get('file');
  const folder = (formData.get('folder') || 'attachments').toString().toLowerCase().replace(/[^a-z0-9/-]+/g, '-').replace(/^\/+|\/+$/g, '');
  const slug   = (formData.get('slug')   || 'document').toString();

  if (!file || typeof file === 'string') {
    return json({ success: false, error: 'Missing file' }, 400);
  }

  const nameExt = (file.name || '').split('.').pop().toLowerCase();
  const ext = allowedExts.find(e => e === nameExt) ||
              allowedExts.find(e => FILE_TYPES[e].includes(file.type));
  if (!ext) {
    return json({ success: false, error: `File type not allowed. Accepted: ${allowedExts.map(e => e.toUpperCase()).join(', ')}` }, 400);
  }

  if (file.size > MAX_FILE_BYTES) {
    return json({ success: false, error: 'File exceeds the 25 MB limit' }, 400);
  }

  const safeSlug = slug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'document';

  const key = `${folder}/${safeSlug}-${Date.now()}.${ext}`;
  const contentType = FILE_TYPES[ext][0];

  await env.FILES_BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType, contentDisposition: `inline; filename="${safeSlug}.${ext}"` }
  });

  return json({
    success: true,
    key,
    url: `${env.FILES_R2BUCKET_PUBLIC_DOMAIN}/${key}`,
    name: file.name || `${safeSlug}.${ext}`,
    size: file.size,
    type: contentType,
    ext
  });
}
