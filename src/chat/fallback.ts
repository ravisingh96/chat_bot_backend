// Used when the AI call fails or no OPENAI_API_KEY is set. It runs a short intake like a support technician would:
// it works out which question each customer reply answered (even one-word replies like "hp" or "no"), says
// something specific about it, and then asks for the next detail that is still missing.
import { isGreeting } from './greeting';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

type Slot = 'brand' | 'os' | 'when' | 'conn' | 'signals' | 'else';
type Topic = 'offline' | 'jam' | 'wifi' | 'scan' | 'driver' | 'ink' | 'slow' | 'power';

const BRANDS = ['HP', 'Canon', 'Epson', 'Brother', 'Samsung', 'Xerox', 'Lexmark', 'Ricoh', 'Kyocera', 'Dell', 'Pixma', 'LaserJet', 'OfficeJet', 'DeskJet'];

// Each question has a marker so a later turn can tell which one the customer was answering.
const QUESTIONS: Record<Slot, { marker: RegExp; text: string }> = {
  brand: { marker: /brand and model/i, text: 'Which brand and model is your printer? You will usually find it on a label at the front or back.' },
  os: { marker: /Windows PC, a Mac/i, text: 'Are you printing from a Windows PC, a Mac or a phone?' },
  conn: { marker: /Wi-Fi, USB or Ethernet/i, text: 'Is the printer connected over Wi-Fi, USB or Ethernet?' },
  when: { marker: /When did this start/i, text: 'When did this start, and did it happen suddenly or after an update or a change in your setup?' },
  signals: { marker: /lights, sounds/i, text: 'When you try to use it, do you see any lights, sounds or error messages on the printer or your screen?' },
  else: { marker: /anything else/i, text: 'Is there anything else I should note for the specialist?' },
};

const TIPS: { topic: Topic; test: RegExp; tip: string; deeper: string }[] = [
  {
    topic: 'power',
    test: /(not|n'?t|won'?t|doesn'?t|isn'?t|never)\s+(?:\w+\s+)?(start|turn(ing)?\s*on|power(ing)?|boot|switch(ing)?\s*on)|no power|dead|not starting/i,
    tip: 'Meanwhile, plug the power cable straight into a wall socket (not a power strip) and check it is firm at both ends.',
    deeper: 'Also try a different wall socket, since a faulty outlet can look exactly like a dead printer.',
  },
  {
    topic: 'offline',
    test: /offline|not responding|unavailable|can'?t (find|see)|not detected|not showing/i,
    tip: 'An "offline" status usually means the computer and printer have lost their connection, so switch the printer off and on and check it shows as ready.',
    deeper: 'Also open the printer list on your computer and untick "use printer offline" if it is ticked, then print again.',
  },
  {
    topic: 'jam',
    test: /jam|stuck paper|paper (stuck|feed|pick)|won'?t feed/i,
    tip: 'Switch the printer off, open the rear and front covers, and pull the sheet out slowly in the direction of the paper path so nothing tears.',
    deeper: 'Check for small torn pieces near the rollers and make sure the tray is not overfilled.',
  },
  {
    topic: 'wifi',
    test: /wi-?fi|wireless|network|router|pair/i,
    tip: 'Make sure the printer is on the same Wi-Fi network as your computer, and restart the router and printer together.',
    deeper: 'If it will not join, run the wireless setup from the printer menu again with the router close by.',
  },
  {
    topic: 'scan',
    test: /scan/i,
    tip: 'Scanning needs its own software on top of the print driver, so check the manufacturer\'s scanner app is installed.',
    deeper: 'Make sure the scanner is selected in that app and connected the same way as when you print.',
  },
  {
    topic: 'driver',
    test: /driver|install|download|software|setup|update/i,
    tip: 'The safest route is the official support page for your exact model, where you pick your operating system and download the matching driver.',
    deeper: 'Close other print apps before installing and restart the computer once the driver finishes.',
  },
  {
    topic: 'ink',
    test: /ink|toner|cartridge|faded|streak|blank page|smudge/i,
    tip: 'Take the cartridge out, reseat it firmly, and run the printer\'s own cleaning or alignment routine from its menu.',
    deeper: 'Check the cartridge is the right one for your model and is not past its expiry date.',
  },
  {
    topic: 'slow',
    test: /slow|takes (long|forever)|stuck in (queue|spool)|spool|queue|pending|won'?t print|not printing|doesn'?t print/i,
    tip: 'Cancel everything in the print queue, restart the printer, and send a single test page.',
    deeper: 'If the queue keeps freezing, restarting the computer\'s print service often clears it.',
  },
];

