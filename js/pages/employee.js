/* Employee app: Home, Requests, Request Leave wizard, Calendar,
 * Notifications, Profile. One render(state) per screen; wizard state object
 * + draft autosave so updates never wipe the form. */
import { requireEmployee } from "../core/router.js";
import { esc, qs, qsa, debounce, avatarColor } from "../core/dom.js";
import { initials, daysLabel } from "../core/format.js";
import { calcWorkingDays, isCancellable, validateApplication, remaining } from "../core/rules.js";
import { todayISO, monthGrid, monthLabel, addMonths, parseISODate } from "../core/dates.js";
import { toast, installGlobalHandlers } from "../core/toast.js";
import { LEAVE_DETAIL_FIELDS } from "../core/constants.js";
import { signOut } from "../services/auth.js";
import { myApplications, applicationDetail, submitLeave, cancelLeave, addDocument } from "../services/leaves.js";
import { myBalances } from "../services/balances.js";
import { listLeaveTypes } from "../services/leaveTypes.js";
import { holidayDates, listHolidays } from "../services/holidays.js";
import { myNotifications, markRead, markAllRead, subscribeMyNotifications } from "../services/notifications.js";
import { getSettings } from "../services/settings.js";
import { upload, getUrl, storagePath } from "../services/files.js";
import { balanceCard, requestCard, skeletonList, emptyState, errorState, openSheet, openModal, closeOverlays, avatarHtml, timelineHtml, statusPill, xIcon } from "../ui/components.js";
import { initLayoutDebug } from "../ui/layout-debug.js";
import * as draftStore from "../data/draft.js";

installGlobalHandlers();
initLayoutDebug();

const user = await requireEmployee();
if (!user) throw new Error("redirect");

const app = qs("#app");
let tab = "home";
let filter = "all";
let calYear, calMonth;
{
  const t = parseISODate(todayISO());
  calYear = t.getFullYear();
  calMonth = t.getMonth() + 1;
}
let unsubs = [];
let notifCache = [];
let typesCache = [];
let holidaysCache = [];
let settingsCache = null;

const ICONS = {
  home: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10.5L12 3l9 7.5V21H3z"/></svg>',
  req: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 9h6M9 13h6"/></svg>',
  cal: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  not: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 10-12 0c0 7-3 8-3 8h18s-3-1-3-8M10 21a2 2 0 004 0"/></svg>',
  me: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
};

function cleanupSubs() {
  unsubs.forEach((u) => { try { u(); } catch { /* ignore */ } });
  unsubs = [];
}

function renderNav(unread) {
  const tabs = [["home", "Home"], ["req", "Requests"], ["cal", "Calendar"], ["not", "Notifications"], ["me", "Profile"]];
  qs("#nav").innerHTML = tabs.map(([k, label]) =>
    `<button data-tab="${k}" class="${tab === k || (tab === "wizard" && k === "req") ? "on" : ""}">${ICONS[k]}<span>${label}${k === "not" && unread ? ` <span class="nbadge">${unread}</span>` : ""}</span></button>`
  ).join("");
  qs("#nav").onclick = (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) show(b.dataset.tab);
  };
  qs("#fab").style.display = tab === "wizard" ? "none" : "";
}

qs("#fab").addEventListener("click", () => show("wizard"));

async function show(next, arg) {
  cleanupSubs();
  closeOverlays();
  tab = next;
  try {
    if (next === "home") await renderHome();
    else if (next === "req") await renderRequests();
    else if (next === "wizard") renderWizard(arg);
    else if (next === "cal") await renderCalendar();
    else if (next === "not") await renderNotifications();
    else if (next === "me") await renderProfile();
  } catch (e) {
    console.error(e);
    app.innerHTML = errorState(e.message || "Failed to load");
    const r = qs("[data-retry]", app);
    if (r) r.onclick = () => show(tab);
  }
  const unread = notifCache.filter((n) => !n.read).length;
  renderNav(unread);
  window.scrollTo(0, 0);
}

