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
