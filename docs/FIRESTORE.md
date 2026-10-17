# Firestore setup — Leave Management System (Spark plan, no Cloud Functions)

The app is frontend-only and **Firestore-only** — the in-browser demo backend
was removed. The UI talks to Firebase only through the `repo` contract
(`js/data/repository.js` header) implemented by `js/data/firestore-adapter.js`;
`js/services/auth.js` and `js/services/files.js` are the other Firebase touch
points.

> There is no backend. **The security rules (`firestore.rules`) are the real
> security layer.** They were verified against the Firestore emulator
> (38-check end-to-end, see "What was tested"). Re-verify after any rule edit.

## 0. Console steps (manual, ~10 minutes)

1. Create a project at console.firebase.google.com (this repo is wired to
   `leaveapplication-d9556` — change `firebaseConfig` in `js/config.js`
   if you use another project).
2. **Authentication → Sign-in method → enable Email/Password.**
3. **Firestore Database → Create database** (production mode, any region).
4. No service-account keys are needed anywhere. Never commit one.

## 1. First sys_admin (manual, once)

Rules deliberately allow NO self-bootstrap (anyone could claim admin).
Do this in the console:

1. **Authentication → Users → Add user**: email + strong password.
2. Copy the new user's **UID**.
3. **Firestore → users → add document** with ID = that UID:
   `{ email, name, role: "sys_admin", status: "active",
      employeeNo, department, position, dateHired, phone, avatarColor,
      supervisorUid: "", createdAt: "<ISO timestamp>" }`.

## 2. Reference data (in-app, once)

Sign in as the sys_admin → **Settings → Seed reference data**.
Idempotent; creates leave types (14), PH 2026 holidays, departments,
`settings/app`. It NEVER creates users or passwords.

## 3. Emulator testing (recommended before every deploy)

Prereqs: Node + Java (both used here), then from the project root:

```powershell
npx -y firebase-tools@14 emulators:start --only firestore,auth --project leaveapplication-d9556
python3 -m http.server 8000   # separate terminal
```

One-time bootstrap of the emulator's first admin (Admin SDK bypasses rules;
emulator only — never against production):

```powershell
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8080'
$env:FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099'
node tests/bootstrap-emulator.mjs   # needs firebase-admin + playwright installed
```

Then run the full end-to-end (headless Chromium drives the REAL app code):

```powershell
$env:APP_URL='http://127.0.0.1:8000/index.html?emulator=1'
node tests/e2e-firestore.mjs
```

Tip: open any page with `&emulator=1` to connect to the local emulators
(`?emulator=0` disconnects again). The choice is remembered per browser tab
(`sessionStorage`), so it survives in-app redirects that drop the query
string — a bare page after login no longer silently falls back to the real
project.

## 4. How identity works (no Functions, Spark-safe)

- `users/{uid}` **is** the Firebase Auth uid — enforced by rules.
- HR invites do NOT create Auth accounts: `inviteUser` writes
  `pendingProfiles/{token}` (profile waiting for pickup) + `invites/{token}`.
- Redemption (`invite.html?token=…`): the invitee calls
  `createUserWithEmailAndPassword`, writes their own `users/{uid}` (rules
  check uid match + email match + invite token), seeds their own starter
  balances (vacation 25 / sick 15 / spl 5 — exact values enforced by rules),
  then burns the invite. Invite links are unguessable; `get` is public,
  `list` is HR-only.
- Forgot password: Auth's `sendPasswordResetEmail` + an HR-visible request
  (Invites & Resets section). HR "set password" sends a reset email —
  nothing secret is ever written to Firestore (`password` fields don't exist
  there).
- Page boot re-validates a cached session against live Auth
  (`auth.activeSession()`): cleared when signed out elsewhere, the account was
  deleted, or a cache from the retired demo mode is found. On SDK/network
  failure the cached session is kept so offline use still works.

## 5. Uploads (Spark: base64 in Firestore, ≤700 KB)

