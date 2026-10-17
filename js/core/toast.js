/* Toast + global error surface (never a blank screen). */
import { esc } from "./dom.js";

let container = null;

function ensure() {
  if (container) return container;
  container = document.createElement("div");
  container.id = "toasts";
  container.setAttribute("aria-live", "polite");
  document.body.appendChild(container);
  return container;
}

export function toast(msg, type = "info") {
  try {
    const box = ensure();
    // Errors always show (they need attention); info/success dedupe.
    if (type !== "error") {
      const dup = Array.from(box.children).some((t) => t.textContent === String(msg));
      if (dup) return;
    }
    const t = document.createElement("div");
    t.className = `toast toast-${type}`;
    t.innerHTML = `<span>${esc(msg)}</span>`;
    box.appendChild(t);
    setTimeout(() => t.classList.add("show"));
    setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => t.remove(), 300);
    }, 3200);
  } catch (e) {
    console.error("toast failed:", e, msg);
  }
}

export function installGlobalHandlers() {
  window.addEventListener("error", (e) => {
    console.error(e.error || e.message);
    toast("Something went wrong. Please try again.", "error");
  });
  window.addEventListener("unhandledrejection", (e) => {
    console.error(e.reason);
    toast("Something went wrong. Please try again.", "error");
  });
}