// ---------- HOME ----------
async function renderHome() {
  app.innerHTML = `<header class="emp-head"><div class="emp-head-row">
      <div class="skeleton" style="width:56px;height:56px;border-radius:50%"></div>
      <div><div class="skeleton" style="width:140px"></div></div></div></header>
    <div class="emp-sec"><div class="bal-grid">${"<div class='skeleton' style='height:110px'></div>".repeat(4)}</div></div>
    <div class="emp-sec">${skeletonList(2)}</div>`;
  const [bals, apps, types, notifs] = await Promise.all([
    myBalances(user.uid), myApplications(user.uid, "all"), listLeaveTypes(), myNotifications(user.uid),
  ]);
  notifCache = notifs;
  const byCode = new Map(bals.map((b) => [b.leaveTypeCode, b]));
  const cards = [
    { name: "Vacation", code: "vacation", color: "var(--indigo)" },
    { name: "Sick", code: "sick", color: "var(--sick)" },
    { name: "Special Privilege", code: "spl", color: "var(--orange)" },
  ].map(({ name, code, color }) => {
    const b = byCode.get(code) || { remaining: 0, earned: 0 };
    return balanceCard({ name, remaining: b.remaining, quota: b.earned, color });
  });
  const unpaidTaken = apps.filter((a) => a.leaveTypeCode === "unpaid" && a.status === "APPROVED").reduce((s, a) => s + (a.workingDays || 0), 0);
  cards.push(balanceCard({ name: "Unpaid Taken", remaining: unpaidTaken, quota: 0, color: "var(--green)" }));
  const pending = apps.filter((a) => ["PENDING", "UNDER_REVIEW", "FOR_SUPERVISOR_REVIEW", "FOR_FINAL_APPROVAL", "DRAFT"].includes(a.status));
  const recent = apps.slice(0, 3);
  app.innerHTML = `
    <header class="emp-head"><div class="emp-head-row">
      ${avatarHtml(user.name, user.avatarColor || avatarColor(user.name))}
      <div style="flex:1;min-width:0"><span class="staff-pill">STAFF PROFILE</span>
        <h2 class="emp-name ow">${esc(user.name || "Employee")}</h2>
        <div class="emp-sub ow">${esc(user.position || "")}${user.department ? " · " + esc(user.department) : ""}</div>
      </div>
      <button class="logout-btn" id="logout">Logout</button>
    </div></header>
    <section class="emp-sec"><p class="sec-label">Leave allotment remaining</p>
      <div class="bal-grid">${cards.join("")}</div></section>
    <section class="emp-sec">
      <div class="emp-sec-head"><p class="sec-label" style="margin:0">My request tracking</p></div>
      <div class="seg" role="tablist">
        <button data-f="all" class="${filter === "all" ? "on" : ""}">All</button>
        <button data-f="pending" class="${filter === "pending" ? "on" : ""}">Pending${pending.length ? '<span class="dot"></span>' : ""}</button>
        <button data-f="history" class="${filter === "history" ? "on" : ""}">History</button>
      </div>
      <div id="req-list" style="margin-top:12px">
        ${recent.length ? recent.map(requestCard).join("") : emptyState("📭", "No requests yet", `<button class="btn btn-primary btn-sm" id="empty-apply">Request Leave</button>`)}
      </div>
      ${apps.length > 3 ? `<button class="btn btn-ghost" id="see-all" style="width:100%">View all requests</button>` : ""}
    </section>`;
  qs("#logout").onclick = async () => { await signOut(); location.replace("login.html"); };
  qsa(".seg button", app).forEach((b) => (b.onclick = () => { filter = b.dataset.f; show("req"); }));
  const sa = qs("#see-all", app);
  if (sa) sa.onclick = () => { filter = "all"; show("req"); };
  const ea = qs("#empty-apply", app);
  if (ea) ea.onclick = () => show("wizard");
  void types;
  qsa("[data-id]", app).forEach((c) => {
    const v = c.querySelector(".view-btn");
    if (v) v.onclick = (e) => { e.stopPropagation(); openDetail(c.dataset.id); };
    else c.onclick = () => openDetail(c.dataset.id);
  });
}

