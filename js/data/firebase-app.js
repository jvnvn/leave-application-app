/* Shared Firebase SDK bootstrap for firestore mode. Single lazy init so the
 * adapter, auth and files services never call initializeApp twice (which
 * throws). Only imported on firestore-mode code paths — local mode loads
 * zero Firebase code. */
import { APP_CONFIG } from "../config.js";

const CDN = () => `https://www.gstatic.com/firebasejs/${APP_CONFIG.firebaseCdnVersion}`;

let ctx = null;

export function useEmulator() {
  // Resolved once in config.js (?emulator=1|0, persisted per tab) so the
  // emulator choice survives redirects that drop the query string.
  return !!APP_CONFIG.useEmulator;
}

export async function firebaseCtx() {
  if (ctx) return ctx;
  const [appMod, fsMod, authMod, stMod] = await Promise.all([
    import(`${CDN()}/firebase-app.js`),
    import(`${CDN()}/firebase-firestore.js`),
    import(`${CDN()}/firebase-auth.js`),
    import(`${CDN()}/firebase-storage.js`),
  ]);
  let app;
  try {
    app = appMod.initializeApp(APP_CONFIG.firebaseConfig);
  } catch {
    app = appMod.getApp();
  }
  const db = fsMod.getFirestore(app);
  const auth = authMod.getAuth(app);
  let storage = null;
  try {
    storage = stMod.getStorage(app);
  } catch {
    storage = null;
  }
  if (useEmulator()) {
    try {
      fsMod.connectFirestoreEmulator(db, APP_CONFIG.emulator.firestoreHost, APP_CONFIG.emulator.firestorePort);
    } catch { /* already connected */ }
    try {
      authMod.connectAuthEmulator(auth, APP_CONFIG.emulator.authUrl, { disableWarnings: true });
    } catch { /* already connected */ }
  }
  ctx = { app, db, auth, storage, fsMod, authMod, stMod };
  return ctx;
}
