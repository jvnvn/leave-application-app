# Android Install Page with QR Code — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public install page with a scannable QR code that hands employees the signed Aurora Leave Android APK in one tap.

**Architecture:** Static addition to the existing GitHub Pages site. The signed APK is committed at a stable path and the QR encodes that exact path, so the code never goes stale when the APK is replaced later. A new `download.html` renders the QR, a direct download button, and three install steps; entry points are added to `login.html` and the employee install strip.

**Tech Stack:** Static HTML/CSS using the existing design tokens; zero runtime JavaScript on the new page; the `qrcode` CLI runs once at build time via `npx` to generate a committed SVG.

## Global Constraints

- "No frameworks, bundlers, or npm packages." The ONLY external dependency allowed is the Firebase Web SDK (modular). The `qrcode` CLI is a one-off developer tool invoked through `npx`; nothing is added to the shipped app or to `package.json`.
- UI code and services NEVER touch localStorage, IndexedDB, fetch, or Firebase directly. Only `js/data/*` does. This plan adds no JavaScript data access.
- Static site is published by GitHub Pages from the `main` branch of `jvnvn/leave-application-app`; the local branch `frontend-only` tracks `jvnvn/main`.
- The APK is copied byte-for-byte. Never rebuild or re-sign it in this plan. SHA-256 `5886920076F1966B0FE74A12814A203D3E6296D89C617432D595359D96E8F192`, size `989228`.
- Signing material (`android.keystore`, `twa-manifest.json`, passwords) must never be committed anywhere in the repo.
- Commits: prefix every git command with `$env:GIT_MASTER='1';`, use lowercase semantic English messages, no attribution trailers.
- Never stage `.playwright-mcp/`.
- Reuse existing classes and tokens (`--ink-2`, `--muted`, `--line`, `--fs-sm`, `--fs-xs`, `--radius-card`, `--shadow-soft`, `.card`, `.btn`, `.btn-primary`, `.btn-ghost`, `.btn-sm`, `.sec-label`, `.install-steps`); do not introduce a new design language.

---

## File Structure

- Create: `downloads/Aurora-Leave.apk` — signed TWA binary at a stable public path (the QR target).
- Create: `img/qr-android.svg` — committed QR image; encodes the exact live APK URL.
- Create: `download.html` — standalone install page (QR card, download button, install steps, back link).
- Modify: `login.html:33` — add a "Get the Android app" ghost link under the forgot-password row.
- Modify: `js/pwa.js:55-59` — add a "Get APK" link to the install strip in install mode only.
- Modify: `css/employee.css:133` — add `.install-strip-link` styling next to the other strip rules.

---

### Task 1: Host the signed APK and generate the QR code

**Files:**
- Create: `downloads/Aurora-Leave.apk`
- Create: `img/qr-android.svg`
- Test (throwaway, outside repo): `C:\Users\tyron\AppData\Local\Temp\opencode\pwtest\verify-qr.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: public paths `downloads/Aurora-Leave.apk` (binary, 989228 bytes) and `img/qr-android.svg` (QR decoding to `https://jvnvn.github.io/leave-application-app/downloads/Aurora-Leave.apk`). Task 2 references both paths.

- [x] **Step 1: Verify the source APK is the signed build**

Run:

```powershell
$src = "C:\Users\tyron\AppData\Local\Temp\opencode\twa\app-release-signed.apk"
"size: " + (Get-Item $src).Length
"sha256: " + (Get-FileHash $src -Algorithm SHA256).Hash
```

Expected:

```text
size: 989228
sha256: 5886920076F1966B0FE74A12814A203D3E6296D89C617432D595359D96E8F192
```

If either value differs, STOP. Do not publish an unexpected binary.

- [x] **Step 2: Back up the signing material outside the repo**

Run:

```powershell
New-Item -ItemType Directory -Force -Path "D:\tyron\Pictures\mint\aurora-leave-signing" | Out-Null
Copy-Item "C:\Users\tyron\AppData\Local\Temp\opencode\twa\android.keystore" "D:\tyron\Pictures\mint\aurora-leave-signing\"
Copy-Item "C:\Users\tyron\AppData\Local\Temp\opencode\twa\twa-manifest.json" "D:\tyron\Pictures\mint\aurora-leave-signing\"
Get-ChildItem "D:\tyron\Pictures\mint\aurora-leave-signing" | Select-Object Name, Length
```