// ---------- REQUESTS ----------
async function renderRequests() {
  app.innerHTML = `<div class="emp-sec"><p class="sec-label">My requests</p>
    <div class="seg">
      ${["all", "pending", "history"].map((f) => `<button data-f="${f}" class="${filter === f ? "on" : ""}">${f[0].toUpperCase() + f.slice(1)}</button>`).join("")}
    </div><div id="req-list" style="margin-top:12px">${skeletonList(3)}</div></div>`;
  qsa(".seg button", app).forEach((b) => (b.onclick = () => { filter = b.dataset.f; renderRequests(); }));
  const apps = await myApplications(user.uid, filter);
  const box = qs("#req-list", app);
  box.innerHTML = apps.length ? apps.map(requestCard).join("") : emptyState("📭", filter === "pending" ? "No pending requests" : "Nothing here");
  qsa("[data-id]", box).forEach((c) => {
    c.onclick = () => openDetail(c.dataset.id);
    const v = c.querySelector(".view-btn");
    if (v) v.onclick = (e) => { e.stopPropagation(); openDetail(c.dataset.id); };
  });
}

async function openDetail(id) {
  openSheet(`<div style="padding:8px 4px">${skeletonList(2)}</div>`);
  const d = await applicationDetail(id);
  if (!d) { closeOverlays(); toast("Not found", "error"); return; }
  const cancellable = isCancellable(d.status) && d.uid === user.uid;
  const attachable = ["DRAFT", "PENDING", "UNDER_REVIEW", "FOR_SUPERVISOR_REVIEW", "FOR_FINAL_APPROVAL"].includes(d.status) && d.uid === user.uid;
  openSheet(`
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <h3 class="ow" style="margin:0;flex:1">${esc(d.leaveTypeName || d.leaveTypeCode || "Leave")}</h3>
      ${statusPill(d.status)}
      <button class="icon-btn" data-close aria-label="Close">${xIcon()}</button>
    </div>
    <dl class="kv" style="margin-top:12px">
      <dt>Dates</dt><dd>${esc(d.startDate || "")} → ${esc(d.endDate || "")}</dd>
      <dt>Working days</dt><dd>${esc(String(d.workingDays || 0))}</dd>
      <dt>Reason</dt><dd class="ow">${esc(d.reason || "")}</dd>
      <dt>Emergency</dt><dd class="ow">${esc(d.emergencyName || "")} (${esc(d.emergencyRelationship || "")}) ${esc(d.emergencyPhone || "")}</dd>
      ${Object.entries(d.details || {}).map(([k, v]) => `<dt class="ow">${esc(k)}</dt><dd class="ow">${esc(String(v))}</dd>`).join("")}
      <dt>Documents</dt><dd>${(d.documents || []).map((x) => `<button class="btn btn-ghost btn-sm doc-open" data-path="${esc(x.path || "")}" style="margin:2px">${esc(x.fileName || "file")}</button>`).join("") || "—"}</dd>
    </dl>
    ${attachable ? `<div class="card" style="padding:12px;margin-top:8px">
      <p class="sec-label">Attach a document</p>
      <input type="file" id="attach-input" aria-label="Attach document" accept=".pdf,.jpg,.jpeg,.png" style="width:100%">
      <p id="attach-err" style="display:none;color:var(--danger);font-size:13px"></p>
    </div>` : ""}
    <h4>Approval timeline</h4>${timelineHtml(d.approvals)}
    <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
      ${cancellable ? `<button class="btn btn-danger" id="cancel-app">Cancel application</button>` : ""}
      <a class="btn btn-ghost" href="print.html?id=${esc(d.id)}" target="_blank" rel="noopener">View / Print Official Form</a>
    </div>`);
  qsa(".doc-open").forEach((b) => (b.onclick = async () => {
    try {
      const url = await getUrl(b.dataset.path);
      window.open(url, "_blank", "noopener");
    } catch (e) { toast(e.message, "error"); }
  }));
  const att = qs("#attach-input");
  if (att) att.onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const errBox = qs("#attach-err");
    errBox.style.display = "none";
    att.disabled = true;
    try {
      const meta = await upload(f, storagePath(user.uid, id, f.name));
      await addDocument(id, { fileName: f.name, path: meta.path, size: meta.size, mimeType: meta.mimeType }, user);
      toast("Document attached", "success");
      openDetail(id);
    } catch (err) {
      errBox.textContent = err.message || "Upload failed";
      errBox.style.display = "block";
      toast(err.message || "Upload failed", "error");
      att.disabled = false;
      att.value = "";
    }
  };
  const c = qs("#cancel-app");
  if (c) c.onclick = () => {
    openModal(`<h3>Cancel this application?</h3><p style="color:var(--muted)">The held balance will be released.</p>
      <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap"><button class="btn btn-ghost" data-close>Keep</button><button class="btn btn-danger" id="confirm-cancel">Cancel leave</button></div>`);
    qs("#confirm-cancel").onclick = async () => {
      try {
        await cancelLeave(id, user);
        toast("Cancelled — balance released", "success");
        closeOverlays();
        show(tab === "wizard" ? "home" : tab);
      } catch (e) { toast(e.message, "error"); }
    };
  };
}

