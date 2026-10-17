/* Timezone-safe date helpers (user is UTC+8 Philippines).
 * NEVER use new Date("YYYY-MM-DD") or date.toISOString().slice(0,10) for
 * calendar dates — both shift days across timezones. All working-day,
 * holiday, calendar and display logic goes through these two helpers. */

export function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISODate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]);
}

export function todayISO() {
  return toISODate(new Date());
}

export function nowISO() {
  return new Date().toISOString();
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function displayDate(iso) {
  const d = parseISODate(iso);
  if (!d) return iso || "";
  return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}, ${d.getFullYear()}`;
}

/** 6x7 grid of YYYY-MM-DD strings (or null) for a month view, weeks start Sunday. */
export function monthGrid(year, month /* 1-12 */) {
  const first = new Date(year, month - 1, 1);
  const startDow = first.getDay();
  const weeks = [];
  let cur = new Date(year, month - 1, 1 - startDow);
  for (let w = 0; w < 6; w++) {
    const row = [];
    for (let i = 0; i < 7; i++) {
      row.push(cur.getMonth() === month - 1 ? toISODate(cur) : null);
      cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
    }
    weeks.push(row);
  }
  return weeks;
}

export function monthLabel(year, month) {
  return `${MONTHS[month - 1]} ${year}`;
}

export function addMonths(year, month, delta) {
  const d = new Date(year, month - 1 + delta, 1);
  return [d.getFullYear(), d.getMonth() + 1];
}
