/* DOM helpers. esc() MUST wrap every user string inserted into HTML. */
const DIV = typeof document !== "undefined" ? document.createElement("div") : null;

export function esc(s) {
  if (s == null) return "";
  // Fast path without DOM (also used by tests in non-DOM envs).
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function qs(sel, root = document) {
  return root.querySelector(sel);
}

export function qsa(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

export function debounce(fn, ms = 250) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function avatarColor(name) {
  const palette = ["#4F46E5", "#0EA5E9", "#10B981", "#F59E0B", "#F43F5E", "#8B5CF6"];
  let h = 0;
  for (const c of String(name || "?")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

export { DIV };
