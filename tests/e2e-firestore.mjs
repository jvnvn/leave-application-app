/* Firestore end-to-end verification (emulator). Drives the REAL app modules
 * in a headless browser through the full role flow and asserts every step.
 * Needs: emulators running, app served at APP_URL, playwright installed.
 *   $env:APP_URL="http://127.0.0.1:8000/index.html?emulator=1"
 *   node tests/e2e-firestore.mjs
 */
import { chromium } from "playwright";

const APP_URL = process.env.APP_URL || "http://127.0.0.1:8000/index.html?emulator=1";
const results = [];
const ok = (name, cond, extra = "") => {
  results.push([cond ? "PASS" : "FAIL", `${name}${extra ? " — " + extra : ""}`]);
  if (!cond) console.log("FAIL:", name, extra);
};

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(APP_URL);
await page.waitForFunction(() => window.location.href.includes("login.html"), null, { timeout: 30000 });
// Blank module playground on the same origin (fresh module state per reload).
await page.goto("http://127.0.0.1:8000/tests/blank.html?emulator=1");

const run = (fn, ...args) => page.evaluate(fn, ...args);

const out = await run(async () => {
  const RUN = Date.now() % 1000000;
  const R = [];
  const t = (n, c, x = "") => R.push([c ? "PASS" : "FAIL", n + (x ? " — " + x : "")]);
  const { repo } = await import("/js/data/repository.js");
  const auth = await import("/js/services/auth.js");
  const leaves = await import("/js/services/leaves.js");
  const balances = await import("/js/services/balances.js");
  const approvals = await import("/js/services/approvals.js");
  const files = await import("/js/services/files.js");
  const audit = await import("/js/services/audit.js");

  try {
    // 1. Admin sign-in (bootstrapped) + seed reference data.
    const admin = await auth.signIn("admin@example.com", "Admin123!");
    t("admin sign-in, role sys_admin", admin.role === "sys_admin", admin.role);
    await repo.seedReferenceData();
    const types = await repo.list("leaveTypes", { limit: 20 });
    t("seed: 14 leave types", types.length === 14, String(types.length));
    const hols = await repo.list("holidays", { limit: 20 });
    t("seed: 9 holidays", hols.length === 9, String(hols.length));
    const settings = await repo.get("settings", "app");
    t("seed: settings/app", !!settings && settings.charLimit === 500);

    // 2. HR-style invite -> redeem -> login (full Auth account creation).
    const supEmail = `supervisor${RUN}@example.com`;
    const { token } = await repo.inviteUser({ userData: { email: supEmail, name: "Sam Supervisor", role: "supervisor", department: "Engineering", position: "Team Lead" } });
    t("invite created, no users doc yet", (await repo.list("users", { where: [["email", "==", supEmail]], limit: 5 })).length === 0);
    const pub = await repo.get("invites", token);
    t("invite readable pre-auth (link holder)", !!pub && pub.email === supEmail);
    await auth.signOut();
    const { uid: supUid } = await auth.setPasswordWithInvite(token, "Sup12345", "Sup12345");
    t("redeem creates Auth user + profile", !!supUid);
    const supProfile = await repo.get("users", supUid);
    t("users/{uid} === auth uid, role kept", !!supProfile && supProfile.role === "supervisor", supProfile && supProfile.role);
    t("invite burned", (await repo.get("invites", token)).used === true);
    t("starter balances seeded", (await repo.list("leaveBalances", { where: [["uid", "==", supUid]] })).length === 3);
    const sup = await auth.signIn(supEmail, "Sup12345");
    t("supervisor login works", sup.role === "supervisor");

    // 3. Submit with attachment (small file, base64 path).
    const file = new File(["hello-leave-doc"], "note.pdf", { type: "application/pdf" });
    const meta = await files.upload(file, `leave-documents/${supUid}/draft-test/note.pdf`);
    t("upload ok (base64, Spark)", !!meta.path);
    const { id: appId, workingDays } = await leaves.submitLeave({
      uid: supUid, employeeName: "Sam Supervisor", department: "Engineering", position: "Team Lead",
      leaveTypeCode: "vacation", startDate: "2026-11-02", endDate: "2026-11-03",
      reason: "Family trip out of town", emergencyName: "Ana", emergencyRelationship: "Spouse",
      emergencyPhone: "+639170000000", details: { location: "within", where: "Cebu" },
    }, [{ fileName: "note.pdf", path: meta.path, size: meta.size, mimeType: meta.mimeType }]);
    t("submit holds 2 days", workingDays === 2, String(workingDays));
    const bal = (await repo.list("leaveBalances", { where: [["uid", "==", supUid], ["leaveTypeCode", "==", "vacation"]] }))[0];
    t("hold in pending", bal.pending === 2 && bal.used === 0, JSON.stringify({ p: bal.pending, u: bal.used }));
    const det = await leaves.applicationDetail(appId);
    t("detail: approval + doc readable", det.approvals.length === 1 && det.documents.length === 1);
    t("doc downloads as data URL", (await files.getUrl(meta.path)).startsWith("data:"));
    t("new-app notification written", (await repo.list("notifications", { limit: 50 })).some((n) => /new leave/i.test(n.title)));

    // 4. Rules: supervisor cannot write balances or read others' apps.
    await auth.signOut();
    await auth.signIn("admin@example.com", "Admin123!");
    let denied = false;
    try { await repo.update("leaveBalances", `${supUid}_vacation`, { earned: 999 }); } catch { denied = true; }
    t("admin CAN adjust (control)", !denied);
    await repo.update("leaveBalances", `${supUid}_vacation`, { earned: 25 });
    await auth.signOut();
    await auth.signIn(supEmail, "Sup12345");
    denied = false;
    try { await repo.update("leaveBalances", `${supUid}_vacation`, { earned: 999 }); } catch { denied = true; }
    t("non-HR balance write denied", denied);

    // 5. Two-stage approval: supervisor stage first, then HR final.
    const adminActs = { uid: admin.uid, name: "System Administrator", role: "sys_admin" };
    const supActs = { uid: supUid, name: "Sam Supervisor", role: "supervisor" };
    // 5a. HR staff cannot act while the app is with the supervisor.
    await auth.signOut();
    await auth.signIn("admin@example.com", "Admin123!");
    const hrEmail = `hr${RUN}@example.com`;
    const hrInv = await repo.inviteUser({ userData: { email: hrEmail, name: "Hera Staff", role: "hr_staff", department: "HR", position: "Officer" } });
    await auth.signOut();
    const { uid: hrUid } = await auth.setPasswordWithInvite(hrInv.token, "Hr123456", "Hr123456");
    await auth.signIn(hrEmail, "Hr123456");
    let hrClientDenied = false;
    try { await approvals.review(appId, "FOR_FINAL_APPROVAL", { uid: hrUid, role: "hr_staff" }, ""); } catch { hrClientDenied = true; }
    t("hr cannot act at supervisor stage (client guard)", hrClientDenied);
    let hrRulesDenied = false;
    try { await repo.update("leaveApplications", appId, { status: "FOR_FINAL_APPROVAL" }); } catch { hrRulesDenied = true; }
    t("hr cannot act at supervisor stage (rules)", hrRulesDenied);
    // 5b. Supervisor acts: stage-skip + rule probes, then forward to HR.
    await auth.signOut();
    await auth.signIn(supEmail, "Sup12345");
    let supSkip = false;
    try { await approvals.review(appId, "APPROVED", supActs, "skip"); } catch { supSkip = true; }
    t("supervisor cannot shortcut to APPROVED (client guard)", supSkip);
    let supSelfApprove = false;
    try { await repo.update("leaveApplications", appId, { status: "APPROVED" }); } catch { supSelfApprove = true; }
    t("supervisor cannot skip stage (rules)", supSelfApprove);
    await approvals.review(appId, "FOR_FINAL_APPROVAL", supActs, "");
    t("forwarded to HR for final approval", (await repo.get("leaveApplications", appId)).status === "FOR_FINAL_APPROVAL");
    let supAtHrStage = false;
    try { await approvals.review(appId, "APPROVED", supActs, "x"); } catch { supAtHrStage = true; }
    t("supervisor cannot act at HR stage (client guard)", supAtHrStage);
    let supRulesAtHr = false;
    try { await repo.update("leaveApplications", appId, { status: "APPROVED" }); } catch { supRulesAtHr = true; }
    t("supervisor cannot act at HR stage (rules)", supRulesAtHr);
    // 5c. HR final approval + reject-requires-comment.
    await auth.signOut();
    await auth.signIn("admin@example.com", "Admin123!");
    let needComment = false;
    try { await approvals.review(appId, "REJECTED", adminActs, ""); } catch { needComment = true; }
    t("reject without comment refused", needComment);
    await approvals.review(appId, "APPROVED", adminActs, "Enjoy!");
    const bal2 = (await repo.list("leaveBalances", { where: [["uid", "==", supUid], ["leaveTypeCode", "==", "vacation"]] }))[0];
    t("approve moves pending->used", bal2.used === 2 && bal2.pending === 0, JSON.stringify({ p: bal2.pending, u: bal2.used }));

    // 6. Second app: reject releases hold; third: cancel releases hold.
    await auth.signOut();
    await auth.signIn(supEmail, "Sup12345");
    const r2 = await leaves.submitLeave({
      uid: supUid, employeeName: "Sam Supervisor", department: "Engineering", position: "Team Lead",
      leaveTypeCode: "sick", startDate: "2026-11-09", endDate: "2026-11-10",
      reason: "Flu, need two days rest", emergencyName: "Ana", emergencyRelationship: "Spouse",
      emergencyPhone: "+639170000000", details: { care_type: "outpatient", illness: "flu" },
    }, [{ fileName: "x.pdf", path: meta.path, size: 1, mimeType: "application/pdf" }]);
    await auth.signOut();
    await auth.signIn("admin@example.com", "Admin123!");
    await approvals.review(r2.id, "REJECTED", adminActs, "Need med cert");
    const bal3 = (await repo.list("leaveBalances", { where: [["uid", "==", supUid], ["leaveTypeCode", "==", "sick"]] }))[0];
    t("reject releases hold", bal3.pending === 0 && bal3.used === 0);
    await auth.signOut();
    await auth.signIn(supEmail, "Sup12345");
    const r3 = await leaves.submitLeave({
      uid: supUid, employeeName: "Sam Supervisor", department: "Engineering", position: "Team Lead",
      leaveTypeCode: "spl", startDate: "2026-11-16", endDate: "2026-11-16",
      reason: "Personal errand day off", emergencyName: "Ana", emergencyRelationship: "Spouse",
      emergencyPhone: "+639170000000", details: { location: "within" },
    }, []);
    await leaves.cancelLeave(r3.id, { uid: supUid });
    const bal4 = (await repo.list("leaveBalances", { where: [["uid", "==", supUid], ["leaveTypeCode", "==", "spl"]] }))[0];
    t("cancel releases hold", bal4.pending === 0);

    // 7. Password reset email (emulator logs it) + deletion four-eyes.
    const pr = await auth.sendPasswordReset(supEmail);
    t("reset flow ok", !!pr.ok);
    await auth.signOut();
    await auth.signIn("admin@example.com", "Admin123!");
    const { requestId } = await repo.requestDeletion({ uid: supUid, actor: { uid: admin.uid, role: "sys_admin" } });
    let selfNo = false;
    try { await repo.confirmDeletion({ requestId, actor: { uid: admin.uid, role: "sys_admin" } }); } catch { selfNo = true; }
    t("requester cannot self-confirm", selfNo);
    const sup2Email = `sup2-${RUN}@example.com`;
    const inv2 = await repo.inviteUser({ userData: { email: sup2Email, name: "Sup Two", role: "supervisor", department: "Engineering", position: "Lead" } });
    await auth.signOut();
    await auth.setPasswordWithInvite(inv2.token, "Sup23456", "Sup23456");
    const sup2 = await auth.signIn(sup2Email, "Sup23456");
    await repo.confirmDeletion({ requestId, actor: { uid: sup2.uid, role: "supervisor" } });
    t("supervisor confirm deletes account", (await repo.get("users", supUid)) === null);

    // 8. Audit trail (as admin — audit is HR-admin-only) + persistence.
    await auth.signOut();
    await auth.signIn("admin@example.com", "Admin123!");
    // Admin files a VAWC app so privacy probes have a target.
    const privApp = await leaves.submitLeave({
      uid: admin.uid, employeeName: "System Administrator", department: "HR", position: "A",
      leaveTypeCode: "vawc", startDate: "2026-12-01", endDate: "2026-12-02",
      reason: "Private admin leave case", emergencyName: "A", emergencyPhone: "+63917", details: {},
    }, []);
    // A plain employee must not read others' apps, touch earned credits, or list users.
    const empEmail = `emp${RUN}@example.com`;
    const empInv = await repo.inviteUser({ userData: { email: empEmail, name: "Emp Loyee", role: "employee", department: "Ops", position: "Staff" } });
    await auth.signOut();
    const { uid: empUid } = await auth.setPasswordWithInvite(empInv.token, "Emp12345", "Emp12345");
    await auth.signIn(empEmail, "Emp12345");
    let p1 = false, p2 = false, p3 = false;
    try { await repo.get("leaveApplications", privApp.id); } catch { p1 = true; }
    t("employee cannot read another's application", p1);
    try { await repo.update("leaveBalances", `${admin.uid}_vacation`, { earned: 999 }); } catch { p2 = true; }
    t("employee cannot touch earned credits", p2);
    try { await repo.list("users", { limit: 5 }); } catch { p3 = true; }
    t("employee cannot list users", p3);
    let p4 = false;
    try { await repo.update("leaveApplications", privApp.id, { status: "APPROVED" }); } catch { p4 = true; }
    t("employee cannot approve an application (rules)", p4);
    // Regression: employee submit must be allowed end-to-end (hold ledger row
    // is owned by the employee; rules previously demanded reviewer on create).
    const empApp = await leaves.submitLeave({
      uid: empUid, employeeName: "Emp Loyee", department: "Ops", position: "Staff",
      leaveTypeCode: "vacation", startDate: "2026-12-10", endDate: "2026-12-10",
      reason: "Personal errand day off", emergencyName: "Ana", emergencyRelationship: "Sibling",
      emergencyPhone: "+639170000000", details: { location: "within" },
    }, []);
    t("employee submit works (ledger hold owned by employee)", (await repo.get("leaveApplications", empApp.id)).status === "FOR_SUPERVISOR_REVIEW");
    // Must use a balance-holding type: capped types (spl has maxDays 3) skip the hold.
    const empBal = (await repo.list("leaveBalances", { where: [["uid", "==", empUid], ["leaveTypeCode", "==", "vacation"]] }))[0];
    t("employee hold recorded in own balance", empBal.pending === 1);
    await auth.signOut();
    await auth.signIn("admin@example.com", "Admin123!");
    const logs = await repo.list("auditLogs", { limit: 100 });
    const acts = new Set(logs.map((l) => l.action));
    for (const a of ["application_submitted", "application_for_final_approval", "application_approved", "application_rejected", "application_cancelled", "user_deleted"]) {
      t("audit has " + a, acts.has(a));
    }
  } catch (e) {
    R.push(["FAIL", "EXCEPTION — " + (e.message || e)]);
  }
  return R;
});

