/* Local adapter: localStorage (+ IndexedDB for file blobs) implementing the
 * repository contract. Active in demo mode. Every JSON.parse and every write
 * is wrapped in try/catch; corrupted data reseeds demo data instead of
 * crashing. Real-time is emulated with an event emitter + the "storage"
 * event so the UI already uses the onSnapshot pattern. */
import { seedBundle, balanceSeedsFor, DEMO_PASSWORD } from "./seed.js";
import { calcWorkingDays, canTransition, remaining, newInviteToken, inviteExpiry, inviteStatus, validPassword } from "../core/rules.js";
import { nowISO } from "../core/dates.js";

const PREFIX = "lms.v1.";
const DB_KEY = `${PREFIX}db`;
const SESSION_KEY = `${PREFIX}session`;

function blankDb() {
  return {
    users: {}, departments: {}, leaveTypes: {}, leaveBalances: {},
    leaveBalanceTransactions: {}, leaveApplications: {}, approvals: {},
    documents: {}, notifications: {}, auditLogs: {}, holidays: {}, settings: {},
  };
}

function loadDb() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return null;
    const db = JSON.parse(raw);
    if (!db || typeof db !== "object") return null;
    return Object.assign(blankDb(), db);
  } catch {
    return null; // corrupted -> caller reseeds
  }
}

let corrupted = false;
function saveDb(db) {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch (e) {
    if (e && (e.name === "QuotaExceededError" || e.code === 22)) {
      throw new Error("Storage is full (for example a file upload was too big). Remove a document and try again.");
    }
    throw e;
  }
}

// ---- normalization: every record gets defaults so missing fields never crash rendering ----
function norm(base, rec) {
  return Object.assign({}, base, rec);
}
const DEFAULTS = {
  users: { email: "", name: "", role: "employee", employeeNo: "", department: "", position: "", status: "active", dateHired: "", phone: "", avatarColor: "#64748B", supervisorUid: "", createdAt: "" },
  leaveTypes: { code: "", name: "Unknown leave", active: true, requiresDoc: false, maxDays: 0, description: "" },
  leaveBalances: { uid: "", leaveTypeCode: "", earned: 0, used: 0, pending: 0 },
  leaveApplications: { uid: "", employeeName: "", department: "", position: "", leaveTypeCode: "", leaveTypeName: "", startDate: "", endDate: "", workingDays: 0, reason: "", emergencyName: "", emergencyRelationship: "", emergencyPhone: "", details: {}, status: "UNKNOWN", submittedAt: "", updatedAt: "" },
  approvals: { applicationId: "", step: "", approverUid: "", approverName: "", role: "", action: "", comment: "", timestamp: "" },
  documents: { applicationId: "", fileName: "", path: "", size: 0, mimeType: "", uploadedAt: "" },
  notifications: { uid: "", title: "", body: "", type: "info", read: false, createdAt: "" },
  auditLogs: { actorUid: "", actorEmail: "", action: "", entity: "", entityId: "", description: "", meta: {}, createdAt: "" },
  holidays: { date: "", name: "", kind: "regular" },
  invites: { token: "", uid: "", email: "", kind: "invite", status: "requested", expiresAt: "", used: false, createdAt: "" },
  deletionRequests: { uid: "", email: "", name: "", requestedBy: "", requestedByName: "", status: "pending", createdAt: "" },
  settings: { orgName: "", office: "", salaryVisible: false, charLimit: 500, cancellationPolicy: "", workflowVacation: "hr_only", workflowDefault: "hr_supervisor_final", uploadMaxMb: 5, notifEnabled: true, signatories: {} },
  departments: { name: "" },
  leaveBalanceTransactions: { uid: "", leaveTypeCode: "", type: "", days: 0, applicationId: "", reason: "", actorUid: "", createdAt: "" },
};

