/* Reusable render helpers. All user text MUST pass through esc(). */
import { esc } from "../core/dom.js";
import { initials } from "../core/format.js";
import { STATUS_LABEL } from "../core/constants.js";

export function statusPill(status) {
  const cls = STATUS_LABEL[status] ? `pill-${status.toLowerCase()}` : "pill-neutral";
  const label = STATUS_LABEL[status] || "Unknown";
  return `<span class="pill ${cls}">${esc(label)}</span>`;
}

export function balanceCard({ name, remaining: rem, quota, color }) {
  const pct = quota > 0 ? Math.max(0, Math.min(100, (rem / quota) * 100)) : 0;
  return `<div class="card bal-card">
    <div class="bal-top"><span class="bal-name">${esc(name)}</span>
    <span class="bal-quota">${quota > 0 ? `Quota ${quota}` : "No quota"}</span></div>
    <div class="bal-num">${esc(String(rem))}</div>
    <div class="bal-bar"><div class="bal-fill" style="--bar-color:${esc(color)};--bar-w:${pct}%"></div></div>
  </div>`;
}

export function requestCard(app) {
  const st = app.status || "UNKNOWN";
  return `<article class="card req-card" data-id="${esc(app.id)}">
    <div class="req-accent ${esc(st)}"></div>
    <div class="req-main">
      <div class="req-top">
        <span class="req-type ow">${esc((app.leaveTypeName || app.leaveTypeCode || "Leave"))}</span>
        ${statusPill(st)}
        <span class="req-actions">
          <button class="icon-btn view-btn" data-id="${esc(app.id)}" aria-label="View details">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        </span>
      </div>
      <div class="req-dates">${esc(app.startDate || "")} → ${esc(app.endDate || "")} · ${esc(String(app.workingDays || 0))} days</div>
      <div class="req-reason clamp-2 ow">“${esc(app.reason || "")}”</div>
    </div>
  </article>`;
}

export function skeletonList(n = 3) {
  return Array.from({ length: n }, () => `<div class="skeleton" style="height:96px;margin-bottom:12px"></div>`).join("");
}

export function emptyState(icon, title, action = "") {
  return `<div class="state-box"><div class="big">${icon}</div><p><b>${esc(title)}</b></p>${action}</div>`;
}

export function errorState(msg) {
  return `<div class="state-box"><div class="big">⚠️</div><p>${esc(msg)}</p><button class="btn btn-ghost btn-sm" data-retry="1">Retry</button></div>`;
}

export function openSheet(html) {
  closeOverlays();
  const scrim = document.createElement("div");
  scrim.className = "scrim";
  scrim.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="sheet-grip"></div>${html}</div>`;
  document.body.appendChild(scrim);
  document.body.style.overflow = "hidden";
  const sheet = scrim.firstElementChild;
  const prevFocus = document.activeElement;
  const close = () => {
    scrim.remove();
    document.body.style.overflow = "";
    if (prevFocus && prevFocus.focus) prevFocus.focus();
  };
  scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });
  scrim.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
    if (e.key === "Tab") {
      const f = Array.from(sheet.querySelectorAll("button,input,select,textarea,a[href]")).filter((x) => !x.disabled);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  const cbtn = sheet.querySelector("[data-close]");
  if (cbtn) cbtn.addEventListener("click", close);
  scrim._close = close;
  return close;
}

export function openModal(html) {
  closeOverlays();
  const wrap = document.createElement("div");
  wrap.className = "modal-wrap";
  wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(wrap);
  document.body.style.overflow = "hidden";
  const prevFocus = document.activeElement;
  const close = () => {
    wrap.remove();
    document.body.style.overflow = "";
    if (prevFocus && prevFocus.focus) prevFocus.focus();
  };
  wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
  wrap.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  wrap.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
  wrap._close = close;
  return close;
}

export function closeOverlays() {
  document.querySelectorAll(".scrim,.modal-wrap").forEach((x) => x.remove());
  document.body.style.overflow = "";
}

export function avatarHtml(name, color) {
  return `<div class="avatar" style="background:${esc(color || "#4F46E5")}">${esc(initials(name))}</div>`;
}

export function timelineHtml(history) {
  if (!history || !history.length) return `<p style="color:var(--muted)">No history yet.</p>`;
  return `<ul class="timeline">${history.map((h) => `<li>
    <b class="ow">${esc(STATUS_LABEL[h.action] || h.action || "")}</b> <span style="color:var(--muted)">· ${esc(h.step || "")}</span><br>
    <span class="ow" style="font-size:13px">${esc(h.comment || "")}</span><br>
    <span style="font-size:12px;color:var(--muted)">${esc(h.approverName || "")} · ${esc(h.timestamp || "")}</span>
  </li>`).join("")}</ul>`;
}
