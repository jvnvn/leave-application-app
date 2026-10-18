# Two-Stage Leave Approval (Supervisor → HR) Design

**Date:** 2026-10-18
**Status:** Approved
**Goal:** Every leave application requires two approvals — the employee's supervisor first, then HR — before it is granted. Wire the existing (dormant) staged-approval scaffolding into the live flow with server-side enforcement.

## Background and motivation

The codebase already defines the pieces for multi-stage review — statuses `FOR_SUPERVISOR_REVIEW` ("With supervisor") and `FOR_FINAL_APPROVAL` ("Final approval"), the `supervisor` and `final_approver` roles, the `leave.review` permission, staged statuses in the admin review queue, and staged entries in the transition table. None of it is wired:

- `submitApplication` hard-codes status `PENDING` and notifies HR only.
- Any reviewer sees the same action buttons for every application, and `reviewApplication` only checks status transitions — a supervisor can currently move a pending application straight to `APPROVED`, and HR can act without a supervisor ever seeing it.
- `firestore.rules` mirrors the loose transitions, so nothing is enforced server-side either.

The organization requires: employee submits → **supervisor approves first** → **HR approves** → leave is granted.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Routing | Every new submission starts at "With supervisor" |
| Which supervisor | Any account with the `supervisor` role — shared review queue, no per-employee assignment. (Create a Supervisor account via Invites & Resets if none exists.) |
| Second stage | HR staff/admin — "Final approval" |
| Skipping stages | Not allowed. Supervisors cannot finalize; HR cannot bypass the supervisor step. `sys_admin` may act at either stage as the standard escape hatch |
| Rejection | Allowed at either stage; comment required; held balance released |
| Cancellation | Owner may cancel while the application is undecided (DRAFT, PENDING, UNDER_REVIEW, FOR_SUPERVISOR_REVIEW, FOR_FINAL_APPROVAL); held balance released. This also fixes a latent bug: `firestore.rules` required a reviewer role for any application update, so employee self-cancel was previously denied by the server |
| Legacy applications | Rows already in PENDING/UNDER_REVIEW are handled by HR directly (grandfathered) |
| Settings workflow dropdowns | Left as-is — `workflowFor()` is dead code that was never wired; out of scope |
| `final_approver` role | Remains unused; out of scope |

## Flow

1. Employee submits → `FOR_SUPERVISOR_REVIEW`; balance held as pending; supervisors notified.
2. Any supervisor approves → `FOR_FINAL_APPROVAL`; HR notified; applicant notified; hold unchanged.
3. HR approves → `APPROVED`; hold converts to used.
4. Reject at either stage → `REJECTED`; hold released.
5. Owner cancels while undecided → `CANCELLED`; hold released.

## State machine (updated)

| From | To (allowed) | Change |
|---|---|---|
| DRAFT | PENDING, CANCELLED | — |
| PENDING | UNDER_REVIEW, REJECTED, CANCELLED, APPROVED | — (legacy path retained) |
| UNDER_REVIEW | FOR_SUPERVISOR_REVIEW, FOR_FINAL_APPROVAL, APPROVED, REJECTED, CANCELLED | + CANCELLED |
| FOR_SUPERVISOR_REVIEW | FOR_FINAL_APPROVAL, REJECTED, CANCELLED | − APPROVED (no skipping HR), + CANCELLED |
| FOR_FINAL_APPROVAL | APPROVED, REJECTED, CANCELLED | + CANCELLED |

## Role matrix (who may move what)

| Current status | Who may act | Targets |
|---|---|---|
| FOR_SUPERVISOR_REVIEW | `supervisor`, `sys_admin` | FOR_FINAL_APPROVAL, REJECTED |
| FOR_FINAL_APPROVAL | `hr_staff`, `hr_admin`, `sys_admin` | APPROVED, REJECTED |
| PENDING, UNDER_REVIEW (legacy) | `hr_staff`, `hr_admin`, `sys_admin` | APPROVED, REJECTED (legacy targets remain legal in the table) |
| Any undecided status | the owner (employee) | CANCELLED |

