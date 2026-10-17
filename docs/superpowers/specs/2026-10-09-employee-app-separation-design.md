# Employee-Only Android App — HR & Supervisor Web-Only

Date: 2026-10-09
Status: Awaiting user review

## Problem

The Android app and the web portal are one system today. `public/login.html` routes
`employee` to `employee.html` and every other role to `admin.html`, and
`LeaveMS-android` is a thin WebView shell that loads `login.html` with no role check.
An HR administrator who opens the phone app therefore gets the full admin panel
rendered inside the app.

## Decisions already made with the user

1. **Scope of "app": the Android APK only.** The web portal is unchanged. HR and
   supervisors keep using plain HTML in a browser, including the installable PWA.
2. **Refuse at the login screen.** HR and supervisor credentials are rejected before a
   session is created, with an explicit message. Not a silent redirect, not a stripped
   UI.
3. **Approach A** — a dedicated employee-only app entry route on the same server, rather
   than a hidden link guard (B) or two independent builds (C).
4. **Reachable from any network; the server stays on the developer's PC.** The user wants
   the app usable away from the local network rather than only when everyone shares one
   connection. Chosen: Tailscale Funnel in front of the existing Node server, so a fixed
   HTTPS hostname reaches port 3000 on that PC from anywhere. Funnel needs no domain and no
   DNS change, only a free Tailscale account and the Tailscale app on that PC; it was picked
   after the user answered that they have no domain and would rather not buy one, which
   rules out a Cloudflare named tunnel because that route requires a domain added to
   Cloudflare's DNS. The data stays where
   it is, in `data/app.db` on the PC — the user confirmed real ongoing use where
   persistence matters, which rules out the unused `render.yaml` path because that plan
   wipes SQLite on every restart. Accepted consequence: the PC must stay on with the tunnel
   running, or nobody can reach the server.

## Architecture

One Express server, one API, one `public/` tree. The separation is an entry-path split,
not a codebase split.

| Client  | Entry         | Reachable pages                      |
|---------|---------------|--------------------------------------|
| Browser | `/login.html` | `employee.html` or `admin.html`      |
| Android | `/app.html`   | `employee.html` only                 |

`GET /app.html` stamps `req.session.client = 'android'`. That marker is the signal the
server keys its refusals on. `express-session` is already a dependency, so no cookie
parser or header plumbing is introduced.

The session is configured with `saveUninitialized: false`, which would normally discard a
session that has only been touched. Assigning a property to `req.session` marks it as
modified, so Express persists it and the cookie is issued. This is what makes the marker
survive from the `GET /app.html` request into every subsequent request.

## Components

### `public/app.html` (new)

Employee-only login page for the Android entry point.

- Reuses `css/app.css`; subtitle reads "Employee Portal" rather than "Employee & HR Portal".
- Submits `{ email, password, client: 'android' }` to `POST /api/auth/login`.
- On 200 -> `location.href = 'employee.html'`.
- On 403 -> render the refusal message in place, form left intact for a retry.
- On any other error -> render the error as `login.html` does today.
- On load: if the URL carries `?blocked=1`, show the refusal banner immediately — that
  query arrives only from the server route after it has destroyed a non-employee session,
  so the page itself performs no logout. Otherwise call `GET /api/auth/me`: if a session
  exists and the role is `employee`, redirect straight to `employee.html` so a returning
  user is not shown a login form they do not need; in every other case (no session, or a
  non-employee session the route should already have destroyed) leave the login form
  visible.

### `public/js/api.js`

`login(email, password, extra)` merges an optional third argument into the request body
before sending. The browser path passes no third argument and is byte-for-byte
unchanged in behaviour.

### `server.js`

Four additions, all before or beside existing code rather than replacing it:

1. **`GET /app.html`** registered ahead of `app.use(express.static(...))` at line 243.
   If the session belongs to a non-employee role, destroy it and redirect to
   `/app.html?blocked=1` — the page then shows the refusal banner, so a stale HR
   session lands on an explanation rather than a login form it could use. Otherwise
   set `req.session.client = 'android'` and `res.sendFile` on `public/app.html`.
   Ordering matters: static would otherwise serve the file and short-circuit the handler.
