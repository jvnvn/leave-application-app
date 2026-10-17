/* Leaves service — thin wrapper over repo atomic ops + read helpers. */
import { repo } from "../data/repository.js";
import { calcWorkingDays } from "../core/rules.js";

export async function myApplications(uid, filter = "all", limit = 200) {
  const rows = await repo.list("leaveApplications", {
    where: [["uid", "==", uid]],
    orderBy: [["submittedAt", "desc"]],
    limit,
  });
  if (filter === "pending") return rows.filter((a) => ["DRAFT", "PENDING", "UNDER_REVIEW", "FOR_SUPERVISOR_REVIEW", "FOR_FINAL_APPROVAL"].includes(a.status));
  if (filter === "history") return rows.filter((a) => ["APPROVED", "REJECTED", "CANCELLED"].includes(a.status));
  return rows;
}

export async function allApplications({ status, type, department, from, to, search, limit = 200 } = {}) {
  // Indexed pre-filter server-side; the rest client-side on small sets.
  const where = [];
  if (status) where.push(["status", "==", status]);
  if (type) where.push(["leaveTypeCode", "==", type]);
  let rows = await repo.list("leaveApplications", { where, orderBy: [["submittedAt", "desc"]], limit });
  if (department) rows = rows.filter((a) => a.department === department);
  if (from) rows = rows.filter((a) => a.startDate >= from);
  if (to) rows = rows.filter((a) => a.endDate <= to);
  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter((a) => `${a.employeeName || ""}`.toLowerCase().includes(q));
  }
  return rows;
}

export async function applicationDetail(id) {
  const app = await repo.get("leaveApplications", id);
  if (!app) return null;
  const approvals = await repo.list("leaveApplications/" + id + "/approvals", { orderBy: [["timestamp", "asc"]], limit: 100 });
  const documents = await repo.list("leaveApplications/" + id + "/documents", { limit: 50 });
  return { ...app, approvals, documents };
}

export async function submitLeave(application, documents = []) {
  return repo.submitApplication({ application, documents });
}

export async function cancelLeave(applicationId, actor) {
  return repo.cancelApplication({ applicationId, actor });
}

export async function addDocument(applicationId, doc, actor) {
  return repo.addDocument({ applicationId, doc, actor });
}

export async function workingDays(startDate, endDate) {
  const holidays = await repo.list("holidays", { limit: 200 });
  return calcWorkingDays(startDate, endDate, holidays.map((h) => h.date || h.id));
}
