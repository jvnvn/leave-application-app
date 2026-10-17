/* Seed: reference data + demo accounts. Idempotent — safe to re-run.
 * Mirrors the old server.js seed() (14 leave types, PH 2026 holidays,
 * default settings) mapped onto the Firestore collection design.
 * NOTE: demo passwords are stored in PLAIN TEXT. DEMO ONLY — never do this
 * in production; Firebase Auth (firestore mode) hashes server-side. */
export const DEMO_PASSWORD = "password123";

export function seedBundle() {
  return {
    departments: [
      { id: "engineering", name: "Engineering" },
      { id: "hr", name: "Human Resources" },
      { id: "finance", name: "Finance" },
      { id: "operations", name: "Operations" },
    ],
    leaveTypes: [
      { code: "vacation", name: "Vacation Leave", active: true, requiresDoc: false, maxDays: 0, description: "" },
      { code: "sick", name: "Sick Leave", active: true, requiresDoc: true, maxDays: 0, description: "" },
      { code: "maternity", name: "Maternity Leave", active: true, requiresDoc: true, maxDays: 105, description: "R.A. No. 11210" },
      { code: "paternity", name: "Paternity Leave", active: true, requiresDoc: false, maxDays: 7, description: "R.A. No. 8187" },
      { code: "spl", name: "Special Privilege Leave", active: true, requiresDoc: false, maxDays: 3, description: "" },
      { code: "solo_parent", name: "Solo Parent Leave", active: true, requiresDoc: false, maxDays: 7, description: "R.A. No. 8972" },
      { code: "study", name: "Study Leave", active: true, requiresDoc: false, maxDays: 6, description: "CSC MC No. 21, s. 2004" },
      { code: "vawc", name: "10-Day VAWC Leave", active: true, requiresDoc: false, maxDays: 10, description: "R.A. No. 9262" },
      { code: "rehab", name: "Rehabilitation Privilege", active: true, requiresDoc: false, maxDays: 0, description: "CSC MC No. 6, s. 2006" },
      { code: "magna_carta", name: "Special Leave Benefits for Women", active: true, requiresDoc: true, maxDays: 60, description: "R.A. No. 9710" },
      { code: "calamity", name: "Special Emergency / Calamity Leave", active: true, requiresDoc: false, maxDays: 5, description: "CSC MC No. 2, s. 2012" },
      { code: "adoption", name: "Adoption Leave", active: true, requiresDoc: false, maxDays: 0, description: "R.A. No. 8552" },
      { code: "unpaid", name: "Unpaid Leave", active: true, requiresDoc: false, maxDays: 0, description: "No balance" },
      { code: "other", name: "Other", active: true, requiresDoc: false, maxDays: 0, description: "No balance" },
    ],
    holidays: [
      { date: "2026-01-01", name: "New Year's Day", kind: "regular" },
      { date: "2026-04-09", name: "Araw ng Kagitingan", kind: "regular" },
      { date: "2026-05-01", name: "Labor Day", kind: "regular" },
      { date: "2026-06-12", name: "Independence Day", kind: "regular" },
      { date: "2026-08-21", name: "Ninoy Aquino Day", kind: "special" },
      { date: "2026-08-31", name: "National Heroes Day", kind: "regular" },
      { date: "2026-11-01", name: "All Saints' Day", kind: "special" },
      { date: "2026-12-25", name: "Christmas Day", kind: "regular" },
      { date: "2026-12-30", name: "Rizal Day", kind: "regular" },
    ],
    settings: {
      id: "app",
      orgName: "Sample Organization Inc.",
      office: "Human Resources Department",
      salaryVisible: false,
      charLimit: 500,
      cancellationPolicy: "Employees may cancel DRAFT, PENDING or UNDER_REVIEW applications.",
      workflowVacation: "hr_only",
      workflowDefault: "hr_supervisor_final",
      uploadMaxMb: 5,
      notifEnabled: true,
      signatories: { hrmo: "", supervisor: "", mayor: "" },
    },
    users: [
      { uid: "u-hr", email: "hr@example.com", name: "HR Administrator", role: "hr_admin", employeeNo: "HR-001", department: "Human Resources", position: "HR Manager", status: "active", dateHired: "2022-06-01", phone: "+639171234567", avatarColor: "#8B5CF6" },
      { uid: "u-sup", email: "supervisor@example.com", name: "Sam Supervisor", role: "supervisor", employeeNo: "SUP-001", department: "Engineering", position: "Team Lead", status: "active", dateHired: "2022-06-01", phone: "+639171234567", avatarColor: "#F59E0B" },
      { uid: "u-admin", email: "admin@example.com", name: "System Administrator", role: "sys_admin", employeeNo: "ADMIN-001", department: "Human Resources", position: "Administrator", status: "active", dateHired: "2022-01-01", phone: "", avatarColor: "#4F46E5" },
    ],
  };
}

/** Demo balances: vacation 25, sick 15, special privilege 5 per account. */
export function balanceSeedsFor(uid) {
  return [
    { uid, leaveTypeCode: "vacation", earned: 25, used: 0, pending: 0 },
    { uid, leaveTypeCode: "sick", earned: 15, used: 0, pending: 0 },
    { uid, leaveTypeCode: "spl", earned: 5, used: 0, pending: 0 },
  ];
}
