/* Admin console. Sections gated by PERMISSIONS/can() — UI hiding is NOT
 * security: Firestore rules must enforce the same permissions. */
import { requireNonEmployee } from "../core/router.js";
import { esc, qs, qsa, debounce } from "../core/dom.js";
import { csvEscape, downloadTextFile, daysLabel } from "../core/format.js";
import { todayISO, monthGrid, monthLabel, addMonths } from "../core/dates.js";
import { toast, installGlobalHandlers } from "../core/toast.js";
import { can, ROLES } from "../core/constants.js";
import { reviewActionsFor, reviewStage } from "../core/rules.js";
import { signOut, adminSetPassword } from "../services/auth.js";
import { allApplications, applicationDetail } from "../services/leaves.js";
import { allBalances, allTransactions, transactions, adjust } from "../services/balances.js";
import { review, pendingQueue } from "../services/approvals.js";
import { listEmployees, getEmployee, saveEmployee, setStatus, listDepartments, inviteEmployee, inviteLink } from "../services/employees.js";
import { listHolidays, saveHoliday, removeHoliday } from "../services/holidays.js";
import { listLeaveTypes, saveLeaveType, createLeaveType, removeLeaveType } from "../services/leaveTypes.js";
import { listAudit } from "../services/audit.js";
import { getSettings, saveSettings } from "../services/settings.js";
import { emailConfigured, sendInviteEmail } from "../services/email.js";
import { summary } from "../services/reports.js";
import { getUrl } from "../services/files.js";
import { skeletonList, emptyState, errorState, openModal, openSheet, closeOverlays, statusPill, timelineHtml, xIcon } from "../ui/components.js";
import { initLayoutDebug } from "../ui/layout-debug.js";
import { repo } from "../data/repository.js";

installGlobalHandlers();
initLayoutDebug();

const user = await requireNonEmployee();
if (!user) throw new Error("redirect");

const view = qs("#view");
qs("#who").textContent = `${user.name || user.email} · ${user.role}`;
qs("#signout").onclick = async () => { await signOut(); location.replace("login.html"); };
qs("#menu-btn").onclick = () => qs("#sidebar").classList.toggle("open");

const SECTIONS = [
  ["dash", "Dashboard", "reports.view"],
  ["apps", "Applications", "leave.review"],
  ["review", "Review queue", "leave.review"],
  ["emps", "Employees", "employees.view"],
  ["bals", "Leave Balances", "balances.view.all"],
  ["cal", "Calendar", "reports.view"],
  ["reports", "Reports", "reports.view"],
  ["audit", "Audit Log", "audit.view"],
  ["hols", "Holidays", null],
  ["types", "Leave Types", null],
  ["users", "Users & Roles", "users.manage"],
  ["invites", "Invites & Resets", "invites.manage"],
  ["settings", "Settings", "settings.manage"],
];

let section = "dash";
// Race guard: a still-running render from an older go() must never write into
// the shared #view after a newer navigation started.
let navSeq = 0;
let unsub = null;
function stopLive() {
  if (unsub) { try { unsub(); } catch { /* ignore */ } unsub = null; }
}

function visibleSections() {
  return SECTIONS.filter(([, , perm]) => !perm || can(user, perm));
}

function renderSide() {
  qs("#side-nav").innerHTML = visibleSections().map(([k, label]) =>
    `<button class="side-link ${section === k ? "on" : ""}" data-sec="${k}">${esc(label)}</button>`).join("");
  qsa("#side-nav .side-link").forEach((b) => (b.onclick = () => {
    qs("#sidebar").classList.remove("open");
    go(b.dataset.sec);
  }));
}

async function go(next, arg) {
  const seq = ++navSeq;
  stopLive();
  closeOverlays();
  section = next;
  renderSide();
  qs("#sec-title").textContent = (SECTIONS.find(([k]) => k === next) || [null, next])[1];
  try {
    if (next === "dash") await vDash();
    else if (next === "apps") await vApps();
    else if (next === "review") await vReview(arg);
    else if (next === "emps") await vEmps();
    else if (next === "bals") await vBals(arg);
    else if (next === "cal") await vCal();
    else if (next === "reports") await vReports();
    else if (next === "audit") await vAudit();
    else if (next === "hols") await vHols();
    else if (next === "types") await vTypes();
    else if (next === "users") await vUsers();
    else if (next === "invites") await vInvites();
    else if (next === "settings") await vSettings();
  } catch (e) {
    if (seq !== navSeq) return;
    console.error(e);
    view.innerHTML = errorState(e.message || "Failed to load");
    const r = qs("[data-retry]", view);
    if (r) r.onclick = () => go(section);
  }
  if (seq !== navSeq) return;
  window.scrollTo(0, 0);
}

const thisMonth = todayISO().slice(0, 7);

async function vDash() {
  const seq = navSeq;
  view.innerHTML = `<div class="stat-grid">${"<div class='skeleton' style='height:100px'></div>".repeat(4)}</div>${skeletonList(3)}`;
  const [pending, apps, emps] = await Promise.all([pendingQueue(), allApplications({ limit: 1000 }), listEmployees()]);
  if (seq !== navSeq) return;
  const approvedMonth = apps.filter((a) => a.status === "APPROVED" && (a.startDate || "").slice(0, 7) === thisMonth).length;
  const today = todayISO();
  const onLeave = apps.filter((a) => a.status === "APPROVED" && a.startDate <= today && a.endDate >= today).length;
  const recentApps = apps.slice(0, 10);
  view.innerHTML = `
    <div class="stat-grid">
      <div class="card stat-card"><div class="stat-num">${pending.length}</div><div class="stat-lbl">Pending review</div></div>
      <div class="card stat-card"><div class="stat-num">${approvedMonth}</div><div class="stat-lbl">Approved this month</div></div>
      <div class="card stat-card"><div class="stat-num">${onLeave}</div><div class="stat-lbl">On leave today</div></div>
      <div class="card stat-card"><div class="stat-num">${emps.filter((e) => e.status === "active").length}</div><div class="stat-lbl">Total employees</div></div>
    </div>
    <div class="card panel"><h3>Recent applications</h3>
      <div class="table-scroll"><table class="data stackable"><thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th>Status</th><th></th></tr></thead>
      <tbody>${recentApps.map((a) => `<tr><td data-th="Employee" class="ow">${esc(a.employeeName || "")}</td><td data-th="Type">${esc(a.leaveTypeName || "")}</td>
        <td data-th="Dates">${esc(a.startDate || "")} → ${esc(a.endDate || "")}</td><td data-th="Status">${statusPill(a.status)}</td>
        <td><button class="btn btn-ghost btn-sm" data-open="${esc(a.id)}">Open</button></td></tr>`).join("") || `<tr><td>No applications</td></tr>`}</tbody></table></div>
    </div>`;
  qsa("[data-open]", view).forEach((b) => (b.onclick = () => go("review", b.dataset.open)));
}