// ---------- WIZARD ----------
function loadDraft() {
  const blank = { leaveTypeCode: "", details: {}, startDate: "", endDate: "", emergencyName: "", emergencyRelationship: "", emergencyPhone: "", reason: "", documents: [] };
  return { ...blank, ...(draftStore.loadDraft(user.uid) || {}) };
}
function saveDraft(s) {
  draftStore.saveDraft(user.uid, s);
}

function renderWizard() {
  const state = loadDraft();
  const draw = async () => {
    if (typesCache.length === 0) {
      typesCache = await listLeaveTypes();
      holidaysCache = await holidayDates();
      settingsCache = await getSettings();
    }
    const bals = await myBalances(user.uid).catch(() => []);
    const remByCode = new Map(bals.map((b) => [b.leaveTypeCode, b.remaining]));
    const currentValidation = () => {
      const days = state.startDate && state.endDate ? calcWorkingDays(state.startDate, state.endDate, holidaysCache) : 0;
      const lt = typesCache.find((t) => (t.code || t.id) === state.leaveTypeCode);
      const draft = {
        startDate: state.startDate, endDate: state.endDate, reason: state.reason,
        emergencyName: state.emergencyName, emergencyPhone: state.emergencyPhone,
        leaveType: lt ? { code: lt.code || lt.id, requiresDoc: lt.requiresDoc } : null,
        details: state.details, documents: state.documents, charLimit: (settingsCache && settingsCache.charLimit) || 500,
      };
      const errs = lt ? validateApplication(draft) : ["Choose a leave type"];
      return { days, lt, errs, valid: errs.length === 0 && days > 0 };
    };
    const { days, lt, errs, valid } = currentValidation();
    const fields = LEAVE_DETAIL_FIELDS[state.leaveTypeCode] || [];
    const reviewHtml = ({ valid: ok, lt: type, errs: problems, days: n }) => ok
      ? `<div class="card" style="padding:16px"><dl class="kv"><dt>Type</dt><dd>${esc(type.name)}</dd><dt>Dates</dt><dd>${esc(state.startDate)} → ${esc(state.endDate)} (${n} days)</dd></dl></div>`
      : `<div class="card" style="padding:16px"><ul style="margin:0;padding-left:18px;color:var(--muted);font-size:14px">${(n <= 0 && state.startDate && state.endDate ? ["Selected range has 0 working days"] : problems).map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>`;
    app.innerHTML = `
    <div class="wiz-head"><button class="icon-btn" id="wiz-back" aria-label="Back">←</button>
      <h2 class="wiz-title">Request Leave</h2><div class="wiz-sub">New Application for Leave</div></div>
    <div class="emp-sec"><p class="sec-label">1. Leave category type</p>
      <div class="tile-grid">${typesCache.map((t) => {
        const code = t.code || t.id;
        const sel = state.leaveTypeCode === code;
        const rem = remByCode.get(code);
        const tag = code === "unpaid" || code === "other" ? "No balance" : rem == null ? "Select" : `${rem} left`;
        return `<button class="tile ${sel ? "sel" : ""}" data-type="${esc(code)}"><span class="ow">${esc(t.name)}</span><span class="rem">${esc(tag)}</span></button>`;
      }).join("")}</div></div>
    ${state.leaveTypeCode ? `<div class="emp-sec"><p class="sec-label">1B. Leave details</p><div class="card" style="padding:16px">
      ${fields.length ? fields.filter((f) => !f.showIf || state.details[Object.keys(f.showIf)[0]] === Object.values(f.showIf)[0]).map((f) => {
        if (f.type === "choice") return `<p class="sec-label">${esc(f.label)}</p><div class="seg" style="margin-bottom:12px">${f.options.map((o) => `<button data-det="${esc(f.key)}" data-val="${esc(o)}" class="${state.details[f.key] === o ? "on" : ""}">${esc(o)}</button>`).join("")}</div>`;
        return `<label class="sec-label" for="det-${esc(f.key)}">${esc(f.label)}</label><input class="field ow" id="det-${esc(f.key)}" data-det-input="${esc(f.key)}" value="${esc(state.details[f.key] || "")}" style="margin-bottom:12px">`;
      }).join("") : `<p style="color:var(--muted);font-size:14px">No extra details for this type.</p>`}
    </div></div>` : ""}
    <div class="emp-sec"><p class="sec-label">2. Choose absence interval</p><div class="card" style="padding:16px">
      <div class="date-row">
        <div><label class="sec-label" for="start">Start</label><input class="field" id="start" type="date" value="${esc(state.startDate)}"></div>
        <div><label class="sec-label" for="end">End</label><input class="field" id="end" type="date" value="${esc(state.endDate)}"></div>
      </div>
      <div class="days-live">${state.startDate && state.endDate ? `${days} working day${days === 1 ? "" : "s"}` : "Pick start and end dates"}</div>
    </div></div>
    <div class="emp-sec"><p class="sec-label">3. Emergency callback contact</p><div class="card" style="padding:16px">
      <label class="sec-label" for="emg-name">Name</label><input class="field ow" id="emg-name" value="${esc(state.emergencyName)}" style="margin-bottom:10px">
      <label class="sec-label" for="emg-rel">Relationship</label><input class="field ow" id="emg-rel" value="${esc(state.emergencyRelationship)}" style="margin-bottom:10px">
      <label class="sec-label" for="emg-phone">Phone</label><input class="field" id="emg-phone" inputmode="tel" placeholder="+63 9XX XXX XXXX" value="${esc(state.emergencyPhone)}">
    </div></div>
    <div class="emp-sec"><p class="sec-label">4. Detail reason and cover details</p>
      <textarea class="field ow" id="reason" aria-label="Reason for leave" maxlength="${(settingsCache && settingsCache.charLimit) || 500}">${esc(state.reason)}</textarea>
      <p style="font-size:12px;color:var(--muted)">Min 8 characters • Written: <span id="reason-count">${(state.reason || "").length}</span> letters</p></div>
    <div class="emp-sec"><p class="sec-label">5. Supporting documents ${lt && lt.requiresDoc ? "(required)" : ""}</p><div class="card" style="padding:16px">
      <p style="font-size:12px;color:var(--muted);margin:0 0 8px">PDF, JPG or PNG · max 700 KB each</p>
      <input type="file" id="doc-input" aria-label="Supporting documents" accept=".pdf,.jpg,.jpeg,.png" style="width:100%">
      <p id="doc-err" style="display:none;color:var(--danger);font-size:13px"></p>
      <p id="doc-busy" style="display:none;color:var(--indigo);font-size:13px">Uploading…</p>
      ${(state.documents || []).map((d, i) => `<div class="doc-row"><span class="ow" style="flex:1">${esc(d.fileName)}</span><button class="icon-btn danger" data-rmdoc="${i}" aria-label="Remove">${xIcon()}</button></div>`).join("")}
    </div></div>
    <div class="emp-sec"><p class="sec-label">6. Review</p>
      <div id="review-box">${reviewHtml({ valid, lt, errs, days })}</div>
      <div class="submit-wrap"><button class="btn btn-primary submit-btn" id="submit-btn" ${valid ? "" : "disabled"}>Submit Leave Application</button></div>
    </div>`;
    renderNav(notifCache.filter((n) => !n.read).length);
    const syncFields = () => {
      const read = (s) => { const n = qs(s); return n ? n.value : undefined; };
      const start = read("#start"); if (start !== undefined) state.startDate = start;
      const end = read("#end"); if (end !== undefined) state.endDate = end;
      const name = read("#emg-name"); if (name !== undefined) state.emergencyName = name;
      const rel = read("#emg-rel"); if (rel !== undefined) state.emergencyRelationship = rel;
      const phone = read("#emg-phone"); if (phone !== undefined) state.emergencyPhone = phone;
      const reason = read("#reason"); if (reason !== undefined) state.reason = reason;
      qsa("[data-det-input]", app).forEach((inp) => { state.details[inp.dataset.detInput] = inp.value; });
    };
    const refreshSummary = () => {
      const v = currentValidation();
      const count = qs("#reason-count");
      if (count) count.textContent = String((state.reason || "").length);
      const live = qs(".days-live");
      if (live) live.textContent = state.startDate && state.endDate ? `${v.days} working day${v.days === 1 ? "" : "s"}` : "Pick start and end dates";
      const box = qs("#review-box");
      if (box) box.innerHTML = reviewHtml(v);
      const btn = qs("#submit-btn");
      if (btn) btn.disabled = !v.valid;
    };
    qs("#wiz-back").onclick = () => show("home");
    qsa("[data-type]", app).forEach((b) => (b.onclick = () => { syncFields(); state.leaveTypeCode = b.dataset.type; state.details = {}; saveDraft(state); draw(); }));
    qsa("[data-det]", app).forEach((b) => (b.onclick = () => { syncFields(); state.details[b.dataset.det] = b.dataset.val; saveDraft(state); draw(); }));
    qsa("[data-det-input]", app).forEach((inp) => (inp.oninput = debounce(() => { state.details[inp.dataset.detInput] = inp.value; saveDraft(state); refreshSummary(); }, 250)));
    const restick = debounce(() => {
      syncFields(); saveDraft(state); refreshSummary();
    }, 250);
    ["#start", "#end", "#emg-name", "#emg-rel", "#emg-phone", "#reason"].forEach((s) => {
      const n = qs(s);
      if (n) {
        n.addEventListener("input", restick);
        n.addEventListener("focus", () => setTimeout(() => n.scrollIntoView({ block: "center", behavior: "smooth" }), 300));
      }
    });
    qs("#doc-input").onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const errBox = qs("#doc-err");
      const busy = qs("#doc-busy");
      errBox.style.display = "none";
      busy.style.display = "block";
      e.target.disabled = true;
      const fail = (msg) => {
        errBox.textContent = msg;
        errBox.style.display = "block";
        busy.style.display = "none";
        e.target.disabled = false;
        e.target.value = "";
        toast(msg, "error");
      };
      try {
        const tmpId = `draft-${Date.now()}`;
        const path = storagePath(user.uid, tmpId, f.name);
        const meta = await upload(f, path);
        state.documents = [...(state.documents || []), { fileName: f.name, path: meta.path, size: meta.size, mimeType: meta.mimeType, applicationId: tmpId }];
        syncFields(); saveDraft(state);
        toast("Document attached", "success");
        draw();
      } catch (err) { fail(err.message || "Upload failed"); }
    };
    qsa("[data-rmdoc]", app).forEach((b) => (b.onclick = () => { syncFields(); state.documents.splice(+b.dataset.rmdoc, 1); saveDraft(state); draw(); }));
    const sub = qs("#submit-btn");
    if (sub) sub.onclick = async () => {
      syncFields(); saveDraft(state);
      const v = currentValidation();
      if (!v.valid) { refreshSummary(); return; }
      sub.disabled = true;
      sub.innerHTML = `<span class="spin"></span> Submitting…`;
      try {
        const docs = state.documents || [];
        const { id } = await submitLeave({
          uid: user.uid, employeeName: user.name || "", department: user.department || "", position: user.position || "",
          leaveTypeCode: state.leaveTypeCode, startDate: state.startDate, endDate: state.endDate,
          reason: state.reason.trim(), emergencyName: state.emergencyName.trim(),
          emergencyRelationship: state.emergencyRelationship.trim(), emergencyPhone: state.emergencyPhone.trim(),
          details: state.details,
        }, docs.map((d) => ({ fileName: d.fileName, path: d.path, size: d.size, mimeType: d.mimeType, applicationId: "" })));
        draftStore.clearDraft(user.uid);
        Object.assign(state, loadDraft());
        toast(`Application submitted (${daysLabel(v.days)})`, "success");
        filter = "pending";
        show("home");
        void id;
      } catch (err) {
        toast(err.message, "error");
        sub.disabled = false;
        sub.textContent = "Submit Leave Application";
      }
    };
  };
  app.innerHTML = `<div class="emp-sec">${skeletonList(4)}</div>`;
  draw().catch((e) => {
    console.error(e);
    app.innerHTML = errorState(e.message || "Failed to load");
  });
}

