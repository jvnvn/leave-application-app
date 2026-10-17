# Employee-Only Android App Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Android APK entry employee-only by giving it a dedicated `/app.html` route that refuses HR and supervisor logins and cannot reach `admin.html`, while the browser portal through `/login.html` keeps behaving exactly as it does today — and expose that entry at a fixed public HTTPS address through Tailscale Funnel so the app works on any network, not just the one the server PC sits on.

**Architecture:** One Express server, one API, one `public/` tree. The split is an entry-path split. `GET /app.html` stamps `req.session.client = 'android'` on the session; a middleware registered ahead of `express.static` redirects an app-marked session away from `admin.html`; and `POST /api/auth/login` returns 403 for HR roles when the request body carries `client: 'android'`. The web path through `/login.html` is untouched. Reachability comes from Tailscale Funnel listening on port 8443 and reverse-proxying to the local server, which is why `trust proxy` becomes unconditional and every public URL in this plan carries `:8443`.

**Tech Stack:** Node 24 + Express 4, `express-session`, `bcryptjs`, `node:sqlite`, plain HTML/CSS/JS front end, Android WebView shell (Java), Tailscale Funnel for public reachability. No test runner — checks are plain `node <file>.js` scripts at the project root.

## Global Constraints

- Refusal message, exact string: `HR and Supervisor accounts use the web portal.`
- Audit action for a refused app login: `login_blocked_app`
- `HR_ROLES` must not be modified: `['hr_staff', 'hr_admin', 'sys_admin', 'supervisor', 'final_approver']`
- App entry path: `/app.html`
- App session marker: `req.session.client === 'android'`
- Paths blocked for an app-marked session: `/admin.html` and `/js/admin.js`
- Redirect target for a blocked path: `/app.html`
- HR session cleared on app entry redirects to: `/app.html?blocked=1`
- `<ORIGIN>`: `https://aki.tail4044e0.ts.net:8443` — scheme included, port included, no path, no trailing slash. Task 5 re-reads this off the machine with `tailscale serve status` before using it: if the serve output shows a different hostname, substitute the observed one everywhere this plan writes `<ORIGIN>` and the plan is otherwise unchanged. The `:8443` suffix is mandatory because an unrelated `tailscale serve` entry already owns 443 on this node; without it, `https://aki.tail4044e0.ts.net/app.html` would reach that other service instead of this app.
- Android `DEFAULT_URL`: `<ORIGIN>/app.html` = `https://aki.tail4044e0.ts.net:8443/app.html`
- No new npm dependencies. The one-off QR regeneration runs through `npx qrcode` and leaves `package.json` untouched. No changes to any `requireRole` guard or role definition.
- Browser portal at `/login.html` must behave identically to today.
- `smoketest.js`, `pwacheck.js` and `dlcheck.js` each spawn their own server on port 3000. Port 3000 must be free before running any of them; never run two of these scripts concurrently.
- Project-root checks are run as `node <file>.js` from the repository root.

---

### Task 1: Refuse HR and supervisor login when the client is the Android app

**Files:**
- Modify: `server.js:275` (destructure `client` from the body)
- Modify: `server.js:282-285` (insert the refusal block between the credential-failure block and `loginAttempts.delete`)
- Test: `smoketest.js` (append after the `csv export` check on line 53, before the `catch` on line 54)

**Interfaces:**
- Consumes: `HR_ROLES` declared at `server.js:270`; `audit(actorId, actorEmail, action, entity, entityId, description, meta = {})` declared at `server.js:109`
- Produces: `POST /api/auth/login` now reads an optional `client` field and returns `403 {"error":"HR and Supervisor accounts use the web portal."}` for HR roles when `client === 'android'`. No session cookie is set on that response. Task 3 relies on this exact status and message.

- [ ] **Step 1: Write the failing test**

Find this block in `smoketest.js`:

```js
    res = await fetch('http://localhost:3000/api/admin/reports/export.csv', { headers: HH });
    check('csv export', res.ok && (res.headers.get('content-type') || '').includes('csv'));
  } catch (e) { results.push('FAIL exception ' + e.message); }
```

Insert between the `csv export` line and the `catch` line:

```js
    // --- app (Android) client separation ---
    res = await fetch('http://localhost:3000/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'employee@example.com', password: 'password123', client: 'android' }) });
    const apj = await res.json();
    check('employee login via app client', res.ok && apj.user && apj.user.role === 'employee', JSON.stringify(apj).slice(0, 100));
    res = await fetch('http://localhost:3000/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'hr@example.com', password: 'password123', client: 'android' }) });
    const hrj = await res.json();
    check('HR refused on app client', res.status === 403 && /web portal/.test(hrj.error || ''), `status=${res.status} ${JSON.stringify(hrj)}`);
    check('HR app refusal sets no cookie', !res.headers.get('set-cookie'), String(res.headers.get('set-cookie')));
    res = await fetch('http://localhost:3000/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'hr@example.com', password: 'password123' }) });
    const hrw = await res.json();
    check('HR browser login unaffected', res.ok && hrw.user, JSON.stringify(hrw).slice(0, 100));
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node smoketest.js`
Expected: two of the four new checks fail — `FAIL HR refused on app client status=200 ...` (the login succeeds today because `client` is ignored) and `FAIL HR app refusal sets no cookie connect.sid=...` (a session cookie is set). The other two new checks (`employee login via app client`, `HR browser login unaffected`) already PASS. Every pre-existing line is unchanged, with the one documented exception: `submit leave` may already read `FAIL` — that is the pre-existing non-idempotency described in Task 7 Step 3, not this task.