for (const [s, n] of out) results.push([s, n]);
const fails = results.filter(([s]) => s === "FAIL");
console.log(`\n==== ${results.length - fails.length}/${results.length} passed ====`);
for (const [s, n] of results) if (s === "FAIL") console.log(s, n);

// Persistence: reload, admin reads everything back.
await page.reload();
await page.goto("http://127.0.0.1:8000/tests/blank.html?emulator=1");
const apps = await run(async () => {
  const { repo } = await import("/js/data/repository.js");
  const auth = await import("/js/services/auth.js");
  await auth.signIn("admin@example.com", "Admin123!");
  return (await repo.list("leaveApplications", { limit: 50 })).length;
});
ok("data survives reload", apps >= 3, `${apps} applications`);

// Regression (2026-10): the emulator choice must survive in-app redirects
// that drop the query string — otherwise a bare page silently falls back to
// the real project and shows "Missing or insufficient permissions.".
await page.goto("http://127.0.0.1:8000/tests/blank.html?emulator=1");
await run(async () => {
  const auth = await import("/js/services/auth.js");
  await auth.signOut();
});
await page.goto(APP_URL);
await page.waitForFunction(() => window.location.href.includes("login.html"), null, { timeout: 30000 });
const modeAfterRedirect = await run(async () => {
  const { APP_CONFIG } = await import("/js/config.js");
  return { useEmulator: APP_CONFIG.useEmulator };
});
ok("emulator mode survives redirect", modeAfterRedirect.useEmulator === true, JSON.stringify(modeAfterRedirect));

