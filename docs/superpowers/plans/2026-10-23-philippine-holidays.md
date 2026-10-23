# Philippine 2026 Holidays and Observances Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Philippine 2026 calendar with 20 non-working holidays plus 13 permanent working days/observances, and make only non-working kinds reduce leave days.

**Architecture:** Extend `holidays/{date}` documents with a four-value `kind`. A pure predicate in `js/core/rules.js` decides whether a kind suspends work. Both reads of the holidays collection (the service used by the browser, the adapter used by the submission transaction) filter through that predicate. Calendars render non-working days with the existing solid orange border and working observances with a dashed muted border.

**Tech Stack:** Vanilla ES modules, no bundler, no `package.json`. Firebase Auth + Firestore (emulator for tests). Playwright for the browser E2E. Node 24 for the pure unit test.

## Global Constraints

- Project root: `D:\tyron\Pictures\mint\leave application app`. This is the git repo; the `C:\Users\tyron\Pictures\mint\...` copy has no source.
- Only `kind` values `regular` and `special` may reduce leave days. `special_working` and `observance` are working days.
- A missing or unknown `kind` is treated as non-working (legacy documents).
- One document per date (`holidays/{YYYY-MM-DD}`). Never create two entries for one date.
- Do not modify `firestore.rules`; admin write access already exists.
- Do not add dependencies. Do not add a `package.json`.
- No `as any`, no `@ts-ignore`, no empty `catch` blocks.
- Dates are `YYYY-MM-DD` strings. Never construct `Date` objects for calendar-date math.
- Commit style: lowercase Conventional Commits, no attribution trailer. Prefix git commands with `$env:GIT_MASTER='1';`.
- Never stage `node_modules/` or `.playwright-mcp/`.
- All commands are Windows PowerShell 5.1 run from the project root.

### Test harness prerequisites (needed for Tasks 2, 3, 6)

Terminal A:

```powershell
npx -y firebase-tools@14 emulators:start --only firestore,auth --project leaveapplication-d9556
```

Terminal B:

```powershell
python -m http.server 8000
```

One-time emulator bootstrap (only if the emulator data was wiped):

```powershell
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8080'
$env:FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099'
node tests/bootstrap-emulator.mjs
```

E2E run:

```powershell
$env:APP_URL='http://127.0.0.1:8000/index.html?emulator=1'
node tests/e2e-firestore.mjs
```

---

### Task 1: Non-working predicate and kind labels

**Files:**
- Modify: `js/core/rules.js` (add after `calcWorkingDays`, around line 66)
- Modify: `js/core/constants.js` (append at end)
- Create: `tests/rules.mjs`

**Interfaces:**
- Produces:
  - `NON_WORKING_HOLIDAY_KINDS: Set<string>` containing exactly `"regular"` and `"special"`.
  - `isNonWorkingHoliday(kind: string | undefined | null): boolean` — true for `"regular"`, `"special"`, `null`, `undefined`; false for `"special_working"`, `"observance"`, any other string.
  - `HOLIDAY_KIND_LABELS: Record<string, string>` with keys `regular`, `special`, `special_working`, `observance`.

- [ ] **Step 1: Write the failing test**

Create `tests/rules.mjs`:

```js
/* Pure business-rule checks. No emulator, no browser: node tests/rules.mjs */
import assert from "node:assert/strict";
import {
  NON_WORKING_HOLIDAY_KINDS,
  calcWorkingDays,
  isNonWorkingHoliday,
} from "../js/core/rules.js";
import { HOLIDAY_KIND_LABELS } from "../js/core/constants.js";

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`PASS ${name}`);
};

t("regular holiday is non-working", () => assert.equal(isNonWorkingHoliday("regular"), true));
t("special non-working day is non-working", () => assert.equal(isNonWorkingHoliday("special"), true));
t("special working day is working", () => assert.equal(isNonWorkingHoliday("special_working"), false));
t("observance is working", () => assert.equal(isNonWorkingHoliday("observance"), false));
t("missing kind stays non-working (legacy)", () => assert.equal(isNonWorkingHoliday(undefined), true));
t("unknown kind is treated as working", () => assert.equal(isNonWorkingHoliday("mystery"), false));
t("non-working set is exactly regular+special", () =>
  assert.deepEqual([...NON_WORKING_HOLIDAY_KINDS].sort(), ["regular", "special"]));
t("labels cover all four kinds", () =>
  assert.deepEqual(Object.keys(HOLIDAY_KIND_LABELS).sort(), ["observance", "regular", "special", "special_working"]));
t("Holy Week holidays remove all three days", () =>
  assert.equal(calcWorkingDays("2026-04-02", "2026-04-04", ["2026-04-02", "2026-04-03"]), 0));
t("Araw ng Pagbasa stays a working day", () =>
  assert.equal(calcWorkingDays("2026-11-26", "2026-11-27", []), 2));
t("calcWorkingDays trusts its input list, so callers must filter", () =>
  assert.equal(calcWorkingDays("2026-11-26", "2026-11-27", ["2026-11-27"]), 1));

console.log(`\n${n} passed`);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/rules.mjs`

Expected: FAIL with `SyntaxError: The requested module '../js/core/rules.js' does not provide an export named 'NON_WORKING_HOLIDAY_KINDS'`.

- [ ] **Step 3: Implement the predicate**

In `js/core/rules.js`, immediately after the closing brace of `calcWorkingDays` (line 66), insert:

```js
/** Holiday kinds that suspend work. Everything else counts as a working day. */
export const NON_WORKING_HOLIDAY_KINDS = new Set(["regular", "special"]);

/** Missing kind keeps legacy documents non-working; unknown kinds stay working. */
export function isNonWorkingHoliday(kind) {
  return kind == null || NON_WORKING_HOLIDAY_KINDS.has(kind);
}
```

In `js/core/constants.js`, append at the end of the file:

```js
// Holiday kinds. Only regular/special suspend work; the rest are display-only.
export const HOLIDAY_KIND_LABELS = {
  regular: "Regular holiday",
  special: "Special non-working",
  special_working: "Special working day",
  observance: "Observance",
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/rules.mjs`

Expected: 11 lines starting with `PASS`, then `11 passed`. Exit code 0.

- [ ] **Step 5: Commit**

```powershell
$env:GIT_MASTER='1'; git add js/core/rules.js js/core/constants.js tests/rules.mjs; git commit -m "feat: add non-working holiday predicate and kind labels"
```

---

### Task 2: Seed the full 2026 calendar

**Files:**
- Modify: `js/data/seed.js:30-40`
- Modify: `tests/e2e-firestore.mjs:45-46`

**Interfaces:**
- Consumes: `HOLIDAY_KIND_LABELS` is not used here; the seed stores raw `kind` tokens.
- Produces: `seedBundle().holidays` is an array of 33 objects, each `{ date, name, kind }`, sorted ascending by date. `seedReferenceData()` writes all 33 through `batch.set(doc(db, "holidays", h.date), h, { merge: true })`.

- [ ] **Step 1: Write the failing assertion**

In `tests/e2e-firestore.mjs`, replace lines 45-46:

```js
    const hols = await repo.list("holidays", { limit: 20 });
    t("seed: 9 holidays", hols.length === 9, String(hols.length));
```

with:

```js
    const hols = await repo.list("holidays", { limit: 50 });
    t("seed: 33 holidays", hols.length === 33, String(hols.length));
    t("seed: includes observances", hols.some((h) => h.kind === "observance"));
    t(
      "seed: 20 non-working dates",
      hols.filter((h) => h.kind === "regular" || h.kind === "special").length === 20,
      String(hols.filter((h) => h.kind === "regular" || h.kind === "special").length)
    );
```

- [ ] **Step 2: Run the E2E to verify it fails**

Run (emulators and static server must already be running):

```powershell
$env:APP_URL='http://127.0.0.1:8000/index.html?emulator=1'
node tests/e2e-firestore.mjs
```

Expected: `FAIL: seed: 33 holidays 9`.

- [ ] **Step 3: Replace the seed array**

In `js/data/seed.js`, replace the 9-entry `holidays` array (lines 30-40) with:

```js
    holidays: [
      // Regular holidays — non-working (Proclamation 1006 + Eid proclamations)
      { date: "2026-01-01", name: "New Year's Day", kind: "regular" },
      { date: "2026-03-20", name: "Eid'l Fitr", kind: "regular" },
      { date: "2026-04-02", name: "Maundy Thursday", kind: "regular" },
      { date: "2026-04-03", name: "Good Friday", kind: "regular" },
      { date: "2026-04-09", name: "Araw ng Kagitingan", kind: "regular" },
      { date: "2026-05-01", name: "Labor Day", kind: "regular" },
      { date: "2026-05-27", name: "Eid'l Adha", kind: "regular" },
      { date: "2026-06-12", name: "Independence Day", kind: "regular" },
      { date: "2026-08-31", name: "National Heroes Day", kind: "regular" },
      { date: "2026-11-30", name: "Bonifacio Day", kind: "regular" },
      { date: "2026-12-25", name: "Christmas Day", kind: "regular" },
      { date: "2026-12-30", name: "Rizal Day", kind: "regular" },
      // Special non-working days (Proclamation 1006)
      { date: "2026-02-17", name: "Chinese New Year", kind: "special" },
      { date: "2026-04-04", name: "Black Saturday", kind: "special" },
      { date: "2026-08-21", name: "Ninoy Aquino Day", kind: "special" },
      { date: "2026-11-01", name: "All Saints' Day", kind: "special" },
      { date: "2026-11-02", name: "All Souls' Day", kind: "special" },
      { date: "2026-12-08", name: "Feast of the Immaculate Conception", kind: "special" },
      { date: "2026-12-24", name: "Christmas Eve", kind: "special" },
      { date: "2026-12-31", name: "Last Day of the Year", kind: "special" },
      // Permanent statutory working days (do NOT reduce leave)
      { date: "2026-01-23", name: "First Philippine Republic Day", kind: "special_working" },
      { date: "2026-02-25", name: "EDSA People Power Revolution Anniversary", kind: "special_working" },
      { date: "2026-04-27", name: "Lapu-Lapu Day", kind: "special_working" },
      { date: "2026-07-27", name: "Iglesia ni Cristo Day", kind: "special_working" },
      { date: "2026-09-08", name: "Feast of the Nativity of Mary", kind: "special_working" },
      { date: "2026-11-07", name: "Sheikh Karim'ul Makhdum Day", kind: "special_working" },
      { date: "2026-11-27", name: "Araw ng Pagbasa", kind: "special_working" },
      // Observances — working days, display only
      { date: "2026-01-16", name: "Lailatul Isra wal Mi'raj", kind: "observance" },
      { date: "2026-02-19", name: "Start of Ramadan", kind: "observance" },
      { date: "2026-04-05", name: "Easter Sunday", kind: "observance" },
      { date: "2026-06-16", name: "Amun Jadid (Islamic New Year)", kind: "observance" },
      { date: "2026-08-26", name: "Maulid un-Nabi", kind: "observance" },
      { date: "2026-11-17", name: "National Students' Day", kind: "observance" },
    ],
```

- [ ] **Step 4: Run the E2E to verify it passes**

Run:

```powershell
$env:APP_URL='http://127.0.0.1:8000/index.html?emulator=1'
node tests/e2e-firestore.mjs
```

Expected: `PASS: seed: 33 holidays`, `PASS: seed: includes observances`, `PASS: seed: 20 non-working dates`, and every pre-existing assertion still `PASS`.

- [ ] **Step 5: Commit**

```powershell
$env:GIT_MASTER='1'; git add js/data/seed.js tests/e2e-firestore.mjs; git commit -m "feat: seed full philippine 2026 holiday calendar"
```

---

### Task 3: Filter non-working kinds at both read paths

**Files:**
- Modify: `js/services/holidays.js`
- Modify: `js/data/firestore-adapter.js:15,249-250`
- Modify: `tests/e2e-firestore.mjs` (append assertions after the seed block)

**Interfaces:**
- Consumes: `isNonWorkingHoliday(kind)` from Task 1.
- Produces: `holidayDates(): Promise<string[]>` now returns only non-working dates. `listHolidays()` still returns every document, including working kinds.

