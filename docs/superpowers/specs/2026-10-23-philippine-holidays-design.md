# Philippine 2026 Holidays and Observances

**Date:** 2026-10-23
**Status:** Approved (Approach A)
**Owner:** Sisyphus

## Problem

The holiday seed contains only 9 of the Philippines' 21 officially declared 2026
dates. Employees and administrators therefore see an incomplete calendar, and
working-day calculations wrongly count real holidays (Maundy Thursday, Good
Friday, Eid'l Fitr, Bonifacio Day, Christmas Eve, and others) as leave days.

The calendar also has no way to display observances that do not suspend work.

## Scope

**In scope**

- Complete Philippine 2026 calendar: 21 officially declared dates plus 12
  permanent statutory working days / observances.
- Distinguish non-working holidays from observances in the calendar and in the
  admin holiday list.
- Correct working-day calculation so only non-working kinds reduce leave days.
- Seed data, admin CRUD, employee calendar, admin calendar, legend, docs, tests.

**Out of scope**

- Years other than 2026.
- Local, provincial, city, or barangay holidays.
- Automatic yearly rollover or an external holiday API.
- Moving-date recalculation beyond the fixed 2026 values below.

## Decision

**Approach A: extend the existing `holidays` collection.**

One collection, one admin screen, one seed path. `kind` grows from two values to
four, and working-day logic filters on `kind` instead of treating every stored
date as non-working.

Rejected alternatives:

- **B — separate `observances` collection:** cleaner semantics, but adds a
  collection, security rules, service, admin section, and a merge in both
  calendars. No user-visible benefit for 12 extra display rows.
- **C — explicit `nonWorking` boolean:** duplicates information already carried
  by `kind`, creating two sources of truth that can drift.

## Data model

Collection unchanged: `holidays/{YYYY-MM-DD}`.

| Field | Type | Notes |
|---|---|---|
| `date` | `YYYY-MM-DD` | Same as document id. |
| `name` | string | Display name. |
| `kind` | string | `regular` \| `special` \| `special_working` \| `observance` |

### Working-day semantics

| `kind` | Non-working? | Effect on `calcWorkingDays` |
|---|---|---|
| `regular` | Yes | Date excluded |
| `special` | Yes | Date excluded |
| `special_working` | No | Date counts if it is a weekday |
| `observance` | No | Date counts if it is a weekday |
| missing / unknown | Yes | Treated as non-working (preserves legacy behaviour) |

`NON_WORKING_HOLIDAY_KINDS = new Set(["regular", "special"])`.

**Critical:** `holidayDates()` currently returns every stored date. Once
observances exist, that would silently deduct leave days. It must filter to
non-working kinds. The Firestore adapter has a second, independent read of the
same collection and needs the same filter.

### One entry per date

Document id is the date, so a date holds exactly one entry. No two entries in the
2026 set collide. If a future observance lands on a declared holiday, the
declared holiday wins and the observance is omitted; do not merge names.

## Approved 2026 data (33 entries)

### Regular holidays — non-working (12)

| Date | Name | Basis |
|---|---|---|
| 2026-01-01 | New Year's Day | Proclamation 1006 |
| 2026-03-20 | Eid'l Fitr | Proclamation 1189 |
| 2026-04-02 | Maundy Thursday | Proclamation 1006 |
| 2026-04-03 | Good Friday | Proclamation 1006 |
| 2026-04-09 | Araw ng Kagitingan | Proclamation 1006 |
| 2026-05-01 | Labor Day | Proclamation 1006 |
| 2026-05-27 | Eid'l Adha | Proclamation 1264 |
| 2026-06-12 | Independence Day | Proclamation 1006 |
| 2026-08-31 | National Heroes Day | Proclamation 1006 |
| 2026-11-30 | Bonifacio Day | Proclamation 1006 |
| 2026-12-25 | Christmas Day | Proclamation 1006 |
| 2026-12-30 | Rizal Day | Proclamation 1006 |

### Special non-working days (8)

| Date | Name | Basis |
|---|---|---|
| 2026-02-17 | Chinese New Year | Proclamation 1006 |
| 2026-04-04 | Black Saturday | Proclamation 1006 |
| 2026-08-21 | Ninoy Aquino Day | Proclamation 1006 |
| 2026-11-01 | All Saints' Day | Proclamation 1006 |
| 2026-11-02 | All Souls' Day | Proclamation 1006 |
| 2026-12-08 | Feast of the Immaculate Conception | Proclamation 1006 / RA 10966 |
| 2026-12-24 | Christmas Eve | Proclamation 1006 |
| 2026-12-31 | Last Day of the Year | Proclamation 1006 |

### Special working days — working (7)

| Date | Name | Basis |
|---|---|---|
| 2026-01-23 | First Philippine Republic Day | RA 11014 |
| 2026-02-25 | EDSA People Power Revolution Anniversary | Proclamation 1006 |
| 2026-04-27 | Lapu-Lapu Day | RA 11040 |
| 2026-07-27 | Iglesia ni Cristo Day | RA 9645 |
| 2026-09-08 | Feast of the Nativity of Mary | RA 11370 |
| 2026-11-07 | Sheikh Karim'ul Makhdum Day | RA 12228 |
| 2026-11-27 | Araw ng Pagbasa | RA 10556 |

### Observances — working, display only (6)

| Date | Name | Note |
|---|---|---|
| 2026-01-16 | Lailatul Isra wal Mi'raj | Lunar; approximate |
| 2026-02-19 | Start of Ramadan | Lunar; approximate |
| 2026-04-05 | Easter Sunday | Western Easter |
| 2026-06-16 | Amun Jadid (Islamic New Year) | Lunar; approximate |
| 2026-08-26 | Maulid un-Nabi | Lunar; approximate |
| 2026-11-17 | National Students' Day | RA 11369 |

**Totals:** 20 non-working (12 regular + 8 special), 13 working (7 special
working + 6 observance), 33 documents.

### Verified data notes

- PCO's news release lists "Chinese New Year – 17 January (Tuesday)". 17 January
  2026 is a Saturday; 17 February 2026 is a Tuesday. The gov.ph 2026 calendar
  and Proclamation 1006 both place Chinese New Year on **17 February**. Use
  2026-02-17.
- Lunar Islamic dates are calendar estimates for 2026. They are display-only and
  never affect leave balances.
- RA 12228 (Sheikh Karim'ul Makhdum Day) was signed 9 July 2025, so it applies to
  2026.

## Code changes

### 1. `js/core/rules.js`

Add pure constant and predicate next to `calcWorkingDays`:

```js
export const NON_WORKING_HOLIDAY_KINDS = new Set(["regular", "special"]);

/** Legacy or missing kind stays non-working so old documents keep their meaning. */
export function isNonWorkingHoliday(kind) {
  return kind == null || NON_WORKING_HOLIDAY_KINDS.has(kind);
}
```

No change to `calcWorkingDays` itself: it still receives a list of dates to
exclude. The caller decides which dates belong in that list.

### 2. `js/services/holidays.js`

- `holidayDates()` filters with `isNonWorkingHoliday(h.kind)`.
- Add `HOLIDAY_KIND_LABELS` for UI:
  `regular` → "Regular holiday", `special` → "Special non-working",
  `special_working` → "Special working day", `observance` → "Observance".
- `listHolidays`, `saveHoliday`, `removeHoliday` unchanged.

### 3. `js/data/firestore-adapter.js`

Replace the unfiltered date mapping at the transaction read:

```js
const holidayDates = holSnap.docs
  .filter((d) => isNonWorkingHoliday(d.data().kind))
  .map((d) => d.id);
```

Import `isNonWorkingHoliday` from `../core/rules.js` (no service-layer import,
so no dependency cycle).

This is the only path the server-side submission check uses; without it a
submitted leave request would still be charged for observances.

### 4. `js/data/seed.js`

Replace the 9-entry `holidays` array with the 33 entries above.

`seedReferenceData` uses `batch.set(..., { merge: true })`, so re-seeding adds
and updates without deleting. Existing rows are all in the new set, so no stale
documents result.

### 5. `js/pages/admin.js`

**Holiday list (`vHols`)** — show a readable kind instead of the raw token:

```js
<i>(${esc(HOLIDAY_KIND_LABELS[h.kind] || h.kind)})</i>
```

Add a muted note above the list: "Only regular and special non-working days
reduce leave days."

**Add-holiday modal** — select with four options:

```html
<option value="regular">Regular holiday (non-working)</option>
<option value="special">Special non-working day</option>
<option value="special_working">Special working day</option>
<option value="observance">Observance (working)</option>
```

**Admin calendar (`vCal`)** — `holSet` becomes `Map(date → { name, kind })`.
Class selection:

- non-working kind → `is-holiday`
- working kind → `is-observance`

Day sheet keeps the name, but labels the type: "(holiday)" for non-working,
"(observance)" for working kinds.

### 6. `js/pages/employee.js`

Same two changes as the admin calendar:

- `holSet` stores `{ name, kind }`.
- Day cell gets `is-holiday` or `is-observance`.
- Day sheet shows the holiday or observance name with the correct label.

Legend becomes:

```html
<span>Approved</span><span>Pending</span><span>Holiday</span><span>Observance</span>
```

(Existing legend glyph markup preserved; only the observance entry is added.)

### 7. `css/employee.css`

Add one rule, reusing existing tokens (`--muted`, `--line`):

```css
.cal-day.is-observance { border-color: var(--line); border-style: dashed; color: var(--muted); }
```

`is-holiday` keeps its solid `--orange` border, so the two states differ by both
border style and colour, not colour alone.

### 8. `tests/e2e-firestore.mjs`

Current assertion cannot pass with 33 documents:

```js
const hols = await repo.list("holidays", { limit: 20 });
t("seed: 9 holidays", hols.length === 9, String(hols.length));
```

Change to `{ limit: 50 }`, expect 33, and add assertion that observances exist
without being non-working:

```js
const hols = await repo.list("holidays", { limit: 50 });
t("seed: 33 holidays", hols.length === 33, String(hols.length));
t("seed: includes observances", hols.some((h) => h.kind === "observance"));
```

Add a working-day regression check in the same file:

```js
const nonWorking = hols.filter((h) => h.kind === "regular" || h.kind === "special");
t("seed: 20 non-working dates", nonWorking.length === 20, String(nonWorking.length));
```

### 9. Documentation

- `js/data/repository.js:58` — schema comment becomes
  `holidays/{YYYY-MM-DD} date,name,kind(regular|special|special_working|observance)`.
- `docs/FIRESTORE.md` — replace "9 holidays" with "33 holidays (20 non-working)";
  note observances do not affect working days.
- `docs/spec.md` holiday section — add the kind table and the rule that only
  non-working kinds are excluded.

## Behaviour after the change

| Scenario | Before | After |
|---|---|---|
| Leave spanning Maundy Thursday 2026-04-02 | Counted as working day | Excluded |
| Leave spanning Easter Sunday 2026-04-05 | Counted as holiday | Sunday: excluded as weekend anyway; still counts in calendar as observance |
| Leave spanning Araw ng Pagbasa 2026-11-27 | No row existed | Counted as a working day |
| Calendar cell 2026-07-27 | No marker | Dashed observance marker, INC Day label |
| Admin adds "observance" | Not possible | Possible, no leave-day impact |

## Acceptance criteria

1. `seedReferenceData()` writes 33 holiday documents; re-running it does not
   duplicate or delete.
2. A leave application covering 2026-04-02 through 2026-04-04 is charged 0
   working days (Thursday holiday, Friday holiday, Saturday weekend).
3. A leave application covering 2026-11-26 through 2026-11-27 is charged 2
   working days (Araw ng Pagbasa is working).
4. Employee and admin calendars mark 2026-12-25 solid (non-working) and
   2026-07-27 dashed (working).
5. Day sheet for 2026-11-07 reads "Sheikh Karim'ul Makhdum Day (observance)".
6. Admin holiday list shows human-readable kinds and the explanatory note.
7. E2E suite passes with the updated counts; no other test regresses.
8. No `as any`, no silent catches, no changes to Firestore rules required.

## Risks

- **Silent over-deduction** if only one of the two holiday reads is filtered.
  Mitigation: both call sites use the same predicate; acceptance check 3 covers
  the adapter path, check 2 covers the client path.
- **Stale seed documents** if a date is later corrected. Mitigation: seeding
  merges only; admins can delete an incorrect row. No 2026 date changes in this
  set.
- **Lunar date drift.** Mitigation: observances are display-only, so an
  incorrect estimate cannot affect balances.