Expected: `android.keystore` and `twa-manifest.json` listed. This directory is outside the repo — nothing to commit.

- [x] **Step 3: Copy the APK into the site at its stable path**

Run (from the repo root):

```powershell
New-Item -ItemType Directory -Force -Path downloads | Out-Null
Copy-Item $src downloads\Aurora-Leave.apk
(Get-FileHash downloads\Aurora-Leave.apk -Algorithm SHA256).Hash
```

Expected: the same SHA-256 as Step 1.

- [x] **Step 4: Generate the QR SVG**

Run (from the repo root):

```powershell
npx --yes qrcode -t svg -o img\qr-android.svg "https://jvnvn.github.io/leave-application-app/downloads/Aurora-Leave.apk"
```

Expected: `saved qrcode to: D:\tyron\Pictures\mint\leave application app\img\qr-android.svg`; the file is roughly 2.5 KB.

- [x] **Step 5: Write the throwaway QR decoder check**

Write `C:\Users\tyron\AppData\Local\Temp\opencode\pwtest\verify-qr.mjs`:

```js
import fs from "node:fs";
import { chromium } from "playwright";
import jsQR from "jsqr";

const svg = fs.readFileSync(
  "D:/tyron/Pictures/mint/leave application app/img/qr-android.svg",
  "utf8",
);
const expected = "https://jvnvn.github.io/leave-application-app/downloads/Aurora-Leave.apk";

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(`<body style="margin:0;background:#fff">${svg}</body>`);
const pixels = await page.evaluate(async () => {
  const svgEl = document.querySelector("svg");
  const size = 600;
  const blob = new Blob([new XMLSerializer().serializeToString(svgEl)], {
    type: "image/svg+xml",
  });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = url;
  });
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(img, 0, 0, size, size);
  return Array.from(ctx.getImageData(0, 0, size, size).data);
});
await browser.close();

const result = jsQR(new Uint8ClampedArray(pixels), 600, 600);
if (!result) {
  console.error("FAIL: no QR code detected in img/qr-android.svg");
  process.exit(1);
}
if (result.data !== expected) {
  console.error("FAIL: decoded " + result.data);
  process.exit(1);
}
console.log("PASS: QR decodes to " + result.data);
```

- [x] **Step 6: Run the decoder check**

Run:

```powershell
Set-Location "C:\Users\tyron\AppData\Local\Temp\opencode\pwtest"
npm install --no-save jsqr
node verify-qr.mjs
```

Expected: `PASS: QR decodes to https://jvnvn.github.io/leave-application-app/downloads/Aurora-Leave.apk`.

If it fails, delete `img\qr-android.svg`, re-run Step 4 with the URL typed exactly as shown, and re-run this step.

- [x] **Step 7: Commit the APK and QR asset**

Run (from the repo root):

```powershell
Set-Location "D:\tyron\Pictures\mint\leave application app"
$env:GIT_MASTER='1'; git add downloads/Aurora-Leave.apk img/qr-android.svg; git commit -m "feat: host signed android apk with download qr code"
```

Expected: `2 files changed`; `git status --short` is clean.

---

### Task 2: Build the `download.html` install page

**Files:**
- Create: `download.html`
- Test (throwaway, outside repo): `C:\Users\tyron\AppData\Local\Temp\opencode\pwtest\mint-serve.mjs`

**Interfaces:**
- Consumes: `downloads/Aurora-Leave.apk`, `img/qr-android.svg` (Task 1); `css/tokens.css`, `css/base.css`, `css/employee.css`.
- Produces: page at `/download.html` whose anchor `a[href="downloads/Aurora-Leave.apk"]` carries the `download` attribute; Task 3 links to `download.html`.

- [x] **Step 1: Write `download.html`**

