# Store listing kit

Raven Scheduling ships through the no-store install flow (see `/install`). This folder
keeps the store submission material ready for whenever it is worth publishing to
the Chrome Web Store or Microsoft Edge Add-ons. Nothing here is required for the
current install flow.

The same zip works for both stores.

## Build the zip

```powershell
.\scripts\build-extension-zip.ps1     # Windows
```
```bash
./scripts/build-extension-zip.sh      # macOS / Linux
```

Both write `dist/ravennow-extension.zip` with `manifest.json` at the root, which
is what the stores expect. `dist/` is gitignored.

Pushing a tag like `v0.1.0` also builds the zip and attaches it to a GitHub
release (`.github/workflows/release-extension.yml`). That asset is what the
install page downloads from:

```
https://github.com/mithustar39/ravennow/releases/latest/download/ravennow-extension.zip
```

## Submit

Chrome Web Store: <https://chrome.google.com/webstore/devconsole> (one-time
developer fee).
Microsoft Edge Add-ons: <https://partner.microsoft.com/dashboard/microsoftedge/>
(free, and a good fit for a student project).

After a listing is live, set `RAVENNOW_CHROME_STORE_URL` so the site switches
from the install page to the store button.

## Listing text

- Name: `Raven Scheduling: Carleton deadlines`
- Short description: `Every Brightspace deadline in one side panel, kept up to date when a prof moves a due date.`
- Category: Productivity
- Language: English

Detailed description:

> Raven Scheduling puts your Brightspace deadlines in a side panel so you can see what
> is due without digging through course pages.
>
> It reads the courses you are already signed in to, lists every assignment,
> quiz, lab and discussion, and groups them by week. When a prof moves a due
> date, the old date is crossed out and the item moves to the week it is due
> now, even if you missed the announcement.
>
> What it does:
> - Every deadline in one list, grouped by week
> - Moved dates are caught and shown as changes
> - Reminders you control
> - No account and no personal information, just an anonymous device token
>
> Raven Scheduling reads Brightspace using the session you already have. It never asks
> for your password. It is not affiliated with or endorsed by D2L Corporation or
> Carleton University.

## Permission justifications

Use these when the store asks why each permission is needed.

- `storage`: saves your settings and the anonymous token on your device.
- `alarms`: runs the periodic sync so due date changes are caught.
- `sidePanel`: shows the deadline list next to the page.
- `notifications`: tells you when a due date moves.
- `tabs`: reads the active Brightspace tab when you ask for a manual scan.
- `scripting`: injects the deadline reader into Brightspace pages.
- Host access to `https://brightspace.carleton.ca/*`: reads your deadlines.
- Optional `https://*/*` and `http://*/*`: lets you point the extension at your
  own backend instead of the default one.

Single purpose: show a student their Brightspace deadlines and flag changes.

## Privacy questionnaire notes

- Data collected: course names and codes, assignment titles, types and due
  dates, plus which items you checked off. Nothing else.
- Not collected: name, email, student number, password, grades, submissions or
  browsing history outside Brightspace.
- Data is not sold and is not used for advertising.
- Data is transferred over HTTPS to operate the service.
- Deletion request: `hello@ravennow.ca` (see the site's privacy page).
- Remote code: none. Everything runs from the packaged files.
