import { repo } from "../data/repository.js";

let cache = null;

export async function getSettings() {
  if (cache) return cache;
  const s = await repo.get("settings", "app");
  cache = {
    orgName: "", office: "", salaryVisible: false, charLimit: 500,
    cancellationPolicy: "", workflowVacation: "hr_only",
    workflowDefault: "hr_supervisor_final", uploadMaxMb: 5,
    notifEnabled: true, signatories: {}, ...(s || {}),
  };
  return cache;
}

export async function saveSettings(patch, actor) {
  await repo.update("settings", "app", patch);
  cache = null;
  if (actor) {
    await repo.create("auditLogs", {
      actorUid: actor.uid, actorEmail: actor.email || "", action: "settings_updated",
      entity: "settings", entityId: "app", description: "Settings updated",
      meta: patch, createdAt: new Date().toISOString(),
    });
  }
}
