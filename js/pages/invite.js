/* invite.html?token=... — set password via HR invite / reset link. */
import { inviteDetail, setPasswordWithInvite } from "../services/auth.js";
import { repo } from "../data/repository.js";
import { inviteStatus } from "../core/rules.js";
import { toast, installGlobalHandlers } from "../core/toast.js";
import { qs, qsa, esc } from "../core/dom.js";
import { initLayoutDebug } from "../ui/layout-debug.js";

installGlobalHandlers();
initLayoutDebug();

const EYE = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_OFF = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

const body = qs("#inv-body");
const token = new URLSearchParams(location.search).get("token") || "";

try {
  const inv = await inviteDetail(token);
  const st = inviteStatus(inv);
  if (st !== "valid") {
    qs("#inv-title").textContent = "Link unavailable";
    body.innerHTML = `<div class="card" style="padding:20px"><p>${esc(
      st === "used" ? "This link was already used. Ask HR for a new one." :
      st === "expired" ? "This link expired (48 hours). Ask HR for a new one." :
      "This link is invalid. Check the full URL from HR."
    )}</p><a class="btn btn-ghost" href="login.html">Back to sign in</a></div>`;
  } else {
    const who = inv.kind === "reset" ? "Choose a new password" : "Create your password to activate the account";
    body.innerHTML = `<div class="card" style="padding:20px">
      <p style="color:var(--muted);font-size:14px">${esc(who)} for <b class="ow">${esc(inv.email || "")}</b></p>
      <div id="inv-err" class="state-box" style="display:none;color:var(--danger);padding:0 0 12px"></div>
      <form id="inv-form">
        <label class="sec-label" for="pw1">New password (min 8 characters)</label>
        <div class="pw-wrap" style="margin-bottom:12px">
          <input class="field" id="pw1" type="password" autocomplete="new-password" required minlength="8">
          <button class="pw-toggle" type="button" data-pw="pw1" aria-label="Show password" aria-pressed="false" title="Show password">${EYE}</button>
        </div>
        <label class="sec-label" for="pw2">Confirm password</label>
        <div class="pw-wrap" style="margin-bottom:16px">
          <input class="field" id="pw2" type="password" autocomplete="new-password" required minlength="8">
          <button class="pw-toggle" type="button" data-pw="pw2" aria-label="Show password" aria-pressed="false" title="Show password">${EYE}</button>
        </div>
        <button class="btn btn-primary" id="inv-btn" type="submit" style="width:100%">Set password</button>
      </form></div>`;
    qsa(".pw-toggle").forEach((btn) => {
      btn.addEventListener("click", () => {
        const inp = qs("#" + btn.dataset.pw);
        const show = inp.type === "password";
        inp.type = show ? "text" : "password";
        btn.innerHTML = show ? EYE_OFF : EYE;
        btn.setAttribute("aria-pressed", String(show));
        btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
        btn.setAttribute("title", show ? "Hide password" : "Show password");
      });
    });
    qs("#inv-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = qs("#inv-btn");
      const err = qs("#inv-err");
      err.style.display = "none";
      btn.disabled = true;
      btn.innerHTML = `<span class="spin"></span> Saving…`;
      try {
        await setPasswordWithInvite(token, qs("#pw1").value, qs("#pw2").value);
        try {
          const u = await repo.get("users", inv.uid);
          toast(`Password set — welcome${u && u.name ? ", " + u.name : ""}!`, "success");
        } catch { toast("Password set!", "success"); }
        location.replace("login.html");
      } catch (ex) {
        err.textContent = ex.message || "Failed";
        err.style.display = "block";
        btn.disabled = false;
        btn.textContent = "Set password";
      }
    });
  }
} catch (e) {
  console.error(e);
  body.innerHTML = `<div class="card" style="padding:20px"><p>Couldn't load this link. Please try again.</p><a class="btn btn-ghost" href="login.html">Back to sign in</a></div>`;
}
