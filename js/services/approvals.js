import { repo } from "../data/repository.js";

export async function review(applicationId, action, actor, comment = "") {
  return repo.reviewApplication({ applicationId, action, actor, comment });
}

export async function pendingQueue(limit = 200) {
  return repo.list("leaveApplications", {
    where: [["status", "in", ["PENDING", "UNDER_REVIEW", "FOR_SUPERVISOR_REVIEW", "FOR_FINAL_APPROVAL"]]],
    orderBy: [["submittedAt", "asc"]],
    limit,
  });
}
