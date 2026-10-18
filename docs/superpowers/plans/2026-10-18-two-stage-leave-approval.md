# Two-Stage Leave Approval (Supervisor → HR) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan inline (subagent-driven execution unavailable in this environment — no subagent credits; tasks are executed directly in-session). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every new leave application flows submit → `FOR_SUPERVISOR_REVIEW` → (supervisor approves) → `FOR_FINAL_APPROVAL` → (HR approves) → `APPROVED`, enforced in UI, adapter, and Firestore rules; owner can cancel while undecided.

**Architecture:** `js/core/rules.js` is the single source of truth for transitions + a new stage/role matrix; `firestore.rules` mirrors it server-side (create accepts `PENDING` for stale PWA clients and `FOR_SUPERVISOR_REVIEW` for the new client); the adapter guards actions and writes notifications; UI renders only valid actions. Legacy `PENDING`/`UNDER_REVIEW` rows keep old transitions and are resolved by HR.

**Tech Stack:** Vanilla ES modules + Firebase Web SDK (compat-free modular), Firestore security rules, Node for syntax checks and ad-hoc assertions, Playwright + Firebase emulator for E2E, CDP-based browser for live smoke.

**Spec:** `docs/superpowers/specs/2026-10-18-two-stage-leave-approval-design.md`

## Global Constraints

- No frameworks, bundlers, or npm packages in the app. Only external dependency: Firebase Web SDK (modular).
- UI code and services NEVER touch localStorage, IndexedDB, fetch, or Firebase directly. Only `js/data/*` does.
- No plaintext passwords stored in Firestore.
- Keep leave dates as `"YYYY-MM-DD"` strings.
- Never commit real service-account keys.
- `js/core/rules.js` TRANSITIONS and `firestore.rules` `validTransition` must stay in lockstep — change both in the same release.
- Commits: lowercase semantic English, no attribution. Git commands prefixed `$env:GIT_MASTER='1';`.
- Release order: **deploy `firestore.rules` live BEFORE pushing the client bundle** (new client submits `FOR_SUPERVISOR_REVIEW`, which old rules reject).
- Firebase project: `leaveapplication-d9556`. Push target: `git push jvnvn frontend-only:main`.
- Work directly (no subagent delegation).

---

### Task 0: Commit the approved docs

**Files:**
- Create: `docs/superpowers/specs/2026-10-18-two-stage-leave-approval-design.md` (already written)
- Create: `docs/superpowers/plans/2026-10-18-two-stage-leave-approval.md` (this file)

- [x] **Step 1: Commit**

```powershell
$env:GIT_MASTER='1'; git add docs/superpowers; git commit -m "docs: two-stage leave approval design and plan"
```

---

### Task 1: `js/core/rules.js` — transitions + stage/role matrix

**Files:**
- Modify: `js/core/rules.js`

**Interfaces (produced, used by Tasks 2–4):**
- `reviewStage(status: string): "supervisor" | "hr" | null`
- `canReviewStage(role: string, status: string): boolean`
- `reviewActionsFor(role: string, status: string): string[]` (target statuses)
- `isCancellable(status): boolean` — extended; `canTransition(from, to)` — extended

- [x] **Step 1: Write the failing check**

Run this red test (expected: FAIL on current code because `isCancellable('FOR_FINAL_APPROVAL')` is false today):

```powershell
node --input-type=module -e "const m=await import('file:///C:/Users/tyron/Pictures/mint/leave%20application%20app/js/core/rules.js'); const ok = m.canTransition('FOR_SUPERVISOR_REVIEW','FOR_FINAL_APPROVAL')===true && m.canTransition('FOR_SUPERVISOR_REVIEW','APPROVED')===false && m.isCancellable('FOR_FINAL_APPROVAL')===true && m.canReviewStage('supervisor','FOR_SUPERVISOR_REVIEW')===true && m.canReviewStage('supervisor','FOR_FINAL_APPROVAL')===false && m.canReviewStage('hr_staff','FOR_FINAL_APPROVAL')===true && m.reviewActionsFor('hr_staff','FOR_SUPERVISOR_REVIEW').length===0; console.log(ok?'PASS':'FAIL'); process.exit(ok?0:1)"
```

