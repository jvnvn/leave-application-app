/* APP_CONFIG — the ONLY switchboard for backend mode.
 * dataSource: "local" (demo, active) | "firestore" (written, NOT yet tested
 * against a live project — see js/data/firestore-adapter.js header).
 * Run locally with any static server:  python3 -m http.server 8000
 * or:  npx serve .
 */
export const APP_CONFIG = {
  dataSource: "firestore",
  appName: "Leave Management System",
  orgName: "Sample Organization Inc.",
  // Firebase Web SDK (modular) is loaded lazily via dynamic import() from the
  // official gstatic CDN ONLY when dataSource === "firestore". Local mode
  // loads zero Firebase code.
  firebaseCdnVersion: "12.4.0",
  firebaseConfig: {
    apiKey: "AIzaSyCcTcFNUtoJI4vn6Y5YTMxp3ipK6qCSq48",
    authDomain: "leaveapplication-d9556.firebaseapp.com",
    projectId: "leaveapplication-d9556",
    storageBucket: "leaveapplication-d9556.firebasestorage.app",
    messagingSenderId: "1022934149903",
    appId: "1:1022934149903:web:0643ff63366c2a6e496c7a",
    measurementId: "G-9Y24D78CS2",
  },
  // ?emulator=1|0 connects/disconnects the Firestore/Auth adapters to local
  // emulators. Resolved (and persisted for the tab) below from the URL.
  emulator: {
    firestoreHost: "127.0.0.1",
    firestorePort: 8080,
    authUrl: "http://127.0.0.1:9099",
  },
  // Resolved below; firebase-app.js reads THIS (not the URL) so the choice
  // survives redirects that drop the query string.
  useEmulator: false,
};

// Mode resolution for testing — no file edit needed:
//   ?backend=local|firestore   ?emulator=1|0
// Priority: URL param > this tab's stored choice > defaults above. The choice
// is stored in sessionStorage because in-app redirects (login -> location
// .replace("admin.html")) drop the query string; without it, the page after
// such a redirect silently falls back to the DEFAULT backend (real Firestore)
// and shows "Missing or insufficient permissions.".
try {
  const MODE_KEY = "lms.v1.mode";
  const params = new URLSearchParams(location.search);
  const qBackend = params.get("backend");
  const qEmulator = params.get("emulator");
  let saved = null;
  try { saved = JSON.parse(window.sessionStorage.getItem(MODE_KEY) || "null"); } catch { saved = null; }
  if (!saved || (saved.backend !== "local" && saved.backend !== "firestore")) saved = null;
  let backend = saved ? saved.backend : APP_CONFIG.dataSource;
  let emulator = saved ? !!saved.emulator : false;
  let changed = false;
  if (qBackend === "local" || qBackend === "firestore") { backend = qBackend; changed = true; }
  if (qEmulator === "1" || qEmulator === "0") { emulator = qEmulator === "1"; changed = true; }
  try { if (changed) window.sessionStorage.setItem(MODE_KEY, JSON.stringify({ backend, emulator })); } catch { /* storage blocked */ }
  APP_CONFIG.dataSource = backend;
  APP_CONFIG.useEmulator = emulator;
} catch { /* non-browser (tests) */ }