Create `download.html` with exactly:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Get the Android app — Aurora Leave</title>
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icons/apple-touch.png">
<meta name="theme-color" content="#0F172A">
<link rel="stylesheet" href="css/tokens.css">
<link rel="stylesheet" href="css/base.css">
<link rel="stylesheet" href="css/employee.css">
<style>
.dl-wrap { max-width: 480px; margin: 0 auto; padding: 32px 16px 48px; }
.dl-head { text-align: center; margin-bottom: 20px; }
.dl-head h1 { margin: 6px 0; }
.dl-sub { color: var(--muted); font-size: var(--fs-sm); margin: 0; }
.qr-card {
  background: #fff; border: 1px solid var(--line); border-radius: var(--radius-card);
  padding: 24px; width: max-content; max-width: 100%; margin: 16px auto;
  box-shadow: var(--shadow-soft);
}
.qr-card img { display: block; width: 240px; height: 240px; }
.qr-hint { text-align: center; color: var(--muted); font-size: var(--fs-sm); margin: 0 0 16px; }
.dl-actions { display: grid; gap: 10px; margin-bottom: 10px; }
.dl-actions .btn { width: 100%; }
.meta-line { text-align: center; color: var(--muted); font-size: var(--fs-xs); margin: 0 0 28px; }
.back-link { text-align: center; margin: 24px 0 0; }
</style>
</head>
<body>
<div class="dl-wrap">
  <div class="dl-head">
    <p class="sec-label">Municipality of Aurora · Isabela</p>
    <h1>Get the Android app</h1>
    <p class="dl-sub">Aurora Leave · Leave Management System</p>
  </div>

  <div class="qr-card">
    <img src="img/qr-android.svg" alt="QR code that opens the Aurora Leave Android APK download" width="240" height="240">
  </div>
  <p class="qr-hint">Scan with your phone camera, or tap Download on this device.</p>

  <div class="dl-actions">
    <a class="btn btn-primary" href="downloads/Aurora-Leave.apk" download>Download APK</a>
  </div>
  <p class="meta-line">Version 1.0.0 · 966 KB · Android 7.0+ · Signed</p>

  <p class="sec-label">Install steps</p>
  <ol class="install-steps">
    <li>Tap <strong>Download APK</strong>, or scan the QR code with your phone.</li>
    <li>Open the downloaded file. If Chrome asks, allow installs from this source.</li>
    <li>Tap <strong>Install</strong>, then open <strong>Aurora Leave</strong> from your home screen.</li>
  </ol>

  <p class="back-link"><a class="btn btn-ghost btn-sm" href="login.html">Back to sign in</a></p>
</div>
</body>
</html>
```

- [x] **Step 2: Write the throwaway static server**

Write `C:\Users\tyron\AppData\Local\Temp\opencode\pwtest\mint-serve.mjs`:

```js
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = "D:/tyron/Pictures/mint/leave application app";
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".apk": "application/vnd.android.package-archive",
};

http
  .createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://local").pathname);
    const file = path.join(root, pathname);
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        "Content-Type": types[path.extname(file)] || "application/octet-stream",
        "Content-Length": body.length,
      });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
    }
  })
  .listen(8099, "127.0.0.1", () => console.log("serving on http://127.0.0.1:8099"));
```

- [x] **Step 3: Start the server**

Run:

```powershell
Set-Location "C:\Users\tyron\AppData\Local\Temp\opencode\pwtest"
Start-Process node -ArgumentList "mint-serve.mjs" -WindowStyle Hidden
Start-Sleep -Seconds 1
curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:8099/download.html
```

Expected: `200`.

- [x] **Step 4: Verify the page serves and the APK is reachable with the right size**

Run:

```powershell
curl.exe -sI http://127.0.0.1:8099/download.html
curl.exe -sI http://127.0.0.1:8099/downloads/Aurora-Leave.apk
curl.exe -sI http://127.0.0.1:8099/img/qr-android.svg
```

Expected: `HTTP/1.1 200 OK` for all three; the APK response shows `Content-Length: 989228` and `Content-Type: application/vnd.android.package-archive`; the SVG shows `Content-Type: image/svg+xml`.

- [x] **Step 5: Verify page structure and rendering in a real browser**

Write `C:\Users\tyron\AppData\Local\Temp\opencode\pwtest\check-download.mjs`:

```js
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto("http://127.0.0.1:8099/download.html");

const title = await page.title();
const download = page.locator('a[href="downloads/Aurora-Leave.apk"]');
const qr = page.locator('img[src="img/qr-android.svg"]');
const steps = page.locator("ol.install-steps li");

const hasDownloadAttr = await download.evaluate((el) => el.hasAttribute("download"));
const qrBox = await qr.boundingBox();
const stepCount = await steps.count();
const qrNatural = await qr.evaluate((el) => el.complete && el.naturalWidth > 0);
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth > window.innerWidth + 1,
);