- [ ] **Step 3: Write the minimal implementation**

In `server.js`, change line 275 from:

```js
  const { email, password } = req.body || {};
```

to:

```js
  const { email, password, client } = req.body || {};
```

Then insert this block immediately after the credential-failure `return` (after line 282, before `loginAttempts.delete(req.ip);` on line 283):

```js
  if (client === 'android' && HR_ROLES.includes(u.role)) {
    audit(u.id, u.email, 'login_blocked_app', 'user', u.id, 'HR/supervisor login refused from Android app');
    return res.status(403).json({ error: 'HR and Supervisor accounts use the web portal.' });
  }
```

Placement matters on both counts. The block must come **after** `bcrypt.compareSync` has passed, so a wrong password still returns 401 `Invalid credentials` and the 403 never discloses whether an address exists. It must come **before** `req.session.user = ...` on line 285, so no session is ever written. It deliberately does not call `loginFailed`, so a refused attempt does not count toward the 20-attempt throttle.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node smoketest.js`
Expected: the four new checks read `PASS` — `PASS HR refused on app client status=403 {"error":"HR and Supervisor accounts use the web portal."}`, `PASS HR app refusal sets no cookie null`, `PASS employee login via app client ...`, `PASS HR browser login unaffected ...` — and every pre-existing check is unchanged. One failure may appear that is not this task's: `submit leave`, the pre-existing non-idempotency documented in Task 7 Step 3. No other line may read `FAIL`.

- [ ] **Step 5: Commit**

```bash
git add server.js smoketest.js
git commit -m "feat: refuse HR/supervisor login from the Android app client"
```

---

### Task 2: Let `api.js` carry an optional client field and stop bouncing `/app.html` to `login.html`

**Files:**
- Modify: `public/js/api.js:6` (401 redirect guard)
- Modify: `public/js/api.js:16` (`login` signature)
- Test: `apitest.js` (new, project root)

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `Api.login(email, password, extra)` where `extra` is an optional object merged into the POST body. `Api.me()` on a 401 no longer redirects when the pathname ends in `app.html`. Task 3's `app.html` depends on both of these signatures.

- [ ] **Step 1: Write the failing test**

Create `apitest.js` at the project root:

```js
// Verifies public/js/api.js forwards the optional client field through
// Api.login and only redirects to login.html from pages other than /app.html.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'public', 'js', 'api.js'), 'utf8');

const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`);

function loadApi(pathname, fetchImpl) {
  const win = {};
  const loc = { pathname, href: 'about:blank' };
  const factory = new Function('window', 'location', 'fetch', src + '\nreturn window.Api;');
  return { api: factory(win, loc, fetchImpl), loc };
}

(async () => {
  let sent = null;
  const a = loadApi('/app.html', async (u, o) => {
    sent = JSON.parse(o.body);
    return { status: 200, ok: true, text: async () => JSON.stringify({ user: { role: 'employee' } }) };
  });
  await a.api.login('a@b.c', 'pw', { client: 'android' });
  check('login forwards client', sent && sent.client === 'android' && sent.email === 'a@b.c', JSON.stringify(sent));

  let sent2 = null;
  const b = loadApi('/login.html', async (u, o) => {
    sent2 = JSON.parse(o.body);
    return { status: 200, ok: true, text: async () => JSON.stringify({ user: { role: 'employee' } }) };
  });
  await b.api.login('a@b.c', 'pw');
  check('login without extra omits client', sent2 && !('client' in sent2) && sent2.email === 'a@b.c', JSON.stringify(sent2));

  const c = loadApi('/app.html', async () => ({ status: 401, ok: false, text: async () => '{}' }));
  let threw = false;
  try { await c.api.me(); } catch { threw = true; }
  check('app.html 401 does not redirect', threw && c.loc.href === 'about:blank', c.loc.href);

  const d = loadApi('/employee.html', async () => ({ status: 401, ok: false, text: async () => '{}' }));
  try { await d.api.me(); } catch {}
  check('employee.html 401 redirects to login', d.loc.href === 'login.html', d.loc.href);

  console.log(results.join('\n'));
  process.exit(results.some(l => l.startsWith('FAIL')) ? 1 : 0);
})();
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node apitest.js`
Expected: `FAIL login forwards client {"email":"a@b.c","password":"pw"}` and `FAIL app.html 401 does not redirect login.html` — the current `login` takes two arguments, so the body arrives without `client`, and the 401 guard only exempts `login.html`.