- [ ] **Step 1: Write the failing assertions**

In `tests/e2e-firestore.mjs`, immediately after the `seed: 20 non-working dates` assertion added in Task 2, insert:

```js
    const holidaysSvc = await import("/js/services/holidays.js");
    const rules = await import("/js/core/rules.js");
    const nonWorkingDates = await holidaysSvc.holidayDates();
    t(
      "holidayDates: includes declared holidays",
      nonWorkingDates.includes("2026-04-02") && nonWorkingDates.includes("2026-12-24"),
      String(nonWorkingDates.length)
    );
    t(
      "holidayDates: excludes working kinds",
      !nonWorkingDates.includes("2026-07-27") && !nonWorkingDates.includes("2026-11-17")
    );
    const holyWeek = rules.calcWorkingDays("2026-04-02", "2026-04-04", nonWorkingDates);
    t("working days: Holy Week counts zero", holyWeek === 0, String(holyWeek));
    const pagbasa = rules.calcWorkingDays("2026-11-26", "2026-11-27", nonWorkingDates);
    t("working days: Araw ng Pagbasa counts two", pagbasa === 2, String(pagbasa));
```

- [ ] **Step 2: Run the E2E to verify it fails**

Run:

```powershell
$env:APP_URL='http://127.0.0.1:8000/index.html?emulator=1'
node tests/e2e-firestore.mjs
```

Expected: `FAIL: holidayDates: excludes working kinds` (both 2026-07-27 and 2026-11-17 are currently returned) and `FAIL: working days: Araw ng Pagbasa counts two` (it returns 0).

- [ ] **Step 3: Filter in the service**

Replace the contents of `js/services/holidays.js` with:

```js
import { repo } from "../data/repository.js";
import { isNonWorkingHoliday } from "../core/rules.js";

export async function listHolidays(limit = 200) {
  return repo.list("holidays", { orderBy: [["date", "asc"]], limit });
}

/** Dates that suspend work. Working observances are intentionally excluded. */
export async function holidayDates() {
  const rows = await listHolidays();
  return rows.filter((h) => isNonWorkingHoliday(h.kind)).map((h) => h.date || h.id);
}

export async function saveHoliday(date, data) {
  return repo.create("holidays", { date, ...(data || {}) }, date);
}

export async function removeHoliday(date) {
  await repo.remove("holidays", date);
}
```

- [ ] **Step 4: Filter in the adapter**

In `js/data/firestore-adapter.js`, line 15, change:

```js
import { calcWorkingDays, canTransition, isCancellable, remaining, reviewActionsFor } from "../core/rules.js";
```

to:

```js
import { calcWorkingDays, canTransition, isCancellable, isNonWorkingHoliday, remaining, reviewActionsFor } from "../core/rules.js";
```

Then replace lines 249-250:

```js
    const holSnap = await fsMod.getDocs(fsMod.collection(db, "holidays"));
    const holidayDates = holSnap.docs.map((d) => d.id);
```

with:

```js
    const holSnap = await fsMod.getDocs(fsMod.collection(db, "holidays"));
    // Only declared non-working kinds may reduce the charged days.
    const holidayDates = holSnap.docs
      .filter((d) => isNonWorkingHoliday(d.data().kind))
      .map((d) => d.id);
```

- [ ] **Step 5: Run the E2E to verify it passes**

Run:

```powershell
$env:APP_URL='http://127.0.0.1:8000/index.html?emulator=1'
node tests/e2e-firestore.mjs
```

Expected: all four new assertions `PASS`, and no previously passing assertion changes to `FAIL`.

- [ ] **Step 6: Run the unit test as a regression check**

Run: `node tests/rules.mjs`

Expected: `11 passed`, exit code 0.

- [ ] **Step 7: Commit**

```powershell
$env:GIT_MASTER='1'; git add js/services/holidays.js js/data/firestore-adapter.js tests/e2e-firestore.mjs; git commit -m "fix: exclude working observances from leave day calculation"
```

---

### Task 4: Admin holiday list and add form

