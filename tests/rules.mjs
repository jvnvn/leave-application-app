/* Pure business-rule checks. No emulator, no browser: node tests/rules.mjs */
import assert from "node:assert/strict";
import {
  NON_WORKING_HOLIDAY_KINDS,
  calcWorkingDays,
  isNonWorkingHoliday,
} from "../js/core/rules.js";
import { HOLIDAY_KIND_LABELS } from "../js/core/constants.js";

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`PASS ${name}`);
};

t("regular holiday is non-working", () => assert.equal(isNonWorkingHoliday("regular"), true));
t("special non-working day is non-working", () => assert.equal(isNonWorkingHoliday("special"), true));
t("special working day is working", () => assert.equal(isNonWorkingHoliday("special_working"), false));
t("observance is working", () => assert.equal(isNonWorkingHoliday("observance"), false));
t("missing kind stays non-working (legacy)", () => assert.equal(isNonWorkingHoliday(undefined), true));
t("unknown kind is treated as working", () => assert.equal(isNonWorkingHoliday("mystery"), false));
t("non-working set is exactly regular+special", () =>
  assert.deepEqual([...NON_WORKING_HOLIDAY_KINDS].sort(), ["regular", "special"]));
t("labels cover all four kinds", () =>
  assert.deepEqual(Object.keys(HOLIDAY_KIND_LABELS).sort(), ["observance", "regular", "special", "special_working"]));
t("Holy Week holidays remove all three days", () =>
  assert.equal(calcWorkingDays("2026-04-02", "2026-04-04", ["2026-04-02", "2026-04-03"]), 0));
t("Araw ng Pagbasa stays a working day", () =>
  assert.equal(calcWorkingDays("2026-11-26", "2026-11-27", []), 2));
t("calcWorkingDays trusts its input list, so callers must filter", () =>
  assert.equal(calcWorkingDays("2026-11-26", "2026-11-27", ["2026-11-27"]), 1));

console.log(`\n${n} passed`);