const EMPATHY: Partial<Record<Topic, string>> = {
  power: "I'm sorry to hear your printer isn't turning on.",
  offline: "I'm sorry about the offline message. It's a common one and usually quick to fix.",
  jam: 'A paper jam is frustrating, but it is usually easy to clear.',
  wifi: 'Printer connection problems are common, and we can usually sort them out.',
  ink: 'Print quality problems are annoying, but they are usually fixable.',
  slow: "I'm sorry your printer isn't printing. Let's find out why.",
};

interface Facts {
  issue?: string;
  brand?: string;
  model?: string;
  brandText?: string;
  os?: string;
  when?: string;
  conn?: string;
  signals?: string;
  topic?: Topic;
  /** which question the latest customer message answered; 'issue' for the first problem description */
  answered: Slot | 'issue' | null;
}

const NO_RE = /^\s*(no|nope|nah|nothing|none|not really|nil)\b/i;

function findBrand(text: string) {
  return BRANDS.find((b) => new RegExp(`\\b${b}\\b`, 'i').test(text));
}

function findModel(text: string) {
  return text.match(/\b[A-Za-z]{1,4}[- ]?\d{2,5}[A-Za-z]{0,3}\b/)?.[0];
}

function findOs(text: string) {
  if (/\bmac(book)?\b|\bimac\b|macos|os ?x|\bapple\b/i.test(text)) return 'Mac';
  if (/windows|\bwin ?(7|8|10|11)\b|\bpc\b/i.test(text)) return 'Windows';
  if (/iphone|ipad|\bios\b/i.test(text)) return 'iPhone';
  if (/android/i.test(text)) return 'Android phone';
  if (/linux|ubuntu/i.test(text)) return 'Linux';
  return undefined;
}

// A short reply to the "which system" question is taken as the answer even when typed loosely ("max" for Mac).
function osFromShortReply(text: string) {
  const t = text.trim();
  if (/^m[ae]?[ack]/i.test(t)) return 'Mac';
  if (/^w[iu]n/i.test(t)) return 'Windows';
  return t.split(/\s+/).length <= 3 ? t : undefined;
}

function findConn(text: string) {
  if (/usb/i.test(text)) return 'USB';
  if (/ethernet|lan cable/i.test(text)) return 'Ethernet';
  if (/wi-?fi|wireless/i.test(text)) return 'Wi-Fi';
  return undefined;
}

function findTopic(text: string): Topic | undefined {
  return TIPS.find((t) => t.test.test(text))?.topic;
}

function classify(assistantText: string): Slot | null {
  return (Object.keys(QUESTIONS) as Slot[]).find((k) => QUESTIONS[k].marker.test(assistantText)) ?? null;
}

function collect(history: Msg[]): Facts {
  const f: Facts = { answered: null };
  let asked: Slot | null = null;
  for (const m of history) {
    if (m.role === 'assistant') {
      asked = classify(m.content);
      continue;
    }
    const text = m.content.trim();
    if (isGreeting(text)) {
      asked = null;
      continue;
    }
    f.brand ??= findBrand(text);
    if (asked === 'brand' || findBrand(text)) f.model ??= findModel(text);
    f.os ??= findOs(text);
    f.conn ??= findConn(text);
    f.topic = findTopic(text) ?? f.topic;

    f.answered = asked;
    if (asked === 'brand') f.brandText = text;
    else if (asked === 'os') f.os ??= osFromShortReply(text);
    else if (asked === 'when') f.when = text;
    else if (asked === 'conn') f.conn ??= text;
    else if (asked === 'signals') f.signals = text;
    else if (!f.issue) {
      f.issue = text;
      f.answered = 'issue';
    }
    asked = null;
  }
  return f;
}

