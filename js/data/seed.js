/* Seed: reference data. Idempotent — safe to re-run. Mirrors the old
 * server.js seed() (14 leave types, PH 2026 holidays, default settings)
 * mapped onto the Firestore collection design. Reference data only — it
 * NEVER creates users or passwords; Firebase Auth hashes passwords
 * server-side. */
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
      // Regular holidays (non-working): Proclamation 1006 + Eid proclamations
      { date: "2026-01-01", name: "New Year's Day", kind: "regular" },
      { date: "2026-03-20", name: "Eid'l Fitr", kind: "regular" },
      { date: "2026-04-02", name: "Maundy Thursday", kind: "regular" },
      { date: "2026-04-03", name: "Good Friday", kind: "regular" },
      { date: "2026-04-09", name: "Araw ng Kagitingan", kind: "regular" },
      { date: "2026-05-01", name: "Labor Day", kind: "regular" },
      { date: "2026-05-27", name: "Eid'l Adha", kind: "regular" },
      { date: "2026-06-12", name: "Independence Day", kind: "regular" },
      { date: "2026-08-31", name: "National Heroes Day", kind: "regular" },
      { date: "2026-11-30", name: "Bonifacio Day", kind: "regular" },
      { date: "2026-12-25", name: "Christmas Day", kind: "regular" },
      { date: "2026-12-30", name: "Rizal Day", kind: "regular" },
      // Special non-working days: Proclamation 1006
      { date: "2026-02-17", name: "Chinese New Year", kind: "special" },
      { date: "2026-04-04", name: "Black Saturday", kind: "special" },
      { date: "2026-08-21", name: "Ninoy Aquino Day", kind: "special" },
      { date: "2026-11-01", name: "All Saints' Day", kind: "special" },
      { date: "2026-11-02", name: "All Souls' Day", kind: "special" },
      { date: "2026-12-08", name: "Feast of the Immaculate Conception", kind: "special" },
      { date: "2026-12-24", name: "Christmas Eve", kind: "special" },
      { date: "2026-12-31", name: "Last Day of the Year", kind: "special" },
      // Permanent statutory working days (do NOT reduce leave)
      { date: "2026-01-23", name: "First Philippine Republic Day", kind: "special_working" },
      { date: "2026-02-25", name: "EDSA People Power Revolution Anniversary", kind: "special_working" },
      { date: "2026-04-27", name: "Lapu-Lapu Day", kind: "special_working" },
      { date: "2026-07-27", name: "Iglesia ni Cristo Day", kind: "special_working" },
      { date: "2026-09-08", name: "Feast of the Nativity of Mary", kind: "special_working" },
      { date: "2026-11-07", name: "Sheikh Karim'ul Makhdum Day", kind: "special_working" },
      { date: "2026-11-27", name: "Araw ng Pagbasa", kind: "special_working" },
      // Observances (working days, display only)
      { date: "2026-01-16", name: "Lailatul Isra wal Mi'raj", kind: "observance" },
      { date: "2026-02-19", name: "Start of Ramadan", kind: "observance" },
      { date: "2026-04-05", name: "Easter Sunday", kind: "observance" },
      { date: "2026-06-16", name: "Amun Jadid (Islamic New Year)", kind: "observance" },
      { date: "2026-08-26", name: "Maulid un-Nabi", kind: "observance" },
      { date: "2026-11-17", name: "National Students' Day", kind: "observance" },
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
  };
}