2. **App-client middleware**, also ahead of `express.static`. When
   `req.session.client === 'android'` and the request path is `/admin.html` or
   `/js/admin.js`, respond `302` to `/app.html`. All other paths pass through.
3. **Login refusal** in `POST /api/auth/login`. Read `client` from the body. After the
   password check succeeds and before the session is written, if `client === 'android'`
   and the role is in `HR_ROLES`, respond
   `403 {"error":"HR and Supervisor accounts use the web portal."}`, create no session,
   and audit the attempt as `login_blocked_app`.

   The role check runs *after* credential verification so the response does not disclose
   which email addresses exist. It returns 403 rather than 401 so a wrong password still
   reads as "Invalid credentials" and a correct password with a disallowed client reads
   distinctly.
4. **`trust proxy` set unconditionally** at line 230, where it is gated on `isProd`
   today. Traffic through Tailscale Funnel reaches Express from the local Tailscale
   daemon, so without a trusted forwarded header every request reports `req.ip` as
   `127.0.0.1`. The login brute-force throttle at line 274 keys its counter on `req.ip`,
   so left as is it collapses into one shared bucket: twenty failed logins from any
   caller would lock out every user for fifteen minutes.

   Whether Funnel sends `X-Forwarded-For` is unsettled — Tailscale's issue tracker
   carries both a report that `tailscaled` injects it and an open feature request saying
   Funnel does not — so this is verified at runtime rather than assumed. Setting
   `trust proxy` unconditionally is correct either way: it resolves the real client IP
   when the header exists, and falls back to the socket address when it does not, leaving
   a direct LAN connection unchanged. Two consequences are stated plainly instead of
   hand-waved. If no header arrives, this change alone does not lift the shared-bucket
   limitation, which is then recorded as a known limitation rather than repaired by
   rewriting throttle keying, since that falls outside the scope boundary below. And a
   client connecting straight to port 3000 can forge `X-Forwarded-For` to reset its own
   counter, which is already true whenever `isProd` is set and becomes newly true in
   development.

### `public/sw.js`

`/admin.html` is listed in the `SHELL` precache array and the fetch handler serves cache
first for non-`/api/` requests. A cached copy would therefore shadow the server's 302.
Change the handling of `/admin.html` specifically to network-first, falling back to the
cache only when the network is unavailable. Every other path keeps the current
cache-first behaviour.

`/app.html` is *not* in `SHELL` today and must be added to it, so the employee entry page
is part of the offline shell next to `login.html` and `employee.html`. The array currently
holds `/`, `/login.html`, `/employee.html`, `/admin.html` and `/print.html`.

The worker only registers on a secure context. On the current LAN address
(`http://192.168.100.235:3000`) every `navigator.serviceWorker.register(...)` call at
`admin.html:13`, `employee.html:22` and `login.html:25` fails silently through
`.catch(()=>{})`, so `sw.js` has never actually executed. Serving from an HTTPS host is
what first makes it register — which is why the `/admin.html` network-first change is
required rather than merely tidy.

### `LeaveMS-android/app/src/main/java/com/leavems/app/MainActivity.java`

- `DEFAULT_URL` moves off the LAN address `http://192.168.100.235:3000/login.html` and onto
  the Funnel's fixed HTTPS origin at the employee entry —
  `https://aki.tail4044e0.ts.net:8443/app.html`. That hostname is read off this machine
  from `tailscale serve status` (`aki` is the device, `tail4044e0` the tailnet), and the
  `:8443` is required for the reason set out in the Funnel section below: port `443` is
  already occupied by an unrelated tailnet-only entry.
- The first-run `EditText` hint at line 47 moves from `http://SERVER-IP:3000/login.html` to
  that same `https://aki.tail4044e0.ts.net:8443/app.html`, so the example a user sees matches the address
  the app actually needs. Line 58 only prepends `http://` when the input carries no scheme,
  so a value already beginning with `https://` passes through untouched — that branch needs
  no change.