function printerName(f: Facts) {
  const brand = f.brand ? (f.model ? `${f.brand} ${f.model}` : f.brand) : '';
  return brand ? `your ${brand} printer` : 'the printer';
}

function symptom(f: Facts) {
  const t = `${f.issue ?? ''} ${f.when ?? ''}`;
  if (TIPS[0].test.test(t)) return "isn't powering on";
  if (/offline/i.test(t)) return 'shows as offline';
  if (/jam/i.test(t)) return 'has a paper jam';
  if (/won'?t print|not printing|doesn'?t print/i.test(t)) return "isn't printing";
  return '';
}

/** One-line description of the case so far, e.g. "your HP printer on a Mac that isn't powering on". */
export function caseSummary(history: Msg[]): string {
  const f = collect(history);
  const known = f.brand || f.os || symptom(f);
  if (!known) return '';
  const os = f.os ? ` on ${f.os === 'Mac' ? 'a Mac' : f.os}` : '';
  const sym = symptom(f);
  return `${printerName(f)}${os}${sym ? ` that ${sym}` : ''}`;
}

function acknowledge(f: Facts, last: string, turn: number): string {
  switch (f.answered) {
    case 'issue':
      return EMPATHY[f.topic as Topic] ?? "I'm sorry to hear that. Let's get it sorted.";
    case 'brand': {
      const label = f.brand ? (f.model ? `${f.brand} ${f.model}` : f.brand) : f.brandText && f.brandText.split(/\s+/).length <= 5 ? f.brandText : '';
      return label ? `Thanks, ${/^(hp|[aeiou])/i.test(label) ? 'an' : 'a'} ${label} printer, noted.` : 'Thanks, noted.';
    }
    case 'os':
      return f.os === 'Mac' ? "Thanks for letting me know you're using a Mac." : f.os ? `Thanks for letting me know you're using ${f.os}.` : 'Thanks for that.';
    case 'when': {
      const s = symptom({ ...f, issue: '', when: last });
      if (s) return `I see, ${printerName(f)} ${s}.`;
      return /yesterday|today|morning|night|week|ago|since|after|suddenly|update/i.test(last) ? 'Okay, that timing helps.' : 'Okay, thanks for explaining that.';
    }
    case 'conn':
      return `Thanks, noted that it's connected over ${f.conn}.`;
    case 'signals':
      return NO_RE.test(last) ? 'Thank you for confirming there are no lights, sounds or messages.' : "Good to know, I'll note that down.";
    default:
      return ['Got it.', 'Okay, thanks for that.', 'Alright, that helps.'][turn % 3];
  }
}

export function fallbackAnswer(history: Msg[]): string {
  const f = collect(history);
  const said = history.filter((m) => m.role === 'assistant').map((m) => m.content).join(' ');
  const last = [...history].reverse().find((m) => m.role === 'user')?.content ?? '';
  const turn = history.filter((m) => m.role === 'assistant').length;
  const parts: string[] = [acknowledge(f, last, turn)];

  // One practical tip when the latest message gave a new symptom; a customer question gets one too.
  const topic = findTopic(last);
  const isQuestion = /\?|^\s*(how|what|why|can|could|should|is|are|do|does)\b/i.test(last);
  const t = TIPS.find((x) => x.topic === topic);
  if (t && (isQuestion || f.answered === 'when' || f.answered === 'issue' || f.answered === null)) {
    if (!said.includes(t.tip)) parts.push(t.tip);
    else if (!said.includes(t.deeper)) parts.push(t.deeper);
  }

  const wantsConn = ['offline', 'wifi', 'slow'].includes(f.topic ?? '');
  const order: [boolean, Slot][] = [
    [!f.brand && !f.brandText, 'brand'],
    [!f.os, 'os'],
    [wantsConn && !f.conn, 'conn'],
    [!f.when, 'when'],
    [!f.signals, 'signals'],
    [true, 'else'],
  ];
  const next = order.find(([need, slot]) => need && !QUESTIONS[slot].marker.test(said)) ?? order[order.length - 1];
  parts.push(QUESTIONS[next[1]].text);
  return parts.filter(Boolean).join(' ');
}