**Files:**
- Modify: `js/pages/admin.js:8` (constants import)
- Modify: `js/pages/admin.js:511-535` (`vHols`)

**Interfaces:**
- Consumes: `HOLIDAY_KIND_LABELS` from `js/core/constants.js`.
- Produces: no exported API. The Holidays screen renders human-readable kind labels and can create all four kinds.

- [ ] **Step 1: Add the labels import**

In `js/pages/admin.js` line 8, change:

```js
import { can, ROLES } from "../core/constants.js";
```

to:

```js
import { can, ROLES, HOLIDAY_KIND_LABELS } from "../core/constants.js";
```

- [ ] **Step 2: Update the list rendering and the add modal**

In `vHols`, replace the header line (currently line 513) so the note sits under the heading:

```js
  view.innerHTML = `<div class="card panel"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><h3 style="flex:1;margin:0">Holidays</h3>
    ${can(user, "holidays.manage") ? `<button class="btn btn-primary btn-sm" id="add-h">Add</button>` : ""}</div>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 0">Only regular and special non-working days reduce leave days. Special working days and observances are display only.</p>
    <div id="h-out" style="margin-top:12px"></div></div>`;
```

Replace the row template inside `reload` (currently line 518):

```js
    qs("#h-out").innerHTML = rows.map((h) => `<div class="doc-row"><span><b>${esc(h.date || h.id)}</b> — <span class="ow">${esc(h.name)}</span> <i>(${esc(HOLIDAY_KIND_LABELS[h.kind] || h.kind)})</i></span>
      ${can(user, "holidays.manage") ? `<button class="icon-btn danger" data-del="${esc(h.date || h.id)}" aria-label="Delete">${xIcon()}</button>` : ""}</div>`).join("") || emptyState("📅", "No holidays");
```

Replace the kind select in the add modal (currently line 527):

```js
      <label class="sec-label">Kind</label><select class="field" id="h-k"><option value="regular">Regular holiday (non-working)</option><option value="special">Special non-working day</option><option value="special_working">Special working day</option><option value="observance">Observance (working)</option></select>
```

- [ ] **Step 3: Verify in the browser**

Start the emulators and static server, then open:

`http://127.0.0.1:8000/index.html?emulator=1`

Sign in as `admin@example.com` / `Admin123!`, open **Holidays**, and confirm:

1. The list shows `(Regular holiday)`, `(Special non-working)`, `(Special working day)`, `(Observance)` — never `special_working` or `observance` raw.
2. The explanatory line about leave days is visible.
3. **Add** opens a modal whose Kind select has exactly four options with the labels above.

- [ ] **Step 4: Commit**

```powershell
$env:GIT_MASTER='1'; git add js/pages/admin.js; git commit -m "feat: show readable holiday kinds in admin"
```

---

### Task 5: Calendar rendering for working kinds

**Files:**
- Modify: `js/pages/employee.js:11,13,427,431,457-460,468`
- Modify: `js/pages/admin.js:10,432,449,457`
- Modify: `css/employee.css:102-103`

**Interfaces:**
- Consumes: `isNonWorkingHoliday` (Task 1), `HOLIDAY_KIND_LABELS` (Task 1), store entries `{ name, kind }`.
- Produces: day cells carry `is-holiday` (solid orange) or `is-observance` (dashed muted); day sheets name the kind.

- [ ] **Step 1: Update the employee imports**

In `js/pages/employee.js` line 6, change:

```js
import { calcWorkingDays, isCancellable, validateApplication, remaining } from "../core/rules.js";
```

to:

```js
import { calcWorkingDays, isCancellable, isNonWorkingHoliday, validateApplication, remaining } from "../core/rules.js";
```

Line 10, change:

```js
import { LEAVE_DETAIL_FIELDS } from "../core/constants.js";
```

to:

```js
import { LEAVE_DETAIL_FIELDS, HOLIDAY_KIND_LABELS } from "../core/constants.js";
```

- [ ] **Step 2: Update the employee legend and store**

Line 427, change the legend to:

```js
    <div class="cal-legend" style="margin-top:8px"><span>🟩 Approved</span><span>🟨 Pending</span><span>🟧 Holiday</span><span>⬜ Observance</span></div></div></div>`;