await page.screenshot({ path: "C:/Users/tyron/AppData/Local/Temp/opencode/pwtest/download-mobile.png", fullPage: true });
await page.setViewportSize({ width: 1280, height: 900 });
await page.screenshot({ path: "C:/Users/tyron/AppData/Local/Temp/opencode/pwtest/download-desktop.png", fullPage: true });
await browser.close();

console.log("title:", title);
console.log("download attribute:", hasDownloadAttr);
console.log("qr natural width:", qrNatural);
console.log("qr box:", JSON.stringify(qrBox));
console.log("install steps:", stepCount);
console.log("horizontal overflow:", overflow);

const ok =
  title.includes("Android") &&
  hasDownloadAttr &&
  qrNatural &&
  qrBox && qrBox.width >= 200 &&
  stepCount === 3 &&
  !overflow;
if (!ok) {
  console.error("FAIL: page check failed");
  process.exit(1);
}
console.log("PASS: download page renders correctly");
```

Run:

```powershell
Set-Location "C:\Users\tyron\AppData\Local\Temp\opencode\pwtest"
node check-download.mjs
```

Expected:

```text
title: Get the Android app — Aurora Leave
download attribute: true
qr natural width: true
qr box: {"x":...,"y":...,"width":240,"height":240}
install steps: 3
horizontal overflow: false
PASS: download page renders correctly
```

- [x] **Step 6: Visually inspect both screenshots**

Open `download-mobile.png` and `download-desktop.png` from `C:\Users\tyron\AppData\Local\Temp\opencode\pwtest\` and confirm: QR is centred with white quiet zone, the download button is full width, the meta line reads `Version 1.0.0 · 966 KB · Android 7.0+ · Signed`, install steps are numbered 1-3, and no text is clipped at 390 px wide.

- [x] **Step 7: Commit the install page**

Run (from the repo root):

```powershell
Set-Location "D:\tyron\Pictures\mint\leave application app"
$env:GIT_MASTER='1'; git add download.html; git commit -m "feat: add android install page with qr download"
```

Expected: `1 file changed`; `git status --short` is clean.

---

### Task 3: Link the install page from login and the employee install strip

**Files:**
- Modify: `login.html:33` (insert after the forgot-password paragraph)
- Modify: `js/pwa.js:55-59`
- Modify: `css/employee.css` (after `.install-strip-x` rule, around line 133)
- Test (throwaway): `.strip-test.html` in the repo root, deleted after the check; `check-links.mjs` in the temp rig

**Interfaces:**
- Consumes: `download.html` (Task 2).
- Produces: anchor `a[href="download.html"]` present on `login.html`; `.install-strip-link` anchor with `href="download.html"` rendered inside `.install-strip` only when `mode === "install"`.

- [x] **Step 1: Add the login link**

In `login.html`, replace line 33:

```html
    <p style="text-align:center"><button class="btn btn-ghost btn-sm" id="forgot-btn" type="button">Forgot password?</button></p>
```

with:

```html
    <p style="text-align:center"><button class="btn btn-ghost btn-sm" id="forgot-btn" type="button">Forgot password?</button></p>
    <p style="text-align:center;margin:0"><a class="btn btn-ghost btn-sm" href="download.html">Get the Android app</a></p>
```

- [x] **Step 2: Add the strip link markup**

In `js/pwa.js`, replace the `strip.innerHTML` assignment (lines 55-59):

```js
  strip.innerHTML = `
    <span class="install-strip-text">Install Aurora Leave for quick access</span>
    <button class="install-strip-btn" type="button">${mode === "ios" ? "Show me how" : "Install"}</button>
    <button class="install-strip-x" type="button" aria-label="Dismiss">✕</button>
  `;
```

with:

```js
  strip.innerHTML = `
    <span class="install-strip-text">Install Aurora Leave for quick access</span>
    ${mode === "install" ? '<a class="install-strip-link" href="download.html">Get APK</a>' : ""}
    <button class="install-strip-btn" type="button">${mode === "ios" ? "Show me how" : "Install"}</button>
    <button class="install-strip-x" type="button" aria-label="Dismiss">✕</button>
  `;