async function vApps() {
  const seq = navSeq;
  view.innerHTML = `<div class="card panel"><h3>Applications</h3>
    <div class="filter-row">
      <select class="field" id="f-status"><option value="">All statuses</option>${["PENDING", "UNDER_REVIEW", "FOR_SUPERVISOR_REVIEW", "FOR_FINAL_APPROVAL", "APPROVED", "REJECTED", "CANCELLED"].map((s) => `<option>${s}</option>`).join("")}</select>
      <input class="field" id="f-search" placeholder="Search by name" aria-label="Search by name">
      <input class="field" id="f-from" type="date" aria-label="From date">
      <input class="field" id="f-to" type="date" aria-label="To date">
    </div><div id="apps-out">${skeletonList(4)}</div></div>`;
  const reload = debounce(async () => {
    if (seq !== navSeq) return;
    const rows = await allApplications({
      status: qs("#f-status").value || undefined,
      search: qs("#f-search").value.trim(),
      from: qs("#f-from").value || undefined,
      to: qs("#f-to").value || undefined,
    });
    if (seq !== navSeq) return;
    qs("#apps-out").innerHTML = `<div class="table-scroll"><table class="data stackable"><thead><tr><th>Employee</th><th>Dept</th><th>Type</th><th>Dates</th><th>Days</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.map((a) => `<tr><td data-th="Employee" class="ow">${esc(a.employeeName || "")}</td><td data-th="Dept" class="ow">${esc(a.department || "")}</td>
        <td data-th="Type">${esc(a.leaveTypeName || "")}</td><td data-th="Dates">${esc(a.startDate || "")} → ${esc(a.endDate || "")}</td>
        <td data-th="Days">${esc(String(a.workingDays || 0))}</td><td data-th="Status">${statusPill(a.status)}</td>
        <td><button class="btn btn-ghost btn-sm" data-open="${esc(a.id)}">Review</button></td></tr>`).join("") || `<tr><td>No matches</td></tr>`}</tbody></table></div>`;
    qsa("[data-open]", view).forEach((b) => (b.onclick = () => go("review", b.dataset.open)));
  }, 250);
  ["#f-status", "#f-search", "#f-from", "#f-to"].forEach((s) => qs(s).addEventListener("input", reload));
  await reload();
}

async function vReview(id) {
  const seq = navSeq;
  if (!id) {
    const q = await pendingQueue();
    if (seq !== navSeq) return;
    view.innerHTML = `<div class="card panel"><h3>Review queue (${q.length})</h3>
      ${q.length ? q.map((a) => `<div class="card req-card" style="margin-bottom:10px"><div class="req-accent ${esc(a.status)}"></div>
        <div class="req-main"><div class="req-top"><span class="req-type ow">${esc(a.employeeName || "")} — ${esc(a.leaveTypeName || "")}</span>${statusPill(a.status)}
        <span class="req-actions"><button class="btn btn-primary btn-sm" data-open="${esc(a.id)}">Review</button></span></div>
        <div class="req-dates">${esc(a.startDate || "")} → ${esc(a.endDate || "")} · ${esc(String(a.workingDays || 0))} days</div>
        <div class="req-reason clamp-2 ow">“${esc(a.reason || "")}”</div></div></div>`).join("")
        : emptyState("✅", "Queue is clear")}</div>`;
    qsa("[data-open]", view).forEach((b) => (b.onclick = () => go("review", b.dataset.open)));
    return;
  }
  view.innerHTML = skeletonList(4);
  const d = await applicationDetail(id);
  if (seq !== navSeq) return;
  if (!d) { view.innerHTML = emptyState("🔍", "Not found"); return; }
  // Balance snapshot via known-ID gets (reviewers can't run cross-user lists).
  const bals = (
    await Promise.all(
      ["vacation", "sick", "spl"].map((code) => repo.get("leaveBalances", `${d.uid}_${code}`).catch(() => null))
    )
  ).filter(Boolean);
  if (seq !== navSeq) return;
  const actions = reviewActionsFor(user.role, d.status);
  const stage = reviewStage(d.status);
  const waiting = !actions.length && stage
    ? `<p class="muted">${stage === "supervisor" ? "Waiting for supervisor approval" : "Waiting for HR final approval"}</p>`
    : "";
  const decisionBtns = actions.map((a) => {
    const label = a === "FOR_FINAL_APPROVAL" ? "Approve — send to HR" : a === "APPROVED" ? (d.status === "FOR_FINAL_APPROVAL" ? "Approve (final)" : "Approve") : "Reject";
    return `<button class="${a === "REJECTED" ? "btn btn-danger" : "btn btn-primary"}" data-act="${a}">${label}</button>`;
  }).join("");
  view.innerHTML = `
    <div class="card panel"><button class="btn btn-ghost btn-sm" id="back-q">← Queue</button>
      <h3 class="ow">${esc(d.employeeName || "")} — ${esc(d.leaveTypeName || "")}</h3>
      <p>${statusPill(d.status)} · ${esc(d.startDate || "")} → ${esc(d.endDate || "")} · ${daysLabel(d.workingDays)}</p>
      <dl class="kv"><dt>Department</dt><dd class="ow">${esc(d.department || "")}</dd><dt>Position</dt><dd class="ow">${esc(d.position || "")}</dd>
      <dt>Reason</dt><dd class="ow">${esc(d.reason || "")}</dd><dt>Emergency</dt><dd class="ow">${esc(d.emergencyName || "")} ${esc(d.emergencyPhone || "")}</dd>
      ${Object.entries(d.details || {}).map(([k, v]) => `<dt class="ow">${esc(k)}</dt><dd class="ow">${esc(String(v))}</dd>`).join("")}</dl>
      <h4>Balance snapshot</h4><div class="table-scroll"><table class="data"><thead><tr><th>Type</th><th>Earned</th><th>Used</th><th>Pending</th><th>Remaining</th></tr></thead>
      <tbody>${bals.map((b) => `<tr><td>${esc(b.leaveTypeCode)}</td><td>${b.earned}</td><td>${b.used}</td><td>${b.pending}</td><td><b>${b.earned - b.used - b.pending}</b></td></tr>`).join("")}</tbody></table></div>
      <h4>Documents</h4><p>${(d.documents || []).map((x) => `<button class="btn btn-ghost btn-sm doc-open" data-path="${esc(x.path || "")}">${esc(x.fileName || "file")}</button>`).join(" ") || "—"}</p>
      <h4>Approval timeline</h4>${timelineHtml(d.approvals)}
      <h4>Decision</h4>
      ${actions.length
        ? `<label class="sec-label" for="rev-comment">Comment (required to reject)</label>
      <textarea class="field ow" id="rev-comment" style="margin-bottom:10px"></textarea>`
        : waiting}
      <div style="display:flex;gap:8px;flex-wrap:wrap">${decisionBtns}
        <a class="btn btn-ghost" href="print.html?id=${esc(d.id)}" target="_blank" rel="noopener">Print form</a>
      </div></div>`;
  qs("#back-q").onclick = () => go("review");
  qsa(".doc-open", view).forEach((b) => (b.onclick = async () => {
    try { window.open(await getUrl(b.dataset.path), "_blank", "noopener"); } catch (e) { toast(e.message, "error"); }
  }));
  qsa("[data-act]", view).forEach((b) => (b.onclick = async () => {
    const action = b.dataset.act;
    const comment = qs("#rev-comment").value;
    if (action === "REJECTED" && !comment.trim()) { toast("A comment is required to reject", "error"); return; }
    b.disabled = true;
    try {
      await review(id, action, user, comment);
      const doneMsg = action === "FOR_FINAL_APPROVAL" ? "Sent to HR for final approval" : action === "APPROVED" ? "Approved" : "Rejected";
      toast(doneMsg, "success");
      go("review");
    } catch (e) {
      toast(e.message, "error");
      b.disabled = false;
    }
  }));
}

