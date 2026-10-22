/* Static role/workflow contract. No browser or emulator required. */
import assert from "node:assert/strict";
import { ROLES, REVIEWER_ROLES, PERMISSIONS } from "../js/core/constants.js";
import { canTransition, canReviewStage, reviewActionsFor, reviewStage } from "../js/core/rules.js";

assert.deepEqual(ROLES, ["employee", "supervisor", "hr_staff", "hr_admin", "sys_admin"]);
assert.ok(!REVIEWER_ROLES.includes("final_approver"), "final_approver must not be a reviewer");
for (const role of REVIEWER_ROLES) assert.ok(ROLES.includes(role), `unknown reviewer role: ${role}`);

for (const [permission, roles] of Object.entries(PERMISSIONS)) {
  for (const role of roles) {
    assert.ok(ROLES.includes(role), `${permission} grants unknown role: ${role}`);
  }
}

assert.equal(reviewStage("FOR_SUPERVISOR_REVIEW"), "supervisor");
assert.equal(reviewStage("FOR_FINAL_APPROVAL"), "hr");
assert.equal(canReviewStage("supervisor", "FOR_SUPERVISOR_REVIEW"), true);
assert.equal(canReviewStage("supervisor", "FOR_FINAL_APPROVAL"), false);
assert.equal(canReviewStage("hr_staff", "FOR_FINAL_APPROVAL"), true);
assert.equal(canReviewStage("final_approver", "FOR_FINAL_APPROVAL"), false);
assert.equal(canTransition("FOR_SUPERVISOR_REVIEW", "APPROVED"), false);
assert.deepEqual(reviewActionsFor("supervisor", "FOR_SUPERVISOR_REVIEW"), ["FOR_FINAL_APPROVAL", "REJECTED"]);
assert.deepEqual(reviewActionsFor("hr_admin", "FOR_FINAL_APPROVAL"), ["APPROVED", "REJECTED"]);

console.log("role-config: PASS");
