/* One-time emulator bootstrap: creates the FIRST sys_admin (Auth account +
 * users/{uid} profile). Uses the Admin SDK, which bypasses rules. Production
 * equivalent = create the user in the Firebase console, then add the
 * users/{uid} doc manually. Run:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node tests/bootstrap-emulator.mjs
 */
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

initializeApp({ projectId: "leaveapplication-d9556" });

const email = "admin@example.com";
const password = "Admin123!";

let uid;
try {
  uid = (await getAuth().getUserByEmail(email)).uid;
  console.log("auth user exists:", uid);
} catch {
  uid = (await getAuth().createUser({ email, password, displayName: "System Administrator" })).uid;
  console.log("auth user created:", uid);
}

await getFirestore().doc(`users/${uid}`).set({
  email,
  name: "System Administrator",
  role: "sys_admin",
  employeeNo: "ADMIN-001",
  department: "Human Resources",
  position: "Administrator",
  status: "active",
  dateHired: "2022-01-01",
  phone: "",
  avatarColor: "#4F46E5",
  supervisorUid: "",
  createdAt: new Date().toISOString(),
});
console.log("users doc written. Sign in with:", email, "/", password);
