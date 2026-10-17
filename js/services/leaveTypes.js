import { repo } from "../data/repository.js";

export async function listLeaveTypes(includeInactive = false, limit = 50) {
  const rows = await repo.list("leaveTypes", { orderBy: [["name", "asc"]], limit });
  return includeInactive ? rows : rows.filter((t) => t.active);
}

export async function getLeaveType(code) {
  return repo.get("leaveTypes", code);
}

export async function saveLeaveType(code, patch) {
  await repo.update("leaveTypes", code, patch);
}
