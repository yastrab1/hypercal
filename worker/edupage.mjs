export function schoolOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw Object.assign(new Error("Use your school’s HTTPS EduPage address."), {
      status: 400,
    });
  }
  if (
    url.protocol !== "https:" ||
    !/^[a-z0-9-]+\.edupage\.org$/.test(url.hostname) ||
    url.port ||
    url.username ||
    url.password
  )
    throw Object.assign(new Error("Use your school’s HTTPS EduPage address."), {
      status: 400,
    });
  return url.origin;
}

// Read the JSON argument of EduPage's dashboard initializer without evaluating
// any downloaded JavaScript. Protocol field names are documented in docs/plugins.md.
export function dashboardData(scripts) {
  for (const script of scripts) {
    const marker = script.indexOf(".userhome(");
    if (marker < 0) continue;
    const start = script.indexOf("{", marker);
    let depth = 0,
      quoted = false,
      escaped = false;
    for (let i = start; i >= 0 && i < script.length; i++) {
      const char = script[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') quoted = true;
      else if (char === "{") depth++;
      else if (char === "}" && --depth === 0)
        return JSON.parse(script.slice(start, i + 1));
    }
  }
  return null;
}
const clean = (value) =>
  String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
export function assignmentsFrom(
  data,
  origin,
  {
    today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Prague",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
  } = {},
) {
  if (!Array.isArray(data.homeworks))
    throw new Error(
      "EduPage’s assignment data format was not recognized. No calendar events were changed.",
    );
  const subjects = new Map(
    Object.entries(data.dbi?.subjects || {}).map(([key, s]) => [
      String(s.id ?? key),
      clean(s.name || s.short),
    ]),
  );
  const exams = new Set([
    "exam",
    "etest",
    "etestprint",
    "bexam",
    "sexam",
    "oexam",
    "rexam",
    "pexam",
    "testing",
    "test",
  ]);
  const homework = new Set(["homework", "hw", "etesthw"]);
  const items = new Map();
  let skipped = 0;
  for (const record of data.homeworks) {
    const type = String(record.typ || "")
      .split("|")
      .at(-1);
    if (!exams.has(type) && !homework.has(type)) continue;
    const kind = exams.has(type) ? "exam" : "homework";
    const id = String(
      record.homeworkid || record.e_superid || record.superid || "",
    );
    // EduPage datefrom is often the publication/availability date, even for
    // exams. dateto/datetimeto is the scheduled exam or homework deadline.
    const dateValue =
      record.datetimeto ||
      record.dateto ||
      record.datetimefrom ||
      record.datefrom;
    const date = String(dateValue || "").match(/^\d{4}-\d{2}-\d{2}/)?.[0];
    if (
      !id ||
      !date ||
      Number.isNaN(Date.parse(date)) ||
      new Date(date + "T12:00:00Z").toISOString().slice(0, 10) !== date
    ) {
      skipped++;
      continue;
    }
    if (date < today) continue;
    items.set(id, {
      id,
      date,
      kind,
      title:
        clean(record.name || record.details).slice(0, 140) ||
        (kind === "exam" ? "Exam" : "Homework"),
      subject:
        clean(record.predmet_meno) ||
        subjects.get(String(record.predmetid)) ||
        clean(record.subject),
      description: clean(record.details).slice(0, 12000),
      url: `${origin}/user/`,
    });
  }
  return {
    items: [...items.values()].sort((a, b) => a.date.localeCompare(b.date)),
    subjects: [...new Set([...items.values()].map((item) => item.subject))]
      .filter(Boolean)
      .sort(),
    skipped,
  };
}