- [ ] **Step 3: Write the minimal implementation**

In `public/js/api.js`, change line 6 from:

```js
    if (r.status === 401 && !location.pathname.endsWith('login.html')) { location.href = 'login.html'; throw new Error('Login required'); }
```

to:

```js
    if (r.status === 401 && !/(login|app)\.html$/.test(location.pathname)) { location.href = 'login.html'; throw new Error('Login required'); }
```

Then change line 16 from:

```js
    login: (email, password) => req('POST', '/api/auth/login', { email, password }),
```

to:

```js
    login: (email, password, extra) => req('POST', '/api/auth/login', { email, password, ...extra }),
```

`{...undefined}` is a valid object literal and contributes nothing, so the two-argument browser call is unaffected. The regex still matches `/login.html`, so `login.html` keeps its existing behaviour.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node apitest.js`
Expected: four `PASS` lines, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add public/js/api.js apitest.js
git commit -m "feat: api.js carries optional client field and allows /app.html"
```

---

### Task 3: Add the `/app.html` entry page, its server route, and the `admin.html` block

**Files:**
- Create: `public/app.html`
- Modify: `server.js:242-243` (insert the route and middleware between the session middleware and `express.static`)
- Test: `smoketest.js` (append after the Task 1 block)

**Interfaces:**
- Consumes: `Api.login(email, password, extra)` and the `/app.html` 401 exemption from Task 2; the `403` refusal message and status from Task 1
- Produces: `GET /app.html` returns 200 and stamps `req.session.client = 'android'`. An app-marked session requesting `/admin.html` or `/js/admin.js` receives `302` to `/app.html`. An HR-role session requesting `/app.html` is destroyed and receives `302` to `/app.html?blocked=1`.

- [ ] **Step 1: Create `public/app.html`**

```html
<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Login — Employee Portal</title><link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#1e2a5a">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="apple-touch-icon" href="icons/apple-touch.png">
<link rel="stylesheet" href="css/app.css"></head><body>
<header class="top"><h2 style="margin:0">Leave Management System</h2><div class="muted" style="color:#c7d2fe">Employee Portal</div></header>
<div class="wrap" style="max-width:440px"><div class="card">
<h3>Employee Login</h3><div id="e"></div>
<div id="b" style="display:none;margin-top:8px" class="err">HR and Supervisor accounts use the web portal. Please sign in there instead.</div>
<label>Email</label><input id="email" placeholder="you@example.com">
<label>Password</label><input id="pw" type="password" placeholder="••••••••">
<div style="margin-top:12px"><button class="btn" style="width:100%" onclick="go()">Login</button></div>
<div class="card" style="background:#eef2ff">Employees sign in here. HR and Supervisor accounts must use the web portal.</div>
</div></div>
<script src="js/api.js"></script><script>
function showBlock(){document.getElementById('b').style.display='block';document.getElementById('e').innerHTML='';}
async function go(){
  try{
    const j = await Api.login(email.value.trim(), pw.value, {client:'android'});
    if (j.user && j.user.role !== 'employee') { showBlock(); return; }
    location.href='employee.html';
  } catch(e){
    if (/web portal/.test(e.message)) showBlock();
    else document.getElementById('e').innerHTML='<div class=err>'+esc(e.message)+'</div>';
  }
}
async function boot(){
  if (location.search.indexOf('blocked=1') > -1) showBlock();
  try { const j = await Api.me(); if (j.user && j.user.role === 'employee') location.href='employee.html'; }
  catch(e){ /* not signed in - leave the form visible */ }
}
boot();
</script>
<script>if('serviceWorker' in navigator){navigator.serviceWorker.register('sw.js').catch(()=>{});}</script></body></html>
```

`email` and `pw` are id-based element globals, matching how `login.html` already reads them. `boot()` uses `Api.me()` rather than a raw `fetch` so that a 401 is caught by the `catch` instead of redirecting — Task 2 made that possible.

- [ ] **Step 2: Write the failing test**

Find this block in `smoketest.js` (the Task 1 block ends with the `HR browser login unaffected` check, followed by `} catch (e) {...}`):

```js
    check('HR browser login unaffected', res.ok && hrw.user, JSON.stringify(hrw).slice(0, 100));
  } catch (e) { results.push('FAIL exception ' + e.message); }
```

Insert between them:

```js
    // --- app entry route + admin block ---
    res = await fetch('http://localhost:3000/app.html');
    const appCookie = (res.headers.get('set-cookie') || '').split(';')[0];
    check('app.html serves', res.ok, res.status);
    res = await fetch('http://localhost:3000/admin.html', { headers: { Cookie: appCookie }, redirect: 'manual' });
    const loc1 = res.headers.get('location') || '';
    check('admin.html blocked for app session', res.status === 302 && loc1.includes('/app.html'), `${res.status} ${loc1}`);
    res = await fetch('http://localhost:3000/js/admin.js', { headers: { Cookie: appCookie }, redirect: 'manual' });
    check('admin.js blocked for app session', res.status === 302, res.status);
    res = await fetch('http://localhost:3000/admin.html', { redirect: 'manual' });
    check('admin.html open for unmarked session', res.ok, res.status);
    res = await fetch('http://localhost:3000/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'hr@example.com', password: 'password123' }) });
    const hrc = (res.headers.get('set-cookie') || '').split(';')[0];
    check('hr login for clear test', res.ok, res.status);
    res = await fetch('http://localhost:3000/app.html', { headers: { Cookie: hrc }, redirect: 'manual' });
    const loc2 = res.headers.get('location') || '';
    check('app.html clears HR session', res.status === 302 && loc2.includes('blocked=1'), `${res.status} ${loc2}`);
    res = await fetch('http://localhost:3000/api/auth/me', { headers: { Cookie: hrc } });
    check('HR session destroyed', res.status === 401, res.status);
    res = await fetch('http://localhost:3000/app.html', { headers: { Cookie: cookie }, redirect: 'manual' });
    check('app.html serves employee session', res.status === 200, res.status);
    res = await fetch('http://localhost:3000/api/auth/me', { headers: { Cookie: cookie } });
    check('employee session intact after app.html', res.status === 200, res.status);
```

`redirect: 'manual'` is required — Node's `fetch` follows redirects by default and would otherwise report a 200, hiding the 302 that this task exists to produce. The two employee-session checks reuse the `cookie` variable from the top of the smoke test (the employee login) and are regression guards: they pass before the implementation and must still pass after it, proving the route stamps the marker without disturbing an employee who is already signed in.

- [ ] **Step 3: Run the test to verify it fails**

Run: `node smoketest.js`
Expected: `PASS app.html serves 200` — `public/app.html` already exists from Step 1, so `express.static` serves it with no session marker, leaving `appCookie` empty. The two new employee-session checks also pass already (the static file is served untouched), which is expected — they are guards, not witnesses of the new route. The real failures are `FAIL admin.html blocked for app session 200`, `FAIL admin.js blocked for app session 200`, `FAIL app.html clears HR session 200`, and `FAIL HR session destroyed 200`. All four prove the route and middleware are missing.

- [ ] **Step 4: Write the implementation**

In `server.js`, replace line 243 (`app.use(express.static(path.join(__dirname, 'public')));`) with this block:

```js
// ----- app (Android) entry: employee-only -----
const APP_BLOCKED_PATHS = ['/admin.html', '/js/admin.js'];
app.get('/app.html', (req, res) => {
  if (req.session.user && req.session.user.role !== 'employee') {
    return req.session.destroy(() => res.redirect('/app.html?blocked=1'));
  }
  req.session.client = 'android';
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});
app.use((req, res, next) => {
  if (req.session.client !== 'android') return next();
  if (APP_BLOCKED_PATHS.includes(req.path)) return res.redirect('/app.html');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
```

The route must be registered before `express.static`, otherwise static serves the file first and the handler never runs to stamp the marker. The session is configured with `saveUninitialized: false`; assigning `req.session.client` marks the session as modified, which is what causes Express to persist it and issue the cookie. The `admin.html blocked` assertion proves that persistence across two requests.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node smoketest.js`
Expected: `admin.html blocked for app session 302 /app.html`, `admin.js blocked for app session 302`, `app.html clears HR session 302 /app.html?blocked=1`, `HR session destroyed 401`, `app.html serves employee session 200`, and `employee session intact after app.html 200` all read `PASS`, alongside every other check. Express emits the `Location` header as the path you passed to `res.redirect` — `/app.html`, not an absolute URL — so assert against the path, not against `http://localhost:3000/...`. The single allowed exception is the pre-existing `submit leave` failure documented in Task 7 Step 3.

- [ ] **Step 6: Run the API check from Task 2**

Run: `node apitest.js`
Expected: four `PASS` lines.

- [ ] **Step 7: Commit**

```bash
git add public/app.html server.js smoketest.js
git commit -m "feat: add employee-only /app.html entry with admin.html block"
```

---

### Task 4: Serve `admin.html` from the network first in the service worker

**Files:**
- Modify: `public/sw.js:3-7` (the `SHELL` precache list)
- Modify: `public/sw.js:14-24` (the `fetch` listener)

**Interfaces:**
- Consumes: the `CACHE` and `SHELL` constants declared at `public/sw.js:2-7`
- Produces: a `GET` for `/admin.html` reaches the network before any cached copy, so the server's 302 from Task 3 is not shadowed by the precached entry in `SHELL`. `SHELL` also gains `/app.html`, so the employee entry page is precached alongside the rest of the shell.

- [ ] **Step 1: Write the failing test**

`public/sw.js:4` precaches `/admin.html` in `SHELL`, and the fetch handler at line 17 serves `caches.match(e.request)` before hitting the network. On a repeat visit the cached copy wins and the server's 302 is never seen. Assert the fix as a source-level check:

Add to `apitest.js`, immediately before the final `console.log(results.join('\n'));` line:

```js
  const sw = fs.readFileSync(path.join(__dirname, 'public', 'sw.js'), 'utf8');
  const swOk = sw.includes("u.pathname === '/admin.html'")
    && /fetch\(e\.request\)/.test(sw)
    && sw.includes('!res.redirected');
  check('sw.js network-first for admin.html', swOk, swOk ? '' : 'missing admin.html network-first branch');
  const shellOk = /const SHELL = \[[^\]]*'\/app\.html'/.test(sw);
  check('sw.js SHELL precaches /app.html', shellOk, shellOk ? '' : '/app.html missing from SHELL');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node apitest.js`
Expected: `FAIL sw.js network-first for admin.html missing admin.html network-first branch` and `FAIL sw.js SHELL precaches /app.html /app.html missing from SHELL`.

- [ ] **Step 3: Write the minimal implementation**

In `public/sw.js`, add `/app.html` to the `SHELL` list on line 4 so the employee entry page is precached:

```js
  '/', '/login.html', '/app.html', '/employee.html', '/admin.html', '/print.html',
```

Then replace the whole `fetch` listener (lines 14-24) with:

```js
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.pathname.startsWith('/api/')) return; // always live data, never cache
  // /admin.html must reach the network first so the server's app-client 302
  // is not shadowed by the precached copy in SHELL.
  if (u.pathname === '/admin.html') {
    e.respondWith(fetch(e.request).then(res => {
      if (e.request.method === 'GET' && res.ok && !res.redirected && u.origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match('/admin.html')));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
    if (e.request.method === 'GET' && res.ok && u.origin === location.origin) {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
    }
    return res;
  }).catch(() => caches.match('/login.html'))));
});
```

`!res.redirected` is load-bearing. `fetch` follows redirects transparently, so a 302 to `/app.html` arrives as `res.ok === true` with `res.redirected === true`. Without the guard, the app page's HTML would be written into the cache under the `/admin.html` key. The `.catch` cache fallback covers the offline case, where no 302 exists to follow.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node apitest.js`
Expected: six `PASS` lines, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add public/sw.js apitest.js
git commit -m "fix: serve admin.html network-first so the app-client redirect wins"
```

---

### Task 5: Expose the server through Tailscale Funnel

**Files:**
- Test: `apitest.js` (append two source-level checks)

**Interfaces:**
- Consumes: the running Node server on `127.0.0.1:3000`, the existing `tailscale serve` entry for `https://aki.tail4044e0.ts.net` → `127.0.0.1:7317`
- Produces: `https://aki.tail4044e0.ts.net:8443` publicly reachable and reverse-proxied to this app; `app.set('trust proxy', 1)` unconditional in `server.js`; `public/download.html` no longer claims a shared LAN is required; `public/downloads/qr.png` regenerated against the Funnel origin.

This task changes network reachability and two lines of app copy. It does not touch the login, session, or role logic from Tasks 1–4.

- [ ] **Step 1: Record the origin and the pre-existing serve config**

Run: `tailscale serve status`
Expected: an `https://` entry for this node pointing at `http://127.0.0.1:7317`, plus a TCP `443` HTTPS entry. Capture the whole output verbatim — Step 7 must prove both entries survive.

Derive `<ORIGIN>` from the hostname printed there: `https://<hostname>:8443`. Global Constraints already assume `https://aki.tail4044e0.ts.net:8443`; if the hostname differs, use the observed one from here on and the rest of the plan is unchanged.

If MagicDNS or HTTPS certificates are not enabled, enable them in the Tailscale admin console (Settings → DNS, and the HTTPS certificates toggle) before continuing — Funnel refuses to provision without them.

- [ ] **Step 2: Write the failing tests**

Add to `apitest.js`, immediately before the final `console.log(results.join('\n'));` line:

```js
  const srv = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const trustOk = /app\.set\(\s*'trust proxy',\s*1\s*\)/.test(srv) && !/if\s*\(\s*isProd\s*\)\s*app\.set\(\s*'trust proxy'/.test(srv);
  check('trust proxy set unconditionally', trustOk, trustOk ? '' : 'trust proxy still gated behind isProd');
  const dl = fs.readFileSync(path.join(__dirname, 'public', 'download.html'), 'utf8');
  const dlOk = !dl.includes('Same WiFi as the server PC required');
  check('download.html drops LAN-only claim', dlOk, dlOk ? '' : 'download.html still claims LAN-only');
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node apitest.js`
Expected: six `PASS` lines followed by two `FAIL` lines — `FAIL trust proxy set unconditionally trust proxy still gated behind isProd` and `FAIL download.html drops LAN-only claim download.html still claims LAN-only` — exit code 1. The six that pass are Tasks 2's and Task 4's checks; the two new ones fail.

- [ ] **Step 4: Write the minimal implementation**

In `server.js`, change line 230 from:

```js
if (isProd) app.set('trust proxy', 1);
```

to:

```js
app.set('trust proxy', 1);
```

