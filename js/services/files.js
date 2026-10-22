/* Files seam: upload / getUrl / remove. Spark plan: small files ride as
 * base64 data URLs in the fileBlobs collection — no Storage dependency. */
import { getSettings } from "./settings.js";
import { repo } from "../data/repository.js";
import { currentUser } from "./auth.js";
import { REVIEWER_ROLES } from "../core/constants.js";

const ACCEPT = ["application/pdf", "image/jpeg", "image/png", "image/jpg"];
const FIRESTORE_MAX_BYTES = 700 * 1024;

function blobToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error || new Error("Could not read file"));
    r.readAsDataURL(file);
  });
}

export function validateFile(file, maxMb) {
  const okType = ACCEPT.includes(file.type) || /\.(pdf|jpe?g|png)$/i.test(file.name);
  if (!okType) return "Only PDF, JPG, PNG allowed";
  if (file.size > maxMb * 1024 * 1024) return `File exceeds ${maxMb} MB`;
  return null;
}

export async function upload(file, path) {
  const settings = await getSettings().catch(() => ({ uploadMaxMb: 5 }));
  const err = validateFile(file, settings.uploadMaxMb || 5);
  if (err) throw new Error(err);
  // Spark plan has no Storage guarantee: small files ride as base64 inside
  // Firestore (1 MiB doc cap => ~700 KB raw cap after base64 inflation).
  if (file.size > FIRESTORE_MAX_BYTES) {
    throw new Error("Online mode accepts files up to 700 KB (free-plan limit). Compress the file and retry.");
  }
  const dataUrl = await blobToDataUrl(file);
  await repo.create("fileBlobs", {
    path, data: dataUrl, size: file.size, mimeType: file.type || "application/octet-stream",
    uid: (currentUser() || {}).uid || "", createdAt: new Date().toISOString(),
  });
  return { path, size: file.size, mimeType: file.type };
}

async function blobRows(path) {
  // Owners filter by their own uid (list rules); reviewers read anything.
  const me = currentUser() || {};
  const elevated = REVIEWER_ROLES.includes(me.role);
  const where = [["path", "==", path]];
  if (!elevated && me.uid) where.push(["uid", "==", me.uid]);
  return repo.list("fileBlobs", { where, limit: 10 });
}

export async function getUrl(path) {
  const rows = await blobRows(path);
  if (!rows.length || !rows[0].data) throw new Error("File not found");
  return rows[0].data;
}

export async function remove(path) {
  const rows = await blobRows(path);
  await Promise.all(rows.map((r) => repo.remove("fileBlobs", r.id)));
}

export function storagePath(uid, applicationId, fileName) {
  const safe = String(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
  return `leave-documents/${uid}/${applicationId}/${safe}`;
}
