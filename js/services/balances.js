import { repo } from "../data/repository.js";
import { remaining } from "../core/rules.js";

export async function myBalances(uid) {
  const bals = await repo.list("leaveBalances", { where: [["uid", "==", uid]], limit: 50 });
  const types = await repo.list("leaveTypes", { limit: 50 });
  const byCode = new Map(types.map((t) => [t.code || t.id, t]));
  return bals.map((b) => {
    const t = byCode.get(b.leaveTypeCode) || {};
    return { ...b, leaveTypeName: t.name || b.leaveTypeCode, remaining: remaining(b.earned, b.used, b.pending) };
  });
}

export async function balanceFor(uid, leaveTypeCode) {
  const rows = await repo.list("leaveBalances", { where: [["uid", "==", uid], ["leaveTypeCode", "==", leaveTypeCode]], limit: 1 });
  const b = rows[0] || { uid, leaveTypeCode, earned: 0, used: 0, pending: 0 };
  return { ...b, remaining: remaining(b.earned, b.used, b.pending) };
}

export async function adjust(uid, leaveTypeCode, delta, reason, actor) {
  return repo.adjustBalance({ uid, leaveTypeCode, delta, reason, actor });
}

export async function transactions(uid, leaveTypeCode, limit = 100) {
  const where = [["uid", "==", uid]];
  if (leaveTypeCode) where.push(["leaveTypeCode", "==", leaveTypeCode]);
  return repo.list("leaveBalanceTransactions", { where, orderBy: [["createdAt", "desc"]], limit });
}

export async function allBalances(limit = 500) {
  return repo.list("leaveBalances", { limit });
}