`trust proxy` must be unconditional because the Funnel's `X-Forwarded-For` arrives even when `NODE_ENV` is unset — a dev-mode server behind Funnel is exactly the case that needs it.

In `public/download.html`, replace line 6 in full (it carries no indentation and ends the card div, so keep the trailing `</div>`):

```html
<div class="muted">Same WiFi as the server PC required</div></div>
```

with copy that no longer asserts a shared LAN, for example:

```html
<div class="muted">Works from any network</div></div>
```

- [ ] **Step 5: Run the tests and regenerate the QR**

Run: `node apitest.js`
Expected: eight `PASS` lines, exit code 0.

Run: `npx qrcode -o public/downloads/qr.png "https://aki.tail4044e0.ts.net:8443/downloads/LeaveMS.apk"`
`npx` runs the generator ephemerally; `package.json` must be unchanged.

Verify the new image encodes the Funnel URL, not the old LAN one. A one-off decode (no package is added to the project):

```bash
npx --yes -p jsqr -p pngjs node -e "const fs=require('fs');const{PNG}=require('pngjs');const jsQR=require('jsqr');const p=PNG.sync.read(fs.readFileSync('public/downloads/qr.png'));console.log(jsQR(new Uint8ClampedArray(p.data),p.width,p.height).data)"
```

Expected: `https://aki.tail4044e0.ts.net:8443/downloads/LeaveMS.apk`. If the hostname differed in Step 1, expect that hostname instead.

- [ ] **Step 6: Start the server**

Run: `node server.js` in a background terminal.
Expected: the server listens on `127.0.0.1:3000`. Leave it running for Steps 7–9.

- [ ] **Step 7: Enable the funnel**

Run: `tailscale funnel --bg --https=8443 localhost:3000`

The first funnel run on this tailnet opens a browser prompt asking to add the `funnel` attribute to this node's ACL policy. Approve it in the Tailscale admin console, then re-run the command if it exited.

The port suffix `--https=8443` is required, not cosmetic. Funnel is allowed to listen only on 443, 8443, or 10000, and 443 on this node is already occupied by the unrelated serve entry recorded in Step 1. A bare `tailscale funnel localhost:3000` would try to claim 443 and either fail or displace that service.

Run: `tailscale serve status` again.
Expected: both Step 1 entries still present (hostname → `127.0.0.1:7317`, TCP 443 HTTPS), **plus** a new `https://<hostname>:8443` entry targeting this app. If an original entry is missing, stop and restore it with the same `tailscale serve` command recorded in Step 1 before doing anything else — do not leave the node's other service broken.

- [ ] **Step 8: Prove the Funnel reaches this app**

Run: `curl -sS -o /dev/null -w "%{http_code}\n" https://aki.tail4044e0.ts.net:8443/login.html`
Expected: `200`. A non-200 means Funnel is not yet approved or the server from Step 6 is not running — neither is a code defect.

- [ ] **Step 9: Record the forwarded headers**

The login route keys its throttle on `req.ip` at all three touchpoints — `loginThrottled(req.ip)` on entry, `loginFailed(req.ip)` on a bad password, and `loginAttempts.delete(req.ip)` on success — so what Funnel puts in `X-Forwarded-For` decides whether that throttle keys on real clients or on the proxy address for everyone. Capture the actual headers once, while the funnel from Step 7 is still pointed at 3000.

Temporarily append this middleware immediately after the `app.set('trust proxy', 1);` line from Step 4:

```js
app.use((req, res, next) => { console.log('[fwd]', req.ip, req.headers['x-forwarded-for'], req.headers['x-forwarded-proto']); next(); });
```

Restart the server (stop the Step 6 process, run `node server.js` again) so it picks up the edit, open `https://aki.tail4044e0.ts.net:8443/login.html` once, read the printed line, then **remove the middleware again and restart**. Write what you observed into the Step 10 commit message.

If no `X-Forwarded-For` arrives, say so explicitly in the commit message: the throttle then keys on the proxy address for every visitor and rate-limits them as one. That is a limitation to record, not something this plan fixes. Do not add header-forgery handling — the spec already accepts that LAN clients could spoof `X-Forwarded-For`, and this task does not revisit that decision.

- [ ] **Step 10: Commit**

```bash
git add server.js public/download.html public/downloads/qr.png apitest.js
git commit -m "feat: expose app via Tailscale Funnel on :8443

trust proxy unconditional; download page no longer claims LAN-only;
QR regenerated against the Funnel origin.
forwarded headers observed: <paste Step 9 observation>"
```

On Windows, if `tailscale funnel` dies when the terminal closes, re-run it with the "Run unattended" / `--bg` form so it persists independently of the shell.