// ---------- CALENDAR ----------
async function renderCalendar() {
  app.innerHTML = `<div class="emp-sec"><div class="emp-sec-head">
      <button class="icon-btn" id="cal-prev" aria-label="Previous month">←</button>
      <h3 style="margin:0">${esc(monthLabel(calYear, calMonth))}</h3>
      <button class="icon-btn" id="cal-next" aria-label="Next month">→</button></div>
    <div class="card" style="padding:12px"><div class="cal-grid" id="cal-grid"></div>
    <div class="cal-legend" style="margin-top:8px"><span>🟩 Approved</span><span>🟨 Pending</span><span>🟧 Holiday</span></div></div></div>`;
  qs("#cal-prev").onclick = () => { [calYear, calMonth] = addMonths(calYear, calMonth, -1); renderCalendar(); };
  qs("#cal-next").onclick = () => { [calYear, calMonth] = addMonths(calYear, calMonth, 1); renderCalendar(); };
  const [apps, hols] = await Promise.all([myApplications(user.uid, "all", 500), listHolidays()]);
  const holSet = new Map(hols.map((h) => [h.date || h.id, h.name]));
  const leaveByDate = new Map();
  const stepDay = (iso) => {
    const d = parseISODate(iso);
    if (!d) return null;
    const n = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  };
  for (const a of apps) {
    if (["REJECTED", "CANCELLED"].includes(a.status)) continue;
    let cur = a.startDate;
    let guard = 0;
    while (cur && cur <= a.endDate && guard++ < 370) {
      if (!leaveByDate.has(cur)) leaveByDate.set(cur, []);
      leaveByDate.get(cur).push(a);
      cur = stepDay(cur);
    }
  }
  const weeks = monthGrid(calYear, calMonth);
  const grid = qs("#cal-grid");
  grid.innerHTML =
    ["S", "M", "T", "W", "T", "F", "S"].map((d) => `<div class="cal-dow">${d}</div>`).join("") +
    weeks.map((w) => w.map((iso) => {
      if (!iso) return `<div class="cal-day dim"></div>`;
      const mine = (leaveByDate.get(iso) || []);
      const st = mine.find((a) => a.status === "APPROVED") ? "APPROVED" : mine.length ? mine[0].status : null;
      const hol = holSet.get(iso);
      const cls = st === "APPROVED" ? "has-APPROVED" : st ? "has-PENDING" : "";
      const title = `${iso}${hol ? " — " + hol : ""}${st ? " — " + st : ""}`;
      return `<button class="cal-day ${cls} ${hol ? "is-holiday" : ""}" data-day="${esc(iso)}" title="${esc(title)}" aria-label="${esc(title)}">${+iso.slice(8)}</button>`;
    }).join("")).join("");
  qsa("#cal-grid [data-day]").forEach((b) => (b.onclick = () => {
    const iso = b.dataset.day;
    const mine = leaveByDate.get(iso) || [];
    const hol = holSet.get(iso);
    openSheet(`
      <div style="display:flex;align-items:center;gap:8px"><h3 style="margin:0;flex:1">${esc(iso)}</h3><button class="icon-btn" data-close aria-label="Close">${xIcon()}</button></div>
      ${hol ? `<p style="color:var(--muted)">🎉 ${esc(hol)} (holiday)</p>` : ""}
      ${mine.length ? mine.map((a) => `<div class="doc-row">
        <span style="flex:1;min-width:0"><b class="ow">${esc(a.leaveTypeName || a.leaveTypeCode || "")}</b><br>
        <span style="font-size:12px;color:var(--muted)">${esc(a.startDate || "")} → ${esc(a.endDate || "")}</span></span>
        ${statusPill(a.status)}
        <button class="btn btn-ghost btn-sm" data-open-req="${esc(a.id)}">View</button>
      </div>`).join("") : `<p style="color:var(--muted)">Nothing on this day.</p>`}`);
    qsa("[data-open-req]").forEach((o) => (o.onclick = () => openDetail(o.dataset.openReq)));
  }));
}

