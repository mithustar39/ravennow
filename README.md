# RavenNow

**Your Brightspace deadlines, in a browser side panel, kept up to date when profs move them.**

RavenNow is a Carleton-focused take on [WATnow](https://watnow.ugmi.ca/). A small
Chrome/Edge extension reads the deadlines from the Brightspace pages you are
already signed in to, and a Python backend normalizes them, stores them, and
detects when a due date changes. The result: one clean list of assignments,
labs, quizzes and discussions that stays correct all term.

- Built for **Carleton University** (Brightspace only).
- **Python-first**: FastAPI does the parsing, change tracking, reminders and site serving.
- **shadcn/ui** frontend (React + Tailwind), built to static files the Python app serves.
- **No account, no personal information**: anonymous device tokens only.

> RavenNow is not affiliated with or endorsed by D2L Corporation or Carleton
> University. "Brightspace" is a product of D2L Corporation.

---

## Architecture

```
 ┌────────────────────────┐        scrape (session cookies)        ┌────────────────────────┐
 │  Chrome/Edge extension │ ─────────────────────────────────────▶ │  brightspace.carleton  │
 │  content script        │                                        │  (D2L REST API)        │
 │  side panel            │ ◀── deadlines ───────────────────────── └────────────────────────┘
 └───────────┬────────────┘
             │  POST /api/v1/scrape   (Bearer token)
             ▼
 ┌──────────────────────────────────────────────────────────────────────────────────────┐
 │  FastAPI backend  |  normalize → upsert → diff  |  SQLite/Postgres                    │
 │  serves the shadcn/ui landing page, dashboard and privacy policy                      │
 └──────────────────────────────────────────────────────────────────────────────────────┘
```

- **Extension** (`extension/`): MV3. Reads Brightspace's own REST API from the page
  (same-origin, using your existing session) and posts deadlines to the backend.
  Falls back to DOM scraping if the API is unavailable.
- **Backend** (`backend/app/`): FastAPI + SQLAlchemy. Anonymous accounts, deadline
  normalization, change detection, reminders, feedback inbox, and the JSON API.
- **Frontend** (`frontend/`): React + Tailwind + shadcn/ui components, built into
  `backend/static/` so the Python app serves everything from one process.

---

## Quickstart

You need **Python 3.11+** and **Node 18+**.

```bash
# 1. Backend deps
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt   # Windows
# source .venv/bin/activate && pip install -r requirements.txt   # macOS/Linux

# 2. Build the frontend (writes backend/static/)
cd frontend && npm install && npm run build && cd ..

# 3. Run the API + site
.venv/Scripts/python -m uvicorn app.main:app --app-dir backend --reload
```

Open <http://127.0.0.1:8000>.

Or use the helper script (creates the venv, installs deps, builds if needed):

```powershell
.\scripts\dev.ps1              # Windows PowerShell
```
```bash
./scripts/dev.sh               # macOS / Linux
```

### Frontend development

For hot-reload while editing the UI, run the Vite dev server (it proxies `/api`
to the FastAPI app):

```bash
cd frontend && npm run dev     # http://localhost:5173
```

---

## Loading the extension

1. Open `chrome://extensions` (or `edge://extensions`) and enable **Developer mode**.
2. Click **Load unpacked** and select the **`extension/`** folder.
3. Click the RavenNow icon to open the side panel.
4. Open <https://brightspace.carleton.ca/> once and sign in. The panel fills in;
   hit refresh to sync manually.
5. In the extension **options** page, set the **API base URL** to your backend
   (e.g. `https://ravennow.onrender.com`) and save. Copy the token from there if
   you want to use the web dashboard.

There is no store listing yet, so you can skip the manual work with the helper
scripts. They download the latest release zip, unpack it to a stable folder and
open the extensions page:

```powershell
irm https://raw.githubusercontent.com/mithustar39/ravennow/main/scripts/install-extension.ps1 | iex
```
```bash
curl -fsSL https://raw.githubusercontent.com/mithustar39/ravennow/main/scripts/install-extension.sh | bash
```

The site walks through the same steps at `/install`. If you do want a store
listing later, the submission kit is in `store/listing.md` and the zip is built
with `scripts/build-extension-zip.*`.

> The D2L REST endpoints live in `extension/src/content/brightspace.js`
> (`LE_VERSIONS`, path arrays). If Carleton changes its Brightspace routes, add
> the new paths there. Nothing else needs to change.

---

## API

| Method | Path                          | Auth | Purpose                                |
| ------ | ----------------------------- | ---- | -------------------------------------- |
| GET    | `/api/v1/health`              | -    | Liveness + environment                 |
| GET    | `/api/v1/meta`                | -    | Public config for the landing page     |
| GET    | `/api/v1/schools`             | -    | Supported schools                      |
| POST   | `/api/v1/accounts`            | -    | Register an anonymous device → token   |
| GET    | `/api/v1/me`                  | ✓    | Account info + settings                |
| POST   | `/api/v1/scrape`              | ✓    | Upsert scraped deadlines; returns diffs|
| GET    | `/api/v1/deadlines`           | ✓    | List deadlines                         |
| POST   | `/api/v1/deadlines/{id}/check`| ✓    | Check / uncheck an item                |
| GET    | `/api/v1/changes`             | ✓    | Recent change events                   |
| GET/PUT| `/api/v1/settings`            | ✓    | Reminder settings                      |
| GET    | `/api/v1/reminders`           | ✓    | Upcoming reminders                     |
| POST   | `/api/v1/feedback`            | -    | Feedback / feature requests            |
| POST   | `/api/v1/dev/seed`            | ✓    | Demo data (disabled in production)     |

Interactive docs at `/docs` when the server is running.

---

## Deploying

The `Dockerfile` is multi-stage: it builds the React/shadcn frontend with Node,
then copies the output into the Python image. Every platform below uses it.

- **Render**: push to GitHub, then *New → Blueprint* and pick `render.yaml`.
  It provisions the web service plus a free Postgres database.
- **Railway**: *New Project → Deploy from GitHub*; `railway.json` is detected.
  Add a Postgres plugin and Railway sets `DATABASE_URL` (map it to `RAVENNOW_DB`).
- **Fly.io**: `fly launch` (uses `fly.toml`), then
  `fly volumes create ravennow_data --size 1` for persistent SQLite.
- **Docker anywhere**: `docker compose up --build`.

Set at least `RAVENNOW_SECRET` in production. `postgres://` and
`postgresql://` URLs are normalized to the psycopg driver automatically.

### Configuration

Copy `.env.example` to `.env` (local) or set these in your host's dashboard:

| Variable                   | Default                        | Notes                                   |
| -------------------------- | ------------------------------ | --------------------------------------- |
| `RAVENNOW_SECRET`          | dev value                      | **Set this in production.**             |
| `RAVENNOW_ENV`             | `development`                  | `production` disables the demo seed.    |
| `RAVENNOW_DB`              | local SQLite                   | Postgres URL for production.            |
| `RAVENNOW_CORS_ORIGINS`    | `*`                            | Lock down once you have a fixed origin. |
| `RAVENNOW_SUPPORT_EMAIL`   | `hello@ravennow.ca`            | Shown in the footer + privacy page.     |
| `RAVENNOW_CHROME_STORE_URL`| *(empty)*                      | Enables the store button when set.      |
| `RAVENNOW_GITHUB_URL`      | `github.com/mithustar39/ravennow` | Shown in the header/footer.          |
| `RAVENNOW_EXTENSION_URL`   | latest GitHub release          | Zip downloaded by `/install`.           |
| `RAVENNOW_INSTALLER_PS1_URL`| raw GitHub                    | PowerShell installer shown on `/install`.|
| `RAVENNOW_INSTALLER_SH_URL`| raw GitHub                     | Shell installer shown on `/install`.    |

---

## Tests

```bash
.venv/Scripts/python -m pytest -q
```

Covers date parsing, normalization, change detection (reschedules, removals,
submissions) and the API surface.

---

## Project layout

```
backend/app/         FastAPI app (config, db, normalize, tracking, security, main)
backend/static/      Built frontend (generated by `npm run build`)
frontend/            React + Tailwind + shadcn/ui source
extension/           Chrome/Edge MV3 extension (side panel + Brightspace reader)
store/               Store listing kit (Chrome Web Store / Edge Add-ons)
scripts/             dev helpers + icon generator + installer scripts
tests/               pytest suite
Dockerfile           Multi-stage build (Node → Python)
render.yaml / fly.toml / railway.json / docker-compose.yml
```

---

## Roadmap

- Publish to the Chrome Web Store (set `RAVENNOW_CHROME_STORE_URL`).
- Verify and harden the Brightspace API paths against the live Carleton instance.
- Optional email digest of upcoming deadlines.
- Firefox / Safari builds.

---

## License

No license yet. Add one (MIT is a good default for a student project like this)
before others reuse the code.
