import { repo } from "../data/repository.js";

export async function listHolidays(limit = 200) {
  return repo.list("holidays", { orderBy: [["date", "asc"]], limit });
}

export async function holidayDates() {
  const rows = await listHolidays();
  return rows.map((h) => h.date || h.id);
}

export async function saveHoliday(date, data) {
  return repo.create("holidays", { date, ...(data || {}) }, date);
}

export async function removeHoliday(date) {
  await repo.remove("holidays", date);
}
