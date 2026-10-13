// RavenNow options page. Reads/writes config through the background worker.
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
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return setStatus("No active tab.", "error");
    if (!/^https:\/\/brightspace\.carleton\.ca\//i.test(tab.url || "")) {
      $("diag").textContent = "Active tab is not a Brightspace page.\nOpen https://brightspace.carleton.ca/ and try again.";
      return;
    }

    $("diag").textContent = "Scanning…";
    setStatus("");
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { type: "RAVENNOW_COLLECT" });
      if (!resp || !resp.ok) throw new Error((resp && resp.error) || "Collect failed");
      const payload = resp.payload || {};
      const result = await send("RAVENNOW_SCRAPE", { payload });
      $("diag").textContent =
        "courses: " + (payload.courses ? payload.courses.length : 0) +
        "\nitems read: " + (payload.items ? payload.items.length : 0) +
        "\nposted: " + JSON.stringify(result.result && result.result.changes ? {
          new: result.result.new,
          updated: result.result.updated,
          changes: result.result.changes.length,
        } : {});
      setStatus("Scan complete.", "ok");
      await refresh();
    } catch (err) {
      $("diag").textContent = String(err.message || err);
      setStatus("Scan failed.", "error");
    }
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
