/* Repository contract — the ONE data seam.
 *
 * UI code and services NEVER touch localStorage, IndexedDB, fetch, or
 * Firebase directly. Only js/data/* does. `repo` is the Firestore adapter
 * (js/data/firestore-adapter.js), imported lazily so pages that never touch
 * data load zero Firebase code. It implements this interface:
 *
 *   repo.get(collection, id) -> object | null
 *   repo.list(collection, { where: [[field, op, value]], orderBy: [[field, "asc"|"desc"]], limit, cursor })
 *     ops: == in < <= > >= array-contains ONLY. No joins, no OR, no full-text.
 *   repo.create(collection, data, optionalId) -> string id
 *   repo.update(collection, id, patch)
 *   repo.remove(collection, id)
 *   repo.subscribe(collection, query, callback) -> unsubscribe fn
 *   repo.submitApplication({ application, documents }) -> { id, workingDays }
 *   repo.reviewApplication({ applicationId, action, actor, comment }) -> { ok }
 *   repo.cancelApplication({ applicationId, actor }) -> { ok }
 *   repo.adjustBalance({ uid, leaveTypeCode, delta, reason, actor }) -> { ok }
 *   repo.seedReferenceData() -> { ok }   (idempotent)
 *   Account invites / password recovery (HR-created accounts have NO
 *   password until redeemed; forgot-password notifies HR, HR sends link):
 *   repo.inviteUser({ userData }) -> { uid, token, linkPath }
 *   repo.requestPasswordReset({ email }) -> { ok }  (silent if unknown)
 *   repo.markInviteSent(token)
 *   repo.consumeInvite({ token, newPassword }) -> { uid }
 *   repo.adminSetPassword({ uid, newPassword, actor }) -> { ok }
 *     (HR/supervisor resets any account's password; Firestore mode queues
 *     it for a Cloud Function — clients never write Auth passwords)
 *   repo.addDocument({ applicationId, doc, actor }) -> { id }
 *     (attach supporting files while DRAFT/PENDING/UNDER_REVIEW)
 *   Deletion with supervisor confirmation (four-eyes: confirmer must differ
 *   from requester; sys_admin accounts and self-deletion are refused):
 *   repo.requestDeletion({ uid, actor }) -> { requestId }
 *   repo.rejectDeletion({ requestId, actor }) -> { ok }
 *   repo.confirmDeletion({ requestId, actor }) -> { ok }
 *     (deletes user + balances + invites; applications stay as audit trail)
 *   Deletion requests live in deletionRequests/{id}: uid, email, name,
 *   requestedBy, requestedByName, status (pending|rejected), createdAt.
 *   Invites live in invites/{token}: uid, email, kind (invite|reset),
 *   status (sent|requested), expiresAt, used, createdAt.
 *
 * Everything async, plain JSON, string IDs, never class instances.
 * Dates of leave are "YYYY-MM-DD" strings. Timestamps (createdAt,
 * submittedAt, updatedAt) are ISO strings in the app; the Firestore adapter
 * converts to/from Timestamp / serverTimestamp.
 *
 * Collections:
 *   users/{uid}                  email,name,role,employeeNo,department,position,status,dateHired,phone,avatarColor,supervisorUid,createdAt
 *   departments/{id}             name
 *   leaveTypes/{code}            code,name,active,requiresDoc,maxDays,description
 *   leaveBalances/{uid_code}     uid,leaveTypeCode,earned,used,pending
 *   leaveBalanceTransactions/{id} uid,leaveTypeCode,type(credit|debit|hold|release|adjust),days,applicationId,reason,actorUid,createdAt
 *   leaveApplications/{id}       uid,employeeName,department,position,leaveTypeCode,leaveTypeName,startDate,endDate,workingDays,reason,emergencyName,emergencyRelationship,emergencyPhone,details{},status,submittedAt,updatedAt
 *     approvals/{id}             step,approverUid,approverName,role,action,comment,timestamp
 *     documents/{id}             fileName,path,size,mimeType,uploadedAt
 *   notifications/{id}           uid,title,body,type,read,createdAt
 *   auditLogs/{id}               actorUid,actorEmail,action,entity,entityId,description,meta{},createdAt
 *   holidays/{YYYY-MM-DD}        date,name,kind(regular|special)
 *   invites/{token}              uid,email,kind(invite|reset),status(sent|requested),expiresAt,used,createdAt
 *   pendingProfiles/{token}      (firestore mode) profile waiting for invite redemption; users/{uid} is written from it, uid === Auth uid
 *   fileBlobs/{id}               (firestore mode, Spark) path,data(base64),size,mimeType,uid,createdAt — ≤700 KB raw
 *   settings/app                 orgName,office,salaryVisible,charLimit,cancellationPolicy,workflowVacation,workflowDefault,uploadMaxMb,notifEnabled,signatories{}
 *
 * Query patterns the UI uses (keep indexed fields only; the rest is
 * client-side on small result sets):
 *   leaveApplications: uid+submittedAt desc | status+submittedAt | leaveTypeCode+status
 *   notifications: uid+createdAt desc | uid+read
 *   auditLogs: createdAt desc | entity+createdAt
 *   leaveBalanceTransactions: uid+leaveTypeCode+createdAt
 */

// Lazy: the Firebase SDK loads only when a page actually touches data.
const ready = import("./firestore-adapter.js").then((m) => m.firestoreAdapter);

export const repo = new Proxy(
  {},
  {
    get(_t, prop) {
      return (...args) => ready.then((a) => a[prop](...args));
    },
  }
);

/** For tests: the active adapter once its module has loaded. */
export async function resolveAdapter() {
  return ready;
}