function normalize(collection, id, rec) {
  const base = DEFAULTS[collection] || {};
  const out = norm(base, rec || {});
  out.id = id;
  if (out.details == null || typeof out.details !== "object") out.details = {};
  if (out.meta == null || typeof out.meta !== "object") out.meta = {};
  if (out.signatories == null || typeof out.signatories !== "object") out.signatories = {};
  return out;
}

// ---- pub/sub emulating onSnapshot ----
const listeners = new Set();
function emit(collection, queryKey) {
  listeners.forEach((l) => {
    try {
      if (l.collection === collection) l.cb(snapshotFor(l.collection, l.query));
    } catch (e) { console.error(e); }
  });
  void queryKey;
}
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === DB_KEY) listeners.forEach((l) => { try { l.cb(snapshotFor(l.collection, l.query)); } catch (err) { console.error(err); } });
  });
}

// ---- query engine (ops: == in < <= > >= array-contains ONLY) ----
function match(rec, [field, op, value]) {
  const v = rec[field];
  switch (op) {
    case "==": return v === value;
    case "in": return Array.isArray(value) && value.includes(v);
    case "<": return v < value;
    case "<=": return v <= value;
    case ">": return v > value;
    case ">=": return v >= value;
    case "array-contains": return Array.isArray(v) && v.includes(value);
    default: throw new Error(`Unsupported op: ${op}`);
  }
}

function collectionRecords(db, collection) {
  // Subcollection reads (Firestore-shaped paths): approvals and documents
  // live in flat stores with an applicationId field — resolve them here so
  // both adapters answer the same paths.
  const sub = /^leaveApplications\/([^/]+)\/(approvals|documents)$/.exec(collection || "");
  if (sub) {
    const store = db[sub[2]] || {};
    return Object.entries(store)
      .filter(([, r]) => r && r.applicationId === sub[1])
      .map(([id, rec]) => normalize(sub[2], id, rec));
  }
  const store = db[collection] || {};
  return Object.entries(store).map(([id, rec]) => normalize(collection, id, rec));
}

function applyQuery(db, collection, query = {}) {
  let rows = collectionRecords(db, collection);
  for (const w of query.where || []) rows = rows.filter((r) => match(r, w));
  for (const [f, dir] of (query.orderBy || []).slice().reverse()) {
    rows.sort((a, b) => {
      const x = a[f] == null ? "" : a[f], y = b[f] == null ? "" : b[f];
      return (x < y ? -1 : x > y ? 1 : 0) * (dir === "desc" ? -1 : 1);
    });
  }
  // NOTE: complex filtering beyond indexed fields is done client-side on
  // small result sets by the services layer.
  if (query.cursor) {
    const i = rows.findIndex((r) => r.id === query.cursor);
    if (i >= 0) rows = rows.slice(i + 1);
  }
  if (query.limit != null) rows = rows.slice(0, query.limit);
  return rows;
}

function snapshotFor(collection, query) {
  const db = loadDb() || blankDb();
  return applyQuery(db, collection, query);
}

function notifyUser(db, uid, title, body, type = "info") {
  if (!uid) return;
  const id = uuid();
  db.notifications[id] = { uid, title, body: body || "", type, read: false, createdAt: nowISO() };
}

function audit(db, actorUid, actorEmail, action, entity, entityId, description, meta = {}) {
  const id = uuid();
  db.auditLogs[id] = { actorUid: actorUid || "", actorEmail: actorEmail || "", action, entity: entity || "", entityId: String(entityId || ""), description: description || "", meta, createdAt: nowISO() };
}

export function uuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

function balanceId(uid, code) {
  return `${uid}_${code}`;
}

export function wasCorrupted() {
  return corrupted;
}