- The first-run message at line 52 reads "Enter the address of the computer running 'npm start' (same WiFi)." The "(same WiFi)" qualifier becomes false once the app talks to a
  public origin and is dropped; the rest of the sentence stays, because the server really
  is still started with `npm start`.
- `android:usesCleartextTraffic="true"` in `AndroidManifest.xml` stays as it is. It remains
  needed for anyone who points "Change server" at a LAN address, and it does not weaken the
  HTTPS origin.

### `public/download.html` and `public/downloads/`

Line 6 of the install page reads "Same WiFi as the server PC required" — false after this
change, and replaced with wording that the app reaches the server from any network while
the host PC is on. The rest of that page is unchanged.

`downloads/qr.png` and `downloads/LeaveMS.apk` are static files sitting in
`public/downloads/`, not produced at runtime: `package.json` carries no QR dependency, and
the only script that touches the QR — `dlcheck.js` — fetches it rather than creating it.
Both are therefore stale the moment the origin changes. The QR was decoded and found to
carry `http://192.168.100.235:3000/downloads/LeaveMS.apk` — a LAN address that stops
working the moment the phone is off that network — so it is regenerated against
`https://aki.tail4044e0.ts.net:8443/downloads/LeaveMS.apk`, pointing at the same asset the
old QR pointed at but at an address that works off-LAN, and the APK is rebuilt so it embeds
the new `DEFAULT_URL`. Each is then re-verified by `dlcheck.js`.

### Tailscale Funnel (reachability, no code in this repo)

Setup on the host PC, in order:

1. Install the Tailscale app and sign in to a free account.
2. Enable MagicDNS and HTTPS for the tailnet — Funnel requires both to issue the
   certificate for the `ts.net` hostname.
3. Run `tailscale funnel --bg --https=8443 localhost:3000` and approve the browser prompt
   that adds the `funnel` node attribute to the tailnet policy file. `--https=8443` picks
   the listening port explicitly; without it Funnel would claim `443`, which this tailnet
   already gives to an unrelated `tailscale serve` entry, and the two cannot share a port.
   The CLI then prints the public address, which has the shape
   `https://<device>.<tailnet>.ts.net:8443` and does not change across restarts.
4. `--bg` is in the command above so the Funnel stays up after the terminal closes.

Two properties of Funnel shape the rest of this work. It terminates TLS itself and
forwards plain HTTP to `localhost:3000`, so `server.js` needs no HTTPS or certificate
change. And it can only listen on ports `443`, `8443` and `10000` — `3000` is the
*target*, not the listening port. Because `443` is taken here, the listening port is
`8443` and the app's URL therefore carries that suffix: `https://aki.tail4044e0.ts.net:8443/app.html`.
Plain `https://aki.tail4044e0.ts.net/app.html` would hit the unrelated service on `443`,
not this app.

Persistence: on Windows Tailscale runs as the logged-in user unless "Run unattended" is
enabled, so a reboot or a log-out can leave the Funnel down. Because the user asked for
real ongoing use, unattended mode is part of the setup rather than an optional extra.
The accepted consequence from decision 4 stands regardless: with the server on the PC,
the PC must be on and Tailscale connected, or nobody reaches the app.

## Data flow

```
App launch
  -> GET /app.html          session stamped client=android, page returned
  -> POST /api/auth/login   { email, password, client: "android" }
       credentials invalid        -> 401 "Invalid credentials"
       credentials valid, HR role -> 403 refusal, no session created, audited
       credentials valid, employee-> session created
  -> employee.html          existing employee UI, existing role-gated APIs
```

Browser flow through `/login.html` is untouched and continues to route by role.

## Error handling

- **403 at app login** — message rendered in place, form retained. There is no session to
  clear because none was created.
- **Stale HR session inside the app** — if a session already exists and requests
  `admin.html`, the app-client middleware redirects to `/app.html`. If it requests
  `/app.html` itself, the route destroys the session and redirects to
  `/app.html?blocked=1`, whose banner explains the refusal.
- **`public/js/employee.js` line 12** bounces any non-employee to `admin.html`. Under an
  app-marked session that request is caught by the same middleware. No change required.
