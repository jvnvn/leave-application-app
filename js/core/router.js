/* Route guards. UI hiding is NOT security: Firestore rules must enforce
 * the same permissions (see firestore.rules.draft). */
import { activeSession } from "../services/auth.js";

export async function requireAuth() {
  const u = await activeSession();
  if (!u) {
    location.replace("login.html");
    return null;
  }
  return u;
}

/** Redirect employees to employee.html, everyone else stays (admin console). */
export async function requireNonEmployee() {
  const u = await requireAuth();
  if (!u) return null;
  if (u.role === "employee") {
    location.replace("employee.html");
    return null;
  }
  return u;
}

/** Only employees on the employee app (HR roles use admin console). */
export async function requireEmployee() {
  const u = await requireAuth();
  if (!u) return null;
  if (u.role !== "employee") {
    location.replace("admin.html");
    return null;
  }
  return u;
}

export function homeFor(user) {
  return user && user.role === "employee" ? "employee.html" : "admin.html";
}
