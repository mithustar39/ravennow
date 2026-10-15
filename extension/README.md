# Raven Scheduling extension (Chrome / Edge, MV3)

A side panel that reads your Brightspace deadlines and keeps them in sync with
the Raven Scheduling backend.

## Load it

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this `extension/` folder.
3. Click the toolbar icon to open the side panel.

There is no store listing yet. From the repo root you can run
`scripts/install-extension.ps1` (Windows) or `scripts/install-extension.sh`
(macOS/Linux) to download a release and unpack it for you, then follow the same
three steps. The site also walks through this at `/install`.

## Configure

Open the extension **options** (gear icon in the panel, or *Details → Extension
options*):

- **API base URL**: where your backend runs. `http://localhost:8000` for local
  development, or your deployed URL (e.g. `https://ravennow.onrender.com`).
  Saving requests host permission for that origin.
- **School**: Carleton (Brightspace).
- **Test connection**: checks `GET /api/v1/health`.
- **Run a scan on the active tab**: runs a full scan and reports how many items
  were read (useful for debugging). A full scan crawls every course, so it can
  take a minute.
- **Access token**: shown so you can paste it into the web dashboard.

## How it works

- `src/common.js`: shared helpers + the message listener used by the content script.
- `src/content/brightspace.js`: the collector. It has two layers:
  - **API**: reads deadlines from the D2L REST API (`/d2l/api/...`) using your
    existing Brightspace session. Covers dropbox, quizzes, calendar, and Content
    topics that have a structured due date.
  - **Text scan**: many instructors only type due dates into a course outline, a
    content page, or an announcement. The scan reads those pages and pulls out
    any line that names a deadline or assessment and also contains a date. Dates
    without a year are inferred from today.
  - A **shallow** pass reads the API plus the page you are on. A **deep** pass
    (manual sync and the 30-minute alarm) also crawls each course's home page,
    announcements, and Content pages. The backend merges instead of replacing,
    so a shallow pass never erases deep results.
- `src/background.js`: registers an anonymous account, posts scrapes to the
  backend, polls every 30 minutes, and raises a notification when a due date
  changes. It is the only component that makes network requests for the UI.
- `src/sidepanel/`: the panel UI (deadlines grouped by week, changes tab).
- `src/options/`: settings, token, and diagnostics.

## Notes

- API versions are discovered at runtime from `/d2l/api/versions/`; fallbacks
  live in `src/content/brightspace.js`. Deep-crawl bounds (`DEEP_MAX_*`) and the
  deadline keyword/date patterns are in the same file.
- Icons in `icons/` are generated placeholders. Replace them with real artwork
  (run `python scripts/make_icons.py` to regenerate).
- Testing tip: open DevTools → Console and run `RN.DEBUG = true` in the content
  script context to see collection logs.
