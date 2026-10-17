/* Wizard draft autosave — the ONLY module that touches draft storage.
 * Pages call these; never localStorage directly (see js/data/repository.js
 * header). Attachments are deliberately stripped: uploaded documents live in
 * the live form state only, so a reload never resurrects a stale file path. */
const PREFIX = "lms.v1.draft_";

export function loadDraft(uid) {
  try {
    const raw = localStorage.getItem(`${PREFIX}${uid}`);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

export function saveDraft(uid, state) {
  try {
    const { documents: _d, ...rest } = state || {};
    localStorage.setItem(`${PREFIX}${uid}`, JSON.stringify(rest));
  } catch { /* ignore: quota or private mode */ }
}

export function clearDraft(uid) {
  try {
    localStorage.removeItem(`${PREFIX}${uid}`);
  } catch { /* ignore */ }
}