async function vEmps() {
  const seq = navSeq;
  view.innerHTML = `<div class="card panel" id="del-panel" style="display:none"><h3>Deletion requests — supervisor confirmation needed</h3><div id="del-out"></div></div>
    <div class="card panel"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><h3 style="flex:1;margin:0">Employees</h3>
    ${can(user, "employees.manage") ? `<button class="btn btn-primary btn-sm" id="add-emp">Add employee</button>` : ""}</div>
    <div id="emps-out" style="margin-top:12px">${skeletonList(4)}</div></div>`;
  const reloadDels = async () => {
    const all = await repo.list("deletionRequests", { orderBy: [["createdAt", "desc"]], limit: 50 });
    if (seq !== navSeq) return;
    const open = all.filter((r) => r.status === "pending");
    const panel = qs("#del-panel");
    if (!panel) return;
    if (!open.length) { panel.style.display = "none"; return; }
    panel.style.display = "";
    qs("#del-out").innerHTML = open.map((r) => `<div class="doc-row">
        <span style="flex:1;min-width:0"><b class="ow">${esc(r.name || r.email || "")}</b><br>
        <span style="font-size:12px;color:var(--muted)">requested by ${esc(r.requestedByName || "")}</span></span>
        ${can(user, "accounts.delete.confirm") && r.requestedBy !== user.uid ? `<button class="btn btn-primary btn-sm" data-confirm="${esc(r.id)}">Confirm delete</button>` : `<span style="font-size:12px;color:var(--muted)">waiting for a supervisor</span>`}
        <button class="btn btn-ghost btn-sm" data-reject="${esc(r.id)}">Reject</button>
      </div>`).join("");
    qsa("[data-confirm]", view).forEach((b) => (b.onclick = async () => {
      openModal(`<h3>Delete this account?</h3><p style="color:var(--muted)">The account, its balances and its invite links are removed permanently. Past applications stay as records. This cannot be undone.</p>
        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap"><button class="btn btn-ghost" data-close>Back</button><button class="btn btn-danger" id="cf-del">Delete account</button></div>`);
      qs("#cf-del").onclick = async () => {
        try {
          await repo.confirmDeletion({ requestId: b.dataset.confirm, actor: user });
          toast("Account deleted", "success");
          closeOverlays();
          reloadDels();
          reload();
        } catch (e) { toast(e.message, "error"); }
      };
    }));
    qsa("[data-reject]", view).forEach((b) => (b.onclick = async () => {
      try {
        await repo.rejectDeletion({ requestId: b.dataset.reject, actor: user });
        toast("Request rejected", "success");
        reloadDels();
      } catch (e) { toast(e.message, "error"); }
    }));
  };
  await reloadDels();
  const reload = async () => {
    const rows = (await listEmployees()).filter((e) => e.role !== "sys_admin");
    if (seq !== navSeq || !qs("#emps-out")) return;
    qs("#emps-out").innerHTML = `<div class="table-scroll"><table class="data stackable"><thead><tr><th>Name</th><th>Email</th><th>Dept</th><th>Role</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.map((e) => `<tr><td data-th="Name" class="ow">${esc(e.name || "")}</td><td data-th="Email" class="ow">${esc(e.email || "")}</td>
        <td data-th="Dept" class="ow">${esc(e.department || "")}</td><td data-th="Role">${esc(e.role || "")}</td><td data-th="Status">${esc(e.status || "")}</td>
        <td><span style="display:flex;gap:4px;flex-wrap:wrap">${can(user, "employees.manage") ? `<button class="btn btn-ghost btn-sm" data-edit="${esc(e.id)}">Edit</button>` : ""}
        ${can(user, "accounts.delete.request") && e.id !== user.uid ? `<button class="btn btn-danger btn-sm" data-del="${esc(e.id)}" data-nm="${esc(e.name || e.email || "")}">Delete</button>` : ""}</span></td></tr>`).join("")}</tbody></table></div>`;
    qsa("[data-edit]", view).forEach((b) => (b.onclick = () => empModal(b.dataset.edit, reload)));
    qsa("[data-del]", view).forEach((b) => (b.onclick = () => {
      openModal(`<h3>Request deletion?</h3><p style="color:var(--muted)"><b class="ow">${esc(b.dataset.nm)}</b> will NOT be deleted yet — a supervisor must confirm first. Their pending applications must already be resolved.</p>
        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap"><button class="btn btn-ghost" data-close>Back</button><button class="btn btn-danger" id="cf-req">Send for confirmation</button></div>`);
      qs("#cf-req").onclick = async () => {
        try {
          await repo.requestDeletion({ uid: b.dataset.del, actor: user });
          toast("Sent to supervisors for confirmation", "success");
          closeOverlays();
          reloadDels();
        } catch (e) { toast(e.message, "error"); }
      };
    }));
  };
  await reload();
  const add = qs("#add-emp");
  if (add) add.onclick = () => empModal(null, reload);
}

