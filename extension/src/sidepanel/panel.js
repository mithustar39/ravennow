// Raven Scheduling side panel. Talks only to the background service worker.
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  function send(type, extra) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ type, ...(extra || {}) }, (resp) => {
          const err = chrome.runtime.lastError;
          if (err) return reject(new Error(err.message));
          if (!resp || resp.ok === false) {
            return reject(new Error((resp && resp.error) || "Request failed"));
          }
          resolve(resp);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  function setStatus(text, isError) {
    const el = $("status");
    el.textContent = text;
    el.classList.toggle("error", !!isError);
  }

  function startOfWeek(date) {
    const d = new Date(date);
    const day = (d.getDay() + 6) % 7;
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - day);
    return d;
  }

  function fmt(dateStr, withTime) {
    if (!dateStr) return "No date";
    const d = new Date(dateStr);
    const opts = withTime
      ? { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
      : { weekday: "short", month: "short", day: "numeric" };
    return d.toLocaleString(undefined, opts);
  }

  // -------------------------------------------------------------------------
  // Deadlines
  // -------------------------------------------------------------------------
  function renderDeadlines(deadlines) {
    const view = $("view-deadlines");
    view.innerHTML = "";

    if (!deadlines.length) {
      view.innerHTML =
        '<p class="empty">No deadlines yet.<br>Open Brightspace once, then hit ⟳ to sync.</p>';
      return;
    }

    const weeks = new Map();
    for (const d of deadlines) {
      const key = d.due_at ? startOfWeek(d.due_at).toISOString() : "none";
      if (!weeks.has(key)) weeks.set(key, []);
      weeks.get(key).push(d);
    }

    [...weeks.keys()].sort().forEach((key) => {
      const section = document.createElement("section");
      section.className = "week";

      const heading = document.createElement("h2");
      if (key === "none") {
        heading.textContent = "No due date";
      } else {
        const start = new Date(key);
        const end = new Date(start);
        end.setDate(end.getDate() + 6);
        const sameMonth = start.getMonth() === end.getMonth();
        heading.textContent =
          start.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
          " to " +
          end.toLocaleDateString(undefined, sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" });
      }
      section.appendChild(heading);

      weeks.get(key).forEach((d) => section.appendChild(renderItem(d)));
      view.appendChild(section);
    });
  }

  function renderItem(d) {
    const row = document.createElement("div");
    row.className = "item" + (d.changed ? " changed" : "") + (d.checked ? " done" : "");

    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = !!d.checked;
    box.title = "Mark as done";
    box.addEventListener("change", async () => {
      try {
        await send("RAVENNOW_CHECK", { id: d.id, checked: box.checked });
        row.classList.toggle("done", box.checked);
      } catch (err) {
        box.checked = !box.checked;
      }
    });

    const body = document.createElement("div");
    body.className = "body";

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = d.title;
    body.appendChild(title);

    if (d.course_name || d.source) {
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = d.course_name || d.source;
      body.appendChild(meta);
    }

    const due = document.createElement("div");
    due.className = "due";
    due.textContent = fmt(d.due_at, true);
    body.appendChild(due);

    if (d.changed && d.previous_due_at) {
      const moved = document.createElement("div");
      moved.className = "new-due";
      moved.textContent = "was " + fmt(d.previous_due_at, false);
      body.appendChild(moved);
    }

    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = d.type;

    row.appendChild(box);
    row.appendChild(body);
    row.appendChild(pill);

    if (d.url) {
      row.style.cursor = "pointer";
      row.title = "Open in Brightspace";
      row.addEventListener("click", (event) => {
        if (event.target === box) return;
        chrome.tabs.create({ url: d.url });
      });
    }
    return row;
  }

  // -------------------------------------------------------------------------
  // Changes
  // -------------------------------------------------------------------------
  const KIND_LABEL = {
    added: "New deadline",
    due_changed: "Due date changed",
    due_removed: "Due date removed",
    due_added: "Due date added",
    submitted: "Submitted",
  };

  function renderChanges(changes) {
    const view = $("view-changes");
    view.innerHTML = "";

    const interesting = changes.filter((c) => c.kind !== "added");
    if (!interesting.length) {
      view.innerHTML = '<p class="empty">No changes detected yet.</p>';
      return;
    }

    interesting.forEach((c) => {
      const box = document.createElement("div");
      box.className = "change";

      const kind = document.createElement("div");
      kind.className = "kind";
      kind.textContent = KIND_LABEL[c.kind] || c.kind;

      const title = document.createElement("div");
      title.className = "change-title";
      title.textContent = c.title || "";

      const when = document.createElement("div");
      when.className = "when";
      let line = fmt(c.detected_at, true);
      if (c.kind === "due_changed" && c.new_due) line = "now " + fmt(c.new_due, true) + ". Detected " + line;
      when.textContent = line;

      box.appendChild(kind);
      box.appendChild(title);
      box.appendChild(when);
      view.appendChild(box);
    });
  }

  // -------------------------------------------------------------------------
  // Refresh
  // -------------------------------------------------------------------------
  async function refresh() {
    try {
      const [state, deadlines, changes] = await Promise.all([
        send("RAVENNOW_GET_STATE"),
        send("RAVENNOW_GET_DEADLINES"),
        send("RAVENNOW_GET_CHANGES"),
      ]);

      if (state.state.last_error) {
        setStatus(state.state.last_error, true);
      } else if (state.state.last_sync_at) {
        setStatus("Last synced " + fmt(state.state.last_sync_at, true));
      } else {
        setStatus("Not synced yet. Open Brightspace, then tap refresh.");
      }

      renderDeadlines(deadlines.deadlines);
      renderChanges(changes.changes);
    } catch (err) {
      setStatus(String(err.message || err), true);
    }
  }

  async function sync() {
    const button = $("sync");
    button.classList.add("spin");
    setStatus("Syncing…");
    try {
      const result = await send("RAVENNOW_SYNC");
      if (result.synced === 0) {
        setStatus("No Brightspace tab open. Open one and try again.", true);
      } else {
        setStatus("Synced " + result.synced + " tab(s).");
      }
    } catch (err) {
      setStatus(String(err.message || err), true);
    } finally {
      button.classList.remove("spin");
      refresh();
    }
  }

  // -------------------------------------------------------------------------
  // Wiring
  // -------------------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        const name = tab.dataset.tab;
        $("view-deadlines").classList.toggle("hidden", name !== "deadlines");
        $("view-changes").classList.toggle("hidden", name !== "changes");
      });
    });

    $("sync").addEventListener("click", sync);
    $("options").addEventListener("click", () => chrome.runtime.openOptionsPage());
    $("open-learn").addEventListener("click", () =>
      chrome.tabs.create({ url: "https://brightspace.carleton.ca/" })
    );
    $("open-dashboard").addEventListener("click", async () => {
      try {
        const state = await send("RAVENNOW_GET_STATE");
        chrome.tabs.create({ url: state.state.api_base + "/app" });
      } catch (err) {
        chrome.tabs.create({ url: "http://localhost:8000/app" });
      }
    });

    refresh();
  });
})();