No Storage dependency: files ride as base64 data URLs in `fileBlobs/{id}`
(Firestore's 1 MiB doc cap ⇒ ~700 KB raw cap after base64 inflation).
The wizard shows "max 700 KB" and rejects bigger files
with a clear message. To raise the cap later, switch `js/services/files.js`
to Firebase Storage (the path layout `leave-documents/{uid}/{app}/{file}`
is already reserved) — Blaze plan required.

## 6. Collections

`users/{uid}`, `departments/{id}`, `leaveTypes/{code}`,
`leaveBalances/{uid_code}`, `leaveBalanceTransactions/{id}`,
`leaveApplications/{id}` (+ `approvals/`, `documents/` subcollections),
`notifications/{id}` (per-user `uid` notices plus role broadcasts with
`uid: ""` + `forRoles`), `auditLogs/{id}` (append-only),
`holidays/{YYYY-MM-DD}`, `pendingProfiles/{token}`, `invites/{token}`,
`fileBlobs/{id}`, `adminPasswordResets/{id}` (reserved for a future Function),
`deletionRequests/{id}`, `settings/app`.
Field details: `js/data/repository.js` header. Dates stay `"YYYY-MM-DD"`;
timestamps are ISO strings in-app, Timestamps in Firestore.

## 7. Rules summary (`firestore.rules`)

- Employees: CRUD own applications (PENDING only at create); read own
  balances/docs/notices; no user listing; no earned-credit writes
  (`earned` changes are HR-only — reviewers/owners may move only
  pending/used, which the approve/cancel transactions rely on).
- Reviewers (supervisor+): status transitions along the allowed machine,
  read team applications/balances/docs, confirm deletions (never their own
  request — enforced in `repo`, four-eyes).
- HR roles: balances, transactions, user directory, invites, resets.
- sys_admin/hr_admin: reference data, settings, audit log reads, roles.
- Emulator note: on deny paths the emulator sometimes reports
  "evaluation error" text instead of a clean `false`; enforcement was
  verified correct in every case (allowed things allowed, denied things
  denied — see below).

## 8. Deploy

```powershell
firebase login
firebase deploy --only firestore:rules,firestore:indexes
# optional static hosting of this folder:
firebase deploy --only hosting
```

`firestore.indexes.json` covers the UI's composite queries
(uid+submittedAt, status+submittedAt, uid+createdAt, …). Single-field
filters need no entry. If you add a new `where`+`orderBy` combo and see a
"missing index" error, add it there and redeploy.

## 9. What was tested (emulator, 38/38 green)

`tests/e2e-firestore.mjs` (headless Chromium, real app modules):
admin sign-in → seed (14 types / 9 holidays / settings) → invite →
pre-auth invite readable, **no users doc before redeem** → redeem creates
Auth user + matching `users/{uid}` + burned invite + 3 starter balances →
login → submit with attachment (base64 round-trip) → hold in pending →
detail shows approval + document → HR notified → **supervisor balance
write denied**, admin control write works → reject-without-comment refused
→ approve moves pending→used → reject releases hold → cancel releases
hold → reset flow → deletion request → self-confirm refused → second
supervisor confirms → account + balances gone → **employee cannot read
another's application / touch earned / list users** → audit log contains
all five lifecycle actions → **data survives page reload** → **emulator
choice survives redirects** → **retired ?backend=local is inert** → **stale
cached session cleared on firestore boot**.

## 10. Still manual (not automated)

- Firebase console steps (§0–§1) and `firebase login` + deploy.
- Real-project smoke test after deploy (repeat §3 flows against production
  with two test accounts, then delete them).
- Invite emails: automatic via EmailJS (free tier, REST — no SDK, no Cloud
  Functions) once `js/config.js` → `email: { publicKey, serviceId, templateId }`
  is filled. Setup: create an account at emailjs.com → add an email service
  (e.g. Gmail) → create a template whose "To Email" field is `{{to_email}}`
  and whose body uses `{{to_name}}`, `{{invite_link}}`, `{{expires_hours}}`,
  `{{org_name}}`, `{{app_name}}` → paste the three IDs into `js/config.js` and
  add the site origin under EmailJS → Account → Security (allowed origins).
  Unconfigured, the app keeps the copy-link flow (the "Invites & Resets"
  section shows an Email resend button only when configured). Password-reset
  emails are already automatic via Firebase Auth.
- Visual pass of employee/admin screens at 360 px + desktop (see
  `tests/ui-check.html`).
