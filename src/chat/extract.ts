const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/i;
const PHONE_RE = /\+?\d[\d\s().-]{5,}\d/g;

export const countWords = (text: string) => (text.trim().match(/\S+/g) || []).length;

export function findEmail(text: string): string | null {
  const m = text.match(EMAIL_RE);
  return m ? m[0].toLowerCase() : null;
}

export function findPhone(text: string): string | null {
  const withoutEmail = text.replace(EMAIL_RE, ' ');
  for (const m of withoutEmail.match(PHONE_RE) || []) {
    const digits = m.replace(/\D/g, '');
    if (digits.length >= 7 && digits.length <= 15) return m.trim();
  }
  return null;
}

const NAME_LEAD =
  /^(?:hi|hello|hey)?[\s,!.]*(?:(?:my\s+name\s+is|my\s+name's|name\s+is|i\s+am|i'm|im|this\s+is|it\s+is|it's|its|call\s+me|you\s+can\s+call\s+me)\s+)?/i;

/** Pulls a plausible name out of a short reply to "what's your name?". Returns null when it does not look like one. */
export function findName(text: string): string | null {
  const cleaned = text
    .replace(NAME_LEAD, '')
    .replace(/[^\p{L}\s'.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || /@|\d/.test(text) || countWords(text) > 8) return null;
  const parts = cleaned.split(' ').filter(Boolean).slice(0, 3);
  if (!parts.length || parts.some((p) => p.length > 30)) return null;
  const STOP = new Set(['no', 'nope', 'not', 'why', 'what', 'yes', 'ok', 'okay', 'none', 'skip', 'idk']);
  if (STOP.has(parts[0].toLowerCase())) return null;
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}