// Regression (2026-10): the retired ?backend=local demo switch must be inert —
// the app is Firestore-only and never falls back to browser storage.
await page.goto("http://127.0.0.1:8000/index.html?backend=local");
await page.waitForFunction(() => window.location.href.includes("login.html"), null, { timeout: 30000 });
const legacyParam = await run(async () => {
  const { APP_CONFIG } = await import("/js/config.js");
  const adapter = await (await import("/js/data/repository.js")).resolveAdapter();
  return { dataSource: APP_CONFIG.dataSource, adapterKind: adapter.kind };
});
ok("retired ?backend=local is inert", legacyParam.dataSource === undefined && legacyParam.adapterKind === "firestore", JSON.stringify(legacyParam));

// Regression (2026-10): a stale cached session (signed out in another tab, or
// a leftover cache from the retired demo mode) must be cleared on page boot.
await page.goto("http://127.0.0.1:8000/tests/blank.html?emulator=1");
const stale = await run(async () => {
  const auth = await import("/js/services/auth.js");
  const key = "lms.v1.session";
  localStorage.setItem(key, JSON.stringify({ uid: "ghost-uid", email: "ghost@example.com", name: "Ghost", role: "supervisor" }));
  const user = await auth.activeSession();
  return { user, raw: localStorage.getItem(key) };
});
ok("stale cached session cleared on firestore boot", stale.user === null && stale.raw === null, JSON.stringify(stale));

const finalFails = results.filter(([s]) => s === "FAIL");
console.log(`\n==== TOTAL ${results.length - finalFails.length}/${results.length} ====`);
await browser.close();
process.exit(finalFails.length ? 1 : 0);