async function empModal(id, reload) {
  const e = id ? await getEmployee(id) : { name: "", email: "", role: "employee", department: "", position: "", status: "active", employeeNo: "", phone: "" };
  const depts = await listDepartments().catch(() => []);
  const mayRole = can(user, "users.manage");
  const mayPw = id && can(user, "accounts.setPassword");
  openModal(`<h3>${id ? "Edit" : "Add"} employee</h3>
    <div class="form-grid">
    <div><label class="sec-label">Name</label><input class="field ow" id="e-name" value="${esc(e.name || "")}"></div>
    <div><label class="sec-label">Email</label><input class="field ow" id="e-email" value="${esc(e.email || "")}" ${id ? "disabled" : ""}></div>
    <div><label class="sec-label">Department</label><input class="field ow" id="e-dept" list="dept-list" value="${esc(e.department || "")}"><datalist id="dept-list">${depts.map((d) => `<option value="${esc(d.name)}">`).join("")}</datalist></div>
    <div><label class="sec-label">Position</label><input class="field ow" id="e-pos" value="${esc(e.position || "")}"></div>
    <div><label class="sec-label">Role${mayRole ? "" : " (sys admin only)"}</label><select class="field" id="e-role" ${mayRole ? "" : "disabled"}>${ROLES.map((r) => `<option ${e.role === r ? "selected" : ""}>${r}</option>`).join("")}</select></div>
    <div><label class="sec-label">Status</label><select class="field" id="e-status">${["active", "inactive"].map((s) => `<option ${e.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
    ${mayPw ? `<div><label class="sec-label">New password (optional, min 8)</label><input class="field" id="e-pw1" type="password" autocomplete="new-password"></div>
    <div><label class="sec-label">Confirm new password</label><input class="field" id="e-pw2" type="password" autocomplete="new-password"></div>` : ""}
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="e-save">Save</button></div>`);
  qs("#e-save").onclick = async () => {
    try {
      if (!id) {
        if (!qs("#e-email").value.trim()) { toast("Email required", "error"); return; }
        if (!qs("#e-name").value.trim()) { toast("Name required", "error"); return; }
        const email = qs("#e-email").value.trim().toLowerCase();
        const name = qs("#e-name").value.trim();
        const { token } = await inviteEmployee({
          email, name,
          department: qs("#e-dept").value.trim(), position: qs("#e-pos").value.trim(),
          role: qs("#e-role").value, employeeNo: "", phone: "",
        }, user);
        const link = inviteLink(token);
        const canEmail = emailConfigured();
        openModal(`<h3>Account created</h3>
          <p id="inv-status" style="color:var(--muted);font-size:14px">${canEmail
            ? `Sending the invite email to <b class="ow">${esc(email)}</b>…`
            : `The employee has <b>no password yet</b>. Copy this link and send it to them (valid 48 hours, one use).`}</p>
          <input class="field ow" id="inv-link" readonly value="${esc(link)}" style="margin-bottom:12px">
          <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap"><button class="btn btn-ghost" id="inv-done">Done</button><button class="btn btn-primary" id="inv-copy">Copy link</button></div>`);
        if (canEmail) {
          sendInviteEmail({ to: email, name, link }).then(() => {
            const st = qs("#inv-status");
            if (st) st.innerHTML = `Emailed to <b class="ow">${esc(email)}</b> — valid 48 hours, one use. A copy is below just in case.`;
          }).catch((err) => {
            const st = qs("#inv-status");
            if (st) st.textContent = `Couldn't email automatically (${err.message || "send failed"}). Copy the link below and send it yourself — it stays valid 48 hours.`;
            toast("Email failed — copy the link instead", "error");
          });
        }
        qs("#inv-copy").onclick = async () => {
          try { await navigator.clipboard.writeText(link); toast("Link copied", "success"); }
          catch { qs("#inv-link").select(); toast("Copy the link manually", "error"); }
        };
        qs("#inv-done").onclick = () => { closeOverlays(); reload(); };
        toast("Invite created", "success");
        return;
      }
      await saveEmployee({ name: qs("#e-name").value.trim(), department: qs("#e-dept").value.trim(), position: qs("#e-pos").value.trim(), role: mayRole ? qs("#e-role").value : e.role, status: qs("#e-status").value }, id);
      const pw1 = qs("#e-pw1");
      if (pw1 && pw1.value) {
        if (pw1.value !== qs("#e-pw2").value) { toast("Passwords do not match", "error"); return; }
        const res = await adminSetPassword(id, pw1.value, user);
        toast(res && res.emailed ? "Saved — password reset email sent" : "Saved — password updated", "success");
      } else {
        toast("Saved", "success");
      }
      closeOverlays();
      reload();
    } catch (err) { toast(err.message, "error"); }
  };
}

