# Deploying RavenNow

RavenNow is one Python service that serves both the website and the JSON API the
extension talks to. The `Dockerfile` is multi-stage: it builds the React/shadcn
frontend with Node, then copies the static output into the Python image.

Pick one host, set the environment, then repoint the extension at the deployed
URL (the last step is what makes the shipped extension work out of the box).

## 1. Deploy the backend

Any of these work. They all read the same `Dockerfile`.

- **Render** (blueprint): push to GitHub, then *New > Blueprint* and pick
  `render.yaml`. It provisions the web service plus a Postgres database and sets
  `RAVENNOW_ENV=production` and a generated `RAVENNOW_SECRET`.
- **Railway**: *New Project > Deploy from GitHub*, `railway.json` is detected.
  Add a Postgres plugin and map its `DATABASE_URL` to `RAVENNOW_DB`.
- **Fly.io**: `fly launch` (uses `fly.toml`), then
  `fly volumes create ravennow_data --size 1` for persistent SQLite.
- **Docker anywhere**: `docker compose up --build`.

Health checks already point at `/api/v1/health`. A plain `/health` alias exists
too, so a monitor that hits `/health` will not 404.

## 2. Set the environment

Required in production:

| Variable             | Why                                                       |
| -------------------- | --------------------------------------------------------- |
| `RAVENNOW_SECRET`    | Signs install tokens. Use a long random string.           |
| `RAVENNOW_ENV`       | `production` turns off the demo seed route.               |
| `RAVENNOW_DB`        | Postgres URL. `postgres://` and `postgresql://` are normalized. |
| `RAVENNOW_PUBLIC_URL`| Public origin, for example `https://ravennow.example.com`. Used by `robots.txt` and `sitemap.xml`. |
| `RAVENNOW_ADMIN_TOKEN`| Long random string. Unlocks `GET /api/v1/feedback`. Leave empty to keep it closed. |

Optional but recommended:

| Variable                | Why                                              |
| ----------------------- | ------------------------------------------------ |
| `RAVENNOW_SUPPORT_EMAIL`| Shown in the footer and privacy page.            |
| `RAVENNOW_CORS_ORIGINS` | Lock to your origin once it is fixed.            |
| `RAVENNOW_EXTENSION_URL`| Override the zip the `/install` page links to.   |

See `.env.example` for the full list.

## 3. Point the extension at the deployment

Run the configure script with your deployed origin:

```powershell
.\scripts\configure-extension.ps1 https://ravennow.example.com
```

```bash
bash scripts/configure-extension.sh https://ravennow.example.com
```

It rewrites the default API base in `extension/src/background.js`, refreshes the
example URL on the options page, and adds the deployed origin to
`extension/manifest.json` under `host_permissions`. Local development URLs stay
in place, so `http://localhost:8000` keeps working.

## 4. Refresh the downloadable zip

The `/install` page and the installer scripts point at the latest GitHub release
asset named `ravennow-extension.zip`.

```powershell
.\scripts\build-extension-zip.ps1
```

```bash
bash scripts/build-extension-zip.sh
```

Then publish it. The `Release extension` workflow does this automatically for
any tag that starts with `v`, so the usual path is:

```bash
git tag v0.1.1
git push origin v0.1.1
```

That attaches `dist/ravennow-extension.zip` to a fresh release. The stable
download URL stays
`https://github.com/mithustar39/ravennow/releases/latest/download/ravennow-extension.zip`.

## 5. Verify

- `https://<your-host>/api/v1/health` returns `{"status": "ok", ...}`.
- `/health`, `/robots.txt`, `/sitemap.xml` and `/og.png` respond.
- Load the rebuilt extension unpacked, run a sync on Brightspace, and confirm
  deadlines appear in the side panel and on `/app`.
