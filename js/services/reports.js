import { repo } from "../data/repository.js";

/** Summary by type / department / month, computed client-side on list results. */
export async function summary({ from, to } = {}) {
  let rows = await repo.list("leaveApplications", { limit: 1000 });
  if (from) rows = rows.filter((a) => a.startDate >= from);
  if (to) rows = rows.filter((a) => a.endDate <= to);
  const byType = {}, byDept = {}, byMonth = {}, byStatus = {};
  for (const a of rows) {
    const t = a.leaveTypeName || a.leaveTypeCode || "Unknown";
    byType[t] = (byType[t] || 0) + (a.workingDays || 0);
    const d = a.department || "Unknown";
    byDept[d] = (byDept[d] || 0) + 1;
    const m = (a.startDate || "").slice(0, 7) || "Unknown";
    byMonth[m] = (byMonth[m] || 0) + 1;
    byStatus[a.status || "UNKNOWN"] = (byStatus[a.status || "UNKNOWN"] || 0) + 1;
  }
  return { total: rows.length, byType, byDept, byMonth, byStatus, rows };
}