Stop the background `node server.js` from Step 6 (and again after Step 9's restart) before moving on — Task 6 Step 5's `dlcheck.js` and Task 7 Step 1 both require port 3000 to be free.

---

### Task 6: Point the Android WebView at `/app.html`

**Files:**
- Modify: `LeaveMS-android/app/src/main/java/com/leavems/app/MainActivity.java:18` (`DEFAULT_URL`)
- Modify: `LeaveMS-android/app/src/main/java/com/leavems/app/MainActivity.java:47` (first-run hint)
- Modify: `LeaveMS-android/app/src/main/java/com/leavems/app/MainActivity.java:52` (drop "(same WiFi)")
- Rebuild: `public/downloads/LeaveMS.apk` from `LeaveMS-android/`

**Interfaces:**
- Consumes: the `/app.html` route delivered by Task 3; the Funnel origin captured in Task 5
- Produces: a fresh install loads `https://aki.tail4044e0.ts.net:8443/app.html`, and `public/downloads/LeaveMS.apk` is a build of that source, so what the QR serves matches what the repo contains.

- [ ] **Step 1: Write the failing test**

Add to `apitest.js`, immediately before the final `console.log(results.join('\n'));` line:

```js
  const mt = fs.readFileSync(path.join(__dirname, 'LeaveMS-android', 'app', 'src', 'main', 'java', 'com', 'leavems', 'app', 'MainActivity.java'), 'utf8');
  const urlOk = mt.includes('DEFAULT_URL = "https://aki.tail4044e0.ts.net:8443/app.html"');
  check('MainActivity points at app.html', urlOk, urlOk ? '' : 'DEFAULT_URL not updated');
  const hintOk = mt.includes('setHint("https://aki.tail4044e0.ts.net:8443/app.html")');
  check('MainActivity hint points at app.html', hintOk, hintOk ? '' : 'hint not updated');
  const lanOk = !mt.includes('192.168.') && !mt.includes('same WiFi');
  check('MainActivity has no LAN address or same-WiFi claim', lanOk, lanOk ? '' : 'LAN address or same-WiFi wording remains');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node apitest.js`
Expected: `FAIL MainActivity points at app.html DEFAULT_URL not updated`, `FAIL MainActivity hint points at app.html hint not updated`, and `FAIL MainActivity has no LAN address or same-WiFi claim ...`. Eight lines pass (Tasks 2, 4 and 5); these three fail.

- [ ] **Step 3: Write the minimal implementation**

In `MainActivity.java`, change line 18 from:

```java
    private static final String DEFAULT_URL = "http://192.168.100.235:3000/login.html";
```

to:

```java
    private static final String DEFAULT_URL = "https://aki.tail4044e0.ts.net:8443/app.html";
```

Then change line 47 from:

```java
        input.setHint("http://SERVER-IP:3000/login.html");
```

to:

```java
        input.setHint("https://aki.tail4044e0.ts.net:8443/app.html");
```

The hint is an example of the address the app actually needs, so it carries the full origin rather than a placeholder — matching the DEFAULT_URL removes the guesswork the placeholder used to stand for.

Then change line 52's first-run branch from:

```java
                        ? "Enter the address of the computer running 'npm start' (same WiFi)."
```

to:

```java
                        ? "Enter the address of the computer running 'npm start'."
```

Line 52's "(same WiFi)" qualifier becomes false once the app points at a public address and must be dropped; lines 51 and 53 keep their wording. Do not invent unrelated copy.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node apitest.js`
Expected: eleven `PASS` lines, exit code 0.

- [ ] **Step 5: Rebuild the APK**

From `LeaveMS-android/`:

```powershell
$env:ANDROID_HOME='C:\Users\tyron\AppData\Local\Android\Sdk'; & 'C:\Users\tyron\.gradle\wrapper\dists\gradle-8.9-bin\90cnw93cvbtalezasaz0blq0a\gradle-8.9\bin\gradle.bat' assembleDebug --console=plain --no-daemon
```

Expected: `BUILD SUCCESSFUL`, exit code 0. No `gradlew` wrapper and no `local.properties` exist in this project; the `ANDROID_HOME` environment variable is what points Gradle at the SDK, so no new file is created. If Gradle's output looks truncated or the process dies without a result, re-run with output redirected to a log file (`*> build.log`) rather than piping — piping the output is what makes Gradle's console die.

Then copy the artifact over the one the QR now serves:

```powershell
Copy-Item 'app\build\outputs\apk\debug\app-debug.apk' '..\public\downloads\LeaveMS.apk' -Force
```

`node dlcheck.js` re-verifies it is still a valid ZIP (`apk-zip-magic`). Before running it, confirm port 3000 is free the same way Task 7 Step 1 does — `dlcheck.js` spawns its own server and fails against a leftover one. Expected: 4 `PASS` lines.

- [ ] **Step 6: Commit**

```bash
git add LeaveMS-android/app/src/main/java/com/leavems/app/MainActivity.java apitest.js public/downloads/LeaveMS.apk
git commit -m "feat: Android app loads the employee-only /app.html entry over Funnel"
```

---

### Task 7: Full regression across every project check

**Files:**
- No source changes. This task exists to prove Tasks 1-6 did not break the browser portal, the PWA, or the production mode.

**Interfaces:**
- Consumes: all changes from Tasks 1-6
- Produces: a green run of every check script, or an explicit record of pre-existing failures.

- [ ] **Step 1: Confirm port 3000 is free**

Run: `node -e "require('http').get('http://localhost:3000/', r=>{console.log('BUSY '+r.statusCode);process.exit(0)}).on('error',()=>{console.log('FREE');process.exit(0)})"`
Expected: `FREE`. If it prints `BUSY`, stop the leftover server before continuing — `smoketest.js` spawns its own on port 3000 and will fail against a stale one.

- [ ] **Step 2: Run the API and client-lib checks**

Run: `node apitest.js`
Expected: eleven `PASS` lines, exit code 0.

- [ ] **Step 3: Run the smoke test**

Run: `node smoketest.js`
Expected: 20 `PASS`, 1 `FAIL`, 2 `skipped` — 23 lines total. That is the 7 `PASS` / 1 `FAIL` / 2 `skipped` baseline plus the four app-client checks from Task 1 and the nine entry-route checks from Task 3 (including the two employee-session guards). Any other `FAIL` is a defect in this work, with one documented exception: `submit leave` re-uses the fixed dates 2026-09-28..2026-09-29, which a prior run left in `data/app.db` (leave ID 2, reason "Smoke test flu"), so it reports "Overlapping leave application exists" and consequently skips the `approve leave` and `print-data` checks. That failure is pre-existing test non-idempotency, not a regression, and it must not be "fixed" by deleting data.

- [ ] **Step 4: Run the PWA check**

Run: `node pwacheck.js`
Expected: `PASS` for `/manifest.webmanifest`, `/sw.js`, both icons, `/employee.html`, `/admin.html`, plus the manifest and PWA-tag assertions. `pwacheck.js` fetches `/admin.html` with no session cookie, so Task 3's block must not affect it.

- [ ] **Step 5: Run the production-mode check**

Run: `node prodcheck.js`
Expected: `PASS` lines. This runs on port 3001 with `NODE_ENV=production`, so it exercises `secure: isProd` cookies. Record any `FAIL` verbatim and state whether it predates this work — `git stash` and re-run to confirm if unsure.

- [ ] **Step 6: Run the download and QR check**

Run: `node dlcheck.js`
Expected: 4 `PASS` lines — `/download.html`, `/downloads/qr.png`, `/downloads/LeaveMS.apk`, and `apk-zip-magic`. This re-proves the rebuilt APK from Task 6 is still a valid ZIP and that Task 5's `download.html` edit did not break the page.

- [ ] **Step 7: Re-verify the Funnel**

Start `node server.js` in a background terminal first — Steps 1–6 all ran with port 3000 free, so nothing is listening yet, and the Funnel proxies to a dead target until the server is up.

Run: `curl -sS -o /dev/null -w "%{http_code}\n" https://aki.tail4044e0.ts.net:8443/login.html`
Expected: `200`. Use the hostname captured in Task 5 Step 1 if it differed. A non-200 means the funnel stopped or the server is down — neither is a regression in the code, but the run is not complete until the public entry answers.

- [ ] **Step 8: Verify the browser portal path is untouched**

Run: `node -e "const s=require('fs').readFileSync('public/login.html','utf8'); console.log(s.includes(\"'employee.html':'admin.html'\")||s.includes(\"?'employee.html':'admin.html'\") ? 'PASS login routing intact' : 'FAIL login routing')"`
Expected: `PASS login routing intact`.

- [ ] **Step 9: Final commit if any fix was needed**

```bash
git add -A
git commit -m "test: green regression across smoke, api, pwa, dl and prod checks"
```

Skip this step if nothing changed — do not create an empty commit.

---

## Self-Review

**Spec coverage:** The refusal message and `login_blocked_app` audit map to Task 1. The `api.js` signature and 401 exemption map to Task 2. `public/app.html`, the `GET /app.html` route, the `admin.html`/`admin.js` block, and HR session clearing map to Task 3. The service-worker network-first change maps to Task 4. Funnel reachability, unconditional `trust proxy`, the `download.html` copy, and the QR regeneration map to Task 5. All three `MainActivity.java` edits and the APK rebuild map to Task 6. Every bullet in the spec's Testing section appears as an assertion across Tasks 1-6, and Task 7 runs the pre-existing checks including `dlcheck.js`. The spec's Known limitation (WebView "Change server" accepting arbitrary URLs) is deliberately not addressed.

**Type consistency:** `Api.login(email, password, extra)` is defined in Task 2 and called with three arguments only in Task 3's `app.html`. The 403 message string is identical in Task 1's implementation and Task 1's assertion and Task 3's `app.html` `showBlock` matcher. `req.session.client === 'android'` is written in Task 3's route and read in Task 3's middleware. The redirect target `/app.html` matches `APP_BLOCKED_PATHS`' redirect and the spec's Global Constraints. `<ORIGIN>` is defined once in Global Constraints with its concrete value and repeated literally in Task 5 and Task 6 — no task invents a second origin.
