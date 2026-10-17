/* APP_CONFIG — app-wide settings. The app is Firestore-only: the in-browser
 * demo backend (?backend=local) was removed — js/data/repository.js always
 * talks to js/data/firestore-adapter.js.
 * Run locally with any static server:  python3 -m http.server 8000
 * or:  npx serve .
 */
export const APP_CONFIG = {
  appName: "Leave Management System",
  orgName: "Municipality of Aurora, Isabela",
  // Firebase Web SDK (modular) is loaded lazily via dynamic import() from the
  // official gstatic CDN on first data access.
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
  // Automatic invite emails via EmailJS (free tier, REST — no SDK). Setup in
  // docs/FIRESTORE.md §10; with any ID empty, emails are off and HR keeps the
  // copy-link flow.
  email: {
    publicKey: "", // emailjs.com → Account → General → Public Key (safe to expose)
    serviceId: "", // Email Services → service ID (service_xxxx)
    templateId: "", // Email Templates → template ID (template_xxxx)
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

// Emulator resolution for testing — no file edit needed: ?emulator=1|0
// Priority: URL param > this tab's stored choice > default above. The choice
// is stored in sessionStorage because in-app redirects (login -> location
// .replace("admin.html")) drop the query string; without it, the page after
// such a redirect silently falls back to the real project ("Missing or
// insufficient permissions." against the emulators).
try {
  const MODE_KEY = "lms.v1.mode";
  const params = new URLSearchParams(location.search);
  const qEmulator = params.get("emulator");
  let saved = null;
  try { saved = JSON.parse(window.sessionStorage.getItem(MODE_KEY) || "null"); } catch { saved = null; }
  if (!saved || typeof saved.emulator !== "boolean") saved = null;
  let emulator = saved ? !!saved.emulator : false;
  if (qEmulator === "1" || qEmulator === "0") {
    emulator = qEmulator === "1";
    try { window.sessionStorage.setItem(MODE_KEY, JSON.stringify({ emulator })); } catch { /* storage blocked */ }
  }
  APP_CONFIG.useEmulator = emulator;
} catch { /* non-browser (tests) */ }
