/* Auth seam: signIn / signOut / onAuthChanged / currentUser / createUser /
 * sendPasswordReset / invites. Firebase Auth backed; the cached session in
 * localStorage only gates page boot — activeSession() re-validates it
 * against live Auth. */
import { repo } from "../data/repository.js";
import { firebaseCtx } from "../data/firebase-app.js";
import { inviteStatus } from "../core/rules.js";

const SESSION_KEY = "lms.v1.session";
const subs = new Set();

function emit(user) {
  subs.forEach((cb) => { try { cb(user); } catch (e) { console.error(e); } });
}

function localSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setLocalSession(user) {
  try {
    if (user) localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    else localStorage.removeItem(SESSION_KEY);
  } catch (e) {
    console.error(e);
  }
}

async function firebaseAuth() {
  const c = await firebaseCtx();
  return { auth: c.auth, mod: c.authMod };
}

function toPublicUser(u) {
  if (!u) return null;
  const { password: _pw, ...rest } = u;
  return rest;
}

function signInErrorMessage(err) {
  switch (err && err.code) {
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Incorrect email or password.";
    case "auth/invalid-email":
      return "Enter a valid email address.";
    case "auth/too-many-requests":
      return "Too many sign-in attempts. Try again later or reset your password.";
    case "auth/network-request-failed":
      return "Network error. Check your connection and try again.";
    case "auth/user-disabled":
      return "This account has been disabled.";
    default:
      return (err && err.message) || "Sign in failed.";
  }
}

export async function signIn(email, password) {
  const { auth, mod } = await firebaseAuth();
  let cred;
  try {
    cred = await mod.signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    throw new Error(signInErrorMessage(err));
  }
  const profile = await repo.get("users", cred.user.uid);
  if (!profile) {
    await mod.signOut(auth);
    throw new Error("No employee profile for this login — ask HR to invite you.");
  }
  if (profile.status !== "active") {
    await mod.signOut(auth);
    throw new Error("Account is deactivated.");
  }
  const sess = { uid: cred.user.uid, email: profile.email || cred.user.email, name: profile.name || "", role: profile.role, department: profile.department || "", position: profile.position || "", employeeNo: profile.employeeNo || "" };
  setLocalSession(sess);
  emit(sess);
  return { uid: cred.user.uid, ...toPublicUser({ id: cred.user.uid, ...profile }) };
}

export async function signOut() {
  const { auth, mod } = await firebaseAuth();
  await mod.signOut(auth);
  setLocalSession(null);
  emit(null);
}

export function onAuthChanged(cb) {
  subs.add(cb);
  return () => subs.delete(cb);
}

export function currentUser() {
  return localSession();
}

/** Page-boot session. Verifies the cached session against live Firebase Auth
 *  and clears it when stale (signed out in another tab, account deleted, or a
 *  cache left over from the retired in-browser demo mode).
 *  Never throws: on SDK/network failure it keeps the cached session so offline
 *  use still works. Result is cached per page load. */
let booting = null;
export function activeSession() {
  if (!booting) booting = validateCloudSession();
  return booting;
}

async function validateCloudSession() {
  const cached = localSession();
  let auth, mod;
  try {
    ({ auth, mod } = await firebaseAuth());
  } catch (e) {
    console.error(e);
    return cached; // SDK/CDN unavailable — don't lock the user out.
  }
  const fbUser = await firstAuthState(auth, mod, 2500);
  if (fbUser === "timeout") return cached;
  if (!fbUser) {
    if (cached) setLocalSession(null);
    return null;
  }
  let profile;
  try {
    profile = await repo.get("users", fbUser.uid);
  } catch (e) {
    console.error(e);
    return cached && cached.uid === fbUser.uid ? cached : null;
  }
  if (!profile || profile.status !== "active") {
    try { await mod.signOut(auth); } catch { /* ignore */ }
    setLocalSession(null);
    return null;
  }
  const sess = { uid: fbUser.uid, email: profile.email || fbUser.email, name: profile.name || "", role: profile.role, department: profile.department || "", position: profile.position || "", employeeNo: profile.employeeNo || "" };
  setLocalSession(sess);
  return sess;
}