Expected: `FAIL` (exit 1).

- [x] **Step 2: Read the current file and apply the edits**

Read `js/core/rules.js` first, then:

(a) TRANSITIONS becomes:

```js
export const TRANSITIONS = {
  DRAFT: ["PENDING", "CANCELLED"],
  PENDING: ["UNDER_REVIEW", "REJECTED", "CANCELLED", "APPROVED"],
  UNDER_REVIEW: ["FOR_SUPERVISOR_REVIEW", "FOR_FINAL_APPROVAL", "APPROVED", "REJECTED", "CANCELLED"],
  FOR_SUPERVISOR_REVIEW: ["FOR_FINAL_APPROVAL", "REJECTED", "CANCELLED"],
  FOR_FINAL_APPROVAL: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: [],
  REJECTED: [],
  CANCELLED: []
};
```

(b) CANCELLABLE set + helpers (place next to `canTransition`/`isCancellable`):

```js
const CANCELLABLE = ["DRAFT", "PENDING", "UNDER_REVIEW", "FOR_SUPERVISOR_REVIEW", "FOR_FINAL_APPROVAL"];

export function isCancellable(status) {
  return CANCELLABLE.includes(status);
}

// Which reviewer tier may act on an undecided application right now.
// Legacy PENDING/UNDER_REVIEW rows are resolved by HR directly (grandfathered).
export function reviewStage(status) {
  if (status === "FOR_SUPERVISOR_REVIEW") return "supervisor";
  if (status === "FOR_FINAL_APPROVAL") return "hr";
  if (status === "PENDING" || status === "UNDER_REVIEW") return "hr";
  return null;
}

export function canReviewStage(role, status) {
  const stage = reviewStage(status);
  if (!stage) return false;
  if (role === "sys_admin") return true;
  if (stage === "supervisor") return role === "supervisor";
  return role === "hr_staff" || role === "hr_admin";
}

// Target statuses the role may move the application to (drawer + adapter guard).
// Filtered through canTransition so a drift between the two can't offer dead actions.
export function reviewActionsFor(role, status) {
  if (!canReviewStage(role, status)) return [];
  const targets = status === "FOR_SUPERVISOR_REVIEW" ? ["FOR_FINAL_APPROVAL", "REJECTED"] : ["APPROVED", "REJECTED"];
  return targets.filter((to) => canTransition(status, to));
}
```

Note: if the current file wraps `isCancellable` around an inline array, replace that inline array with `CANCELLABLE`.

- [x] **Step 3: Run the check again — expected PASS**

Same command as Step 1. Expected: `PASS` (exit 0).

- [x] **Step 4: Syntax check + commit**

```powershell
node --check js/core/rules.js
$env:GIT_MASTER='1'; git add js/core/rules.js; git commit -m "feat: staged transitions and review stage helpers"
```

---

### Task 2: `firestore.rules` — server-side enforcement

**Files:**
- Modify: `firestore.rules` (also check whether `firestore.rules.draft` exists; if it does and is an in-progress copy, mirror the edits there too)

**Consumes:** the Task 1 matrix (mirrored by hand — rules are a separate language).

- [x] **Step 1: Read the file and update `validTransition`**

Read `firestore.rules` fully first. The current validTransition mirrors the old table; update each `from` branch so it matches Task 1 step 2(a) exactly, including:
- `UNDER_REVIEW`: add `'CANCELLED'`
- `FOR_SUPERVISOR_REVIEW`: `['FOR_FINAL_APPROVAL', 'REJECTED', 'CANCELLED']` (remove `'APPROVED'`)
- `FOR_FINAL_APPROVAL`: `['APPROVED', 'REJECTED', 'CANCELLED']`
- `DRAFT`, `PENDING`: unchanged