async function vBals(uidFilter) {
  const seq = navSeq;
  view.innerHTML = `<div class="card panel"><h3>Leave balances</h3><div id="bals-out">${skeletonList(3)}</div></div>
    <div class="card panel"><div id="tx-head"><h3>Transaction history</h3></div><div id="tx-out">${skeletonList(2)}</div></div>`;
  const bals = await allBalances();
  const emps = await listEmployees();
  if (seq !== navSeq) return;
  const names = new Map(emps.map((e) => [e.id, e.name]));
  const rows = uidFilter ? bals.filter((b) => b.uid === uidFilter) : bals;
  qs("#bals-out").innerHTML = `<div class="table-scroll"><table class="data stackable"><thead><tr><th>Employee</th><th>Type</th><th>Earned</th><th>Used</th><th>Pending</th><th>Remaining</th><th></th></tr></thead>
    <tbody>${rows.map((b) => `<tr><td data-th="Employee" class="ow">${esc(names.get(b.uid) || b.uid)}</td><td data-th="Type">${esc(b.leaveTypeCode)}</td>
      <td data-th="Earned">${b.earned}</td><td data-th="Used">${b.used}</td><td data-th="Pending">${b.pending}</td>
      <td data-th="Remaining"><b>${b.earned - b.used - b.pending}</b></td>
      <td>${can(user, "balances.adjust") ? `<button class="btn btn-ghost btn-sm" data-adj="${esc(b.uid)}|${esc(b.leaveTypeCode)}">Adjust</button>` : ""}</td></tr>`).join("")}</tbody></table></div>`;
  qsa("[data-adj]", view).forEach((b) => (b.onclick = () => {
    const [uid, code] = b.dataset.adj.split("|");
    openModal(`<h3>Adjust ${esc(code)}</h3><label class="sec-label">Delta (e.g. 2 or -1)</label>
      <input class="field" id="adj-d" type="number" style="margin-bottom:8px"><label class="sec-label">Reason (required)</label>
      <input class="field ow" id="adj-r" style="margin-bottom:12px">
      <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="adj-go">Apply</button></div>`);
    qs("#adj-go").onclick = async () => {
      try {
        await adjust(uid, code, Number(qs("#adj-d").value), qs("#adj-r").value, user);
        toast("Balance adjusted", "success");
        closeOverlays();
        vBals(uidFilter);
      } catch (err) { toast(err.message, "error"); }
    };
  }));
  const txUids = [...new Set(bals.map((b) => b.uid))].sort((a, b) => (names.get(a) || a).localeCompare(names.get(b) || b));
  qs("#tx-head").innerHTML = `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><h3 style="margin:0;flex:1">Transaction history</h3>
    <select class="field" id="tx-uid" aria-label="Employee for transaction history" style="max-width:260px"><option value="">All employees</option>
      ${txUids.map((uid) => `<option value="${esc(uid)}" ${uid === uidFilter ? "selected" : ""}>${esc(names.get(uid) || uid)}</option>`).join("")}</select></div>`;
  const loadTx = async (uid) => {
    qs("#tx-out").innerHTML = skeletonList(2);
    const tx = await (uid ? transactions(uid, undefined, 100) : allTransactions(100)).catch(() => []);
    if (seq !== navSeq) return;
    qs("#tx-out").innerHTML = tx.length ? `<div class="table-scroll"><table class="data"><thead><tr><th>When</th><th>Type</th><th>Days</th><th>Kind</th><th>Reason</th></tr></thead>
      <tbody>${tx.map((t) => `<tr><td>${esc((t.createdAt || "").slice(0, 16))}</td><td>${esc(t.leaveTypeCode)}</td><td>${esc(String(t.days))}</td><td>${esc(t.type)}</td><td class="ow">${esc(t.reason || "")}</td></tr>`).join("")}</tbody></table></div>`
      : `<p style="color:var(--muted)">No transactions.</p>`;
  };
  qs("#tx-uid").onchange = () => loadTx(qs("#tx-uid").value);
  await loadTx(uidFilter || "");
}

async function vCal() {
  const seq = navSeq;
  let y = +todayISO().slice(0, 4), m = +todayISO().slice(5, 7);
  view.innerHTML = `<div class="card panel"><div style="display:flex;gap:8px;align-items:center"><button class="icon-btn" id="c-p">←</button>
    <h3 id="c-t" style="flex:1;margin:0"></h3><button class="icon-btn" id="c-n">→</button></div><div id="c-g" style="margin-top:12px"></div></div>`;
  const draw = async () => {
    qs("#c-t").textContent = monthLabel(y, m);
    const apps = await allApplications({ limit: 500 });
    const hols = await listHolidays();
    if (seq !== navSeq) return;
    const holSet = new Map(hols.map((h) => [h.date || h.id, h.name]));
    const byDate = new Map();
    for (const a of apps) {
      if (!["APPROVED", "PENDING", "UNDER_REVIEW", "FOR_SUPERVISOR_REVIEW", "FOR_FINAL_APPROVAL"].includes(a.status)) continue;
      let cur = a.startDate, g = 0;
      while (cur && cur <= a.endDate && g++ < 370) {
        if (!byDate.has(cur)) byDate.set(cur, []);
        byDate.get(cur).push(a);
        const p = cur.split("-").map(Number);
        const n = new Date(p[0], p[1] - 1, p[2] + 1);
        cur = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
      }
    }
    qs("#c-g").innerHTML = `<div class="cal-grid" style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px">${monthGrid(y, m).map((w) => w.map((iso) => {
      if (!iso) return `<div class="cal-day dim"></div>`;
      const list = byDate.get(iso) || [];
      const st = list.some((a) => a.status === "APPROVED") ? "APPROVED" : list.length ? list[0].status : null;
      return `<button class="cal-day ${st === "APPROVED" ? "has-APPROVED" : st ? "has-PENDING" : ""} ${holSet.get(iso) ? "is-holiday" : ""}" data-day="${esc(iso)}" title="${esc(iso)}" aria-label="${esc(iso)}${list.length ? `, ${list.length} on leave` : ""}">${+iso.slice(8)}</button>`;
    }).join("")).join("")}</div><link rel="stylesheet" href="css/employee.css">`;
    qsa("#c-g [data-day]").forEach((b) => (b.onclick = () => {
      const iso = b.dataset.day;
      const list = byDate.get(iso) || [];
      const hol = holSet.get(iso);
      openSheet(`
        <div style="display:flex;align-items:center;gap:8px"><h3 style="margin:0;flex:1">On leave — ${esc(iso)}</h3><button class="icon-btn" data-close aria-label="Close">${xIcon()}</button></div>
        ${hol ? `<p style="color:var(--muted)">🎉 ${esc(hol)} (holiday)</p>` : ""}
        ${list.length ? list.map((a) => `<div class="doc-row">
          <span style="flex:1;min-width:0"><b class="ow">${esc(a.employeeName || "")}</b><br>
          <span style="font-size:12px;color:var(--muted)">${esc(a.leaveTypeName || a.leaveTypeCode || "")} · ${esc(a.startDate || "")} → ${esc(a.endDate || "")}</span></span>
          ${statusPill(a.status)}
          <button class="btn btn-ghost btn-sm" data-open-app="${esc(a.id)}">Open</button>
        </div>`).join("") : `<p style="color:var(--muted)">Nobody on leave this day.</p>`}`);
      qsa("[data-open-app]").forEach((o) => (o.onclick = () => go("review", o.dataset.openApp)));
    }));
  };
  qs("#c-p").onclick = () => { [y, m] = addMonths(y, m, -1); draw(); };
  qs("#c-n").onclick = () => { [y, m] = addMonths(y, m, 1); draw(); };
  await draw();
}

