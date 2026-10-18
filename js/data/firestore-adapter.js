/* Firestore adapter — implements the repository contract against a real
 * project or the local emulators (?emulator=1). Verified against the
 * Firestore + Auth emulators; see docs/FIRESTORE.md for setup.
 *
 * Identity model (Spark plan, no Cloud Functions): users/{docId} === the
 * Firebase Auth uid. HR invites create pendingProfiles/{token} (profile data
 * waiting for pickup) + invites/{token}. On redemption the new user signs up
 * with email+password themselves (createUserWithEmailAndPassword) and writes
 * their own users/{uid} doc — rules enforce uid==auth.uid and email match.
 * Password resets use Auth's built-in email flow (sendPasswordResetEmail).
 *
 * Dates of leave stay "YYYY-MM-DD" strings; timestamps convert ISO string
 * <-> Date (stored as Firestore Timestamp) at this boundary only.
 */
import { calcWorkingDays, canTransition, remaining } from "../core/rules.js";
import { firebaseCtx } from "./firebase-app.js";

const SUBS = { approvals: "approvals", documents: "documents" };

function segs(collection) {
  return String(collection).split("/").filter(Boolean);
}

async function context() {
  const c = await firebaseCtx();
  return { db: c.db, auth: c.auth, storage: c.storage, fns: { fsMod: c.fsMod, authMod: c.authMod, stMod: c.stMod } };
}

async function resolveRef(collection, id) {
  const { db, fns } = await context();
  const { fsMod } = fns;
  const parts = segs(collection);
  if (parts.length === 1) return fsMod.doc(db, parts[0], id);
  let ref = fsMod.collection(db, parts[0]);
  for (let i = 1; i < parts.length; i += 2) {
    ref = fsMod.collection(fsMod.doc(ref, parts[i]), parts[i + 1]);
  }
  return fsMod.doc(ref, id);
}

function toDoc(data) {
  const out = { ...(data || {}) };
  for (const k of ["createdAt", "submittedAt", "updatedAt", "timestamp", "uploadedAt", "expiresAt"]) {
    if (typeof out[k] === "string" && out[k]) out[k] = new Date(out[k]);
  }
  return out;
}

function fromDoc(id, snap) {
  const d = snap.data() || {};
  const out = { id, ...d };
  for (const k of ["createdAt", "submittedAt", "updatedAt", "timestamp", "uploadedAt", "expiresAt"]) {
    const v = out[k];
    if (v && typeof v.toDate === "function") out[k] = v.toDate().toISOString();
    else if (v instanceof Date) out[k] = v.toISOString();
  }
  if (out.details == null || typeof out.details !== "object") out.details = {};
  if (out.meta == null || typeof out.meta !== "object") out.meta = {};
  return out;
}

async function colRef(collection) {
  const { db, fns } = await context();
  const parts = segs(collection);
  let ref = fns.fsMod.collection(db, parts[0]);
  for (let i = 1; i < parts.length; i += 2) {
    ref = fns.fsMod.collection(fns.fsMod.doc(ref, parts[i]), parts[i + 1]);
  }
  return { ref, fsMod: fns.fsMod };
}

function applyConstraints(fsMod, ref, query = {}) {
  const cs = [];
  for (const [f, op, v] of query.where || []) {
    cs.push(fsMod.where(f, op === "array-contains" ? "array-contains" : op, v));
  }
  for (const [f, dir] of query.orderBy || []) cs.push(fsMod.orderBy(f, dir));
  if (query.limit != null) cs.push(fsMod.limit(query.limit));
  if (query.cursor) cs.push(fsMod.startAfter(query.cursor));
  return cs.length ? fsMod.query(ref, ...cs) : ref;
}

function isPermissionDenied(e) {
  return !!e && (e.code === "permission-denied" || /insufficient permissions/i.test(e.message || ""));
}