```

- [x] **Step 3: Style the strip link**

In `css/employee.css`, immediately after the `.install-strip-x` block:

```css
.install-strip-x {
  flex: none; border: 0; background: transparent; color: var(--muted);
  font-size: var(--fs-base); line-height: 1; padding: 6px 8px; cursor: pointer;
}
```

insert:

```css
.install-strip-link {
  flex: none; color: var(--indigo); font-size: var(--fs-sm);
  font-weight: 700; text-decoration: none; padding: 6px 2px;
}
```

- [x] **Step 4: Syntax-check the modified module**

Run:

```powershell
node --check js/pwa.js
```

Expected: no output, exit code 0.

- [x] **Step 5: Create the throwaway strip test page**

Create `.strip-test.html` in the repo root (delete it in Step 8; never stage it):

```html
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>strip test</title></head>
<body>
<div class="emp-col"></div>
<script type="module" src="js/pwa.js"></script>
</body>
</html>
```

- [x] **Step 6: Verify both entry points in a browser**

Write `C:\Users\tyron\AppData\Local\Temp\opencode\pwtest\check-links.mjs`:

```js
import { chromium } from "playwright";

const browser = await chromium.launch();

const login = await browser.newPage({ viewport: { width: 390, height: 844 } });
await login.goto("http://127.0.0.1:8099/login.html");
const loginLink = login.locator('a[href="download.html"]');
await loginLink.waitFor({ state: "visible", timeout: 3000 });
console.log("PASS: login link visible ->", await loginLink.textContent());

const strip = await browser.newPage({ viewport: { width: 390, height: 844 } });
await strip.goto("http://127.0.0.1:8099/.strip-test.html");
await strip.evaluate(() => {
  const ev = new Event("beforeinstallprompt");
  ev.prompt = async () => {};
  ev.userChoice = Promise.resolve({ outcome: "dismissed" });
  window.dispatchEvent(ev);
});
const stripLink = strip.locator(".install-strip-link");
await stripLink.waitFor({ state: "visible", timeout: 3000 });
const href = await stripLink.getAttribute("href");
console.log("PASS: strip link visible ->", href);
const stripText = await strip.locator(".install-strip-text").textContent();
console.log("      strip text:", stripText.trim());

await browser.close();

if (href !== "download.html") {
  console.error("FAIL: strip link href is " + href);
  process.exit(1);
}
console.log("PASS: both entry points verified");
```

Run:

```powershell
Set-Location "C:\Users\tyron\AppData\Local\Temp\opencode\pwtest"
node check-links.mjs
```

Expected: `PASS: login link visible -> Get the Android app`, `PASS: strip link visible -> download.html`, `PASS: both entry points verified`.

- [x] **Step 7: Confirm the iOS strip has no APK link**

Run:

```powershell
Set-Location "C:\Users\tyron\AppData\Local\Temp\opencode\pwtest"
node -e "const s = require('fs').readFileSync('D:/tyron/Pictures/mint/leave application app/js/pwa.js','utf8'); if (!s.includes('mode === \"install\" ?')) { console.error('FAIL: link is not install-mode gated'); process.exit(1); } console.log('PASS: link gated to install mode');"
```

Expected: `PASS: link gated to install mode`. (The iOS path calls `mountStrip("ios")`, so the gated string is omitted there.)

- [x] **Step 8: Delete the throwaway page and confirm the tree is clean of it**

Run:

```powershell
Remove-Item ".strip-test.html"
git status --short
```

Expected: `.strip-test.html` removed; no untracked test file listed.

- [x] **Step 9: Commit the entry points**

Run (from the repo root):

```powershell
$env:GIT_MASTER='1'; git add login.html js/pwa.js css/employee.css; git commit -m "feat: link android install page from login and install strip"
```

Expected: `3 files changed`; `git status --short` is clean.

---

### Task 4: Deploy to GitHub Pages and verify live

**Files:**
- No file changes; deployment and verification only.

**Interfaces:**
- Consumes: the three commits from Tasks 1-3.
- Produces: live `download.html`, live APK at `downloads/Aurora-Leave.apk` with matching SHA-256.

- [x] **Step 1: Confirm the push target**

Run:

```powershell
git branch -vv
git log --oneline -4
```

Expected: `frontend-only` is tracked against `jvnvn/main` and ahead by 3 commits (`feat: host signed android apk...`, `feat: add android install page...`, `feat: link android install page...`), on top of `489e375`.

- [x] **Step 2: Push to the Pages branch**

Run:

```powershell
$env:GIT_MASTER='1'; git push jvnvn frontend-only:main
```

Expected: the three commits pushed; the branch reports up to date with `jvnvn/main`.

- [x] **Step 3: Wait for the Pages build and check the page**

Run (repeat up to 10 times, one minute apart, until 200):

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" https://jvnvn.github.io/leave-application-app/download.html
```

