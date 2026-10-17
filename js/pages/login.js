/* Login page wiring. */
import { signIn, sendPasswordReset, activeSession } from "../services/auth.js";
import { homeFor } from "../core/router.js";
import { toast, installGlobalHandlers } from "../core/toast.js";
import { qs } from "../core/dom.js";
import { initLayoutDebug } from "../ui/layout-debug.js";

installGlobalHandlers();
initLayoutDebug();

// Async (form wiring below stays synchronous): only bounce on a VALID session
// so a stale cache never lands the user on a dead dashboard.
activeSession().then((existing) => {
  if (existing) location.replace(homeFor(existing));
}).catch(() => { /* stay on login */ });

const form = qs("#login-form");
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = qs("#login-btn");
  const errBox = qs("#login-error");
  errBox.style.display = "none";
  btn.disabled = true;
  btn.innerHTML = `<span class="spin"></span> Signing in…`;
  try {
    const user = await signIn(qs("#email").value.trim(), qs("#password").value);
    toast(`Welcome, ${user.name || user.email}!`, "success");
    location.replace(homeFor(user));
  } catch (err) {
    errBox.textContent = err.message || "Sign in failed";
    errBox.style.display = "block";
  } finally {
    btn.disabled = false;
    btn.textContent = "Sign in";
  }
});

qs("#forgot-btn").addEventListener("click", async () => {
  const email = qs("#email").value.trim();
  if (!email) {
    toast("Enter your email first", "error");
    return;
  }
  try {
    const r = await sendPasswordReset(email);
    toast(r.message, "success");
  } catch (e) {
    toast(e.message || "Request failed", "error");
  }
});