- **Offline** — the service worker's cache fallback still resolves `/admin.html`; the
  network-first change only governs the online path where the 302 matters.

## Testing

Extend `smoketest.js` using its existing `check(name, ok, extra)` convention and its
spawn-and-wait harness for everything that needs a running server. Assertions that only
need to read source files — the `api.js` signatures, the `sw.js` branches, `trust proxy`,
the `download.html` copy, and the `MainActivity.java` strings — live in a new `apitest.js`
at the project root, run the same way (`node apitest.js`), so they can be written and
made to fail before the implementation exists without booting the server:

- `GET /app.html` returns 200.
- Employee login with `client: 'android'` returns 200 and a user object.
- `hr@example.com` login with `client: 'android'` returns 403 carrying the exact refusal
  string, and sets no session cookie.
- `hr@example.com` login *without* `client` returns 200 — proves the browser path is
  unaffected.
- A session marked `client=android` requesting `/admin.html` receives a 302 to
  `/app.html`.
- An unmarked session requesting `/admin.html` receives 200.
- `GET /app.html` under a session belonging to an `employee` role returns the page and
  leaves the session intact; under an HR-role session it clears the session (subsequent
  `GET /api/auth/me` returns 401).
- Existing assertions (balances, leave types, working-day calculation, submission,
  approval, CSV export) continue to pass unchanged, subject to the baseline note below.
- `sw.js` `SHELL` contains `/app.html`.
- `public/download.html` no longer claims the phone must share the server PC's WiFi.
- `server.js` sets `trust proxy` unconditionally, not only when `NODE_ENV=production`.
- **Forwarded-header verification**: with the server running, one request is traced to
  report the `X-Forwarded-For` header Funnel sends (or confirm none arrives), and the
  result is recorded against the throttle limitation above — either way the outcome is
  stated, not assumed.
- `MainActivity.java` contains no LAN address and no "(same WiFi)" wording.

**Baseline, captured 2026-10-09 before any implementation: 7 PASS, 1 FAIL, 2 skipped.**
The failure is `submit leave`: an earlier run left `leave_applications` ID 2 dated
2026-09-28..2026-09-29 with reason "Smoke test flu" (now `APPROVED`), and `smoketest.js`
re-submits those exact dates with no cleanup, so the server rejects the duplicate as
overlapping. Because `created.id` is then absent, the `approve leave` and `print-data`
checks are skipped rather than run. This is pre-existing test non-idempotency against the
persistent `data/app.db`, not a regression from this work; it is recorded so Task 7 does
not mistake it for one.

## Scope boundary and non-goals

**This is a presentation boundary, not a security boundary.** Every `/api/admin/*` route
is already protected by `requireRole`, and none of that changes. A determined user who
controls the WebView can still call the admin API directly — they always could, from a
browser too. The guarantee being added is about what the phone app will *render*.

Not in scope:

- No second Android project, no second front-end, no API changes beyond the login
  refusal.
- No change to role definitions, `HR_ROLES`, or any `requireRole` guard.
- No change to the PWA install experience for HR on the web.
- No native Android login UI — the app remains a WebView over server-rendered pages.

## Known limitations

**Login throttle behind Funnel.** The throttle at `server.js:274` counts failed logins by
`req.ip`. If Funnel turns out not to forward `X-Forwarded-For` — which Tailscale has not
settled either way — every request arriving through it reports `127.0.0.1` and the
counters share one bucket, so twenty failures from anyone locks out all users for fifteen
minutes. The `trust proxy` change is the correct posture but cannot invent a header that
is never sent. Accepted for now: closing it would mean re-keying the throttle on
something other than the source address, which is an API-behaviour change outside this
scope. The verification step decides whether this limitation is live or dormant.

**The WebView's "Change server" menu accepts an arbitrary URL**, so a user can point the app
at `/login.html` directly. If that session was previously marked `client=android` the
`admin.html` block still applies; a session that never loaded `/app.html` is not marked.
This is accepted rather than closed: the menu is an explicit user action, and the
underlying admin API access is governed by `requireRole` regardless of entry path.
