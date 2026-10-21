/* PWA glue: service worker registration + "install app" strip.
 * The strip only mounts on pages that render the employee column. */
import { openModal } from "./ui/components.js";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.warn("Service worker registration failed", err);
    });
  });
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.navigator.standalone === true
  );
}

/* iPadOS 13+ reports a Mac user agent, hence the touch-capable check. */
function isIosSafari() {
  if (/CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent)) return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

const IOS_STEPS = `
  <h3 style="margin:0 0 10px">Add to Home Screen</h3>
  <ol class="install-steps">
    <li>Tap the <strong>Share</strong> button in Safari's toolbar.</li>
    <li>Choose <strong>Add to Home Screen</strong>.</li>
    <li>Tap <strong>Add</strong> — the app appears on your Home Screen.</li>
  </ol>
  <button class="btn btn-primary" style="width:100%" data-close>Got it</button>
`;

let deferredPrompt = null;
let strip = null;

function removeStrip() {
  if (!strip) return;
  strip.remove();
  strip = null;
}

function mountStrip(mode) {
  const column = document.querySelector(".emp-col");
  if (strip || !column || isStandalone()) return;
  strip = document.createElement("div");
  strip.className = "install-strip";
  strip.setAttribute("role", "region");
  strip.setAttribute("aria-label", "Install app");
  strip.innerHTML = `
    <span class="install-strip-text">Install Aurora Leave for quick access</span>
    ${mode === "install" ? '<a class="install-strip-link" href="download.html">Get APK</a>' : ""}
    <button class="install-strip-btn" type="button">${mode === "ios" ? "Show me how" : "Install"}</button>
    <button class="install-strip-x" type="button" aria-label="Dismiss">✕</button>
  `;
  strip.querySelector(".install-strip-btn").addEventListener("click", async () => {
    if (mode === "ios") return openModal(IOS_STEPS);
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    removeStrip();
  });
  strip.querySelector(".install-strip-x").addEventListener("click", removeStrip);
  column.prepend(strip);
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredPrompt = event;
  mountStrip("install");
});

window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  removeStrip();
});

if (isIosSafari()) mountStrip("ios");
