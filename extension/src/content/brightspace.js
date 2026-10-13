/**
 * Brightspace (D2L) collector for Carleton.
 *
 * Strategy: prefer D2L's own REST API, called from the page with the student's
 * existing session cookies (`credentials: "include"`). This is far more stable
 * than DOM scraping. If the API is unavailable we fall back to reading the
 * rendered page.
 *
 * NOTE: D2L API paths/versions vary between instances. Each call is wrapped so
 * one failure never aborts the whole sync. If Carleton changes its routes, add
 * them to the arrays below. The rest of the pipeline is unaffected.
 */
(function () {
  "use strict";

  const RN = window.RN;
  if (!RN) return;

  const LE_VERSIONS = ["1.6", "1.5", "1.4", "1.0"];
  const MAX_COURSES = 30;

  async function d2l(path) {
    const res = await fetch(path, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      const err = new Error(path + " => " + res.status);
      err.status = res.status;
      throw err;
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
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

  async function getCourses() {
    const data = await d2lAny([
      "/d2l/api/lp/1.4/enrollments/myenrollments/",
      "/d2l/api/lp/1.0/enrollments/myenrollments/",
    ]);
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
    const { start, end } = window_();
    for (const version of LE_VERSIONS) {
      const data = await d2lAny([
        `/d2l/api/le/${version}/${course.id}/calendar/events/myEvents/?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}`,
        `/d2l/api/le/${version}/${course.id}/calendar/events/?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}`,
      ]);
      if (Array.isArray(data)) {
        return data
          .filter((e) => e && (e.StartDateTime || e.EndDateTime))
          .map((e) => ({
            title: e.Title || e.title || "Untitled",
            due: e.EndDateTime || e.StartDateTime,
            url: e.Url || e.url || courseUrl(course),
            type: "other",
          }));
      }
    }
    return [];
  }

  async function getDropbox(course) {
    for (const version of LE_VERSIONS) {
      const data = await d2lAny([`/d2l/api/le/${version}/${course.id}/dropbox/folders/`]);
      if (Array.isArray(data)) {
        return data
          .filter((f) => f && f.Name)
          .map((f) => ({
            title: f.Name,
            due: f.DueDate || f.dueDate || null,
            url: courseUrl(course, "/dropbox/"),
            type: "assignment",
          }));
      }
    }
    return [];
  }

  async function getQuizzes(course) {
    for (const version of LE_VERSIONS) {
      const data = await d2lAny([`/d2l/api/le/${version}/${course.id}/quizzes/`]);
      const objects = data && (data.Objects || data.objects);
      if (Array.isArray(objects)) {
        return objects
          .filter((q) => q && q.Name)
          .map((q) => ({
            title: q.Name,
            due: q.DueDate || q.dueDate || null,
            url: courseUrl(course, "/quizzes/"),
            type: "quiz",
          }));
      }
    }
    return [];
  }

  function courseUrl(course, suffix = "") {
    return RN.absolute(`/d2l/home/${course.id}${suffix ? "#" + suffix : ""}`);
  }

  // -------------------------------------------------------------------------
  // DOM fallback (used only when the API returns nothing)
  // -------------------------------------------------------------------------
  function collectFromDom() {
    const courses = [];
    const items = [];
    const seen = new Set();

    const anchors = document.querySelectorAll('a[href*="/dropbox/"], a[href*="/quiz/"], a[href*="/discussions/"]');
    anchors.forEach((a) => {
      const title = RN.text(a);
      if (!title || title.length > 200) return;
      const container = a.closest("li, tr, .d2l-datalist-item, .d2l-rowshadeonhover, div") || a.parentElement;
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
