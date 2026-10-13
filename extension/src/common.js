/**
 * Shared helpers for RavenNow content scripts.
 *
 * Content scripts run in an isolated world, but files injected into the same
 * frame share it, so `window.RN` defined here is visible to brightspace.js.
 */
(function () {
  "use strict";

  const RN = {
    DEBUG: false,

    log(...args) {
      if (RN.DEBUG) console.debug("[RavenNow]", ...args);
    },

    /** Collapse whitespace in a DOM node's text. */
    text(el) {
      if (!el) return "";
      return (el.textContent || "").replace(/\s+/g, " ").trim();
    },

    /** Resolve a possibly-relative URL against the current page. */
    absolute(href) {
      if (!href) return "";
      try {
        return new URL(href, location.href).href;
      } catch (err) {
        return href;
      }
    },

    /** Parse a date-ish string to an ISO-8601 UTC string, or null. */
    toIso(value) {
      if (!value) return null;
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return null;
      return date.toISOString();
    },

    /** Send a scrape payload to the background service worker. */
    deliver(payload) {
      return new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ type: "RAVENNOW_SCRAPE", payload }, (resp) => {
            // Reading lastError prevents "Unchecked runtime.lastError" noise
            // when the service worker is asleep or gone.
            void chrome.runtime.lastError;
            resolve(resp);
          });
        } catch (err) {
          RN.log("deliver failed", err);
          resolve(null);
        }
      });
    },

    /**
     * Register the standard message listener used by both content scripts.
     * The background asks for a fresh collect on its 30-minute alarm.
     */
    listen(collect) {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (!msg || msg.type !== "RAVENNOW_COLLECT") return undefined;
        Promise.resolve()
          .then(collect)
          .then((payload) => sendResponse({ ok: true, payload }))
          .catch((err) => sendResponse({ ok: false, error: String(err) }));
        return true; // keep the channel open for the async response
      });
    },
  };

  window.RN = RN;
})();
