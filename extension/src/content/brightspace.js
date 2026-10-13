/**
 * Brightspace (D2L) collector for Carleton.
 *
 * Strategy: prefer D2L's own REST API, called from the page with the student's
 * existing session cookies (`credentials: "include"`). This is far more stable
 * than DOM scraping. If the API is unavailable we fall back to reading the
 * rendered page.
 *
 * The API version is discovered at runtime from `/d2l/api/versions/`, because
 * the supported versions differ between D2L instances and change over time.
 * Fallback versions are kept in case discovery is blocked.
 *
 * Every call is wrapped so one failure never aborts the whole sync, and a
 * small `diag` summary is attached to the payload so the options page can show
 * what actually happened.
 */
(function () {
  "use strict";

  const RN = window.RN;
  if (!RN) return;

  const MAX_COURSES = 40;
  const MAX_ATTEMPTS = 80;
  const DEFAULT_LP_VERSIONS = ["1.4", "1.0"];
  const DEFAULT_LE_VERSIONS = ["1.6", "1.5", "1.4", "1.0"];

  const diag = {
    lpVersions: [],
    leVersions: [],
    attempts: [],
  };

  function note(path, status, ok) {
    if (diag.attempts.length < MAX_ATTEMPTS) {
      diag.attempts.push({ path, status, ok });
    }
  }

  async function d2l(path) {
    const res = await fetch(path, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      note(path, res.status, false);
      const err = new Error(path + " => " + res.status);
      err.status = res.status;
      throw err;
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (err) {
      // A login redirect returns HTML with a 200; treat it as a miss.
      note(path, "not-json", false);
      throw err;
    }
    note(path, res.status, true);
    return data;
  }

  /** Try each candidate path until one returns JSON. */
  async function d2lAny(paths) {
    for (const path of paths) {
      try {
        const data = await d2l(path);
        if (data) return data;
      } catch (err) {
        RN.log("d2l miss", path, err.status || err.message);
      }
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // API version discovery
  // -------------------------------------------------------------------------
  let lpVersions = DEFAULT_LP_VERSIONS.slice();
  let leVersions = DEFAULT_LE_VERSIONS.slice();
  let versionDiscovery = null;

  function discoverVersions() {
    if (!versionDiscovery) {
      versionDiscovery = (async () => {
        try {
          const data = await d2lAny(["/d2l/api/versions/"]);
          const list = (data && (data.Versions || data.versions)) || [];
          const pick = (code) => {
            const entry = list.find(
              (p) =>
                String(p.ProductCode || p.productCode || "").toLowerCase() === code
            );
            if (!entry) return [];
            const latest = entry.LatestVersion || entry.latestVersion;
            const supported =
              entry.SupportedVersions || entry.supportedVersions || [];
            const ordered = [];
            if (latest) ordered.push(latest);
            for (const value of supported.slice().reverse()) ordered.push(value);
            return [...new Set(ordered)].slice(0, 4);
          };
          const lp = pick("lp");
          const le = pick("le");
          if (lp.length) lpVersions = lp;
          if (le.length) leVersions = le;
        } catch (err) {
          RN.log("version discovery failed", err);
        }
        diag.lpVersions = lpVersions.slice();
        diag.leVersions = leVersions.slice();
      })();
    }
    return versionDiscovery;
  }

  // -------------------------------------------------------------------------
  // API collectors
  // -------------------------------------------------------------------------
  async function getCourses() {
    await discoverVersions();
    const data = await d2lAny(
      lpVersions.map((v) => `/d2l/api/lp/${v}/enrollments/myenrollments/`)
    );
    const items = (data && (data.Items || data.items)) || [];
    return items
      .map((entry) => {
        const ou = entry.OrgUnit || entry.orgUnit || entry;
        const type = ou.Type || ou.type || {};
        const typeCode = type.Code || type.code || "";
        return {
          id: String(ou.Id ?? ou.id ?? ""),
          name: ou.Name || ou.name || "",
          code: ou.Code || ou.code || "",
          typeCode,
        };
      })
      .filter((c) => c.id && c.name)
      .filter((c) => !c.typeCode || c.typeCode === "Course Offering")
      .slice(0, MAX_COURSES);
  }

  function window_() {
    const now = Date.now();
    return {
      start: new Date(now - 7 * 864e5).toISOString(),
      end: new Date(now + 150 * 864e5).toISOString(),
    };
  }

  async function getCalendarEvents(course) {
    await discoverVersions();
    const { start, end } = window_();
    const query =
      "?startDateTime=" +
      encodeURIComponent(start) +
      "&endDateTime=" +
      encodeURIComponent(end);
    const paths = [];
    for (const version of leVersions) {
      paths.push(
        `/d2l/api/le/${version}/${course.id}/calendar/events/myEvents/${query}`
      );
      paths.push(`/d2l/api/le/${version}/${course.id}/calendar/events/${query}`);
    }
    const data = await d2lAny(paths);
    if (!Array.isArray(data)) return [];
    return data
      .filter((e) => e && (e.StartDateTime || e.EndDateTime))
      .map((e) => ({
        title: e.Title || e.title || "Untitled",
        due: e.EndDateTime || e.StartDateTime,
        url: e.Url || e.url || courseUrl(course),
        type: "other",
      }));
  }

  async function getDropbox(course) {
    await discoverVersions();
    const data = await d2lAny(
      leVersions.map((v) => `/d2l/api/le/${v}/${course.id}/dropbox/folders/`)
    );
    if (!Array.isArray(data)) return [];
    return data
      .filter((f) => f && f.Name)
      .map((f) => ({
        title: f.Name,
        due: f.DueDate || f.dueDate || null,
        url: courseUrl(course, "/dropbox/"),
        type: "assignment",
      }));
  }

  async function getQuizzes(course) {
    await discoverVersions();
    const data = await d2lAny(
      leVersions.map((v) => `/d2l/api/le/${v}/${course.id}/quizzes/`)
    );
    const objects = data && (data.Objects || data.objects);
    if (!Array.isArray(objects)) return [];
    return objects
      .filter((q) => q && q.Name)
      .map((q) => ({
        title: q.Name,
        due: q.DueDate || q.dueDate || null,
        url: courseUrl(course, "/quizzes/"),
        type: "quiz",
      }));
  }

  function courseUrl(course, suffix = "") {
    return RN.absolute(`/d2l/home/${course.id}${suffix ? "#" + suffix : ""}`);
  }

  // -------------------------------------------------------------------------
  // DOM fallback (used only when the API returns no courses)
  // -------------------------------------------------------------------------
  function collectFromDom() {
    const courses = [];
    const items = [];
    const seen = new Set();

    const anchors = document.querySelectorAll(
      'a[href*="/dropbox/"], a[href*="/quiz/"], a[href*="/discussions/"]'
    );
    anchors.forEach((a) => {
      const title = RN.text(a);
      if (!title || title.length > 200) return;
      const container =
        a.closest("li, tr, .d2l-datalist-item, .d2l-rowshadeonhover, div") ||
        a.parentElement;
      const context = RN.text(container).slice(0, 400);

      // Look for a date anywhere near the link.
      const match = context.match(
        /(\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?)|(?:[A-Z][a-z]{2,8}\s+\d{1,2},\s*\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?)/i
      );
      const key = title.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);

      const href = a.getAttribute("href") || "";
      let type = "other";
      if (href.includes("/dropbox/")) type = "assignment";
      else if (href.includes("/quiz/")) type = "quiz";
      else if (href.includes("/discussions/")) type = "discussion";

      items.push({
        title,
        due: match ? match[0] : null,
        url: RN.absolute(href),
        type,
      });
    });

    diag.usedDom = true;
    diag.domItems = items.length;

    return {
      school: "carleton",
      source: "brightspace",
      captured_at: new Date().toISOString(),
      courses,
      items,
    };
  }

  async function collect() {
    const courses = await getCourses();

    if (!courses.length) {
      RN.log("no courses via API; using DOM fallback");
      return collectFromDom();
    }

    const items = [];
    for (const course of courses) {
      const [calendar, dropbox, quizzes] = await Promise.all([
        getCalendarEvents(course).catch(() => []),
        getDropbox(course).catch(() => []),
        getQuizzes(course).catch(() => []),
      ]);

      const push = (entry, source) => {
        if (!entry || !entry.title) return;
        items.push({
          source,
          course_external_id: course.id,
          course_name: course.name,
          title: entry.title,
          type: entry.type,
          due: entry.due,
          url: entry.url,
          submitted: false,
        });
      };

      calendar.forEach((e) => push(e, "brightspace"));
      dropbox.forEach((e) => push(e, "brightspace"));
      quizzes.forEach((e) => push(e, "brightspace"));
    }

    return {
      school: "carleton",
      source: "brightspace",
      captured_at: new Date().toISOString(),
      courses: courses.map((c) => ({
        source: "brightspace",
        external_id: c.id,
        name: c.name,
        code: c.code,
      })),
      items,
    };
  }

  async function run() {
    try {
      const payload = await collect();
      diag.courses = payload.courses ? payload.courses.length : 0;
      diag.items = payload.items ? payload.items.length : 0;
      payload.diag = diag;
      RN.log("collected", payload.items.length, "items");
      return payload;
    } catch (err) {
      RN.log("collect failed", err);
      return null;
    }
  }

  RN.listen(run);

  // Initial pass, and again if Brightspace is a single-page app that mutates
  // the URL without a reload.
  setTimeout(() => run().then((p) => p && RN.deliver(p)), 2000);
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(() => run().then((p) => p && RN.deliver(p)), 1500);
    }
  }, 3000);
})();