// ---------- NOTIFICATIONS ----------
async function renderNotifications() {
  app.innerHTML = `<div class="emp-sec"><div class="emp-sec-head"><p class="sec-label" style="margin:0">Notifications</p>
    <button class="btn btn-ghost btn-sm" id="mark-all">Mark all read</button></div>
    <div id="not-list">${skeletonList(3)}</div></div>`;
  qs("#mark-all").onclick = async () => { await markAllRead(user.uid); notifCache = await myNotifications(user.uid); renderNotifications(); renderNav(0); };
  cleanupSubs();
  unsubs.push(subscribeMyNotifications(user.uid, (rows) => {
    notifCache = rows;
    const box = qs("#not-list");
    if (!box) return;
    box.innerHTML = rows.length ? rows.map((n) => `<div class="card req-card" data-nid="${esc(n.id)}" style="${n.read ? "opacity:.65" : ""}">
        <div class="req-accent ${n.read ? "CANCELLED" : "PENDING"}"></div>
        <div class="req-main"><b class="ow">${esc(n.title)}</b><p class="ow" style="margin:4px 0;font-size:14px">${esc(n.body || "")}</p>
        <span style="font-size:12px;color:var(--muted)">${esc(n.createdAt || "")}</span></div></div>`).join("")
      : emptyState("🔔", "No notifications");
    qsa("[data-nid]", box).forEach((c) => (c.onclick = async () => { await markRead(c.dataset.nid); }));
    renderNav(rows.filter((n) => !n.read).length);
  }));
}

