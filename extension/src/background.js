/**
 * Raven Scheduling background service worker.
 *
 * Responsibilities:
 *  - Keep an anonymous account token (register once, no PII).
 *  - Post scraped deadlines to the Raven Scheduling API and store the result.
 *  - Poll supported sites every 30 minutes and notify on due-date changes.
 *  - Act as the only component that talks to the network on behalf of the UI.
 */

const DEFAULTS = {
  api_base: "http://localhost:8000",
  school: "carleton",
  device_label: "",
  token: "",
  account_id: null,
  last_sync_at: null,
  last_result: null,
  last_error: null,
  last_diag: null,
  last_diag_at: null,
};

const SUPPORTED_PATTERNS = [
  /^https:\/\/brightspace\.carleton\.ca\//i,
];

const SYNC_ALARM = "ravennow-sync";
const SYNC_PERIOD_MINUTES = 30;

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------
async function getConfig() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

async function setConfig(patch) {
  await chrome.storage.local.set(patch);
}

function apiBase(cfg) {
  return (cfg.api_base || DEFAULTS.api_base).replace(/\/+$/, "");
}

function isSupported(url) {
  return !!url && SUPPORTED_PATTERNS.some((re) => re.test(url));
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------
async function ensureAccount(force = false) {
  const cfg = await getConfig();
  if (cfg.token && !force) return cfg;

  const res = await fetch(apiBase(cfg) + "/api/v1/accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      device_label: cfg.device_label || "Raven Scheduling extension",
      school: cfg.school || "carleton",
    }),
  });
  if (!res.ok) throw new Error("Could not register device (" + res.status + ")");
  const data = await res.json();
  await setConfig({ token: data.token, account_id: data.account_id, school: data.school });
  return { ...cfg, token: data.token, account_id: data.account_id };
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------
async function postScrape(payload) {
  if (!payload) return null;
  let cfg = await ensureAccount();
  const url = apiBase(cfg) + "/api/v1/scrape";

  // Keep the diagnostics locally; the server does not need them.
  const { diag, ...body } = payload;
  if (diag) await setConfig({ last_diag: diag, last_diag_at: new Date().toISOString() });

  let res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + cfg.token,
    },
    body: JSON.stringify(body),
  });

  if (res.status === 401) {
    cfg = await ensureAccount(true); // token rotated / cleared server-side
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + cfg.token,
      },
      body: JSON.stringify(body),
    });
  }

  if (!res.ok) throw new Error("Sync failed (" + res.status + ")");
  return finishScrape(await res.json());
}

async function finishScrape(result) {
  const changes = (result && result.changes) || [];
  const important = changes.filter(
    (c) => c.kind === "due_changed" || c.kind === "due_removed"
  );

  if (important.length && chrome.notifications) {
    const first = important[0];
    const message = first.new_due
      ? `${first.title} moved to ${new Date(first.new_due).toLocaleString()}`
      : `${first.title} no longer has a due date`;
    try {
      chrome.notifications.create("ravennow-" + Date.now(), {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title:
          important.length > 1
            ? `${important.length} deadlines changed`
            : "A due date changed",
        message,
      });
    } catch (err) {
      /* notifications are best-effort */
    }
  }

  await setConfig({
    last_sync_at: new Date().toISOString(),
    last_result: result,
    last_error: null,
  });
  return result;
}

/** Ask every open supported tab to scrape, then post what it returns. */
async function scrapeOpenTabs() {
  const tabs = await chrome.tabs.query({});
  const targets = tabs.filter((t) => t.id != null && isSupported(t.url));
  const summary = [];

  for (const tab of targets) {
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, {
        type: "RAVENNOW_COLLECT",
      });
      if (resp && resp.ok && resp.payload) {
        await postScrape(resp.payload);
        summary.push({ url: tab.url, ok: true });
      } else {
        summary.push({ url: tab.url, ok: false, error: resp && resp.error });
      }
    } catch (err) {
      summary.push({ url: tab.url, ok: false, error: String(err) });
    }
  }

  if (!targets.length) {
    await setConfig({ last_error: "No Brightspace tab is open." });
  }
  return { synced: summary.length, summary };
}

// ---------------------------------------------------------------------------
// Network helpers for the UI (panel + options talk only to the worker)
// ---------------------------------------------------------------------------
async function apiFetch(path, options = {}) {
  const cfg = await ensureAccount();
  const res = await fetch(apiBase(cfg) + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + cfg.token,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error("Request failed (" + res.status + ")");
  return res.json();
}

async function getState() {
  const cfg = await getConfig();
  return {
    connected: !!cfg.token,
    account_id: cfg.account_id,
    token: cfg.token,
    school: cfg.school,
    api_base: cfg.api_base,
    device_label: cfg.device_label,
    last_sync_at: cfg.last_sync_at,
    last_error: cfg.last_error,
    last_result: cfg.last_result,
    last_diag: cfg.last_diag,
    last_diag_at: cfg.last_diag_at,
  };
}

async function testConnection(base) {
  const cfg = await getConfig();
  const url = (base || apiBase(cfg)).replace(/\/+$/, "");
  const res = await fetch(url + "/api/v1/health", {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error("Health check failed (" + res.status + ")");
  return res.json();
}

async function saveConfig(patch) {
  await setConfig(patch);
  return getState();
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const type = msg && msg.type;

  (async () => {
    try {
      switch (type) {
        case "RAVENNOW_SCRAPE":
          return sendResponse({ ok: true, result: await postScrape(msg.payload) });

        case "RAVENNOW_SYNC":
          return sendResponse({ ok: true, ...(await scrapeOpenTabs()) });

        case "RAVENNOW_GET_STATE":
          return sendResponse({ ok: true, state: await getState() });

        case "RAVENNOW_GET_DEADLINES":
          return sendResponse({
            ok: true,
            deadlines: await apiFetch("/api/v1/deadlines"),
          });

        case "RAVENNOW_GET_CHANGES":
          return sendResponse({
            ok: true,
            changes: await apiFetch("/api/v1/changes"),
          });

        case "RAVENNOW_CHECK":
          return sendResponse({
            ok: true,
            deadline: await apiFetch(`/api/v1/deadlines/${msg.id}/check`, {
              method: "POST",
              body: JSON.stringify({ checked: !!msg.checked }),
            }),
          });

        case "RAVENNOW_TEST":
          await ensureAccount();
          return sendResponse({ ok: true, health: await testConnection(msg.api_base) });

        case "RAVENNOW_SAVE_CONFIG":
          return sendResponse({ ok: true, state: await saveConfig(msg.patch || {}) });

        case "RAVENNOW_RESET":
          await setConfig({ token: "", account_id: null, last_result: null, last_error: null });
          return sendResponse({ ok: true, state: await getState() });

        default:
          return sendResponse({ ok: false, error: "Unknown message: " + type });
      }
    } catch (err) {
      await setConfig({ last_error: String(err) });
      return sendResponse({ ok: false, error: String(err) });
    }
  })();

  return true; // async response
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
chrome.runtime.onInstalled.addListener(async () => {
  await setConfig({});
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_PERIOD_MINUTES });
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch(() => {});
  }
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_PERIOD_MINUTES });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== SYNC_ALARM) return;
  scrapeOpenTabs().catch((err) => setConfig({ last_error: String(err) }));
});