/* permission-denied also means a stale ID token - refresh once, then retry. */
async function withFreshAuth(run) {
  try {
    return await run();
  } catch (e) {
    if (!isPermissionDenied(e)) throw e;
    console.error(e);
    const { auth, fns } = await context();
    if (!auth.currentUser) throw new Error("Your sign-in has expired - sign in again.");
    try {
      await fns.authMod.getIdToken(auth.currentUser, true);
    } catch (refreshErr) {
      console.error(refreshErr);
    }
    try {
      return await run();
    } catch (retryErr) {
      if (!isPermissionDenied(retryErr)) throw retryErr;
      console.error(retryErr);
      throw new Error("Your sign-in expired or your role changed - sign in again.");
    }
  }
}

export const firestoreAdapter = {
  kind: "firestore",

  async get(collection, id) {
    return withFreshAuth(async () => {
      const { fns } = await context();
      const snap = await fns.fsMod.getDoc(await resolveRef(collection, id));
      return snap.exists() ? fromDoc(snap.id, snap) : null;
    });
  },

  async list(collection, query = {}) {
    return withFreshAuth(async () => {
      const { ref, fsMod } = await colRef(collection);
      const snap = await fsMod.getDocs(applyConstraints(fsMod, ref, query));
      return snap.docs.map((d) => fromDoc(d.id, d));
    });
  },

  async create(collection, data, optionalId) {
    return withFreshAuth(async () => {
      const { ref, fsMod } = await colRef(collection);
      if (optionalId) {
        await fsMod.setDoc(fsMod.doc(ref, optionalId), toDoc(data));
        return optionalId;
      }
      const doc = await fsMod.addDoc(ref, toDoc(data));
      return doc.id;
    });
  },

  async update(collection, id, patch) {
    return withFreshAuth(async () => {
      const { fns } = await context();
      await fns.fsMod.updateDoc(await resolveRef(collection, id), toDoc(patch));
    });
  },

  async remove(collection, id) {
    return withFreshAuth(async () => {
      const { fns } = await context();
      await fns.fsMod.deleteDoc(await resolveRef(collection, id));
    });
  },

  subscribe(collection, query, callback) {
    let unsub = () => {};
    colRef(collection).then(({ ref, fsMod }) => {
      unsub = fsMod.onSnapshot(
        applyConstraints(fsMod, ref, query),
        (snap) => callback(snap.docs.map((d) => fromDoc(d.id, d))),
        (e) => console.error(e)
      );
    });
    return () => unsub();
  },

  /* HR invites WITHOUT creating a users doc (users/{uid} must equal the
   * future Auth uid, which doesn't exist yet). Profile waits in
   * pendingProfiles/{token}; redemption (auth.js) signs the user up, writes
   * users/{newUid}, then marks the invite used. */
  async inviteUser({ userData }) {
    const { db, fns } = await context();
    const { fsMod } = fns;
    const email = String(userData.email || "").toLowerCase().trim();
    if (!email) throw new Error("Email is required");
    const dupSnap = await fsMod.getDocs(fsMod.query(fsMod.collection(db, "users"), fsMod.where("email", "==", email), fsMod.limit(1)));
    if (!dupSnap.empty) throw new Error("An account with this email already exists");
    const pendSnap = await fsMod.getDocs(fsMod.query(fsMod.collection(db, "invites"), fsMod.where("email", "==", email), fsMod.limit(20)));
    if (pendSnap.docs.some((d) => d.data().used === false)) throw new Error("An invite is already pending for this email");
    const { newInviteToken } = await import("../core/rules.js");
    const token = newInviteToken();
    const { createdBy, password: _pw, ...profile } = userData || {};
    const batch = fsMod.writeBatch(db);
    batch.set(fsMod.doc(db, "pendingProfiles", token), { ...profile, email, status: "active", createdAt: new Date() });
    batch.set(fsMod.doc(db, "invites", token), { token, email, kind: "invite", status: "sent", expiresAt: new Date(Date.now() + 48 * 3600e3), used: false, createdAt: new Date(), createdBy: createdBy || "" });
    batch.set(fsMod.doc(fsMod.collection(db, "auditLogs")), { actorUid: createdBy || "", action: "user_invited", entity: "user", entityId: email, createdAt: new Date() });
    await batch.commit();
    return { uid: null, token, linkPath: `invite.html?token=${token}` };
  },

  async requestPasswordReset({ email }) {
    const { db, fns } = await context();
    const { fsMod } = fns;
    const em = String(email || "").toLowerCase().trim();
    const q = fsMod.query(fsMod.collection(db, "users"), fsMod.where("email", "==", em), fsMod.limit(1));
    const snap = await fsMod.getDocs(q);
    if (snap.empty) return { ok: true };
    const u = snap.docs[0];
    const { newInviteToken } = await import("../core/rules.js");
    const token = newInviteToken();
    const batch = fsMod.writeBatch(db);
    batch.set(fsMod.doc(db, "invites", token), { token, uid: u.id, email: em, kind: "reset", status: "requested", expiresAt: new Date(Date.now() + 48 * 3600e3), used: false, createdAt: new Date() });
    batch.set(fsMod.doc(fsMod.collection(db, "auditLogs")), { actorUid: u.id, action: "password_reset_requested", entity: "user", entityId: u.id, createdAt: new Date() });
    await batch.commit();
    return { ok: true };
  },

  async markInviteSent(token) {
    const { db, fns } = await context();
    await fns.fsMod.updateDoc(fns.fsMod.doc(db, "invites", token), { status: "sent" });
    return { ok: true };
  },

  /* Adapter-level: validate + mark used. The Auth account creation happens in
   * auth.js (setPasswordWithInvite), which calls this last. */
  async consumeInvite({ token, newPassword }) {
    const { db, fns } = await context();
    const { fsMod } = fns;
    const { inviteStatus, validPassword } = await import("../core/rules.js");
    return fsMod.runTransaction(db, async (tx) => {
      const iRef = fsMod.doc(db, "invites", token);
      const iSnap = await tx.get(iRef);
      const raw = iSnap.exists() ? { token, ...iSnap.data() } : null;
      if (raw && raw.expiresAt && typeof raw.expiresAt.toDate === "function") raw.expiresAt = raw.expiresAt.toDate().toISOString();
      if (inviteStatus(raw) !== "valid") throw new Error("This link is invalid, used, or expired");
      if (!validPassword(newPassword)) throw new Error("Password must be at least 8 characters");
      tx.update(iRef, { used: true, status: "used" });
      return { uid: (raw && raw.uid) || null };
    });
  },

  // Kept for interface parity; the app uses Auth's reset-email flow instead.
  async adminSetPassword({ uid, actor }) {
    const { db, fns } = await context();
    const { fsMod } = fns;
    const batch = fsMod.writeBatch(db);
    batch.set(fsMod.doc(fsMod.collection(db, "adminPasswordResets")), { uid, actorUid: (actor && actor.uid) || "", createdAt: new Date(), status: "pending" });
    batch.set(fsMod.doc(fsMod.collection(db, "auditLogs")), { actorUid: (actor && actor.uid) || "", action: "password_reset_admin", entity: "user", entityId: uid, createdAt: new Date() });
    await batch.commit();
    return { ok: true };
  },

  async submitApplication({ application, documents = [] }) {
    const { db, fns } = await context();
    const { fsMod } = fns;
    // Collection/query reads can't run inside a web-SDK transaction — fetch first.
    const holSnap = await fsMod.getDocs(fsMod.collection(db, "holidays"));
    const holidayDates = holSnap.docs.map((d) => d.id);
    return fsMod.runTransaction(db, async (tx) => {
      // All reads first — Firestore forbids reads after writes in a tx.
      const ltSnap = await tx.get(fsMod.doc(db, "leaveTypes", application.leaveTypeCode));
      const peekBid = `${application.uid}_${application.leaveTypeCode}`;
      const peekSnap = await tx.get(fsMod.doc(db, "leaveBalances", peekBid));
      if (!ltSnap.exists() || ltSnap.data().active === false) throw new Error("Invalid or disabled leave type");
      const lt = { code: application.leaveTypeCode, ...ltSnap.data() };
      const days = calcWorkingDays(application.startDate, application.endDate, holidayDates);
      if (days <= 0) throw new Error("Selected range has 0 working days");
      if ((lt.maxDays || 0) > 0 && days > lt.maxDays) throw new Error(`This leave allows at most ${lt.maxDays} days per application`);
      const noBalance = ["unpaid", "other"].includes(application.leaveTypeCode) || (lt.maxDays || 0) > 0;
      const bId = peekBid;
      const bal = peekSnap.exists() ? peekSnap.data() : { earned: 0, used: 0, pending: 0 };
      if (!noBalance && remaining(bal.earned, bal.used, bal.pending) < days) throw new Error("Insufficient leave balance");
      const appRef = fsMod.doc(fsMod.collection(db, "leaveApplications"));
      tx.set(appRef, { ...toDoc(application), workingDays: days, leaveTypeName: lt.name, status: "PENDING", submittedAt: new Date(), updatedAt: new Date() });
      // One role broadcast (no user-directory query — employees can't list users).
      tx.set(fsMod.doc(fsMod.collection(db, "notifications")), { uid: "", forRoles: ["hr_staff", "hr_admin", "sys_admin"], title: "New leave application", body: `${lt.name} from ${application.employeeName || ""}`, type: "leave", read: false, createdAt: new Date() });
      tx.set(fsMod.doc(fsMod.collection(db, "leaveApplications", appRef.id, SUBS.approvals)), { applicationId: appRef.id, step: "SUBMISSION", approverUid: application.uid, action: "SUBMITTED", comment: "Application submitted", timestamp: new Date() });
      if (!noBalance) {
        tx.set(fsMod.doc(db, "leaveBalances", bId), { uid: application.uid, leaveTypeCode: application.leaveTypeCode, earned: bal.earned || 0, used: bal.used || 0, pending: (bal.pending || 0) + days });
        tx.set(fsMod.doc(fsMod.collection(db, "leaveBalanceTransactions")), { uid: application.uid, leaveTypeCode: application.leaveTypeCode, type: "hold", days, applicationId: appRef.id, actorUid: application.uid, createdAt: new Date() });
      }
      for (const d of documents) {
        tx.set(fsMod.doc(fsMod.collection(db, "leaveApplications", appRef.id, SUBS.documents)), { ...(d || {}), applicationId: appRef.id, uploadedAt: new Date() });
      }
      tx.set(fsMod.doc(fsMod.collection(db, "auditLogs")), { actorUid: application.uid, action: "application_submitted", entity: "leave_application", entityId: appRef.id, createdAt: new Date() });
      return { id: appRef.id, workingDays: days };
    });
  },

  async reviewApplication({ applicationId, action, actor, comment = "" }) {
    const { db, fns } = await context();
    const { fsMod } = fns;
    return fsMod.runTransaction(db, async (tx) => {
      const aRef = fsMod.doc(db, "leaveApplications", applicationId);
      const aSnap = await tx.get(aRef);
      if (!aSnap.exists()) throw new Error("Application not found");
      const app = aSnap.data();
      if (!canTransition(app.status, action)) throw new Error(`Cannot move from ${app.status} to ${action}`);
      if (action === "REJECTED" && !comment.trim()) throw new Error("A comment is required to reject");
      const ltSnap = await tx.get(fsMod.doc(db, "leaveTypes", app.leaveTypeCode));
      const ltMax = ltSnap.exists() ? ltSnap.data().maxDays || 0 : 0;
      const noBalance = ["unpaid", "other"].includes(app.leaveTypeCode) || ltMax > 0;
      const bId = `${app.uid}_${app.leaveTypeCode}`;
      const bSnap = await tx.get(fsMod.doc(db, "leaveBalances", bId));
      const bal = bSnap.exists() ? bSnap.data() : { earned: 0, used: 0, pending: 0 };
      tx.update(aRef, { status: action, updatedAt: new Date() });
      tx.set(fsMod.doc(fsMod.collection(db, "leaveApplications", applicationId, SUBS.approvals)), { applicationId, approverUid: actor.uid, approverName: actor.name || "", role: actor.role || "", action, comment, timestamp: new Date() });
      if (!noBalance && (action === "APPROVED" || action === "REJECTED")) {
        const used = action === "APPROVED" ? (bal.used || 0) + app.workingDays : bal.used || 0;
        tx.set(fsMod.doc(db, "leaveBalances", bId), { ...bal, used, pending: Math.max(0, (bal.pending || 0) - app.workingDays) });
        tx.set(fsMod.doc(fsMod.collection(db, "leaveBalanceTransactions")), { uid: app.uid, leaveTypeCode: app.leaveTypeCode, type: action === "APPROVED" ? "debit" : "release", days: app.workingDays, applicationId, actorUid: actor.uid, createdAt: new Date() });
      }
      tx.set(fsMod.doc(fsMod.collection(db, "notifications")), { uid: app.uid, title: `Leave ${action.toLowerCase()}`, body: comment || action, type: "leave", read: false, createdAt: new Date() });
      tx.set(fsMod.doc(fsMod.collection(db, "auditLogs")), { actorUid: actor.uid, action: "application_" + action.toLowerCase(), entity: "leave_application", entityId: applicationId, createdAt: new Date() });
      return { ok: true };
    });
  },

  async cancelApplication({ applicationId, actor }) {
    const { db, fns } = await context();
    const { fsMod } = fns;
    return fsMod.runTransaction(db, async (tx) => {
      const aRef = fsMod.doc(db, "leaveApplications", applicationId);
      const aSnap = await tx.get(aRef);
      if (!aSnap.exists()) throw new Error("Application not found");
      const app = aSnap.data();
      if (!["DRAFT", "PENDING", "UNDER_REVIEW"].includes(app.status)) throw new Error("Cannot cancel at stage " + app.status);
      const bId = `${app.uid}_${app.leaveTypeCode}`;
      const bSnap = await tx.get(fsMod.doc(db, "leaveBalances", bId));
      if (bSnap.exists()) tx.update(fsMod.doc(db, "leaveBalances", bId), { pending: Math.max(0, (bSnap.data().pending || 0) - app.workingDays) });
      tx.update(aRef, { status: "CANCELLED", updatedAt: new Date() });
      tx.set(fsMod.doc(fsMod.collection(db, "leaveApplications", applicationId, SUBS.approvals)), { applicationId, step: "CANCELLATION", approverUid: actor.uid, approverName: actor.name || "", role: actor.role || "", action: "CANCELLED", comment: "Cancelled", timestamp: new Date() });
      tx.set(fsMod.doc(fsMod.collection(db, "auditLogs")), { actorUid: actor.uid, action: "application_cancelled", entity: "leave_application", entityId: applicationId, createdAt: new Date() });
      return { ok: true };
    });
  },

  async addDocument({ applicationId, doc }) {
    const { db, fns } = await context();
    const { fsMod } = fns;
    const aSnap = await fsMod.getDoc(fsMod.doc(db, "leaveApplications", applicationId));
    if (!aSnap.exists()) throw new Error("Application not found");
    if (!["DRAFT", "PENDING", "UNDER_REVIEW"].includes(aSnap.data().status)) throw new Error("Cannot attach documents at this stage");
    const ref = await fsMod.addDoc(fsMod.collection(db, "leaveApplications", applicationId, SUBS.documents), { ...(doc || {}), applicationId, uploadedAt: new Date() });
    return { id: ref.id };
  },

  async adjustBalance({ uid, leaveTypeCode, delta, reason, actor }) {
    const { db, fns } = await context();
    const { fsMod } = fns;
    if (!reason || !reason.trim()) throw new Error("A reason is required");
    return fsMod.runTransaction(db, async (tx) => {
      const bId = `${uid}_${leaveTypeCode}`;
      const bSnap = await tx.get(fsMod.doc(db, "leaveBalances", bId));
      const bal = bSnap.exists() ? bSnap.data() : { earned: 0, used: 0, pending: 0 };
      tx.set(fsMod.doc(db, "leaveBalances", bId), { ...bal, uid, leaveTypeCode, earned: (bal.earned || 0) + delta });
      tx.set(fsMod.doc(fsMod.collection(db, "leaveBalanceTransactions")), { uid, leaveTypeCode, type: "adjust", days: delta, reason, actorUid: actor.uid, createdAt: new Date() });
      return { ok: true };
    });
  },

  async requestDeletion({ uid, actor }) {
    const { db, fns } = await context();
    const { fsMod } = fns;
    const uSnap = await fsMod.getDoc(fsMod.doc(db, "users", uid));
    if (!uSnap.exists()) throw new Error("Account not found");
    const u = uSnap.data();
    if (u.role === "sys_admin") throw new Error("System administrator accounts cannot be deleted");
    if (uid === actor.uid) throw new Error("You cannot delete your own account");
    const ref = await fsMod.addDoc(fsMod.collection(db, "deletionRequests"), {
      uid, email: u.email || "", name: u.name || "", requestedBy: actor.uid,
      requestedByName: actor.name || "", status: "pending", createdAt: new Date(),
    });
    return { requestId: ref.id };
  },

  async rejectDeletion({ requestId, actor }) {
    const { db, fns } = await context();
    const { fsMod } = fns;
    const rRef = fsMod.doc(db, "deletionRequests", requestId);
    const rSnap = await fsMod.getDoc(rRef);
    if (!rSnap.exists() || rSnap.data().status !== "pending") throw new Error("Request not found");
    const r = rSnap.data();
    const senior = ["supervisor", "hr_admin", "sys_admin"].includes(actor.role);
    if (r.requestedBy !== actor.uid && !senior) throw new Error("Not allowed");
    await fsMod.updateDoc(rRef, { status: "rejected" });
    return { ok: true };
  },

  async confirmDeletion({ requestId, actor }) {
    const { db, fns } = await context();
    const { fsMod } = fns;
    const targetUid = await fsMod.runTransaction(db, async (tx) => {
      const rRef = fsMod.doc(db, "deletionRequests", requestId);
      const rSnap = await tx.get(rRef);
      if (!rSnap.exists() || rSnap.data().status !== "pending") throw new Error("Request not found");
      const r = rSnap.data();
      if (!["supervisor", "hr_admin", "sys_admin"].includes(actor.role)) throw new Error("Only a supervisor or above can confirm deletion");
      if (r.requestedBy === actor.uid) throw new Error("The person who requested cannot confirm — ask another supervisor");
      const uSnap = await tx.get(fsMod.doc(db, "users", r.uid));
      if (!uSnap.exists()) throw new Error("Account already gone");
      if (uSnap.data().role === "sys_admin") throw new Error("System administrator accounts cannot be deleted");
      tx.delete(fsMod.doc(db, "users", r.uid));
      tx.delete(rRef);
      tx.set(fsMod.doc(fsMod.collection(db, "auditLogs")), { actorUid: actor.uid, action: "user_deleted", entity: "user", entityId: r.uid, createdAt: new Date() });
      return r.uid;
    });
    const batch = fsMod.writeBatch(db);
    // Known balance IDs (no cross-user list — reviewers can't run those).
    for (const code of ["vacation", "sick", "spl", "maternity", "paternity", "solo_parent", "study", "vawc", "rehab", "magna_carta", "calamity", "adoption", "unpaid", "other"]) {
      batch.delete(fsMod.doc(db, "leaveBalances", `${targetUid}_${code}`));
    }
    const snap = await fsMod.getDocs(fsMod.query(fsMod.collection(db, "invites"), fsMod.where("uid", "==", targetUid)));
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    return { ok: true };
  },

  // Idempotent reference data only — NEVER creates users or passwords.
  async seedReferenceData() {
    const { db, fns } = await context();
    const { fsMod } = fns;
    const { seedBundle } = await import("./seed.js");
    const b = seedBundle();
    const batch = fsMod.writeBatch(db);
    for (const t of b.leaveTypes) batch.set(fsMod.doc(db, "leaveTypes", t.code), t, { merge: true });
    for (const h of b.holidays) batch.set(fsMod.doc(db, "holidays", h.date), h, { merge: true });
    batch.set(fsMod.doc(db, "settings", "app"), b.settings, { merge: true });
    for (const d of b.departments) batch.set(fsMod.doc(db, "departments", d.id), { name: d.name }, { merge: true });
    await batch.commit();
    return { ok: true };
  },
};

export { SUBS };
