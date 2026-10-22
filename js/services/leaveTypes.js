import { repo } from "../data/repository.js";

const CODE_RE = /^[a-z][a-z0-9_]{1,31}$/;

function normalizeCode(code) {
  return String(code || "").trim().toLowerCase();
}

function normalizeType(data = {}) {
  const name = String(data.name || "").trim();
  if (!name) throw new Error("Name is required");
  const maxDays = Number(data.maxDays ?? 0);
  if (!Number.isInteger(maxDays) || maxDays < 0) {
    throw new Error("Max days must be a whole number of 0 or more");
  }
  return {
    name,
    active: data.active !== false,
    requiresDoc: !!data.requiresDoc,
    maxDays,
    description: String(data.description || "").trim().slice(0, 500),
  };
}

async function audit(actor, action, code, description, meta = {}) {
  if (!actor) return;
  try {
    await repo.create("auditLogs", {
      actorUid: actor.uid || "",
      actorEmail: actor.email || "",
      action,
      entity: "leave_type",
      entityId: code,
      description,
      meta,
      createdAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("Leave type audit failed", e);
  }
}

export async function listLeaveTypes(includeInactive = false, limit = 50) {
  const rows = await repo.list("leaveTypes", { orderBy: [["name", "asc"]], limit });
  return includeInactive ? rows : rows.filter((t) => t.active);
}

export async function getLeaveType(code) {
  return repo.get("leaveTypes", code);
}

export async function createLeaveType(code, data, actor) {
  const id = normalizeCode(code);
  if (!CODE_RE.test(id)) {
    throw new Error("Code must start with a letter and use only lowercase letters, numbers, or underscores (2-32 characters)");
  }
  if (await repo.get("leaveTypes", id)) throw new Error("That leave type code already exists");
  const type = normalizeType(data);
  await repo.create("leaveTypes", { code: id, ...type }, id);
  await audit(actor, "leave_type_created", id, `Created leave type ${id} (${type.name})`, type);
  return id;
}

export async function saveLeaveType(code, patch, actor) {
  const id = normalizeCode(code);
  const next = normalizeType(patch);
  await repo.update("leaveTypes", id, next);
  await audit(actor, "leave_type_updated", id, `Updated leave type ${id} (${next.name})`, next);
}

export async function removeLeaveType(code, actor) {
  const id = normalizeCode(code);
  const type = await repo.get("leaveTypes", id);
  if (!type) throw new Error("Leave type not found");

  // Never orphan history. A type with applications, balances, or ledger
  // entries must be deactivated instead of deleted.
  const [apps, balances, txns] = await Promise.all([
    repo.list("leaveApplications", { where: [["leaveTypeCode", "==", id]], limit: 1 }),
    repo.list("leaveBalances", { where: [["leaveTypeCode", "==", id]], limit: 1 }),
    repo.list("leaveBalanceTransactions", { where: [["leaveTypeCode", "==", id]], limit: 1 }),
  ]);
  if (apps.length) throw new Error("This leave type is used by an existing application - deactivate it instead");
  if (balances.length) throw new Error("This leave type has employee balances - deactivate it instead");
  if (txns.length) throw new Error("This leave type has balance transactions - deactivate it instead");

  await repo.remove("leaveTypes", id);
  await audit(actor, "leave_type_removed", id, `Removed leave type ${id} (${type.name || ""})`, {
    name: type.name || "",
  });
}
