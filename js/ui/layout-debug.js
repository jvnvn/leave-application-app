/* ?debug=layout — outlines overflowing elements, logs selectors, badge.
 * Dev tool only; zero cost when the query param is absent. */
export function initLayoutDebug() {
  let params = null;
  try {
    params = new URLSearchParams(location.search);
  } catch {
    return;
  }
  if (!params || params.get("debug") !== "layout") return;
  const run = () => {
    document.querySelectorAll(".ldb-overflow").forEach((x) => x.classList.remove("ldb-overflow"));
    const bad = [];
    const vw = document.documentElement.clientWidth;
    document.querySelectorAll("body *").forEach((elm) => {
      try {
        const r = elm.getBoundingClientRect();
        if (r.right > vw + 1 && r.width > 0) {
          elm.classList.add("ldb-overflow");
          bad.push(`${elm.tagName.toLowerCase()}${elm.id ? "#" + elm.id : ""}${elm.className && typeof elm.className === "string" ? "." + elm.className.split(" ").slice(0, 2).join(".") : ""}`);
        }
      } catch { /* ignore */ }
    });
    let badge = document.getElementById("layout-debug-badge");
    if (!badge) {
      badge = document.createElement("div");
      badge.id = "layout-debug-badge";
      document.body.appendChild(badge);
    }
    badge.textContent = `Overflow: ${bad.length}`;
    if (bad.length) console.warn("[layout-debug] overflowing:", bad.slice(0, 30));
  };
  window.addEventListener("load", () => setTimeout(run, 300));
  setTimeout(run, 800);
}
