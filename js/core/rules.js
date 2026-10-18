/* Pure business rules. NO DOM, NO repo, NO imports from data/services.
 * All functions are timezone-safe: dates are "YYYY-MM-DD" strings compared
 * lexicographically or via core/dates.js component constructors. */

import { MULTI_STEP_CODES } from "./constants.js";

export const TRANSITIONS = {
  DRAFT: ["PENDING", "CANCELLED"],
  PENDING: ["UNDER_REVIEW", "REJECTED", "CANCELLED", "APPROVED"],
  UNDER_REVIEW: ["FOR_SUPERVISOR_REVIEW", "FOR_FINAL_APPROVAL", "APPROVED", "REJECTED", "CANCELLED"],
  FOR_SUPERVISOR_REVIEW: ["FOR_FINAL_APPROVAL", "REJECTED", "CANCELLED"],
  FOR_FINAL_APPROVAL: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: [],
  REJECTED: [],
  CANCELLED: [],
};

const CANCELLABLE = new Set(["DRAFT", "PENDING", "UNDER_REVIEW", "FOR_SUPERVISOR_REVIEW", "FOR_FINAL_APPROVAL"]);

export function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

export function isCancellable(status) {
  return CANCELLABLE.has(status);
}

/** Which reviewer tier may act on an undecided application right now.
 * Legacy PENDING/UNDER_REVIEW rows are resolved by HR directly (grandfathered). */
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

/** Target statuses the role may move the application to (drawer + adapter guard).
 * Filtered through canTransition so drift between the two can't offer dead actions. */
export function reviewActionsFor(role, status) {
  if (!canReviewStage(role, status)) return [];
  const targets = status === "FOR_SUPERVISOR_REVIEW" ? ["FOR_FINAL_APPROVAL", "REJECTED"] : ["APPROVED", "REJECTED"];
  return targets.filter((to) => canTransition(status, to));
}

/** Exclude Saturdays, Sundays and holidays. 0 if end < start or invalid. */
export function calcWorkingDays(startISO, endISO, holidayISOs = []) {
  if (!startISO || !endISO || endISO < startISO) return 0;
  const hol = new Set(holidayISOs || []);
  let n = 0;
  let cur = startISO;
  // String-based day walk avoids all Date/timezone pitfalls.
  while (cur <= endISO) {
    const dow = dayOfWeek(cur);
    if (dow !== 0 && dow !== 6 && !hol.has(cur)) n++;
    cur = nextDay(cur);
  }
  return n;
}

// Zeller-free: days-from-civil algorithm (Howard Hinnant), pure integer math.
function daysFromCivil(y, m, d) {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor((y >= 0 ? y : y - 399) / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function parseParts(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return null;
  return [+m[1], +m[2], +m[3]];
}

/** 0=Sunday..6=Saturday for a YYYY-MM-DD string, timezone-independent. */
export function dayOfWeek(iso) {
  const p = parseParts(iso);
  if (!p) return NaN;
  return (daysFromCivil(p[0], p[1], p[2]) + 4) % 7 < 0
    ? ((daysFromCivil(p[0], p[1], p[2]) + 4) % 7) + 7
    : (daysFromCivil(p[0], p[1], p[2]) + 4) % 7;
}

function civilFromDays(z) {
  z += 719468;
  const era = Math.floor((z >= 0 ? z : z - 146096) / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const mth = mp + (mp < 10 ? 3 : -9);
  return [mth <= 2 ? y + 1 : y, mth, d];
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function nextDay(iso) {
  const p = parseParts(iso);
  const [y, m, d] = civilFromDays(daysFromCivil(p[0], p[1], p[2]) + 1);
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Invite / reset tokens (HR-created accounts, password recovery).
 * Pure and timezone-safe: expiry compared as ISO strings. */
export function newInviteToken() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
  }
  return `inv-${Date.now()}-${Math.floor(Math.random() * 1e12)}`;
}

export function inviteExpiry(hours = 48) {
  return new Date(Date.now() + hours * 3600e3).toISOString();
}

/** "valid" | "used" | "expired" | "invalid" */
export function inviteStatus(invite, now = new Date().toISOString()) {
  if (!invite || !invite.token) return "invalid";
  if (invite.used) return "used";
  if (invite.expiresAt && invite.expiresAt < now) return "expired";
  return "valid";
}

export function validPassword(pw) {
  return typeof pw === "string" && pw.length >= 8;
}

/** remaining = earned - used - pending */
export function remaining(earned, used, pending) {
  return (earned || 0) - (used || 0) - (pending || 0);
}

export function workflowFor(leaveTypeCode, settings) {
  if (MULTI_STEP_CODES.has(leaveTypeCode)) return "multi_step";
  if (leaveTypeCode === "vacation") return (settings && settings.workflowVacation) || "hr_only";
  return (settings && settings.workflowDefault) || "hr_supervisor_final";
}

/**
 * Validate a leave application draft. Returns an array of error strings.
 * draft: { startDate, endDate, reason, emergencyName, emergencyPhone,
 *          leaveType: {code, requiresDoc}, details, documents, charLimit }
 */
export function validateApplication(draft) {
  const errs = [];
  if (!draft.startDate || !draft.endDate) errs.push("Start and end dates required");
  else if (draft.endDate < draft.startDate) errs.push("End date cannot be before start date");
  const reason = (draft.reason || "").trim();
  if (!reason) errs.push("Reason is required");
  else {
    if (reason.length < 8) errs.push("Reason must be at least 8 characters");
    const lim = draft.charLimit || 500;
    if (reason.length > lim) errs.push(`Reason exceeds ${lim} characters`);
  }
  if (!draft.emergencyName || !draft.emergencyName.trim()) errs.push("Emergency contact name required");
  if (!draft.emergencyPhone || String(draft.emergencyPhone).replace(/\D/g, "").length < 7)
    errs.push("Valid emergency phone required");
  const code = draft.leaveType && draft.leaveType.code;
  const det = draft.details || {};
  if (code === "vacation" || code === "spl") {
    if (!det.location) errs.push("Choose Within the Philippines or Abroad");
    if (det.location === "abroad" && !det.country) errs.push("Country required for abroad");
  }
  if (code === "sick") {
    if (!det.care_type) errs.push("Choose Hospital or Out Patient");
    if (!det.illness) errs.push("Illness/reason required");
  }
  if (code === "magna_carta" && !det.illness) errs.push("Illness required");
  if (code === "study" && !det.purpose) errs.push("Study purpose required");
  if (code === "other" && !det.specify) errs.push("Please specify the leave type");
  if (draft.leaveType && draft.leaveType.requiresDoc && !(draft.documents && draft.documents.length))
    errs.push("Supporting document is required for this leave type");
  return errs;
}
