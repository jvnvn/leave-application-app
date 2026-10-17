import { repo } from "../data/repository.js";

export async function myNotifications(uid, limit = 100) {
  return repo.list("notifications", { where: [["uid", "==", uid]], orderBy: [["createdAt", "desc"]], limit });
}

export function subscribeMyNotifications(uid, cb) {
  return repo.subscribe("notifications", { where: [["uid", "==", uid]], orderBy: [["createdAt", "desc"]], limit: 100 }, cb);
}

export async function unreadCount(uid) {
  const rows = await repo.list("notifications", { where: [["uid", "==", uid], ["read", "==", false]], limit: 100 });
  return rows.length;
}

export async function markRead(id) {
  await repo.update("notifications", id, { read: true });
}

export async function markAllRead(uid) {
  const rows = await repo.list("notifications", { where: [["uid", "==", uid], ["read", "==", false]], limit: 200 });
  await Promise.all(rows.map((n) => repo.update("notifications", n.id, { read: true })));
}