- [x] **Step 2: Add the stage gate function**

Insert near the other helper functions (keep the file's existing formatting style):

```js
    // Which reviewer tier may move an application from `from`.
    // Single myRole() call site (called once, from the update rule).
    function reviewerStageOk(role, from, to) {
      return to != 'CANCELLED' && (
        (from == 'FOR_SUPERVISOR_REVIEW' && role in ['supervisor', 'sys_admin']) ||
        ((from == 'FOR_FINAL_APPROVAL' || from == 'PENDING' || from == 'UNDER_REVIEW') && isHr(role))
      );
    }
```

Verify `isHr(role)` exists and includes `sys_admin`; if the existing helper differs (e.g. `isHr()` drains role differently), adapt the call, not the semantics.

- [x] **Step 3: Rewrite the `leaveApplications` update + create rules**

Update rule (replace the old `isReviewer(myRole()) && validTransition(...)` clause; preserve any other conditions the old rule had, e.g. uid immutable):

```js
      allow update: if signedIn()
        && request.resource.data.uid == resource.data.uid
        && validTransition(resource.data.status, request.resource.data.status)
        && (
             (resource.data.uid == myUid() && request.resource.data.status == 'CANCELLED')
             || reviewerStageOk(myRole(), resource.data.status, request.resource.data.status)
           );
```

Create rule: keep all existing checks, change the status check to:

```js
        && request.resource.data.status in ['PENDING', 'FOR_SUPERVISOR_REVIEW']
```

(`PENDING` retained for stale cached PWA clients still on the old bundle.)

- [x] **Step 4: Sanity-check role wiring for stage-1 rejection**

Supervisor reject (`FOR_SUPERVISOR_REVIEW → REJECTED`) releases the balance hold inside the adapter transaction, so it writes `leaveBalances`. Read the `leaveBalances` update rule; confirm a supervisor-role actor can perform that settle write. (Historically any reviewer could reject from PENDING with the same transaction, so this is expected to already pass — if it does not, extend the balance rule's permitted roles to include `supervisor` and `sys_admin` for `taken`/`pending` changes only.)

- [x] **Step 5: Commit**

```powershell
$env:GIT_MASTER='1'; git add firestore.rules; git commit -m "feat: enforce staged review roles in firestore rules"
```

(Rule compilation is exercised by the emulator run in Task 6 and deployment in Task 7.)

---

### Task 3: `js/data/firestore-adapter.js` — submit, review guard, cancel, notifications

**Files:**
- Modify: `js/data/firestore-adapter.js`

**Consumes:** `canReviewStage`, `reviewActionsFor`, `isCancellable` from `js/core/rules.js` (check the file's existing import from `../core/rules.js` and add to it).

- [x] **Step 1: `submitApplication` — new first status + supervisor notification**

Read the function first. Changes:
- Written status: `"FOR_SUPERVISOR_REVIEW"` (was `"PENDING"`).
- Replace the HR notification with a supervisor-targeted one, e.g. title `"New leave application"`, body `` `${leaveTypeName} from ${employeeName}` ``, using whatever notification helper the function currently uses (keep its shape; swap the audience/roles to `["supervisor"]`).

- [x] **Step 2: `reviewApplication` — stage guard + copy**

At the top of the function, before the transaction:

```js
  if (!reviewActionsFor(actor.role, app.status).includes(action)) {
    throw new Error("Your role cannot perform that action at this stage.");
  }
```

Guard behavior this yields (verify by reading): supervisor may send `FOR_FINAL_APPROVAL` / `REJECTED` only from `FOR_SUPERVISOR_REVIEW`; HR only `APPROVED`/`REJECTED` from `FOR_FINAL_APPROVAL` or legacy `PENDING`/`UNDER_REVIEW`; `sys_admin` both stages; anything else/decided → throws. Balance settle condition (`action === "APPROVED"` settle, `"REJECTED"` release) already does the right thing because the supervisor hop's target is `FOR_FINAL_APPROVAL` — do not change the transaction math.

After the transaction, replace the notification block with staged copy:
- `action === "FOR_FINAL_APPROVAL"`: applicant notice title `"Approved by supervisor"`, body `"Your leave request is with HR for final approval."` **and** an HR-audience notice (title `"Leave for final approval"`, body using leave type + employee name, audience `["hr_staff", "hr_admin"]`).
- `action === "APPROVED"`: title `"Leave approved"` (keep/replace existing copy).
- `action === "REJECTED"`: title `"Leave rejected"`, include the comment when present.

Remove the old `Leave ${action.toLowerCase()}` interpolation.

- [x] **Step 3: `cancelApplication` — extended statuses + owner guard**

- Replace the hardcoded cancellable-status list with `isCancellable(app.status)`.
- Add, before the transaction: `if (app.uid !== actor.uid) throw new Error("Only the owner can cancel this application.");` (if the function has no `actor` parameter today, add one and pass it from the `employee.js` call site — align with how `reviewApplication` receives `actor`).

- [x] **Step 4: `addDocument` — allowed statuses**

Extend the attachable-status list from `["DRAFT", "PENDING", "UNDER_REVIEW"]` to `["DRAFT", "PENDING", "UNDER_REVIEW", "FOR_SUPERVISOR_REVIEW", "FOR_FINAL_APPROVAL"]`.

- [x] **Step 5: Syntax check + commit**

```powershell
node --check js/data/firestore-adapter.js
$env:GIT_MASTER='1'; git add js/data/firestore-adapter.js; git commit -m "feat: route submissions through supervisor stage"
```

---

### Task 4: `js/pages/admin.js` — stage/role-aware review drawer

**Files:**
- Modify: `js/pages/admin.js` (review drawer ~L161–227; decision buttons ~L202–207; click handler ~L213–226)

**Consumes:** `reviewActionsFor`, `reviewStage` from `../core/rules.js`.

- [x] **Step 1: Read the drawer + handler**

Note the variable holding the current user (role source) — reuse it in the new code below.

- [x] **Step 2: Replace the fixed decision buttons**

Where the drawer currently renders Approve / Reject / Mark under review / Forward buttons, compute:

```js
const actions = reviewActionsFor(currentUser.role, d.status);
const stage = reviewStage(d.status);
```

Render one button per action with labels (keep the drawer's existing escaping/attribute style):
- `FOR_FINAL_APPROVAL` → `Approve — send to HR` (`data-act="FOR_FINAL_APPROVAL"`)
- `APPROVED` → `d.status === "FOR_FINAL_APPROVAL" ? "Approve (final)" : "Approve"` (`data-act="APPROVED"`)
- `REJECTED` → `Reject`

When `actions.length === 0 && stage` render a muted hint instead:
`"Waiting for supervisor approval."` when stage is `supervisor`, else `"Waiting for HR final approval."`

Keep the Print button and non-decision elements as-is. The comment-required-for-reject logic in the handler stays.

- [x] **Step 3: Toast copy**

Replace the generic toast with an action map: `FOR_FINAL_APPROVAL` → `"Sent to HR for final approval"`, `APPROVED` → `"Approved"`, `REJECTED` → `"Rejected"`.

- [x] **Step 4: Syntax check + commit**

```powershell
node --check js/pages/admin.js
$env:GIT_MASTER='1'; git add js/pages/admin.js; git commit -m "feat: stage-aware review actions in admin drawer"
```

---

### Task 5: `js/pages/employee.js` + `js/ui/components.js`

**Files:**
- Modify: `js/pages/employee.js` (attachable-status list ~L172; cancel flow already uses `isCancellable`)
- Modify: `js/ui/components.js` (timeline ~L114–121)

- [x] **Step 1: Extend the attachable list**

In `employee.js`, add `"FOR_SUPERVISOR_REVIEW"` and `"FOR_FINAL_APPROVAL"` to the list that gates the attach-document UI.

- [x] **Step 2: Friendly timeline labels**

In `components.js` `timelineHtml`, render the approval action through the friendly label map instead of the raw code — `STATUS_LABEL[h.action] || h.action` (import `STATUS_LABEL` from `../core/constants.js` if not already imported).

- [x] **Step 3: Syntax check + commit**

```powershell
node --check js/pages/employee.js; node --check js/ui/components.js
$env:GIT_MASTER='1'; git add js/pages/employee.js js/ui/components.js; git commit -m "feat: extend attach gate and timeline labels for staged flow"
```

---

### Task 6: `tests/e2e-firestore.mjs` — update + run on emulator

**Files:**
- Modify: `tests/e2e-firestore.mjs` (read fully first; ~240 lines — helpers: playwright browser against `APP_URL`, app modules via `tests/blank.html?emulator=1`)

- [x] **Step 1: Update the happy-path assertions**

Change the flow section from `PENDING → APPROVED` to:
1. submit → assert `FOR_SUPERVISOR_REVIEW` (and hold incremented — existing balance assertions keep their meaning)
2. reviewer action `FOR_FINAL_APPROVAL` → assert status `FOR_FINAL_APPROVAL`; assert balance `pending` unchanged
3. reviewer action `APPROVED` → assert `APPROVED`; assert `taken` increased and `pending` back to baseline (settle exactly once)

Use the test's existing helpers; the `sys_admin` bootstrap account (`bootstrap-emulator.mjs` → admin@example.com / Admin123!) can legally act at both stages.

- [x] **Step 2: Add deny cases**

Add assertions (using the test's existing auth/account helpers; create an extra account via the emulator Auth REST API if needed):
- supervisor-role actor: `reviewApplication({action: "APPROVED"})` on a `FOR_SUPERVISOR_REVIEW` app rejects (throws), status unchanged.
- HR-role actor: action on `FOR_SUPERVISOR_REVIEW` app rejects.
- employee: `reviewApplication({action: "APPROVED"})` on own app rejects; `cancelApplication` on own `FOR_FINAL_APPROVAL` app succeeds → `CANCELLED`.
- Direct Firestore write attempt from a stale-style client: create with `PENDING` still allowed (grandfathered).

If the harness lacks multi-account auth helpers and adding them balloons scope, cover at minimum: happy path, the `FOR_FINAL_APPROVAL`-stage cancel (exercises owner clause), and one rules-deny REST check; note any deferred cases in the commit message.

- [x] **Step 3: Run it**

Prereqs check first: `firebase --version`, `java -version`, `npx playwright --version` (or the repo's known playwright source).

```powershell
firebase emulators:exec --only firestore,auth --project leaveapplication-d9556 "node tests/e2e-firestore.mjs"
```

(with `APP_URL` pointing at a local static server for the repo root — serve via Node static server from `C:\Users\tyron\AppData\Local\Temp\opencode\` as used previously; set `FIRESTORE_EMULATOR_HOST`/`FIREBASE_AUTH_EMULATOR_HOST` as the test expects).

Expected: PASS. If the environment cannot run the emulator (no Java, missing playwright), record that and lean on Task 8 live smoke as the primary behavioral evidence.

- [x] **Step 4: Commit**

```powershell
$env:GIT_MASTER='1'; git add tests/e2e-firestore.mjs; git commit -m "test: cover two-stage approval flow and stage denies"
```

---

### Task 7: Deploy rules live

- [x] **Step 1: Deploy**

```powershell
$env:GIT_MASTER='1'; firebase deploy --only firestore:rules --project leaveapplication-d9556
```

Expected: `Deploy complete!`. (Requires `firebase login` as the project owner — was used before in this project.)

- [x] **Step 2: Unauthenticated deny probe**

Quick REST probe confirming rules are live (expect 403):

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
try { Invoke-RestMethod -Method Post -Uri "https://firestore.googleapis.com/v1/projects/leaveapplication-d9556/databases/(default)/documents/leaveApplications" -Body '{"fields":{"status":{"stringValue":"FOR_SUPERVISOR_REVIEW"}}}' -ContentType "application/json" } catch { $_.Exception.Response.StatusCode.value__ }
```

Expected: `403`.

---

### Task 8: Push + live smoke

- [x] **Step 1: Push**

```powershell
$env:GIT_MASTER='1'; git push jvnvn frontend-only:main
```

- [x] **Step 2: Recreate the browser rig**

- CDP Chromium on port 9222 (dedicated profile), Playwright via MCP `cdp_url: http://localhost:9222`.
- Static server on port 8091 from `C:\Users\tyron\AppData\Local\Temp\opencode\` serving the repo root.
- GitHub Pages CDN TTL is ~10 min — verify freshness by fetching the new bundle marker with `cache: 'no-store'` (e.g. `"FOR_SUPERVISOR_REVIEW"` in `js/data/firestore-adapter.js`, `"send to HR"` in `js/pages/admin.js`).

- [x] **Step 3: Live smoke (live site, real accounts)**

Login `admin@hr.com` (sys_admin — passes both stages):
1. Employee-side submit (or use an existing employee account) → application shows `With supervisor`, hold applied.
2. Approve → `Final approval`; approve again → `Approved`; balance settles (pending → taken) exactly once.
3. One cancel path on a second application → `Cancelled`, hold released.
4. Reject path at the first stage → `Rejected`, hold released.
(If no supervisor-role account exists, sys_admin covers both stages; optionally create a Supervisor via Invites & Resets to also verify the role-gated path — note result.)

- [x] **Step 4: Final state check**

`git status` clean; report what was verified vs. deferred.

**Execution record (2026-10-18, final):**
- Live smoke on the deployed site: **26/26 PASS** — submit → `With supervisor` (pending +1) → stage-1 approve → `Final approval` → final approve → `Approved` (pending→used settles exactly once) → timeline `SUBMITTED → FOR_FINAL_APPROVAL → APPROVED`; cancel path releases hold; first-stage reject releases hold; list shows Approved/Cancelled/Rejected.
- Emulator E2E: 49/49. Rules live: `Deploy complete!`; unauthenticated REST probe → 403. Push: `2ce2de1..5266891`.
- Deviations (per Step 3 notes): no live supervisor-role account — `sys_admin` covered both stages; employee submit/cancel exercised as `sys_admin` via page-context modules. First smoke pass hit intermittent GitHub-Pages connection resets (5 spurious FAILs; underlying data independently verified via probe); after hardening the rig with retries the rerun passed 26/26.
- Footprint: `sDDvfLPBCWRQ8cLOLbMCpAL50rL2_vacation` earned 3 / used 2 / pending 0. Smoke apps 2026-12-07 (Approved, `PUOp06KxmgtiuNNvudy1`), 2026-12-08 (Cancelled), 2026-12-09 (Rejected).

---

## Self-Review

- **Spec coverage:** flow (T1–T3), state machine table (T1+T2), role matrix (T1–T4), 3-layer enforcement (T2 rules, T3 adapter, T4 UI), balance semantics (T3 — transaction math intentionally untouched), notifications (T3), files-changed list (T1–T6 all present), legacy grandfathering (T2 PENDING branches + T1), stale PWA client note (T2 create rule), verification plan (T6–T8). No gaps.
- **Placeholders:** none — every code step carries the actual new code; the two file-dependent spots (admin drawer template, test helpers) instruct "read first, adapt to existing style" with the exact semantics.
- **Type consistency:** `reviewStage`/`canReviewStage`/`reviewActionsFor` signatures identical across T1 (definition), T3 (adapter guard), T4 (drawer). Actions are target-status strings (`FOR_FINAL_APPROVAL`, `APPROVED`, `REJECTED`) consistent across adapter, drawer, and tests.
- **Ordering:** rules.js (T1) → firestore.rules (T2) → adapter (T3) → UI (T4–T5) → tests (T6) → deploy (T7) → push+smoke (T8). Live rules deploy strictly before client push (release-order constraint).
