/* print.html?id=... — official APPLICATION FOR LEAVE (Revised 2020), A4.
 * Data comes from repo through services only. */
import { repo } from "../data/repository.js";
import { activeSession } from "../services/auth.js";
import { getSettings } from "../services/settings.js";
import { balanceFor } from "../services/balances.js";
import { esc, qs } from "../core/dom.js";
import { toast, installGlobalHandlers } from "../core/toast.js";
import { initLayoutDebug } from "../ui/layout-debug.js";

installGlobalHandlers();
initLayoutDebug();

function check(yes) {
  return `<span class="check">${yes ? "✓" : ""}</span>`;
}

try {
  const me = await activeSession();
  if (!me) location.replace("login.html");
  const id = new URLSearchParams(location.search).get("id");
  if (!id) throw new Error("Missing application id");
  const app = await repo.get("leaveApplications", id);
  if (!app) throw new Error("Application not found");
  if (me.role === "employee" && app.uid !== me.uid) throw new Error("Not found");
  const settings = await getSettings();
  const bal = await balanceFor(app.uid, app.leaveTypeCode).catch(() => ({ earned: 0, used: 0, pending: 0, remaining: 0 }));
  const sig = (settings.signatories || {});
  const lt = app.leaveTypeCode;
  const is = (c) => lt === c;
  const det = app.details || {};
  const detLine = Object.entries(det).map(([k, v]) => `${k}: ${v}`).join("; ");

  qs("#form").innerHTML = `
  <div class="pf-head">
    <p>Republic of the Philippines</p><p><b>Province of ___</b></p><p><b>Municipality of ___</b></p>
    <h3 style="margin:6px 0">APPLICATION FOR LEAVE</h3><p>(Revised 2020)</p>
  </div>
  <div class="pf-sect"><div class="pf-row">
    <div style="flex:1"><b>1. OFFICE/DEPARTMENT:</b> <span class="ow">${esc(app.department || "")}</span></div>
    <div style="flex:1"><b>2. NAME:</b> <span class="ow">${esc(app.employeeName || "")}</span></div>
  </div></div>
  <div class="pf-sect"><div class="pf-row">
    <div style="flex:1"><b>3. DATE OF FILING:</b> ${esc((app.submittedAt || "").slice(0, 10))}</div>
    <div style="flex:1"><b>4. POSITION:</b> <span class="ow">${esc(app.position || "")}</span></div>
    <div style="flex:1"><b>5. SALARY:</b> ${settings.salaryVisible ? esc(app.salary || "___") : "___"}</div>
  </div></div>
  <div class="pf-sect"><h4>6.A TYPE OF LEAVE TO BE AVAILED OF</h4>
    <div>${check(is("vacation"))} Vacation Leave (Sec. 51, Rule XVI, Omnibus Rules)</div>
    <div>${check(is("mandatory"))} Mandatory/Forced Leave (R.A. No. 9710 / MC No. 41, s. 1998)</div>
    <div>${check(is("sick"))} Sick Leave (Sec. 51, Rule XVI, Omnibus Rules)</div>
    <div>${check(is("maternity"))} Maternity Leave (R.A. No. 11210)</div>
    <div>${check(is("paternity"))} Paternity Leave (R.A. No. 8187 / CSC MC No. 71, s. 1998)</div>
    <div>${check(is("solo_parent"))} Solo Parent Leave (R.A. No. 8972 / MC No. 8, s. 2004)</div>
    <div>${check(is("study"))} Study Leave (CSC MC No. 21, s. 2004)</div>
    <div>${check(is("vawc"))} 10-Day VAWC Leave (R.A. No. 9262 / CSC MC No. 15, s. 2005)</div>
    <div>${check(is("rehab"))} Rehabilitation Privilege (CSC MC No. 6, s. 2006)</div>
    <div>${check(is("magna_carta"))} Special Leave Benefits for Women (R.A. No. 9710 / CSC MC No. 25, s. 2010)</div>
    <div>${check(is("calamity"))} Special Emergency / Calamity Leave (CSC MC No. 2, s. 2012)</div>
    <div>${check(false)} Monetization of Leave Credits &nbsp; ${check(false)} Terminal Leave</div>
    <div>${check(is("adoption"))} Adoption Leave (R.A. No. 8552)</div>
    <div>${check(is("other") || is("unpaid") || is("spl"))} Others: <span class="ow">${esc(app.leaveTypeName || "")}</span></div>
  </div>
  <div class="pf-sect"><h4>6.B DETAILS OF APPLICATION</h4>
    <div class="ow">${esc(detLine || "—")}</div>
    <div class="pf-item" style="margin-top:4px"><b>6.C NUMBER OF WORKING DAYS APPLIED FOR:</b> ${esc(String(app.workingDays || 0))} &nbsp; <b>INCLUSIVE DATES:</b> ${esc(app.startDate || "")} to ${esc(app.endDate || "")}</div>
    <div><b>6.D COMMUTATION:</b> ${check(false)} Requested &nbsp; ${check(true)} Not Requested</div>
  </div>
  <div class="pf-sect"><h4>7.A CERTIFICATION OF LEAVE CREDITS</h4>
    <div class="pf-row"><div style="flex:1">Total Earned: <b>${esc(String(bal.earned || 0))}</b></div>
    <div style="flex:1">Less this application: <b>${esc(String(app.workingDays || 0))}</b></div>
    <div style="flex:1">Balance: <b>${esc(String((bal.earned || 0) - (bal.used || 0) - (bal.pending || 0)))}</b></div></div>
  </div>
  <div class="pf-sect"><h4>7.B RECOMMENDATION</h4><div>${check(app.status === "APPROVED")} For approval &nbsp; ${check(app.status === "REJECTED")} For disapproval due to <span class="ow">${esc(app.status === "REJECTED" ? "see remarks" : "___")}</span></div></div>
  <div class="pf-sect"><h4>7.C APPROVED FOR</h4>
    <div>${esc(String(app.workingDays || 0))} days with pay &nbsp; ___ days without pay &nbsp; ___ others (Specify)</div>
    <h4 style="margin-top:6px">7.D DISAPPROVED DUE TO</h4><div class="pf-box ow">${esc(app.status === "REJECTED" ? "Disapproved" : "")}</div>
  </div>
  <div class="pf-sect"><h4>REASON / REMARKS</h4><div class="pf-box ow">${esc(app.reason || "")}</div></div>
  <div class="sig-grid">
    <div><div class="sig-line">${esc(sig.hrmo || "HRMO")}<br>Human Resource Management Officer</div></div>
    <div><div class="sig-line">${esc(sig.supervisor || "Immediate Supervisor")}<br>Immediate Supervisor</div></div>
    <div><div class="sig-line">${esc(sig.mayor || "Head of Office / Mayor")}<br>Head of Office / Mayor</div></div>
  </div>`;

  qs("#print-btn").addEventListener("click", () => window.print());
} catch (e) {
  console.error(e);
  qs("#print-error").textContent = e.message || "Failed to load";
  toast(e.message || "Failed to load", "error");
}
