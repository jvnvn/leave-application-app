/* Email transport seam: EmailJS REST API (https://api.emailjs.com).
 * Chosen because the Spark plan has no Cloud Functions; the free tier sends
 * 200 emails/month and needs only three IDs in js/config.js (APP_CONFIG.email).
 * With any ID empty the feature is off and callers fall back to the manual
 * copy-link flow. The public key is safe to expose — it is scoped by the
 * allowed-origins list and rate limits set in the EmailJS dashboard. */
import { APP_CONFIG } from "../config.js";

const ENDPOINT = "https://api.emailjs.com/api/v1.0/email/send";

export function emailConfigured() {
  const e = APP_CONFIG.email || {};
  return Boolean(e.publicKey && e.serviceId && e.templateId);
}

/** Send one templated email. Throws with the service's reason on failure. */
export async function sendEmail(templateParams) {
  const e = APP_CONFIG.email || {};
  if (!emailConfigured()) throw new Error("Email is not configured");
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service_id: e.serviceId,
      template_id: e.templateId,
      user_id: e.publicKey,
      template_params: templateParams || {},
    }),
  });
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).trim();
    throw new Error(text ? text.slice(0, 200) : `Email service error (${res.status})`);
  }
  return { ok: true };
}
