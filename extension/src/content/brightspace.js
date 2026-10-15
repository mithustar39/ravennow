/**
 * Brightspace (D2L) collector for Carleton.
 *
 * Strategy: prefer D2L's own REST API, called from the page with the student's
 * existing session cookies (`credentials: "include"`). This is far more stable
 * than DOM scraping. If the API is unavailable we fall back to reading the
 * rendered page.
 *
 * Many instructors never set structured due dates. They type them into a course
 * outline or a content page instead. To catch those, the collector also reads
 * the text of the page the student is currently on and pulls out lines that
 * pair a deadline word with a date.
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
  const MAX_TEXT_ITEMS = 60;
  const DEFAULT_LP_VERSIONS = ["1.4", "1.0"];
  const DEFAULT_LE_VERSIONS = ["1.6", "1.5", "1.4", "1.0"];

  const MONTH =
    "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|" +
    "jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

  // Dates must include a year, otherwise every "May 5" in a syllabus matches.
  const DATE_RE = new RegExp(
    "(?:" +
      MONTH +
      "\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,\\s*|\\s+)\\d{4}" +
      "|\\d{1,2}(?:st|nd|rd|th)?\\s+" +
      MONTH +
      "\\.?\\s+\\d{4}" +
      "|\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}" +
      "|\\d{4}-\\d{2}-\\d{2}" +
      ")",
    "i"
  );

  const TIME_RE = /\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/i;
  // A line is a candidate only if it names a deadline or an assessment AND
  // carries a date with a year. The year requirement keeps casual mentions of
  // dates (lecture topics, office hours) out.
  const KEYWORD_RE =
    /\b(due|deadline|submit|submission|hand in|hand-in|no later than|closes|closing|last day|end date|ends on|exam|midterm|final|test|quiz|assignment|project|lab|report|paper|essay|presentation|journal|worksheet|post)\b/i;

  function typeFor(text) {
    if (/\bdiscussion|\bposts?\b/i.test(text)) return "discussion";
    if (/\blabs?\b/i.test(text)) return "lab";
    if (/\bquiz(zes)?\b|\btests?\b/i.test(text)) return "quiz";
    if (
      /\bassignments?\b|\bhomework\b|\bdropbox\b|\bsubmissions?\b|\bsubmitted\b|\bsubmits?\b|\breports?\b|\bpapers?\b|\bessays?\b|\bprojects?\b|\bpresentations?\b|\bworksheets?\b/i.test(
        text
      )
    ) {
      return "assignment";
    }
    if (/\bmidterms?\b|\bexams?\b|\bfinals?\b/i.test(text)) return "exam";
    return "other";
  }

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

  /**
   * Content topics can carry a due date. Only some instructors set one, but it
   * is cheap and covers "due date lives on a content page" cases.
   */
  async function getContentDueDates(course) {
    await discoverVersions();
    const data = await d2lAny(
      leVersions.map((v) => `/d2l/api/le/${v}/${course.id}/content/toc`)
    );
    if (!data) return [];

    const out = [];
    const seen = new Set();
    const walk = (nodes) => {
      if (!Array.isArray(nodes)) return;
      for (const node of nodes) {
        if (!node) continue;
        const due = node.DueDate || node.dueDate;
        if (due && node.Title && !seen.has(node.Title)) {
          seen.add(node.Title);
          out.push({
            title: node.Title,
            due,
            url: courseUrl(course, "/content/"),
            type: "content",
          });
        }
        walk(node.Modules || node.modules);
        walk(node.Topics || node.topics);
      }
    };
    walk(data.Modules || data.modules);
    return out;
  }

  function courseUrl(course, suffix = "") {
    return RN.absolute(`/d2l/home/${course.id}${suffix ? "#" + suffix : ""}`);
  }

  // -------------------------------------------------------------------------
  // Page text scan (course outlines and content pages)
  // -------------------------------------------------------------------------
  function courseIdFromUrl() {
    const match = location.pathname.match(
      /\/(?:content|le|home|quizzes|dropbox|discussions|grades)\/(\d+)/i
    );
    return match ? match[1] : null;
  }

  function pageCourse(courses) {
    const id = courseIdFromUrl();
    if (!id) return null;
    const known = courses.find((c) => c.id === id);
    if (known) return known;
    const name =
      (document.title || "").replace(/\s*[-|]\s*Brightspace.*$/i, "").trim() ||
      "Course " + id;
    return { id, name, code: "" };
  }

  function pageText() {
    const el =
      document.querySelector(
        ".d2l-page-main, main, #Content, .d2l-content-container, .d2l-htmlblock"
      ) || document.body;
    return (el && el.innerText) || "";
  }

  function segments(text) {
    const out = [];
    for (const line of text.split(/\n+/)) {
      const trimmed = line.trim();
      if (trimmed.length < 6) continue;
      if (trimmed.length <= 220) {
        out.push(trimmed);
        continue;
      }
      for (const sentence of trimmed.split(/(?<=[.!?;])\s+/)) {
        if (sentence.trim().length >= 6) out.push(sentence.trim());
      }
    }
    return out;
  }

  function cleanTitle(sentence, dateText) {
    let title = sentence.replace(dateText, " ");
    title = title.replace(/\s+/g, " ").trim();
    title = title.replace(/^[-\s:;,.]+/, "");
    title = title.replace(
      /\b(?:is|are|was|were|will be)\s+(?:due|posted|submitted|released)\b.*$/i,
      ""
    );
    title = title.replace(/\b(?:at\s+)?\d{1,2}:\d{2}\s*(?:am|pm)?\b/i, "");
    title = title.replace(
      /\b(?:due|deadline|submission|submit|by|before|no later than|on|at|closes|closing|ends?)\s*[:\-.,;]?\s*$/i,
      ""
    );
    title = title.replace(/[-\s:;,.[\]()]+$/, "").trim();
    if (title.length > 140) title = title.slice(0, 137).trim() + "...";
    return title;
  }

  function collectFromPageText(course, existing) {
    if (!course) return [];
    const taken = new Set(
      existing.map((item) => String(item.title || "").trim().toLowerCase())
    );
    const text = pageText();
    if (!text) return [];

    const items = [];
    const localSeen = new Set();
    for (const segment of segments(text)) {
      if (items.length >= MAX_TEXT_ITEMS) break;
      if (!KEYWORD_RE.test(segment)) continue;
      const dateMatch = DATE_RE.exec(segment);
      if (!dateMatch) continue;

      let due = dateMatch[0];
      const after = segment.slice(
        dateMatch.index + dateMatch[0].length,
        dateMatch.index + dateMatch[0].length + 24
      );
      const time = after.match(TIME_RE);
      if (time) due = due + " " + time[0];

      const title = cleanTitle(segment, dateMatch[0]);
      if (title.length < 3) continue;
      const key = title.toLowerCase();
      if (taken.has(key) || localSeen.has(key)) continue;
      localSeen.add(key);

      items.push({
        source: "brightspace",
        course_external_id: course.id,
        course_name: course.name,
        title,
        type: typeFor(segment),
        due,
        url: location.href,
        submitted: false,
      });
    }
    return items;
  }

  // -------------------------------------------------------------------------
  // DOM fallback (used only when the API returns no courses)
  // -------------------------------------------------------------------------
  function collectFromDomFallback() {
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
      const match = context.match(DATE_RE);
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
      courses: [],
      items,
    };
  }

  async function collect() {
    const courses = await getCourses();

    if (!courses.length) {
      RN.log("no courses via API; using DOM fallback");
      return collectFromDomFallback();
    }

    const items = [];
    for (const course of courses) {
      const [calendar, dropbox, quizzes, content] = await Promise.all([
        getCalendarEvents(course).catch(() => []),
        getDropbox(course).catch(() => []),
        getQuizzes(course).catch(() => []),
        getContentDueDates(course).catch(() => []),
      ]);

      const push = (entry) => {
        if (!entry || !entry.title) return;
        items.push({
          source: "brightspace",
          course_external_id: course.id,
          course_name: course.name,
          title: entry.title,
          type: entry.type,
          due: entry.due,
          url: entry.url,
          submitted: false,
        });
      };

      calendar.forEach(push);
      dropbox.forEach(push);
      quizzes.forEach(push);
      content.forEach(push);
    }

    // Read the current page as well, so outline text is captured as the
    // student browses. Only when the URL identifies a course.
    const onPage = pageCourse(courses);
    const textItems = collectFromPageText(onPage, items);
    diag.textItems = textItems.length;
    diag.pageCourse = onPage ? onPage.name : "";

    const allCourses = courses.slice();
    if (onPage && !courses.some((c) => c.id === onPage.id)) allCourses.push(onPage);

    return {
      school: "carleton",
      source: "brightspace",
      captured_at: new Date().toISOString(),
      courses: allCourses.map((c) => ({
        source: "brightspace",
        external_id: c.id,
        name: c.name,
        code: c.code,
      })),
      items: items.concat(textItems),
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