async function vReports() {
  const seq = navSeq;
  view.innerHTML = `<div class="card panel"><h3>Reports</h3>
    <div class="filter-row"><input class="field" id="r-from" type="month" value="${esc(thisMonth)}"><input class="field" id="r-to" type="month" value="${esc(thisMonth)}">
    <button class="btn btn-primary btn-sm" id="r-go">Run</button><button class="btn btn-ghost btn-sm" id="r-csv">Export CSV</button></div>
    <div id="r-out">${skeletonList(2)}</div></div>`;
  let last = null;
  const run = async () => {
    const from = qs("#r-from").value ? qs("#r-from").value + "-01" : undefined;
    const to = qs("#r-to").value ? qs("#r-to").value + "-31" : undefined;
    last = await summary({ from, to });
    if (seq !== navSeq) return;
    const tbl = (obj) => Object.entries(obj).map(([k, v]) => `<tr><td class="ow">${esc(k)}</td><td>${esc(String(v))}</td></tr>`).join("") || `<tr><td>—</td></tr>`;
    qs("#r-out").innerHTML = `<p>Total applications: <b>${last.total}</b></p>
      <div class="table-scroll"><table class="data"><thead><tr><th>By type (days)</th><th>Days</th></tr></thead><tbody>${tbl(last.byType)}</tbody></table></div>
      <div class="table-scroll"><table class="data"><thead><tr><th>By department</th><th>Count</th></tr></thead><tbody>${tbl(last.byDept)}</tbody></table></div>
      <div class="table-scroll"><table class="data"><thead><tr><th>By month</th><th>Count</th></tr></thead><tbody>${tbl(last.byMonth)}</tbody></table></div>
      <div class="table-scroll"><table class="data"><thead><tr><th>By status</th><th>Count</th></tr></thead><tbody>${tbl(last.byStatus)}</tbody></table></div>`;
  };
  qs("#r-go").onclick = run;
  qs("#r-csv").onclick = () => {
    if (!last) { toast("Run the report first", "error"); return; }
    const lines = ["id,employee,department,type,start,end,days,status,reason"];
    for (const a of last.rows) lines.push([a.id, a.employeeName, a.department, a.leaveTypeCode, a.startDate, a.endDate, a.workingDays, a.status, a.reason].map(csvEscape).join(","));
    downloadTextFile("leave-report.csv", lines.join("\n"));
  };
  await run();
}

async function vAudit() {
  const seq = navSeq;
  view.innerHTML = `<div class="card panel"><h3>Audit log</h3><div id="a-out">${skeletonList(3)}</div></div>`;
  const rows = await listAudit({ limit: 200 });
  if (seq !== navSeq) return;
  qs("#a-out").innerHTML = `<div class="table-scroll"><table class="data stackable"><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Description</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td data-th="When">${esc((r.createdAt || "").slice(0, 16))}</td><td data-th="Actor" class="ow">${esc(r.actorEmail || r.actorUid || "")}</td>
      <td data-th="Action" class="ow">${esc(r.action)}</td><td data-th="Entity">${esc(r.entity)} ${esc(r.entityId)}</td><td data-th="Description" class="ow">${esc(r.description || "")}</td></tr>`).join("") || `<tr><td>No entries</td></tr>`}</tbody></table></div>`;
}

async function vHols() {
  const seq = navSeq;
  view.innerHTML = `<div class="card panel"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><h3 style="flex:1;margin:0">Holidays</h3>
    ${can(user, "holidays.manage") ? `<button class="btn btn-primary btn-sm" id="add-h">Add</button>` : ""}</div><div id="h-out" style="margin-top:12px"></div></div>`;
  const reload = async () => {
    const rows = await listHolidays();
    if (seq !== navSeq) return;
    qs("#h-out").innerHTML = rows.map((h) => `<div class="doc-row"><span><b>${esc(h.date || h.id)}</b> — <span class="ow">${esc(h.name)}</span> <i>(${esc(h.kind)})</i></span>
      ${can(user, "holidays.manage") ? `<button class="icon-btn danger" data-del="${esc(h.date || h.id)}" aria-label="Delete">${xIcon()}</button>` : ""}</div>`).join("") || emptyState("📅", "No holidays");
    qsa("[data-del]", view).forEach((b) => (b.onclick = async () => { await removeHoliday(b.dataset.del); toast("Deleted", "success"); reload(); }));
  };
  await reload();
  const add = qs("#add-h");
  if (add) add.onclick = () => {
    openModal(`<h3>Add holiday</h3><label class="sec-label">Date</label><input class="field" id="h-d" type="date" style="margin-bottom:8px">
      <label class="sec-label">Name</label><input class="field ow" id="h-n" style="margin-bottom:8px">
      <label class="sec-label">Kind</label><select class="field" id="h-k"><option value="regular">regular</option><option value="special">special</option></select>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="h-go">Save</button></div>`);
    qs("#h-go").onclick = async () => {
      try {
        await saveHoliday(qs("#h-d").value, { name: qs("#h-n").value.trim(), kind: qs("#h-k").value });
        closeOverlays(); reload();
      } catch (e) { toast(e.message, "error"); }
    };
  };
}

async function vTypes() {
  const seq = navSeq;
  const may = can(user, "leaveTypes.manage");
  view.innerHTML = `<div class="card panel"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><h3 style="flex:1;margin:0">Leave types</h3>
    ${may ? `<button class="btn btn-primary btn-sm" id="add-t">Add leave type</button>` : ""}</div><div id="t-out" style="margin-top:12px">${skeletonList(3)}</div></div>`;
  const reload = async () => {
    const rows = await listLeaveTypes(true);
    if (seq !== navSeq) return;
    const body = rows.map((t) => {
      const code = t.code || t.id;
      return `<tr><td data-th="Code">${esc(code)}</td><td data-th="Name" class="ow">${esc(t.name)}</td>
        <td data-th="Active">${t.active ? "yes" : "no"}</td><td data-th="Requires doc">${t.requiresDoc ? "yes" : "no"}</td><td data-th="Max days">${esc(String(t.maxDays || 0))}</td>
        <td>${may ? `<div style="display:flex;gap:6px;justify-content:flex-end"><button class="btn btn-ghost btn-sm" data-edit="${esc(code)}">Edit</button>
          <button class="icon-btn danger" data-remove="${esc(code)}" data-name="${esc(t.name || code)}" aria-label="Remove ${esc(t.name || code)}">${xIcon()}</button></div>` : ""}</td></tr>`;
    }).join("") || `<tr><td colspan="6">${emptyState("🗂", "No leave types yet")}</td></tr>`;
    qs("#t-out").innerHTML = `<div class="table-scroll"><table class="data stackable"><thead><tr><th>Code</th><th>Name</th><th>Active</th><th>Requires doc</th><th>Max days</th><th></th></tr></thead><tbody>${body}</tbody></table></div>`;
    qsa("[data-edit]", view).forEach((b) => (b.onclick = () => leaveTypeModal(b.dataset.edit, reload)));
    qsa("[data-remove]", view).forEach((b) => (b.onclick = () => {
      const code = b.dataset.remove;
      openModal(`<h3>Remove leave type</h3><p>Remove <b>${esc(b.dataset.name || code)}</b>?</p>
        <p style="color:var(--muted);font-size:14px">Only unused types can be removed. If it has applications, employee balances, or transaction history, deactivate it instead.</p>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-danger" id="t-del">Remove</button></div>`);
      qs("#t-del").onclick = async () => {
        try {
          await removeLeaveType(code, user);
          closeOverlays();
          await reload();
          toast("Leave type removed", "success");
        } catch (e) { toast(e.message, "error"); }
      };
    }));
  };
  await reload();
  const add = qs("#add-t");
  if (add) add.onclick = () => leaveTypeModal("", reload);
}

