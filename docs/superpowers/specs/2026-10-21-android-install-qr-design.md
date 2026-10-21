# Android install page with QR code — design

**Date:** 2026-10-21
**Status:** Approved for planning
**Scope:** One page, one QR asset, two entry links, one binary asset. No app logic changes.

## Problem

Employees need the Android APK, but the site has no public download entry point. A signed
Bubblewrap TWA build of the app exists (`io.github.jvnvn.leaveapp`, version 1.0.0) but it only
lives in a temp build folder. The web app already offers a PWA install strip; the APK is the
alternative for users and devices where the PWA path is not desired.

## Goal

An employee, or anyone given the page link/QR, can install the signed Aurora Leave APK in a few
steps:

1. Reach an install page from the login screen (or the employee page install strip).
2. Scan a QR with a phone, or tap a Download button, to fetch the APK.
3. Follow the on-page install steps.

Success criteria:

- `download.html` exists and is reachable from `login.html` and from the employee install strip.
- The page shows a scannable QR and a direct download link for the signed APK.
- The QR and download URL stay valid across future APK versions.
- No runtime dependencies are added (static site constraint in AGENTS.md is preserved).

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| APK hosting | Commit the signed APK to the repo at `downloads/Aurora-Leave.apk` | GitHub Pages already serves the site; a 966 KB binary is cheap; keeps one host |
| URL stability | Stable filename without a version number | QR encodes this URL once and never needs regenerating |
| QR generation | Pre-generated SVG committed at `img/qr-android.svg` | Static asset, no runtime library; vector stays crisp for print |
| QR target | The APK URL directly | Scan → download starts; matches "scan to install the APK" |
| Page | New `download.html` styled with existing CSS | Matches the `download.html` precedent from the 2026-10-09 work |
| Entry points | Login screen link + employee install strip link | Discoverable before and after sign-in; iOS gets no APK link |
| TWA signing key | Preserve `android.keystore` + `twa-manifest.json` outside the repo | Temp folder may be cleaned; key is required for future APK updates |

APK facts (verified 2026-10-21):

- Path: `C:\Users\tyron\AppData\Local\Temp\opencode\twa\app-release-signed.apk`
- Size: 989,228 bytes (~966 KB)
- SHA-256: `5886920076F1966B0FE74A12814A203D3E6296D89C617432D595359D96E8F192`
- Package: `io.github.jvnvn.leaveapp`; version 1.0.0 (code 1); minSdk 24 (Android 7.0+)
- Signed v3: `CN=Aurora Leave, OU=IT, O=Municipality of Aurora, L=Aurora, ST=Isabela, C=PH`
- TWA entry: `https://jvnvn.github.io/leave-application-app/employee.html`

## Components

### 1. `downloads/Aurora-Leave.apk` (new)

Byte-identical copy of the signed APK above. Served by GitHub Pages at:

`https://jvnvn.github.io/leave-application-app/downloads/Aurora-Leave.apk`

### 2. `img/qr-android.svg` (new)

Generated once, offline, before committing:

```
npx --yes qrcode -t svg -o img/qr-android.svg "https://jvnvn.github.io/leave-application-app/downloads/Aurora-Leave.apk"
```

The QR is rendered on a white card with at least 24px padding to provide the quiet zone.

### 3. `download.html` (new)

Standalone static page. Head copies the `login.html` pattern (manifest, apple-touch icon, theme
color, `css/tokens.css`, `css/base.css`, `css/employee.css`) plus a small inline style for the
centered install wrap (max-width ~420px, same as `.login-wrap`).

Body, in order:

1. Eyebrow "Aurora Leave" + heading "Get it on Android"
2. White card containing the QR (`img/qr-android.svg`, ~240px wide, alt text describing the link),
   with caption "Scan with your phone camera"
3. Primary download button:
   `<a class="btn btn-primary" href="downloads/Aurora-Leave.apk" download>Download APK</a>`
4. Meta line: "Version 1.0.0 · 966 KB · Android 7.0+ · Signed"
5. Ordered install steps using the existing `.install-steps` class:
   1. Tap **Download APK** — or scan the QR with another device.
   2. If prompted, allow your browser or file manager to install unknown apps.
   3. Open the downloaded file, tap **Install**, then sign in with your work account.