// ---------- PROFILE ----------
async function renderProfile() {
  app.innerHTML = `<div class="emp-sec">${skeletonList(3)}</div>`;
  const [bals, apps] = await Promise.all([myBalances(user.uid), myApplications(user.uid, "all")]);
  app.innerHTML = `
    <header class="emp-head"><div class="emp-head-row">
      ${avatarHtml(user.name, user.avatarColor || avatarColor(user.name))}
      <div style="flex:1;min-width:0"><span class="staff-pill">STAFF PROFILE</span>
        <h2 class="emp-name ow">${esc(user.name || "")}</h2>
        <div class="emp-sub ow">${esc(user.position || "")} · ${esc(user.department || "")}</div></div>
    </div></header>
    <div class="emp-sec"><div class="card" style="padding:16px"><dl class="kv">
      <dt>Email</dt><dd class="ow">${esc(user.email || "")}</dd>
      <dt>Employee No</dt><dd class="ow">${esc(user.employeeNo || "")}</dd>
      <dt>Date hired</dt><dd>${esc(user.dateHired || "")}</dd>
      <dt>Applications</dt><dd>${apps.length}</dd>
    </dl></div></div>
    <div class="emp-sec"><p class="sec-label">Balances</p><div class="bal-grid">
      ${bals.map((b) => balanceCard({ name: b.leaveTypeName, remaining: b.remaining, quota: b.earned, color: "var(--indigo)" })).join("")}
    </div></div>
    <div class="emp-sec"><button class="btn btn-danger" id="signout" style="width:100%">Sign out</button></div>`;
  qs("#signout").onclick = async () => { await signOut(); location.replace("login.html"); };
}

// live notification badge
try {
  subscribeMyNotifications(user.uid, (rows) => { notifCache = rows; });
} catch { /* ignore */ }

show("home");