async function leaveTypeModal(code, done) {
  const editing = !!code;
  const t = editing ? await repo.get("leaveTypes", code) : { active: true, requiresDoc: false, maxDays: 0, description: "" };
  if (!t) { toast("Leave type not found", "error"); return; }
  openModal(`<h3>${editing ? "Edit leave type" : "Add leave type"}</h3>
    <label class="sec-label">Code</label><input class="field" id="t-code" value="${esc(code || "")}" ${editing ? "disabled" : ""} placeholder="e.g. wellness" maxlength="32" autocomplete="off">
    <p style="color:var(--muted);font-size:12px;margin:4px 0 8px">Lowercase letters, numbers, underscores. The code cannot be changed later.</p>
    <label class="sec-label">Name</label><input class="field ow" id="t-n" value="${esc(t.name || "")}" maxlength="80" style="margin-bottom:8px">
    <label class="sec-label">Description</label><textarea class="field ow" id="t-desc" rows="2" maxlength="500" style="margin-bottom:8px">${esc(t.description || "")}</textarea>
    <label style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><input type="checkbox" id="t-a" ${t.active ? "checked" : ""} style="width:24px;height:24px"> Active</label>
    <label style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><input type="checkbox" id="t-r" ${t.requiresDoc ? "checked" : ""} style="width:24px;height:24px"> Requires document</label>
    <label class="sec-label">Max days (0 = unlimited)</label><input class="field" id="t-m" type="number" min="0" step="1" value="${esc(String(t.maxDays || 0))}">
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="t-go">${editing ? "Save" : "Add"}</button></div>`);
  qs("#t-go").onclick = async () => {
    try {
      const payload = { name: qs("#t-n").value.trim(), description: qs("#t-desc").value.trim(), active: qs("#t-a").checked, requiresDoc: qs("#t-r").checked, maxDays: Number(qs("#t-m").value) };
      if (editing) await saveLeaveType(code, payload, user);
      else await createLeaveType(qs("#t-code").value, payload, user);
      closeOverlays();
      await done();
      toast(editing ? "Saved" : "Leave type added", "success");
    } catch (e) { toast(e.message, "error"); }
  };
}

async function vInvites() {
  const seq = navSeq;
  const canEmail = emailConfigured();
  view.innerHTML = `<div class="card panel"><h3>Pending invites & password resets</h3>
    <p style="color:var(--muted);font-size:14px">Forgot-password requests from employees appear here. ${canEmail ? "Invite emails go out automatically — use Email to send one again." : "Copy the link and send it to them."}</p>
    <div id="inv-out">${skeletonList(2)}</div></div>`;
  const reloadInv = async () => {
    const all = await repo.list("invites", { orderBy: [["createdAt", "desc"]], limit: 100 });
    if (seq !== navSeq) return;
    const open = all.filter((i) => !i.used);
    qs("#inv-out").innerHTML = open.length ? open.map((i) => `<div class="doc-row">
        <span style="flex:1;min-width:0"><b class="ow">${esc(i.email || "")}</b><br>
        <span style="font-size:12px;color:var(--muted)">${esc(i.kind)} · ${esc(i.status)} · expires ${esc((i.expiresAt || "").slice(0, 16))}</span></span>
        <button class="btn btn-ghost btn-sm" data-copy="${esc(i.token)}">Copy link</button>
        ${canEmail && i.kind === "invite" ? `<button class="btn btn-ghost btn-sm" data-email="${esc(i.token)}">Email</button>` : ""}
        ${i.kind === "reset" && i.status === "requested" ? `<button class="btn btn-primary btn-sm" data-sent="${esc(i.token)}">Mark sent</button>` : ""}
        <button class="icon-btn danger" data-revoke="${esc(i.token)}" aria-label="Revoke">${xIcon()}</button>
      </div>`).join("")
      : `<p style="color:var(--muted)">Nothing pending.</p>`;
    qsa("[data-copy]", view).forEach((b) => (b.onclick = async () => {
      try { await navigator.clipboard.writeText(inviteLink(b.dataset.copy)); toast("Link copied", "success"); }
      catch { toast("Copy failed", "error"); }
    }));
    qsa("[data-email]", view).forEach((b) => (b.onclick = async () => {
      const token = b.dataset.email;
      const row = open.find((i) => i.token === token) || {};
      b.disabled = true;
      const prof = await repo.get("pendingProfiles", token).catch(() => null);
      try {
        await sendInviteEmail({ to: row.email || "", name: (prof && prof.name) || "", link: inviteLink(token) });
        toast(`Invite emailed to ${row.email || "the employee"}`, "success");
      } catch (e) { toast(e.message || "Email failed", "error"); }
      b.disabled = false;
    }));
    qsa("[data-sent]", view).forEach((b) => (b.onclick = async () => {
      await repo.markInviteSent(b.dataset.sent);
      toast("Marked as sent", "success");
      reloadInv();
    }));
    qsa("[data-revoke]", view).forEach((b) => (b.onclick = async () => {
      await repo.remove("invites", b.dataset.revoke);
      toast("Link revoked", "success");
      reloadInv();
    }));
  };
  await reloadInv();
}