Expected: `200`. Pages builds usually finish in 1-2 minutes; the CDN can lag up to about 10 minutes.

- [x] **Step 4: Verify the live APK is byte-identical**

Run:

```powershell
Invoke-WebRequest -Uri "https://jvnvn.github.io/leave-application-app/downloads/Aurora-Leave.apk" -OutFile "$env:TEMP\live-apk.apk" -UseBasicParsing
"size: " + (Get-Item "$env:TEMP\live-apk.apk").Length
"sha256: " + (Get-FileHash "$env:TEMP\live-apk.apk" -Algorithm SHA256).Hash
```

Expected:

```text
size: 989228
sha256: 5886920076F1966B0FE74A12814A203D3E6296D89C617432D595359D96E8F192
```

If the hash differs, the CDN served a stale or corrupted file — re-run after the cache window, and confirm `git show HEAD:downloads/Aurora-Leave.apk` hashes to the same value locally.

- [x] **Step 5: Verify the live QR asset and page wiring**

Run:

```powershell
curl.exe -sI https://jvnvn.github.io/leave-application-app/img/qr-android.svg
```

Expected: `HTTP/2 200` (or `HTTP/1.1 200`) with `content-type: image/svg+xml`.

- [x] **Step 6: Manual phone check (user)**

On an Android phone: scan the QR from the live page, confirm the APK downloads, open it, allow installs from Chrome if prompted, install, and sign in. Report back if the install prompt or login fails.

---

## Self-Review

**Spec coverage:**
- Host APK at stable path → Task 1 Step 3.
- QR encoding the APK URL → Task 1 Steps 4-6.
- Keystore backup outside repo → Task 1 Step 2.
- `download.html` with QR, button, meta, steps, back link → Task 2 Steps 1-6.
- Login link → Task 3 Step 1.
- Strip link gated to install mode + CSS → Task 3 Steps 2-3, 6-7.
- Live verification incl. SHA-256 → Task 4 Steps 3-5.
- Out of scope (assetlinks, rebuild, Play Store, analytics) → untouched by design; Global Constraints forbid rebuild/re-sign.

**Placeholder scan:** no TBD/TODO; every code step carries the literal content; every check states expected output.

**Type consistency:** `download.html` and the two links use the same relative href `download.html` / `downloads/Aurora-Leave.apk`; the QR target matches the deployed Pages path exactly (`https://jvnvn.github.io/leave-application-app/downloads/Aurora-Leave.apk`); `mountStrip("install")` is the only mode that renders `.install-strip-link`.

---

## Execution Record

Executed inline on 2026-10-21 on branch `frontend-only`, directly in the deploy checkout (clean tree at start; no worktree because the plan's absolute paths target this checkout).

| Task | Commit | Result |
|---|---|---|
| 1. Host APK + QR | `170e11f` | APK 989228 B, SHA-256 `58869200…F192`; QR decoded to the live APK URL |
| 2. Install page | `09332ae` | Local 200; APK Content-Length 989228; 3 steps; no overflow at 390 px |
| 3. Entry links | `0f938aa` | Login link visible; strip link renders only in install mode; no overflow |
| 4. Deploy + verify | push `5266891..0f938aa` | Live page 200; live APK 989228 B with matching SHA-256; live QR decodes; 0 console errors |

Verification evidence:

- `node --check js/pwa.js` — exit 0.
- Local static server: `download.html` 200; APK 200 (`application/vnd.android.package-archive`, 989228); SVG 200 (`image/svg+xml`, 2546).
- Playwright at 390×844 and 1280×900: QR rendered 240×240, button carries `download`, 3 install steps, no horizontal overflow; screenshots inspected.
- Live Playwright: title correct, QR rendered, 3 steps, no overflow, 0 console errors, 0 failed requests.
- Live APK download: 989228 B, SHA-256 `5886920076F1966B0FE74A12814A203D3E6296D89C617432D595359D96E8F192`. The first fetch was truncated (359121 B) by a flaky CDN edge; an immediate HTTP/1.1 retry returned the complete file, so the artifact is correct and the CDN edge was transient.

Remaining manual step: install from the QR on an Android phone and sign in (Task 4, Step 6).
