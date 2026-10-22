/* Roles, permissions, statuses. UI hiding is NOT security:
 * Firestore rules (firestore.rules.draft) MUST enforce the same permissions. */

export const ROLES = [
  "employee",
  "supervisor",
  "hr_staff",
  "hr_admin",
  "final_approver",
  "sys_admin",
];

export const HR_ROLES = ["hr_staff", "hr_admin", "sys_admin"];
export const REVIEWER_ROLES = ["hr_staff", "hr_admin", "supervisor", "final_approver", "sys_admin"];

// permission -> roles allowed (sys_admin bypasses all checks in can()).
export const PERMISSIONS = {
  "leave.apply": ["employee", "supervisor", "hr_staff", "hr_admin", "final_approver", "sys_admin"],
  "leave.review": ["supervisor", "hr_staff", "hr_admin", "final_approver", "sys_admin"],
  "leave.forward": ["supervisor", "hr_staff", "hr_admin", "sys_admin"],
  "balances.view.own": ["employee", "supervisor", "hr_staff", "hr_admin", "final_approver", "sys_admin"],
  "balances.view.all": ["hr_staff", "hr_admin", "sys_admin"],
  "balances.adjust": ["hr_staff", "hr_admin", "sys_admin"],
  "employees.view": ["supervisor", "hr_staff", "hr_admin", "final_approver", "sys_admin"],
  "employees.manage": ["supervisor", "hr_staff", "hr_admin", "sys_admin"],
  "accounts.setPassword": ["supervisor", "hr_staff", "hr_admin", "sys_admin"],
  "accounts.delete.request": ["supervisor", "hr_staff", "hr_admin", "sys_admin"],
  "accounts.delete.confirm": ["supervisor", "hr_admin", "sys_admin"],
  "users.manage": ["sys_admin"],
  "invites.manage": ["hr_staff", "hr_admin", "sys_admin"],
  "holidays.manage": ["hr_admin", "sys_admin"],
  "leaveTypes.manage": ["hr_staff", "hr_admin", "sys_admin"],
  "settings.manage": ["hr_admin", "sys_admin"],
  "reports.view": ["supervisor", "hr_staff", "hr_admin", "final_approver", "sys_admin"],
  "audit.view": ["hr_admin", "sys_admin"],
  "seed.run": ["sys_admin"],
};

export function can(user, permission) {
  if (!user || !user.role) return false;
  if (user.role === "sys_admin") return true;
  return (PERMISSIONS[permission] || []).includes(user.role);
}

export const STATUSES = [
  "DRAFT",
  "PENDING",
  "UNDER_REVIEW",
  "FOR_SUPERVISOR_REVIEW",
  "FOR_FINAL_APPROVAL",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
];

export const STATUS_LABEL = {
  DRAFT: "Draft",
  PENDING: "Pending",
  UNDER_REVIEW: "Under review",
  FOR_SUPERVISOR_REVIEW: "With supervisor",
  FOR_FINAL_APPROVAL: "Final approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

// Dynamic per-type detail fields for wizard section 1B -> application.details
export const LEAVE_DETAIL_FIELDS = {
  vacation: [
    { key: "location", label: "Location", type: "choice", options: ["within", "abroad"], required: true },
    { key: "country", label: "Country (if abroad)", type: "text", showIf: { location: "abroad" }, required: true },
    { key: "where", label: "Where (if within PH)", type: "text", showIf: { location: "within" }, required: false },
  ],
  spl: [
    { key: "location", label: "Location", type: "choice", options: ["within", "abroad"], required: true },
    { key: "where", label: "Where", type: "text", required: false },
  ],
  sick: [
    { key: "care_type", label: "Care", type: "choice", options: ["hospital", "outpatient"], required: true },
    { key: "illness", label: "Illness", type: "text", required: true },
  ],
  magna_carta: [{ key: "illness", label: "Illness", type: "text", required: true }],
  study: [
    { key: "purpose", label: "Purpose", type: "choice", options: ["masters", "bar_board"], required: true },
    { key: "school", label: "School / Review center", type: "text", required: false },
  ],
  other: [{ key: "specify", label: "Please specify", type: "text", required: true }],
};

export const MULTI_STEP_CODES = new Set(["maternity", "paternity", "study", "vawc", "adoption", "rehab"]);

// Print-form legal references for 6.A (Revised 2020 form)
export const LEAVE_LEGAL_REF = {
  vacation: "Sec. 51, Rule XVI, Omnibus Rules",
  mandatory: "R.A. No. 9710 / MC No. 41, s. 1998",
  sick: "Sec. 51, Rule XVI, Omnibus Rules",
  maternity: "R.A. No. 11210",
  paternity: "R.A. No. 8187 / CSC MC No. 71, s. 1998",
  solo_parent: "R.A. No. 8972 / MC No. 8, s. 2004",
  study: "CSC MC No. 21, s. 2004",
  vawc: "R.A. No. 9262 / CSC MC No. 15, s. 2005",
  rehab: "CSC MC No. 6, s. 2006",
  magna_carta: "R.A. No. 9710 / CSC MC No. 25, s. 2010",
  calamity: "CSC MC No. 2, s. 2012",
  monetization: "Sec. 22-23, Omnibus Rules",
  terminal: "Sec. 23, Omnibus Rules",
  adoption: "R.A. No. 8552",
  others: "Specify",
};
