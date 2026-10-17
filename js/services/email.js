/* Invite emails. Transport lives in js/data/email-adapter.js (EmailJS REST);
 * this file composes the variables the EmailJS template expects:
 *   {{to_email}} {{to_name}} {{invite_link}} {{expires_hours}} {{org_name}}
 *   {{app_name}}
 * With EmailJS unconfigured, callers keep the manual copy-link flow. */
import { APP_CONFIG } from "../config.js";
import { emailConfigured, sendEmail } from "../data/email-adapter.js";

export { emailConfigured };

const INVITE_HOURS = 48; // must match the invite window written by the data layer

export async function sendInviteEmail({ to, name, link }) {
  if (!emailConfigured()) return { ok: false, reason: "not-configured" };
  await sendEmail({
    to_email: to,
    to_name: name || to,
    invite_link: link,
    expires_hours: String(INVITE_HOURS),
    org_name: APP_CONFIG.orgName,
    app_name: APP_CONFIG.appName,
  });
  return { ok: true };
}
