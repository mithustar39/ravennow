/**
 * Brightspace (D2L) collector for Carleton.
 *
 * Two layers:
 *  1. D2L's own REST API, called from the page with the student's existing
 *     session cookies (`credentials: "include"`). This is the stable source for
 *     structured deadlines (dropbox, quizzes, calendar, content).
 *  2. A text scan. Many instructors never set a structured due date; they type
 *     it into a course outline, a content page, or an announcement. The scan
 *     reads those pages and pairs a deadline or assessment word with a date.
 *
 * A "deep" pass crawls each course's home page, announcements, and the Content
 * tool so that coverage does not depend on which pages the student happens to
 * open. A shallow pass reads only the API plus the current page.
 *
 * The API version is discovered at runtime from `/d2l/api/versions/` because
 * the supported versions differ between D2L instances and change over time.
 *
 * Every call is wrapped so one failure never aborts a sync, and a `diag`
 * summary is attached to the payload for the options page.
 */
(function () {
  "use strict";

  const RN = window.RN;
  if (!RN) return;

  const MAX_COURSES = 40;
  const MAX_ATTEMPTS = 400;
  const MAX_TEXT_ITEMS = 500;

  // Deep crawl bounds. The point is to stay inside a service worker's patience
  // and Brightspace's tolerance for a burst of requests.
  const DEEP_MAX_COURSES = 30;
  const DEEP_MAX_TOPICS_PER_COURSE = 40;
  const DEEP_MAX_PAGES = 240;
  const DEEP_TIME_BUDGET_MS = 90000;
  const DEEP_CONCURRENCY = 3;

  const DEFAULT_LP_VERSIONS = ["1.4", "1.0"];
  const DEFAULT_LE_VERSIONS = ["1.6", "1.5", "1.4", "1.0"];

  const M =
    "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|" +
    "jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

  const MONTH_DAY_YEAR_RE = new RegExp(
    "\\b(" + M + ")\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b",
    "i"
  );
  const DAY_MONTH_YEAR_RE = new RegExp(
    "\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(" + M + ")\\.?\\s+(\\d{4})\\b",
    "i"
  );
  const MONTH_DAY_RE = new RegExp(
    "\\b(" + M + ")\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b",
    "i"
  );
  const DAY_MONTH_RE = new RegExp(
    "\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(" + M + ")\\.?\\b",
    "i"
  );
  const ISO_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/;
  const NUMERIC_RE = /\b(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})\b/;

  const MONTH_INDEX = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };

  // A line is a candidate only if it names a deadline or an assessment. The
  // date is required separately by findDue.
  const KEYWORD_RE =
    /\b(due|deadline|submit|submission|submissions|hand in|hand-in|no later than|closes|closing|last day|end date|ends on|exam|midterm|final|test|quiz|assignment|project|lab|report|paper|essay|presentation|journal|worksheet|posts?|posting)\b/i;

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

  async function getNews(course) {
    await discoverVersions();
    const data = await d2lAny(
      leVersions.map((v) => `/d2l/api/le/${v}/${course.id}/news/`)
    );
    return Array.isArray(data) ? data : [];
  }

  function newsText(item) {
    if (!item) return "";
    const body = item.Body || item.body;
    if (!body) return "";
    if (typeof body === "string") return htmlToText(body);
    return (
      body.Text ||
      body.text ||
      htmlToText(body.Html || body.html || "") ||
      ""
    );
  }

  async function getContentToc(course) {
    await discoverVersions();
    return d2lAny(
      leVersions.map((v) => `/d2l/api/le/${v}/${course.id}/content/toc`)
    );
  }

  /** Flatten a Content TOC into topics that can carry a page. */
  function flattenTopics(toc) {
    const out = [];
    const walk = (nodes) => {
      if (!Array.isArray(nodes)) return;
      for (const node of nodes) {
        if (!node) continue;
        const children = node.Modules || node.modules || node.Topics || node.topics;
        const isModule = Array.isArray(node.Topics) || Array.isArray(node.Modules);
        if (Array.isArray(children) && children.length) walk(children);
        const url = node.Url || node.url;
        if (url && !isModule) {
          out.push({
            id: node.Id || node.id,
            title: node.Title || node.title || "",
            url,
            due: node.DueDate || node.dueDate || null,
          });
        }
      }
    };
    walk(toc && (toc.Modules || toc.modules));
    return out;
  }

  /** Structured due dates on Content topics, when an instructor set one. */
  async function getContentDueDates(course) {
    const toc = await getContentToc(course);
    if (!toc) return [];
    return flattenTopics(toc)
      .filter((t) => t.due && t.title)
      .map((t) => ({
        title: t.title,
        due: t.due,
        url: t.url,
        type: "content",
      }));
  }

  function courseUrl(course, suffix = "") {
    return RN.absolute(`/d2l/home/${course.id}${suffix ? "#" + suffix : ""}`);
  }

  // -------------------------------------------------------------------------
  // HTML / text helpers
  // -------------------------------------------------------------------------
  function safeChar(code) {
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return " ";
    try {
      return String.fromCodePoint(code);
    } catch (err) {
      return " ";
    }
  }

  function decodeEntities(s) {
    return s
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#0*39;|&apos;/gi, "'")
      .replace(/&#x([0-9a-f]+);/gi, (m, h) => safeChar(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (m, d) => safeChar(parseInt(d, 10)));
  }

  function htmlToText(html) {
    if (!html) return "";
    let s = String(html);
    s = s.replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ");
    s = s.replace(/<!--[\s\S]*?-->/g, " ");
    s = s.replace(/<\s*br\s*\/?>/gi, "\n");
    s = s.replace(
      /<\/(p|div|li|tr|h[1-6]|section|article|header|footer|td|th|ul|ol|table|blockquote|form)\s*>/gi,
      "\n"
    );
    s = s.replace(/<[^>]+>/g, " ");
    s = decodeEntities(s);
    return s.replace(/[ \t\r\f\v]+/g, " ").replace(/\n[ \t]*/g, "\n").replace(/\n{2,}/g, "\n");
  }

  function segments(text) {
    const out = [];
    for (const line of String(text).split(/\n+/)) {
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

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function monthOf(name) {
    return MONTH_INDEX[String(name).slice(0, 3).toLowerCase()] || 0;
  }

  function inferYear(month, day) {
    const now = new Date();
    let year = now.getFullYear();
    const when = new Date(year, month - 1, day);
    // A date well in the past is almost certainly next year on a syllabus.
    if (when.getTime() < now.getTime() - 45 * 864e5) year += 1;
    return year;
  }

  function timeAt(segment, fromIndex) {
    const after = segment.slice(fromIndex, fromIndex + 24);
    const m = after.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i);
    if (!m) return "";
    let h = Number(m[1]);
    const ap = (m[3] || "").toLowerCase();
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    if (h > 23) return "";
    return pad2(h) + ":" + m[2];
  }

  function buildDue(segment, endIndex, year, month, day) {
    if (!month || month < 1 || month > 12 || !day || day < 1 || day > 31) {
      return null;
    }
    let due = year + "-" + pad2(month) + "-" + pad2(day);
    const time = timeAt(segment, endIndex);
    if (time) due += "T" + time;
    return due;
  }

  /** Find a date in a segment. Returns { raw, due } or null. */
  function findDue(segment) {
    let m = segment.match(MONTH_DAY_YEAR_RE);
    if (m) {
      const due = buildDue(segment, m.index + m[0].length, Number(m[3]), monthOf(m[1]), Number(m[2]));
      if (due) return { raw: m[0], due };
    }
    m = segment.match(DAY_MONTH_YEAR_RE);
    if (m) {
      const due = buildDue(segment, m.index + m[0].length, Number(m[3]), monthOf(m[2]), Number(m[1]));
      if (due) return { raw: m[0], due };
    }
    m = segment.match(ISO_RE);
    if (m) {
      const due = buildDue(segment, m.index + m[0].length, Number(m[1]), Number(m[2]), Number(m[3]));
      if (due) return { raw: m[0], due };
    }
    m = segment.match(NUMERIC_RE);
    if (m) {
      let month = Number(m[1]);
      let day = Number(m[2]);
      if (month > 12 && day <= 12) {
        const swap = month;
        month = day;
        day = swap;
      }
      let year = Number(m[3]);
      if (year < 100) year += 2000;
      const due = buildDue(segment, m.index + m[0].length, year, month, day);
      if (due) return { raw: m[0], due };
    }
    m = segment.match(MONTH_DAY_RE);
    if (m) {
      const month = monthOf(m[1]);
      const day = Number(m[2]);
      const due = buildDue(segment, m.index + m[0].length, inferYear(month, day), month, day);
      if (due) return { raw: m[0], due };
    }
    m = segment.match(DAY_MONTH_RE);
    if (m) {
      const month = monthOf(m[2]);
      const day = Number(m[1]);
      const due = buildDue(segment, m.index + m[0].length, inferYear(month, day), month, day);
      if (due) return { raw: m[0], due };
    }
    return null;
  }

  const WEEKDAY_RE =
    /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)\b\.?,?/gi;

  /**
   * Build a stable label from a deadline sentence. The words before the date
   * are usually the name ("Assignment 1: Due October 15" -> "Assignment 1");
   * anything after the date is dropped so it never leaks into the uid.
   */
  function cleanTitle(sentence, dateText) {
    const at = sentence.indexOf(dateText);
    let title = at > 0 ? sentence.slice(0, at) : "";
    if (!title || title.replace(/[^a-z0-9]/gi, "").length < 3) {
      title = at >= 0 ? sentence.slice(at + dateText.length) : sentence;
    }
    title = title.replace(/\s+/g, " ").trim();
    title = title.replace(WEEKDAY_RE, " ");
    title = title.replace(
      /\b(?:must|shall|should|will|need to|needs to|have to|has to|can|could)\s+(?:be\s+)?(?:submitted|completed|posted|done|handed in|uploaded)\b.*$/i,
      ""
    );
    title = title.replace(
      /\b(?:is|are|was|were|will be)\s+(?:due|posted|submitted|released)\b.*$/i,
      ""
    );
    title = title.replace(/^[-\s:;,.]+/, "");
    title = title.replace(/\b(?:at\s+)?\d{1,2}:\d{2}\s*(?:am|pm)?\b/i, "");
    title = title.replace(
      /\b(?:due|deadline|submission|submit|submitted|by|before|no later than|on|at|closes|closing|opens?|ends?)\s*[:\-.,;]?\s*$/i,
      ""
    );
    title = title.replace(/[-\s:;,.[\]()]+$/, "").replace(/\s+/g, " ").trim();
    if (title.length < 3) title = dateText ? "Deadline" : title;
    if (title.length > 140) title = title.slice(0, 137).trim() + "...";
    return title;
  }

  function typeFor(text) {
    if (/\bdiscussion|\bposts?(\b|ing)/i.test(text)) return "discussion";
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

  /**
   * Scan some page text for deadline lines and append new items to `out`.
   * `seen` holds courseKey|titleLower keys so nothing is captured twice.
   */
  function scanText(text, course, pageUrl, seen, out) {
    if (!text || !course) return 0;
    let added = 0;
    for (const segment of segments(text)) {
      if (out.length >= MAX_TEXT_ITEMS) break;
      if (!KEYWORD_RE.test(segment)) continue;
      const found = findDue(segment);
      if (!found || !found.due) continue;
      const title = cleanTitle(segment, found.raw);
      if (title.length < 3) continue;
      const key = course.id + "|" + title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        source: "brightspace",
        course_external_id: course.id,
        course_name: course.name,
        title,
        type: typeFor(segment),
        due: found.due,
        url: RN.absolute(pageUrl || ""),
        submitted: false,
      });
      added += 1;
    }
    return added;
  }

  // -------------------------------------------------------------------------
  // Current-page helpers
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

  // -------------------------------------------------------------------------
  // Deep crawl
  // -------------------------------------------------------------------------
  function fetchText(url, budget) {
    if (budget.pages <= 0) return Promise.resolve("");
    budget.pages -= 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    return fetch(url, {
      credentials: "include",
      signal: controller.signal,
      headers: { Accept: "text/html,application/xhtml+xml" },
    })
      .then((res) => {
        if (!res.ok) {
          note(url, res.status, false);
          return "";
        }
        const type = (res.headers.get("content-type") || "").toLowerCase();
        if (type && !/html|text\/plain|json/.test(type)) {
          note(url, "type:" + type, true);
          controller.abort();
          return "";
        }
        return res.text().then((html) => {
          note(nameOf(res.url || url), "ok", true);
          return htmlToText(html);
        });
      })
      .catch(() => {
        note(url, "err", false);
        return "";
      })
      .finally(() => clearTimeout(timer));
  }

  function nameOf(url) {
    try {
      return new URL(url, location.href).pathname;
    } catch (err) {
      return url;
    }
  }

  async function mapPool(items, limit, fn) {
    const results = new Array(items.length);
    let cursor = 0;
    const workers = [];
    const size = Math.max(1, Math.min(limit, items.length));
    for (let i = 0; i < size; i += 1) {
      workers.push(
        (async () => {
          while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            results[index] = await fn(items[index], index);
          }
        })()
      );
    }
    await Promise.all(workers);
    return results;
  }

  const TOPIC_PRIORITY_RE =
    /outline|syllabus|schedule|overview|start here|important|dates|due|calendar|assignment|assessment|course information|readme|welcome/i;

  function topicScore(topic) {
    return TOPIC_PRIORITY_RE.test(topic.title || "") ? 1 : 0;
  }

  async function deepCrawl(courses, budget, seen) {
    const out = [];
    const stats = { home: 0, news: 0, content: 0, pages: 0, topics: 0 };
    const deadline = Date.now() + DEEP_TIME_BUDGET_MS;

    for (const course of courses.slice(0, DEEP_MAX_COURSES)) {
      if (budget.pages <= 0 || Date.now() > deadline) break;

      // Course home: Work To Do, calendar widget, announcements widget.
      const homeUrl = "/d2l/home/" + course.id;
      const homeText = await fetchText(homeUrl, budget);
      stats.home += scanText(homeText, course, homeUrl, seen, out);

      // Announcements carry dates in their body.
      const news = await getNews(course);
      for (const item of news) {
        const text = newsText(item);
        if (text) {
          stats.news += scanText(
            text,
            course,
            "/d2l/le/news/" + course.id + "/news/list",
            seen,
            out
          );
        }
      }

      // Content topics: fetch each page's rendered HTML and scan it.
      const toc = await getContentToc(course);
      const topics = flattenTopics(toc)
        .filter((t) => t.url && t.url.indexOf("/viewContent/") !== -1)
        .sort((a, b) => topicScore(b) - topicScore(a))
        .slice(0, DEEP_MAX_TOPICS_PER_COURSE);

      const texts = await mapPool(topics, DEEP_CONCURRENCY, (topic) =>
        fetchText(topic.url, budget)
      );
      topics.forEach((topic, index) => {
        stats.topics += 1;
        stats.content += scanText(texts[index], course, topic.url, seen, out);
      });
    }

    stats.pages = budget.start - budget.pages;
    stats.remaining = budget.pages;
    diag.deep = stats;
    return out;
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
      const found = findDue(context);
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
        due: found ? found.due : null,
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

  // -------------------------------------------------------------------------
  // Collect
  // -------------------------------------------------------------------------
  async function collect(opts) {
    const deep = !!(opts && opts.deep);
    const courses = await getCourses();

    if (!courses.length) {
      RN.log("no courses via API; using DOM fallback");
      return collectFromDomFallback();
    }

    const items = [];
    const seen = new Set();

    for (const course of courses) {
      const [calendar, dropbox, quizzes, content] = await Promise.all([
        getCalendarEvents(course).catch(() => []),
        getDropbox(course).catch(() => []),
        getQuizzes(course).catch(() => []),
        getContentDueDates(course).catch(() => []),
      ]);

      const push = (entry) => {
        if (!entry || !entry.title) return;
        const key = course.id + "|" + String(entry.title).trim().toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
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

    // Always read the page the student is on.
    const onPage = pageCourse(courses);
    if (onPage) {
      diag.pageCourse = onPage.name;
      diag.textItems = scanText(pageText(), onPage, location.href, seen, items);
    }

    // Deep pass: crawl course homes, announcements, and Content pages.
    if (deep) {
      const crawled = await deepCrawl(
        courses,
        { pages: DEEP_MAX_PAGES, start: DEEP_MAX_PAGES },
        seen
      );
      items.push(...crawled);
      diag.deepItems = crawled.length;
    }

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
      items,
    };
  }

  async function doRun(opts) {
    try {
      const payload = await collect(opts);
      diag.deep = diag.deep || null;
      diag.courses = payload.courses ? payload.courses.length : 0;
      diag.items = payload.items ? payload.items.length : 0;
      diag.deepScan = !!(opts && opts.deep);
      payload.diag = diag;
      RN.log("collected", payload.items.length, "items", opts && opts.deep ? "(deep)" : "");
      return payload;
    } catch (err) {
      RN.log("collect failed", err);
      return null;
    }
  }

  // Serialize runs so a deep crawl and a page-load pass never overlap.
  let queue = Promise.resolve();
  function run(opts) {
    const next = queue.then(() => doRun(opts), () => doRun(opts));
    queue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  RN.listen(run);

  // Initial pass, and again if Brightspace mutates the URL without a reload.
  setTimeout(() => run().then((p) => p && RN.deliver(p)), 2000);
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(() => run().then((p) => p && RN.deliver(p)), 1500);
    }
  }, 3000);
})();
