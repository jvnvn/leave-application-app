import { repo } from "../data/repository.js";

export async function listEmployees(limit = 500) {
  return repo.list("users", { orderBy: [["name", "asc"]], limit });
}

export async function getEmployee(uid) {
  return repo.get("users", uid);
}

export async function saveEmployee(data, id) {
  if (id) {
    await repo.update("users", id, data);
    return id;
  }
  return repo.create("users", { status: "active", ...(data || {}) });
}

/** HR creates an account: user has NO password until the invite link is used. */
export async function inviteEmployee(data, createdBy) {
  return repo.inviteUser({ userData: { ...data, createdBy: (createdBy && createdBy.uid) || "" } });
}

export function inviteLink(token) {
  const base = location.pathname.replace(/[^/]*$/, "");
  return `${location.origin}${base}invite.html?token=${token}`;
}

export async function setStatus(uid, status) {
  await repo.update("users", uid, { status });
}

export async function listDepartments() {
  return repo.list("departments", { limit: 50 });
}
