# enlil-cms-api

Source of the `enlil-cms-api` Cloudflare Worker — the backend behind the CMS
(`/admin`) and the public site's content API.

This folder is **not** deployed by the Pages build that publishes the rest of
this repo. It is deployed separately to the Worker named `enlil-cms-api` via the
Cloudflare API (or the dashboard's Quick Edit). Bindings (KV `CMS_DATA`, R2
`IMAGES_BUCKET` / `FILES_BUCKET`, the two public-domain variables, and the
`ADMIN_TOKEN` secret) live in the Worker's dashboard settings, not here.

Endpoints:

| Route | Auth | Purpose |
|---|---|---|
| `GET /data/{key}` | public | Read a content type (`authors`, `articles`, `research`, `projects`, `partners`, `sources`) |
| `PUT /data/{key}` | `X-Admin-Token` | Replace a content type's JSON array |
| `POST /upload-image` | `X-Admin-Token` | Raw image body → R2 `IMAGES_BUCKET`; `X-Filename` sets the key |
| `POST /upload/file` | `X-Admin-Token` | multipart `file`/`folder`/`slug` → R2 `FILES_BUCKET` (PDF, DOC/X, XLS/X, CSV, PPT/X, ≤25 MB) |
| `POST /upload/pdf` | `X-Admin-Token` | Same as above, PDF only (kept for older admin code) |
| `GET /admin/token` | Cloudflare Access | Returns the current admin token to an Access-authenticated browser |
