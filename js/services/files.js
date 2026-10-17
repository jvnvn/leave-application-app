/* Files seam: upload / getUrl / remove. Local mode keeps blobs in
 * IndexedDB ("lms-files"). Firestore mode (Spark plan) stores small files as
 * base64 data in the fileBlobs collection — no Storage dependency. */
import { APP_CONFIG } from "../config.js";
import { getSettings } from "./settings.js";
import { repo } from "../data/repository.js";
import { currentUser } from "./auth.js";

const ACCEPT = ["application/pdf", "image/jpeg", "image/png", "image/jpg"];
const FIRESTORE_MAX_BYTES = 700 * 1024;

function openDb() {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open("lms-files", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("files");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) {
      reject(e);
    }
  });
}

async function idbPut(path, blob) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").put(blob, path);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(path) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readonly");
    const q = tx.objectStore("files").get(path);
    q.onsuccess = () => resolve(q.result || null);
    q.onerror = () => reject(q.error);
  });
}

async function idbDel(path) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").delete(path);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

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
  if (APP_CONFIG.dataSource === "firestore") {
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
  try {
    await idbPut(path, file);
  } catch (e) {
    if (e && e.name === "QuotaExceededError") throw new Error("Storage is full — the file is too big to keep locally.");
    throw e;
  }
  return { path, size: file.size, mimeType: file.type };
}

async function blobRows(path) {
  // Owners filter by their own uid (list rules); reviewers read anything.
  const me = currentUser() || {};
  const elevated = ["hr_staff", "hr_admin", "supervisor", "final_approver", "sys_admin"].includes(me.role);
  const where = [["path", "==", path]];
  if (!elevated && me.uid) where.push(["uid", "==", me.uid]);
  return repo.list("fileBlobs", { where, limit: 10 });
}

export async function getUrl(path) {
  if (APP_CONFIG.dataSource === "firestore") {
    const rows = await blobRows(path);
    if (!rows.length || !rows[0].data) throw new Error("File not found");
    return rows[0].data;
  }
  const blob = await idbGet(path);
  if (!blob) throw new Error("File not found");
  return URL.createObjectURL(blob);
}

export async function remove(path) {
  if (APP_CONFIG.dataSource === "firestore") {
    const rows = await blobRows(path);
    await Promise.all(rows.map((r) => repo.remove("fileBlobs", r.id)));
    return;
  }
  await idbDel(path);
}

export function storagePath(uid, applicationId, fileName) {
  const safe = String(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
  return `leave-documents/${uid}/${applicationId}/${safe}`;
}
