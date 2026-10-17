import { repo } from "../data/repository.js";

export async function listAudit({ entity, action, limit = 200 } = {}) {
  const where = [];
  if (entity) where.push(["entity", "==", entity]);
  if (action) where.push(["action", "==", action]);
  return repo.list("auditLogs", { where, orderBy: [["createdAt", "desc"]], limit });
}