6. "← Back to sign in" link to `login.html`

No JavaScript on the page.

### 4. `login.html` (edit)

Add, directly under the existing "Forgot password?" row, in the same centered paragraph pattern:

```html
<p style="text-align:center"><a class="btn btn-ghost btn-sm" href="download.html">Get the Android app</a></p>
```

### 5. `js/pwa.js` (edit)

In `mountStrip`, when `mode === "install"` (Android/desktop), append a small link before the
Install button:

```html
<a class="install-strip-link" href="download.html">Get APK</a>
```

Shown only in install mode; the iOS instructions modal stays unchanged (iOS cannot install APKs).

### 6. `css/employee.css` (edit)

Add a rule next to the existing install-strip styles:

```css
.install-strip-link {
  flex: none; align-self: center; white-space: nowrap;
  font-size: var(--fs-xs); font-weight: 700;
  color: var(--indigo); text-decoration: underline;
}
```

## Data flow

There is no new runtime flow. The page, QR, and APK are static files. The service worker
(`sw.js`) is unchanged: same-origin GETs stay network-first with cache fallback, so the new files
work offline only after a successful first fetch. The APK is downloaded through the browser's
normal download path.

## Version bumps

To ship a new APK later:

1. Rebuild and sign with the preserved keystore.
2. Overwrite `downloads/Aurora-Leave.apk`.
3. Update the version/size meta line in `download.html`.

No QR regeneration and no URL change.

## Error handling

- The download link is a plain anchor; a missing file surfaces as the GitHub Pages 404 page.
  Before deploying, verify the file exists and its size matches.
- The page does not detect an install failure; Android's own installer UI reports errors. The
  install steps cover the common "unknown apps" permission prompt.
- GitHub Pages may serve `.apk` as `application/octet-stream` instead of
  `application/vnd.android.package-archive`; either way the browser downloads the file.

## Testing

Local (static server on the repo root):

- `GET /download.html` → 200.
- `GET /downloads/Aurora-Leave.apk` → 200, `Content-Length` 989,228, body starts with `PK`.
- QR decodes to exactly `https://jvnvn.github.io/leave-application-app/downloads/Aurora-Leave.apk`.
- `login.html` contains an anchor to `download.html`.
- Employee strip: with an Android/desktop user agent and a synthetic `beforeinstallprompt`, the
  strip mounts and contains the `Get APK` link pointing at `download.html`.
- `node --check js/pwa.js` passes.

Live after deploy:

- `curl -I https://jvnvn.github.io/leave-application-app/download.html` → 200.
- `curl -I https://jvnvn.github.io/leave-application-app/downloads/Aurora-Leave.apk` → 200 with the
  expected length (allow CDN delay).
- Scan the QR with a phone camera: the download starts and the file installs after allowing the
  unknown-apps prompt (manual step).

## Files

| File | Change |
|---|---|
| `downloads/Aurora-Leave.apk` | New — signed APK binary |
| `download.html` | New — install page with QR, button, steps |
| `img/qr-android.svg` | New — pre-generated QR |
| `login.html` | Edit — "Get the Android app" link |
| `js/pwa.js` | Edit — "Get APK" link in install mode |
| `css/employee.css` | Edit — `.install-strip-link` style |

Not committed: keystore backup at `D:\tyron\Pictures\mint\aurora-leave-signing\` (local only).

## Out of scope

- `assetlinks.json` / removing the TWA URL bar (needs a `jvnvn.github.io` root repo).
- Rebuilding or versioning the APK itself.
- Play Store distribution.
- QR analytics or dynamic redirects.

## Risks and notes

- The APK is public once pushed; it contains no secrets, and the signing certificate is public by
  design.
- TWA without `assetlinks.json` falls back to Custom Tabs (URL bar visible). This is existing
  behavior, not introduced here.
- The keystore password is not recorded in this repo. Preserve the keystore and remember the
  password before the temp folder is cleaned.
