/* invite.html?token=... — set password via HR invite / reset link. */
import { inviteDetail, setPasswordWithInvite } from "../services/auth.js";
import { repo } from "../data/repository.js";
import { inviteStatus } from "../core/rules.js";
import { toast, installGlobalHandlers } from "../core/toast.js";
import { qs, esc } from "../core/dom.js";
import { initLayoutDebug } from "../ui/layout-debug.js";

installGlobalHandlers();
initLayoutDebug();

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
        <input class="field" id="pw1" type="password" autocomplete="new-password" required minlength="8" style="margin-bottom:12px">
        <label class="sec-label" for="pw2">Confirm password</label>
        <input class="field" id="pw2" type="password" autocomplete="new-password" required minlength="8" style="margin-bottom:16px">
        <button class="btn btn-primary" id="inv-btn" type="submit" style="width:100%">Set password</button>
      </form></div>`;
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