```

Line 431, change:

```js
  const holSet = new Map(hols.map((h) => [h.date || h.id, h.name]));
```

to:

```js
  const holSet = new Map(hols.map((h) => [h.date || h.id, { name: h.name, kind: h.kind }]));
```

Lines 457-460, change the cell rendering to:

```js
      const hol = holSet.get(iso);
      const cls = st === "APPROVED" ? "has-APPROVED" : st ? "has-PENDING" : "";
      const holCls = hol ? (isNonWorkingHoliday(hol.kind) ? "is-holiday" : "is-observance") : "";
      const title = `${iso}${hol ? " — " + hol.name : ""}${st ? " — " + st : ""}`;
      return `<button class="cal-day ${cls} ${holCls}" data-day="${esc(iso)}" title="${esc(title)}" aria-label="${esc(title)}">${+iso.slice(8)}</button>`;
```

Line 468, change the day-sheet line to:

```js
      ${hol ? `<p style="color:var(--muted)">${isNonWorkingHoliday(hol.kind) ? "🎉 " : ""}${esc(hol.name)} <i>(${esc(HOLIDAY_KIND_LABELS[hol.kind] || hol.kind)})</i></p>` : ""}
```

- [ ] **Step 3: Update the admin imports**

In `js/pages/admin.js` line 8 (already changed in Task 4), keep `HOLIDAY_KIND_LABELS`.

Line 10, change:

```js
import { reviewActionsFor, reviewStage } from "../core/rules.js";
```

to:

```js
import { isNonWorkingHoliday, reviewActionsFor, reviewStage } from "../core/rules.js";
```

- [ ] **Step 4: Update the admin calendar store and cell**

Line 432, change:

```js
    const holSet = new Map(hols.map((h) => [h.date || h.id, h.name]));
```

to:

```js
    const holSet = new Map(hols.map((h) => [h.date || h.id, { name: h.name, kind: h.kind }]));
```

Line 449, replace the button template with:

```js
      const hol = holSet.get(iso);
      const holCls = hol ? (isNonWorkingHoliday(hol.kind) ? "is-holiday" : "is-observance") : "";
      return `<button class="cal-day ${st === "APPROVED" ? "has-APPROVED" : st ? "has-PENDING" : ""} ${holCls}" data-day="${esc(iso)}" title="${esc(iso)}${hol ? ` — ${esc(hol.name)}` : ""}" aria-label="${esc(iso)}${list.length ? `, ${list.length} on leave` : ""}">${+iso.slice(8)}</button>`;
```

Line 457, change the day-sheet line to:

```js
        ${hol ? `<p style="color:var(--muted)">${isNonWorkingHoliday(hol.kind) ? "🎉 " : ""}${esc(hol.name)} <i>(${esc(HOLIDAY_KIND_LABELS[hol.kind] || hol.kind)})</i></p>` : ""}
```

- [ ] **Step 5: Add the observance style**

In `css/employee.css`, after line 102 (`.cal-day.is-holiday`), insert:

```css
.cal-day.is-observance { border-color: var(--line); border-style: dashed; color: var(--muted); }
```

- [ ] **Step 6: Verify visually**

With the emulators and static server running, use Playwright at `http://127.0.0.1:8000/index.html?emulator=1`:

1. Sign in as an employee (`employee@example.com` / `Employee123!` if the bootstrap created it; otherwise use the admin account, which also renders the employee calendar).
2. Open **Calendar**, navigate to **July 2026**.
3. Confirm `button.cal-day[data-day="2026-07-27"]` has class `is-observance` and a dashed border, and `button.cal-day[data-day="2026-12-25"]` has `is-holiday` and a solid orange border.
4. Click 2026-07-27 and confirm the sheet reads `Iglesia ni Cristo Day (Special working day)`.
5. Repeat steps 2-4 in the admin **Calendar** section.
6. Resize to 375×812 and confirm the legend wraps without overflow.

Run in the browser console to assert quickly:

```js
document.querySelector('[data-day="2026-07-27"]').className
// expected: "cal-day is-observance"
document.querySelector('[data-day="2026-12-25"]').className
// expected: "cal-day is-holiday"
```

- [ ] **Step 7: Re-run the E2E**

Run:

```powershell
$env:APP_URL='http://127.0.0.1:8000/index.html?emulator=1'
node tests/e2e-firestore.mjs
```

Expected: all assertions `PASS`.

- [ ] **Step 8: Commit**

```powershell
$env:GIT_MASTER='1'; git add js/pages/employee.js js/pages/admin.js css/employee.css; git commit -m "feat: distinguish holidays from observances in calendars"
```

---

### Task 6: Documentation and full verification

**Files:**
- Modify: `js/data/repository.js:58`
- Modify: `docs/FIRESTORE.md:37,146`
- Modify: `docs/spec.md` section 29 (around line 1053)

**Interfaces:**
- Consumes: everything above.
- Produces: documentation only.

- [ ] **Step 1: Update the schema comment**

In `js/data/repository.js` line 58, change:

```js
 *   holidays/{YYYY-MM-DD}        date,name,kind(regular|special)
```

to:

```js
 *   holidays/{YYYY-MM-DD}        date,name,kind(regular|special|special_working|observance)
```

- [ ] **Step 2: Update the Firestore guide**

In `docs/FIRESTORE.md` line 37, change `PH 2026 holidays` to `PH 2026 holidays (20 non-working + 13 working)`.

Line 146, change `seed (14 types / 9 holidays / settings)` to `seed (14 types / 33 holidays / settings)`.

- [ ] **Step 3: Update the product spec**

In `docs/spec.md`, inside section **29. HOLIDAY MANAGEMENT**, after the sentence `The working-day calculator must use configured holidays.`, insert:

```markdown
Each holiday document has a `kind`:

| Kind | Non-working? | Effect on leave days |
|---|---|---|
| `regular` | Yes | Excluded |
| `special` | Yes | Excluded |
| `special_working` | No | Counted |
| `observance` | No | Counted |

Only `regular` and `special` reduce leave days. `special_working` and
`observance` are display-only calendar labels. A missing `kind` is treated as
non-working for backward compatibility with documents created before this rule.
```

- [ ] **Step 4: Run the pure unit test**

Run: `node tests/rules.mjs`

Expected: `11 passed`, exit code 0.

- [ ] **Step 5: Run the full E2E suite**

Run:

```powershell
$env:APP_URL='http://127.0.0.1:8000/index.html?emulator=1'
node tests/e2e-firestore.mjs
```

Expected: every line `PASS`, zero `FAIL`.

- [ ] **Step 6: Run the role-config check**

Run:

```powershell
node tests/role-config.mjs
```

Expected: exit code 0. If it needs the emulator, keep the emulator terminal running.

- [ ] **Step 7: Check diagnostics on every changed file**

Run:

```powershell
git diff --name-only HEAD~5
```

Then run `lsp_diagnostics` on each changed JS file. Expected: no errors (warnings unrelated to these edits are acceptable and must be reported, not fixed).

- [ ] **Step 8: Commit**

```powershell
$env:GIT_MASTER='1'; git add js/data/repository.js docs/FIRESTORE.md docs/spec.md; git commit -m "docs: document holiday kinds and 2026 calendar"
```

---

## Self-Review Notes

- **Spec coverage:** every spec section maps to a task — data model to Tasks 1-2, working-day semantics to Tasks 1 and 3, admin list/modal to Task 4, calendar display to Task 5, docs to Task 6, tests to Tasks 1-3 and 6.
- **Placeholder scan:** no TBD/TODO; every code step contains the exact code; verification steps contain exact commands and expected output.
- **Type consistency:** `isNonWorkingHoliday`, `NON_WORKING_HOLIDAY_KINDS`, and `HOLIDAY_KIND_LABELS` are defined once in Task 1 and used verbatim in Tasks 3-5. `holidayDates()` keeps its existing name and return type.
- **Known risk:** the E2E exact-count assertion assumes a clean emulator holiday collection. If a prior run left a manually created holiday, restart the emulator before Task 2 step 4.