async function vUsers() {
  const seq = navSeq;
  view.innerHTML = `<div class="card panel"><h3>Users & roles (sys_admin)</h3><div id="u-out">${skeletonList(3)}</div></div>`;
  const rows = await listEmployees();
  if (seq !== navSeq) return;
  qs("#u-out").innerHTML = `<div class="table-scroll"><table class="data stackable"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
    <tbody>${rows.map((e) => `<tr><td data-th="Name" class="ow">${esc(e.name || "")}</td><td data-th="Email" class="ow">${esc(e.email || "")}</td>
      <td data-th="Role"><select class="field" data-role="${esc(e.id)}" style="max-width:180px">${ROLES.map((r) => `<option ${e.role === r ? "selected" : ""}>${r}</option>`).join("")}</select></td>
      <td data-th="Status">${esc(e.status || "")}</td>
      <td><button class="btn btn-ghost btn-sm" data-toggle="${esc(e.id)}" data-st="${esc(e.status || "active")}">${e.status === "active" ? "Deactivate" : "Activate"}</button></td></tr>`).join("")}</tbody></table></div>`;
  qsa("[data-role]", view).forEach((s) => (s.onchange = async () => {
    try { await saveEmployee({ role: s.value }, s.dataset.role); toast("Role updated", "success"); }
    catch (e) { toast(e.message, "error"); }
  }));
  qsa("[data-toggle]", view).forEach((b) => (b.onclick = async () => {
    await setStatus(b.dataset.toggle, b.dataset.st === "active" ? "inactive" : "active");
    vUsers();
  }));
}

async function vSettings() {
  const seq = navSeq;
  view.innerHTML = `<div class="card panel"><h3>Settings</h3><div id="s-out">${skeletonList(3)}</div></div>
    <div class="card panel"><h3>Reference data</h3>
      <p style="color:var(--muted);font-size:14px">Re-seeds leave types, holidays, settings and departments without touching accounts or applications.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-ghost" id="seed-ref">Seed reference data</button></div></div>`;
  const s = await getSettings();
  if (seq !== navSeq) return;
  qs("#s-out").innerHTML = `<div class="form-grid">
    <div><label class="sec-label">Organization</label><input class="field ow" id="s-org" value="${esc(s.orgName || "")}"></div>
    <div><label class="sec-label">Office</label><input class="field ow" id="s-office" value="${esc(s.office || "")}"></div>
    <div><label class="sec-label">Reason char limit</label><input class="field" id="s-char" type="number" value="${esc(String(s.charLimit || 500))}"></div>
    <div><label class="sec-label">Upload max MB</label><input class="field" id="s-mb" type="number" value="${esc(String(s.uploadMaxMb || 5))}"></div>
    <div><label class="sec-label">Vacation workflow</label><select class="field" id="s-wv"><option value="hr_only" ${s.workflowVacation === "hr_only" ? "selected" : ""}>hr_only</option><option value="hr_supervisor_final" ${s.workflowVacation !== "hr_only" ? "selected" : ""}>hr_supervisor_final</option></select></div>
    <div><label class="sec-label">Default workflow</label><select class="field" id="s-wd"><option value="hr_only" ${s.workflowDefault === "hr_only" ? "selected" : ""}>hr_only</option><option value="hr_supervisor_final" ${s.workflowDefault !== "hr_only" ? "selected" : ""}>hr_supervisor_final</option></select></div>
    <div class="full"><label class="sec-label">Cancellation policy</label><textarea class="field ow" id="s-cancel">${esc(s.cancellationPolicy || "")}</textarea></div>
    <div><label class="sec-label">HRMO name (print form)</label><input class="field ow" id="s-hrmo" value="${esc((s.signatories || {}).hrmo || "")}"></div>
    <div><label class="sec-label">Supervisor name (print form)</label><input class="field ow" id="s-sup" value="${esc((s.signatories || {}).supervisor || "")}"></div>
    <div><label class="sec-label">Mayor / head name (print form)</label><input class="field ow" id="s-mayor" value="${esc((s.signatories || {}).mayor || "")}"></div>
    <div><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="s-sal" ${s.salaryVisible ? "checked" : ""} style="width:24px;height:24px"> Show salary on print form</label></div>
    </div>
    <div style="margin-top:12px"><button class="btn btn-primary" id="s-save">Save settings</button></div>`;
  qs("#s-save").onclick = async () => {
    try {
      await saveSettings({
        orgName: qs("#s-org").value.trim(), office: qs("#s-office").value.trim(),
        charLimit: Number(qs("#s-char").value) || 500, uploadMaxMb: Number(qs("#s-mb").value) || 5,
        workflowVacation: qs("#s-wv").value, workflowDefault: qs("#s-wd").value,
        cancellationPolicy: qs("#s-cancel").value.trim(), salaryVisible: qs("#s-sal").checked,
        signatories: { hrmo: qs("#s-hrmo").value.trim(), supervisor: qs("#s-sup").value.trim(), mayor: qs("#s-mayor").value.trim() },
      }, user);
      toast("Settings saved", "success");
    } catch (e) { toast(e.message, "error"); }
  };
  qs("#seed-ref").onclick = async () => {
    try { await repo.seedReferenceData(); toast("Reference data seeded", "success"); }
    catch (e) { toast(e.message, "error"); }
  };
}

renderSide();
go("dash");