## Enforcement (defense in depth)

1. **UI** (`js/pages/admin.js`) — the review drawer renders only stage + role-valid actions; reviewers outside the current stage see "Waiting for supervisor approval" / "Waiting for HR final approval". The queue itself stays shared (every reviewer sees every application).
2. **Adapter guard** (`js/data/firestore-adapter.js`) — `reviewApplication` validates the stage/role matrix before writing; `cancelApplication` requires the actor to be the owner. Friendly errors for the UI.
3. **Firestore rules** (authoritative) — `validTransition` mirrors the table above; `allow update` gains an owner-cancel clause (target `CANCELLED`, actor is the document owner) and a stage gate for reviewers (single `myRole()` call): supervisor stage → `supervisor`/`sys_admin`; final + legacy stages → HR. `APPROVED` is therefore HR-only on every path. `allow create` accepts `FOR_SUPERVISOR_REVIEW` (new client) and `PENDING` (stale cached PWA clients still on the old bundle).

## Balance semantics

- Hold at submit (unchanged).
- No movement at the supervisor stage — the intermediate target is `FOR_FINAL_APPROVAL`, and settlement only triggers on action `APPROVED`, so holds naturally carry through.
- Settle (pending → used) only at final HR approval.
- Release on rejection (either stage) or cancellation.
- No balance-logic changes are required in the adapter beyond the status lists.

## Notifications

- Submit: role broadcast `forRoles: ["supervisor"]`, "New leave application".
- Supervisor approval: applicant notice ("Approved by supervisor — with HR for final approval") + HR role broadcast ("Leave for final approval").
- Final approve/reject: applicant notice ("Leave approved" / "Leave rejected" + comment).
- Note (pre-existing): role broadcasts are written but no UI reads them yet; the shared Review queue remains the operative surface.

## Files changed

| File | Change |
|---|---|
| `js/core/rules.js` | Transition table, CANCELLABLE set, new helpers `reviewStage()`, `canReviewStage()`, `reviewActionsFor()` |
| `js/data/firestore-adapter.js` | `submitApplication` (status + notification), `reviewApplication` (guard, copy, HR broadcast), `cancelApplication` (statuses + owner guard), `addDocument` (statuses) |
| `firestore.rules` | Transition mirror, reviewer stage gate, owner-cancel clause, create statuses |
| `js/pages/admin.js` | Review drawer stage/role-aware buttons + waiting hint + toast copy |
| `js/pages/employee.js` | Attach gate extended to new stages (cancel already flows through `isCancellable`) |
| `js/ui/components.js` | `timelineHtml` renders `STATUS_LABEL[action]` for friendly timeline labels |
| `tests/e2e-firestore.mjs` | Updated to assert the two-stage flow + deny cases |

**No changes:** `js/services/leaves.js` (pending filter already includes staged statuses), `js/services/approvals.js` (queue already includes them), `js/core/constants.js` (statuses/roles/permissions already present), seed data and settings.

## Verification

1. `node --check` on every edited JS file.
2. Emulator E2E — update and run `tests/e2e-firestore.mjs`: happy path (submit → FOR_SUPERVISOR_REVIEW → supervisor approve → FOR_FINAL_APPROVAL → HR approve → APPROVED), balances settle exactly once, deny cases (supervisor cannot final-approve; HR cannot act at the supervisor stage; employee cannot self-approve), reject at each stage releases the hold, cancel at the new stages succeeds (exercises the owner clause).
3. Deploy rules to project `leaveapplication-d9556` (`firebase deploy --only firestore:rules`).
4. Live smoke on `https://jvnvn.github.io/leave-application-app/` with real accounts (full happy path + one deny path).

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Stale cached PWA clients still submit `PENDING` | Create rule keeps accepting `PENDING`; those rows appear in the queue and HR resolves them |
| Rules deploy missed → UI offers actions the server denies | Rules deploy is part of the release checklist; verify with deny-case checks after deploy |
| Shared queue shows everything to every reviewer | Intentional (transparency); actions are gated by stage + role |