function ensureSeeded() {
  let db = loadDb();
  if (db && Object.keys(db.users || {}).length) return { db, reseeded: false };
  // Missing or corrupted -> (re)seed demo data instead of crashing.
  if (db === null && localStorage.getItem(DB_KEY) != null) corrupted = true;
  db = blankDb();
  const b = seedBundle();
  for (const d of b.departments) db.departments[d.id] = { name: d.name };
  for (const t of b.leaveTypes) db.leaveTypes[t.code] = { ...t };
  for (const h of b.holidays) db.holidays[h.date] = { ...h };
  db.settings[b.settings.id] = { ...b.settings };
  for (const u of b.users) {
    db.users[u.uid] = { ...u, password: DEMO_PASSWORD, createdAt: nowISO() };
    for (const bal of balanceSeedsFor(u.uid)) db.leaveBalances[balanceId(bal.uid, bal.leaveTypeCode)] = { ...bal };
  }
  audit(db, "", "system", "seed", "system", "", "Demo data seeded");
  saveDb(db);
  return { db, reseeded: true };
}

export const localAdapter = {
  kind: "local",

  async get(collection, id) {
    const { db } = ensureSeeded();
    const rec = (db[collection] || {})[id];
    return rec ? normalize(collection, id, rec) : null;
  },

  async list(collection, query = {}) {
    ensureSeeded();
    return snapshotFor(collection, query);
  },

  async create(collection, data, optionalId) {
    const { db } = ensureSeeded();
    const id = optionalId || (collection === "holidays" && data.date) || (collection === "settings" ? "app" : uuid());
    db[collection] = db[collection] || {};
    db[collection][id] = { ...(data || {}) };
    if (collection === "leaveBalances" && !optionalId && data.uid && data.leaveTypeCode && id === undefined) {
      db[collection][balanceId(data.uid, data.leaveTypeCode)] = { ...(data || {}) };
      delete db[collection][id];
      saveDb(db);
      emit(collection);
      return balanceId(data.uid, data.leaveTypeCode);
    }
    saveDb(db);
    emit(collection);
    return id;
  },

  async update(collection, id, patch) {
    const { db } = ensureSeeded();
    db[collection] = db[collection] || {};
    db[collection][id] = { ...(db[collection][id] || {}), ...(patch || {}) };
    saveDb(db);
    emit(collection);
  },

  async remove(collection, id) {
    const { db } = ensureSeeded();
    if (db[collection]) delete db[collection][id];
    saveDb(db);
    emit(collection);
  },

  subscribe(collection, query, callback) {
    ensureSeeded();
    const entry = { collection, query: query || {}, cb: callback };
    listeners.add(entry);
    try {
      callback(snapshotFor(collection, query || {}));
    } catch (e) { console.error(e); }
    return () => listeners.delete(entry);
  },

  /* ---- atomic: all-or-nothing via snapshot + rollback before write ---- */
  async submitApplication({ application, documents = [] }) {
    const { db } = ensureSeeded();
    const backup = JSON.stringify(db);
    try {
      const lt = db.leaveTypes[application.leaveTypeCode];
      if (!lt || !lt.active) throw new Error("Invalid or disabled leave type");
      const days = calcWorkingDays(application.startDate, application.endDate, Object.keys(db.holidays || {}));
      if (days <= 0) throw new Error("Selected range has 0 working days (weekends/holidays excluded)");
      if ((lt.maxDays || 0) > 0 && days > lt.maxDays) throw new Error(`This leave allows at most ${lt.maxDays} days per application`);
      const mine = Object.entries(db.leaveApplications || {})
        .filter(([, a]) => a.uid === application.uid && !["REJECTED", "CANCELLED"].includes(a.status));
      const overlap = mine.find(([, a]) => !(a.endDate < application.startDate || a.startDate > application.endDate));
      if (overlap) throw new Error("Overlapping leave application exists");
      const noBalance = application.leaveTypeCode === "unpaid" || application.leaveTypeCode === "other" || (lt.maxDays || 0) > 0;
      const bId = balanceId(application.uid, application.leaveTypeCode);
      const bal = db.leaveBalances[bId] || { uid: application.uid, leaveTypeCode: application.leaveTypeCode, earned: 0, used: 0, pending: 0 };
      if (!noBalance && remaining(bal.earned, bal.used, bal.pending) < days)
        throw new Error("Insufficient leave balance");
      const id = uuid();
      db.leaveApplications[id] = {
        ...application,
        workingDays: days,
        leaveTypeName: lt.name,
        status: "PENDING",
        submittedAt: nowISO(),
        updatedAt: nowISO(),
      };
      db.approvals[uuid()] = { applicationId: id, step: "SUBMISSION", approverUid: application.uid, approverName: application.employeeName || "", role: "", action: "SUBMITTED", comment: "Application submitted", timestamp: nowISO() };
      if (!noBalance) {
        db.leaveBalances[bId] = { ...bal, pending: bal.pending + days };
        db.leaveBalanceTransactions[uuid()] = { uid: application.uid, leaveTypeCode: application.leaveTypeCode, type: "hold", days, applicationId: id, reason: `Hold for ${application.startDate}→${application.endDate}`, actorUid: application.uid, createdAt: nowISO() };
      }
      for (const d of documents) db.documents[uuid()] = { applicationId: id, ...d, uploadedAt: nowISO() };
      Object.values(db.users || {})
        .filter((u) => ["hr_staff", "hr_admin", "sys_admin"].includes(u.role) && u.status === "active")
        .forEach((u, i) => notifyUser(db, Object.keys(db.users).find((k) => db.users[k] === u) || Object.keys(db.users)[i], "New leave application", `${lt.name} from ${application.employeeName || ""}`, "leave"));
      audit(db, application.uid, "", "application_submitted", "leave_application", id, `${lt.name} ${application.startDate}→${application.endDate} (${days}d)`);
      saveDb(db);
      emit("leaveApplications"); emit("leaveBalances"); emit("notifications"); emit("auditLogs");
      return { id, workingDays: days };
    } catch (e) {
      localStorage.setItem(DB_KEY, backup); // rollback
      throw e;
    }
  },

  async reviewApplication({ applicationId, action, actor, comment = "" }) {
    const { db } = ensureSeeded();
    const backup = JSON.stringify(db);
    try {
      const app = db.leaveApplications[applicationId];
      if (!app) throw new Error("Application not found");
      if (!canTransition(app.status, action)) throw new Error(`Cannot move from ${app.status} to ${action}`);
      if (action === "REJECTED" && !comment.trim()) throw new Error("A comment is required to reject");
      const ltR = db.leaveTypes[app.leaveTypeCode] || {};
      const noBalance = app.leaveTypeCode === "unpaid" || app.leaveTypeCode === "other" || (ltR.maxDays || 0) > 0;
      const bId = balanceId(app.uid, app.leaveTypeCode);
      const bal = db.leaveBalances[bId] || { uid: app.uid, leaveTypeCode: app.leaveTypeCode, earned: 0, used: 0, pending: 0 };
      app.status = action;
      app.updatedAt = nowISO();
      db.approvals[uuid()] = { applicationId, step: action === "APPROVED" ? "APPROVAL" : "REVIEW", approverUid: actor.uid, approverName: actor.name || "", role: actor.role || "", action, comment, timestamp: nowISO() };
      if (!noBalance) {
        if (action === "APPROVED") {
          db.leaveBalances[bId] = { ...bal, used: bal.used + app.workingDays, pending: Math.max(0, bal.pending - app.workingDays) };
          db.leaveBalanceTransactions[uuid()] = { uid: app.uid, leaveTypeCode: app.leaveTypeCode, type: "debit", days: app.workingDays, applicationId, reason: "Approved", actorUid: actor.uid, createdAt: nowISO() };
        } else if (action === "REJECTED") {
          db.leaveBalances[bId] = { ...bal, pending: Math.max(0, bal.pending - app.workingDays) };
          db.leaveBalanceTransactions[uuid()] = { uid: app.uid, leaveTypeCode: app.leaveTypeCode, type: "release", days: app.workingDays, applicationId, reason: comment || "Rejected", actorUid: actor.uid, createdAt: nowISO() };
        }
      }
      notifyUser(db, app.uid, `Leave ${action === "APPROVED" ? "approved" : action === "REJECTED" ? "rejected" : "updated"}`, `${app.leaveTypeName || app.leaveTypeCode}: ${action}${comment ? " — " + comment : ""}`, "leave");
      if (["FOR_SUPERVISOR_REVIEW", "FOR_FINAL_APPROVAL", "UNDER_REVIEW"].includes(action)) {
        const target = action === "FOR_SUPERVISOR_REVIEW" ? ["supervisor"] : action === "FOR_FINAL_APPROVAL" ? ["final_approver", "hr_admin"] : ["hr_staff", "hr_admin"];
        Object.entries(db.users || {})
          .filter(([, u]) => target.includes(u.role) && u.status === "active")
          .forEach(([uid]) => notifyUser(db, uid, "Leave needs review", `${app.employeeName || ""} — ${app.leaveTypeName || ""}`, "leave"));
      }
      audit(db, actor.uid, actor.email || "", "application_" + action.toLowerCase(), "leave_application", applicationId, `${action}${comment ? ": " + comment : ""}`);
      saveDb(db);
      emit("leaveApplications"); emit("leaveBalances"); emit("notifications"); emit("auditLogs"); emit("approvals");
      return { ok: true };
    } catch (e) {
      localStorage.setItem(DB_KEY, backup);
      throw e;
    }
  },

  async cancelApplication({ applicationId, actor }) {
    const { db } = ensureSeeded();
    const backup = JSON.stringify(db);
    try {
      const app = db.leaveApplications[applicationId];
      if (!app) throw new Error("Application not found");
      if (!["DRAFT", "PENDING", "UNDER_REVIEW"].includes(app.status)) throw new Error("Cannot cancel at stage " + app.status);
      const ltC = db.leaveTypes[app.leaveTypeCode] || {};
      const noBalance = app.leaveTypeCode === "unpaid" || app.leaveTypeCode === "other" || (ltC.maxDays || 0) > 0;
      const bId = balanceId(app.uid, app.leaveTypeCode);
      const bal = db.leaveBalances[bId];
      if (bal && !noBalance) db.leaveBalances[bId] = { ...bal, pending: Math.max(0, bal.pending - app.workingDays) };
      app.status = "CANCELLED";
      app.updatedAt = nowISO();
      db.approvals[uuid()] = { applicationId, step: "CANCELLATION", approverUid: actor.uid, approverName: actor.name || "", role: actor.role || "", action: "CANCELLED", comment: "Cancelled", timestamp: nowISO() };
      audit(db, actor.uid, actor.email || "", "application_cancelled", "leave_application", applicationId, "Cancelled");
      saveDb(db);
      emit("leaveApplications"); emit("leaveBalances"); emit("auditLogs"); emit("approvals");
      return { ok: true };
    } catch (e) {
      localStorage.setItem(DB_KEY, backup);
      throw e;
    }
  },

  async adjustBalance({ uid, leaveTypeCode, delta, reason, actor }) {
    const { db } = ensureSeeded();
    const backup = JSON.stringify(db);
    try {
      if (!reason || !reason.trim()) throw new Error("A reason is required");
      const bId = balanceId(uid, leaveTypeCode);
      const bal = db.leaveBalances[bId] || { uid, leaveTypeCode, earned: 0, used: 0, pending: 0 };
      db.leaveBalances[bId] = { ...bal, earned: bal.earned + delta };
      db.leaveBalanceTransactions[uuid()] = { uid, leaveTypeCode, type: "adjust", days: delta, applicationId: "", reason, actorUid: actor.uid, createdAt: nowISO() };
      audit(db, actor.uid, actor.email || "", "balance_adjusted", "leave_balance", bId, `${leaveTypeCode} ${delta > 0 ? "+" : ""}${delta}: ${reason}`);
      saveDb(db);
      emit("leaveBalances"); emit("auditLogs");
      return { ok: true };
    } catch (e) {
      localStorage.setItem(DB_KEY, backup);
      throw e;
    }
  },

  async inviteUser({ userData }) {
    const { db } = ensureSeeded();
    const backup = JSON.stringify(db);
    try {
      const email = String(userData.email || "").toLowerCase().trim();
      if (!email) throw new Error("Email is required");
      const dup = Object.values(db.users || {}).some((u) => u.email === email);
      if (dup) throw new Error("An account with this email already exists");
      const uid = uuid();
      db.users[uid] = { ...userData, email, password: null, status: "active", createdAt: nowISO() };
      for (const bal of balanceSeedsFor(uid)) db.leaveBalances[balanceId(bal.uid, bal.leaveTypeCode)] = { ...bal };
      const token = newInviteToken();
      db.invites = db.invites || {};
      db.invites[token] = { token, uid, email, kind: "invite", status: "sent", expiresAt: inviteExpiry(48), used: false, createdAt: nowISO() };
      audit(db, userData.createdBy || "", "", "user_invited", "user", uid, `Invite created for ${email}`);
      saveDb(db);
      emit("users"); emit("invites"); emit("auditLogs");
      return { uid, token, linkPath: `invite.html?token=${token}` };
    } catch (e) {
      localStorage.setItem(DB_KEY, backup);
      throw e;
    }
  },

  async requestPasswordReset({ email }) {
    const { db } = ensureSeeded();
    const backup = JSON.stringify(db);
    try {
      const em = String(email || "").toLowerCase().trim();
      const entry = Object.entries(db.users || {}).find(([, u]) => u.email === em);
      if (!entry) return { ok: true };
      const [uid, u] = entry;
      const token = newInviteToken();
      db.invites = db.invites || {};
      db.invites[token] = { token, uid, email: em, kind: "reset", status: "requested", expiresAt: inviteExpiry(48), used: false, createdAt: nowISO() };
      Object.entries(db.users || {})
        .filter(([, x]) => ["hr_staff", "hr_admin", "sys_admin"].includes(x.role) && x.status === "active")
        .forEach(([hrUid]) => notifyUser(db, hrUid, "Password reset requested", `${u.name || em} forgot their password. Send them a reset link from Users & Roles.`, "security"));
      audit(db, uid, em, "password_reset_requested", "user", uid, "Employee requested a password reset");
      saveDb(db);
      emit("invites"); emit("notifications"); emit("auditLogs");
      return { ok: true };
    } catch (e) {
      localStorage.setItem(DB_KEY, backup);
      throw e;
    }
  },

  async markInviteSent(token) {
    const { db } = ensureSeeded();
    db.invites = db.invites || {};
    if (!db.invites[token]) throw new Error("Invite not found");
    db.invites[token].status = "sent";
    saveDb(db);
    emit("invites");
    return { ok: true };
  },

  async consumeInvite({ token, newPassword }) {
    const { db } = ensureSeeded();
    const backup = JSON.stringify(db);
    try {
      const inv = (db.invites || {})[token];
      const st = inviteStatus(inv);
      if (st !== "valid") throw new Error(st === "used" ? "This link was already used" : st === "expired" ? "This link expired — ask HR for a new one" : "Invalid link");
      if (!validPassword(newPassword)) throw new Error("Password must be at least 8 characters");
      const u = db.users[inv.uid];
      if (!u || u.status !== "active") throw new Error("Account is no longer active");
      u.password = newPassword; // DEMO ONLY plain text (local mode)
      inv.used = true;
      inv.status = "used";
      audit(db, inv.uid, inv.email, "password_set", "user", inv.uid, `Password set via ${inv.kind} link`);
      saveDb(db);
      emit("users"); emit("invites"); emit("auditLogs");
      return { uid: inv.uid };
    } catch (e) {
      localStorage.setItem(DB_KEY, backup);
      throw e;
    }
  },

    async adminSetPassword({ uid, newPassword, actor }) {
    const { db } = ensureSeeded();
    const backup = JSON.stringify(db);
    try {
      const u = db.users[uid];
      if (!u) throw new Error("Account not found");
      if (!validPassword(newPassword)) throw new Error("Password must be at least 8 characters");
      u.password = newPassword;
      audit(db, actor.uid, actor.email || "", "password_reset_admin", "user", uid, `Password set by ${(actor.name || actor.email) || "admin"}`);
      saveDb(db);
      emit("users"); emit("auditLogs");
      return { ok: true };
    } catch (e) {
      localStorage.setItem(DB_KEY, backup);
      throw e;
    }
  },

  async addDocument({ applicationId, doc, actor }) {
    const { db } = ensureSeeded();
    const backup = JSON.stringify(db);
    try {
      const app = db.leaveApplications[applicationId];
      if (!app) throw new Error("Application not found");
      if (!["DRAFT", "PENDING", "UNDER_REVIEW"].includes(app.status)) throw new Error("Cannot attach documents at this stage");
      const id = uuid();
      db.documents[id] = { applicationId, ...(doc || {}), uploadedAt: nowISO() };
      audit(db, (actor && actor.uid) || "", (actor && actor.email) || "", "document_uploaded", "supporting_document", id, (doc && doc.fileName) || "file");
      saveDb(db);
      emit("documents"); emit("auditLogs");
      return { id };
    } catch (e) {
      localStorage.setItem(DB_KEY, backup);
      throw e;
    }
  },

  async requestDeletion({ uid, actor }) {
    const { db } = ensureSeeded();
    const backup = JSON.stringify(db);
    try {
      const u = db.users[uid];
      if (!u) throw new Error("Account not found");
      if (u.role === "sys_admin") throw new Error("System administrator accounts cannot be deleted");
      if (uid === actor.uid) throw new Error("You cannot delete your own account");
      const active = Object.values(db.leaveApplications || {}).some(
        (a) => a.uid === uid && !["APPROVED", "REJECTED", "CANCELLED"].includes(a.status)
      );
      if (active) throw new Error("This account has applications still in review — resolve them first");
      const dup = Object.values(db.deletionRequests || {}).some((r) => r.uid === uid && r.status === "pending");
      if (dup) throw new Error("A deletion request for this account is already pending");
      const id = uuid();
      db.deletionRequests = db.deletionRequests || {};
      db.deletionRequests[id] = { uid, email: u.email, name: u.name, requestedBy: actor.uid, requestedByName: actor.name || actor.email || "", status: "pending", createdAt: nowISO() };
      Object.entries(db.users || {})
        .filter(([sUid, x]) => ["supervisor", "hr_admin", "sys_admin"].includes(x.role) && x.status === "active" && sUid !== actor.uid)
        .forEach(([sUid]) => notifyUser(db, sUid, "Deletion needs confirmation", `${u.name || u.email} was flagged for deletion by ${actor.name || actor.email}. Confirm in Employees.`, "security"));
      audit(db, actor.uid, actor.email || "", "deletion_requested", "user", uid, `Deletion requested for ${u.email}`);
      saveDb(db);
      emit("deletionRequests"); emit("notifications"); emit("auditLogs");
      return { requestId: id };
    } catch (e) {
      localStorage.setItem(DB_KEY, backup);
      throw e;
    }
  },

  async rejectDeletion({ requestId, actor }) {
    const { db } = ensureSeeded();
    db.deletionRequests = db.deletionRequests || {};
    const r = db.deletionRequests[requestId];
    if (!r || r.status !== "pending") throw new Error("Request not found");
    const mine = r.requestedBy === actor.uid;
    const senior = ["supervisor", "hr_admin", "sys_admin"].includes(actor.role);
    if (!mine && !senior) throw new Error("Not allowed");
    r.status = "rejected";
    audit(db, actor.uid, actor.email || "", "deletion_rejected", "user", r.uid, `Deletion request rejected for ${r.email}`);
    saveDb(db);
    emit("deletionRequests"); emit("auditLogs");
    return { ok: true };
  },

  async confirmDeletion({ requestId, actor }) {
    const { db } = ensureSeeded();
    const backup = JSON.stringify(db);
    try {
      const r = (db.deletionRequests || {})[requestId];
      if (!r || r.status !== "pending") throw new Error("Request not found");
      if (!["supervisor", "hr_admin", "sys_admin"].includes(actor.role)) throw new Error("Only a supervisor or above can confirm deletion");
      if (r.requestedBy === actor.uid) throw new Error("The person who requested cannot confirm — ask another supervisor");
      const u = db.users[r.uid];
      if (!u) throw new Error("Account already gone");
      if (u.role === "sys_admin") throw new Error("System administrator accounts cannot be deleted");
      delete db.users[r.uid];
      for (const [bid, b] of Object.entries(db.leaveBalances || {})) if (b.uid === r.uid) delete db.leaveBalances[bid];
      for (const [tok, inv] of Object.entries(db.invites || {})) if (inv.uid === r.uid) delete db.invites[tok];
      delete db.deletionRequests[requestId];
      notifyUser(db, r.requestedBy, "Deletion confirmed", `${r.name || r.email} has been deleted.`, "security");
      audit(db, actor.uid, actor.email || "", "user_deleted", "user", r.uid, `${r.email} deleted (requested by ${r.requestedByName || r.requestedBy})`);
      saveDb(db);
      emit("users"); emit("leaveBalances"); emit("invites"); emit("deletionRequests"); emit("notifications"); emit("auditLogs");
      return { ok: true };
    } catch (e) {
      localStorage.setItem(DB_KEY, backup);
      throw e;
    }
  },

  async seedReferenceData() {    const { db } = ensureSeeded();
    const b = seedBundle();
    for (const d of b.departments) if (!db.departments[d.id]) db.departments[d.id] = { name: d.name };
    for (const t of b.leaveTypes) if (!db.leaveTypes[t.code]) db.leaveTypes[t.code] = { ...t };
    for (const h of b.holidays) if (!db.holidays[h.date]) db.holidays[h.date] = { ...h };
    if (!db.settings.app) db.settings.app = { ...b.settings };
    saveDb(db);
    emit("leaveTypes"); emit("holidays"); emit("settings"); emit("departments");
    return { ok: true };
  },

  resetDemoData() {
    try {
      localStorage.removeItem(DB_KEY);
    } catch { /* ignore */ }
    // Clear file blobs too (best effort).
    try {
      const req = indexedDB.deleteDatabase("lms-files");
      void req;
    } catch { /* ignore */ }
    corrupted = false;
    ensureSeeded();
  },

  sessionKey() {
    return SESSION_KEY;
  },

  /* Wizard draft autosave (local mode). Pages call these — never localStorage. */
  loadDraft(uid) {
    try {
      const raw = localStorage.getItem(`${PREFIX}draft_${uid}`);
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return null;
  },

  saveDraft(uid, state) {
    try {
      const { documents: _d, ...rest } = state || {};
      localStorage.setItem(`${PREFIX}draft_${uid}`, JSON.stringify(rest));
    } catch { /* ignore: quota or private mode */ }
  },

  clearDraft(uid) {
    try {
      localStorage.removeItem(`${PREFIX}draft_${uid}`);
    } catch { /* ignore */ }
  },
};
