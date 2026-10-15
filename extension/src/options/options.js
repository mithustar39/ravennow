// Raven Scheduling options page. Reads/writes config through the background worker.
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  function send(type, extra) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, ...(extra || {}) }, (resp) => {
        const err = chrome.runtime.lastError;
        if (err) return reject(new Error(err.message));
        if (!resp || resp.ok === false) {
          return reject(new Error((resp && resp.error) || "Request failed"));
        }
        resolve(resp);
      });
    });
  }

  function setStatus(text, kind) {
    const el = $("status");
    el.textContent = text || "";
    el.className = "status" + (kind ? " " + kind : "");
  }

  function normalizeBase(value) {
    const url = new URL(value.trim());
    if (!/^https?:$/.test(url.protocol)) throw new Error("URL must start with http:// or https://");
    return url.origin + url.pathname.replace(/\/+$/, "");
  }

  async function refresh() {
    const { state } = await send("RAVENNOW_GET_STATE");
    $("api_base").value = state.api_base || "";
    $("school").value = state.school || "carleton";
    $("device_label").value = state.device_label || "";
    $("token").value = state.token || "";
    $("account_id").textContent = state.account_id ?? "None";
    $("last_sync").textContent = state.last_sync_at
      ? new Date(state.last_sync_at).toLocaleString()
      : "never";

    const link = $("privacy-link");
    if (state.api_base) {
      link.href = state.api_base.replace(/\/+$/, "") + "/privacy";
      link.target = "_blank";
    }

    if (state.last_diag && !$("diag").textContent) {
      $("diag").textContent =
        "Last sync " +
        (state.last_diag_at ? new Date(state.last_diag_at).toLocaleString() : "") +
        "\n" +
        formatDiag(state.last_diag, state.last_result);
    }
    return state;
  }

  async function save() {
    const button = $("save");
    button.disabled = true;
    setStatus("Saving…");
    try {
      const api_base = normalizeBase($("api_base").value);
      const state = await send("RAVENNOW_GET_STATE");

      // Grant access to the chosen origin (must happen in a user gesture).
      try {
        await chrome.permissions.request({ origins: [new URL(api_base).origin + "/*"] });
      } catch {
        /* request may be auto-denied; fetch will surface the real problem */
      }

      const patch = {
        api_base,
        school: $("school").value,
        device_label: $("device_label").value.trim(),
      };
      if (state.state.api_base !== api_base) {
        // Different server: drop the old token so a fresh account is created.
        patch.token = "";
        patch.account_id = null;
      }
      await send("RAVENNOW_SAVE_CONFIG", { patch });

      const { health } = await send("RAVENNOW_TEST");
      setStatus("Connected to " + health.app + " (" + health.environment + ").", "ok");
      await refresh();
    } catch (err) {
      setStatus(String(err.message || err), "error");
    } finally {
      button.disabled = false;
    }
  }

  async function test() {
    const button = $("test");
    button.disabled = true;
    setStatus("Testing…");
    try {
      const api_base = normalizeBase($("api_base").value);
      await send("RAVENNOW_SAVE_CONFIG", { patch: { api_base } });
      const { health } = await send("RAVENNOW_TEST");
      setStatus("OK: " + health.app + ", " + health.school + ", " + health.environment, "ok");
    } catch (err) {
      setStatus(String(err.message || err), "error");
    } finally {
      button.disabled = false;
    }
  }

  async function scan() {
    const tabs = await chrome.tabs.query({ url: "https://brightspace.carleton.ca/*" });
    if (!tabs.length) {
      $("diag").textContent =
        "No Brightspace tab found.\nOpen https://brightspace.carleton.ca/, sign in, then try again.";
      setStatus("");
      return;
    }
    const tab = tabs.find((t) => t.active) || tabs[0];

    $("diag").textContent =
      "Scanning " + tab.url + " …\nThis crawls every course's home, announcements, and Content pages, so it can take a minute.";
    setStatus("");
    try {
      let resp;
      try {
        resp = await chrome.tabs.sendMessage(tab.id, {
          type: "RAVENNOW_COLLECT",
          deep: true,
        });
      } catch (err) {
        // The page was opened before the extension loaded, so no content script.
        $("diag").textContent =
          "Could not reach the page script.\nReload the Brightspace tab, then scan again.";
        setStatus("Reload the Brightspace tab, then scan.", "error");
        return;
      }
      if (!resp || !resp.ok) throw new Error((resp && resp.error) || "Collect failed");
      const payload = resp.payload || {};
      const result = await send("RAVENNOW_SCRAPE", { payload });
      $("diag").textContent = formatDiag(payload.diag, result && result.result);
      setStatus("Scan complete.", "ok");
      await refresh();
    } catch (err) {
      $("diag").textContent = String(err.message || err);
      setStatus("Scan failed.", "error");
    }
  }

  function formatDiag(d, result) {
    d = d || {};
    const versions =
      "lp=" + ((d.lpVersions || []).join("/") || "?") +
      "  le=" + ((d.leVersions || []).join("/") || "?");
    const failed = (d.attempts || []).filter((a) => !a.ok);
    const lines = [
      "API versions: " + versions,
      "courses: " + (d.courses ?? "?"),
      "items read: " + (d.items ?? "?"),
    ];
    if (d.pageCourse) {
      lines.push("page course: " + d.pageCourse + " (" + (d.textItems || 0) + " from page text)");
    }
    if (d.deep) {
      lines.push(
        "deep scan: " + (d.deep.pages || 0) + " pages" +
          " (home=" + (d.deep.home || 0) +
          " news=" + (d.deep.news || 0) +
          " content=" + (d.deep.content || 0) + ")"
      );
    } else if (d.deepScan) {
      lines.push("deep scan: requested but no stats");
    }
    if (d.usedDom) lines.push("(used DOM fallback, " + (d.domItems || 0) + " items)");
    if (result) {
      lines.push(
        "posted: new=" + (result.new ?? "?") +
          " updated=" + (result.updated ?? "?") +
          " changes=" + ((result.changes && result.changes.length) || 0)
      );
    }
    if (failed.length) {
      lines.push("failed calls (" + failed.length + "):");
      failed.slice(0, 10).forEach((f) => lines.push("  " + f.status + " " + f.path));
    } else {
      lines.push("failed calls: none");
    }
    return lines.join("\n");
  }

  async function reset() {
    await send("RAVENNOW_RESET");
    $("token").value = "";
    $("diag").textContent = "";
    setStatus("Device reset. It will register again on the next sync.");
    await refresh();
  }

  async function copyToken() {
    // The token itself is never sent to the options page; ask storage directly
    // only to place it on the clipboard on explicit user action.
    const { token } = await chrome.storage.local.get("token");
    if (!token) return setStatus("No token yet. Connect first.", "error");
    await navigator.clipboard.writeText(token);
    setStatus("Token copied to clipboard.", "ok");
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("save").addEventListener("click", save);
    $("test").addEventListener("click", test);
    $("scan").addEventListener("click", scan);
    $("reset").addEventListener("click", reset);
    $("copy").addEventListener("click", copyToken);
    refresh().catch((err) => setStatus(String(err.message || err), "error"));
  });
})();