/** First Firebase Auth state, or "timeout". Firebase persists the sign-in
 *  locally, so this value decides whether the cached session is still real. */
function firstAuthState(auth, mod, ms) {
  return new Promise((resolve) => {
    let done = false;
    let unsub = null;
    const finish = (v) => {
      if (done) return;
      done = true;
      if (unsub) { try { unsub(); } catch { /* ignore */ } }
      resolve(v);
    };
    try {
      unsub = mod.onAuthStateChanged(auth, (u) => finish(u || null));
    } catch (e) {
      console.error(e);
      finish("timeout");
      return;
    }
    setTimeout(() => finish("timeout"), ms);
  });
}

export async function createUser(data, actor) {
  // Admin only (callers check can(); Firestore rules enforce).
  const id = data.uid || undefined;
  const created = await repo.create("users", { ...data, status: "active" }, id);
  await repo.create("auditLogs", {}).catch(() => {});
  void actor;
  return created;
}

export async function sendPasswordReset(email) {
  // Spark plan, no Functions: Auth's own email flow + an HR-visible request.
  // Silent for unknown emails so accounts can't be enumerated.
  await repo.requestPasswordReset({ email }).catch(() => ({ ok: true }));
  try {
    const { auth, mod } = await firebaseAuth();
    await mod.sendPasswordResetEmail(auth, String(email).trim());
  } catch {
    // Unknown email or mail failure — HR request above is the fallback path.
  }
  return { ok: true, message: "If the account exists, a reset email was sent. Otherwise HR has been notified and will send you a link." };
}

export async function setPasswordWithInvite(token, newPassword, confirm) {
  if (newPassword !== confirm) throw new Error("Passwords do not match");
  // No-Functions redemption: the invitee creates their own Auth account,
  // claims the waiting profile under their new uid, then burns the invite.
  const inv = await repo.get("invites", token);
  if (inviteStatus(inv) !== "valid") throw new Error("This link is invalid, used, or expired");
  const { auth, mod } = await firebaseAuth();
  let cred;
  try {
    cred = await mod.createUserWithEmailAndPassword(auth, inv.email, newPassword);
  } catch (e) {
    if (e && e.code === "auth/email-already-in-use") throw new Error("This link was already used — try signing in instead.");
    throw e;
  }
  const uid = cred.user.uid;
  try {
    const pending = await repo.get("pendingProfiles", token);
    const { status: _s, createdAt: _c, ...profile } = pending || {};
    await repo.create("users", { ...profile, email: inv.email, status: "active", inviteToken: token, createdAt: new Date().toISOString() }, uid);
    try {
      await repo.remove("pendingProfiles", token);
    } catch { /* non-fatal cleanup */ }
    // Balances for the new account (writes only indexed fields; no read needed).
    for (const [code, earned] of [["vacation", 25], ["sick", 15], ["spl", 5]]) {
      try {
        await repo.create("leaveBalances", { uid, leaveTypeCode: code, earned, used: 0, pending: 0 }, `${uid}_${code}`);
      } catch { /* keep going */ }
    }
    await repo.consumeInvite({ token, newPassword });
  } catch (e) {
    try {
      await cred.user.delete();
    } catch { /* leave Auth cleanup to HR */
    }
    throw new Error(`Setup failed halfway (${e.message || e}). Ask HR to re-send the invite.`);
  }
  return { uid };
}

export async function inviteDetail(token) {
  return repo.get("invites", token);
}

export async function adminSetPassword(uid, newPassword, actor) {
  // No Functions: HR triggers Auth's reset email; nothing secret is written.
  const u = await repo.get("users", uid);
  if (!u) throw new Error("Account not found");
  const { auth, mod } = await firebaseAuth();
  await mod.sendPasswordResetEmail(auth, u.email);
  await repo.create("auditLogs", {
    actorUid: actor.uid, actorEmail: actor.email || "", action: "password_reset_admin",
    entity: "user", entityId: uid, description: `Reset email sent to ${u.email}`,
    meta: {}, createdAt: new Date().toISOString(),
  });
  return { ok: true, emailed: true };
}
