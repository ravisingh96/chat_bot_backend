// Used when the AI call fails or no OPENAI_API_KEY is set. It reads what the customer has said so far and
// replies with a topic tip plus one follow-up that has not been asked yet, so the chat still feels contextual.

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

const BRANDS = ['HP', 'Canon', 'Epson', 'Brother', 'Samsung', 'Xerox', 'Lexmark', 'Ricoh', 'Kyocera', 'Dell', 'Pixma', 'LaserJet', 'OfficeJet', 'DeskJet'];

const TIPS: { key: string; test: RegExp; tip: string; deeper: string }[] = [
  {
    key: 'offline',
    test: /offline|not responding|unavailable|can'?t (find|see)|not detected|not showing/i,
    tip: 'An "offline" status usually means the computer and printer have lost their connection, so first switch the printer off and on and check it shows as ready.',
    deeper: 'Also open the printer list on your computer, remove the paused or "use offline" setting if it is ticked, and try printing again.',
  },
  {
    key: 'jam',
    test: /jam|stuck paper|paper (stuck|feed|pick)|won'?t feed/i,
    tip: 'For a paper jam, switch the printer off, open the rear and front covers, and pull the sheet out slowly in the direction of the paper path so nothing tears.',
    deeper: 'Check for small torn pieces near the rollers, make sure the tray is not overfilled, then power on again.',
  },
  {
    key: 'wifi',
    test: /wi-?fi|wireless|network|router|connect(ion)?|pair/i,
    tip: 'For Wi-Fi trouble, make sure the printer is on the same network as your computer and restart the router and printer together.',
    deeper: 'If it still will not join, run the wireless setup from the printer menu again and keep the router close during setup.',
  },
  {
    key: 'scan',
    test: /scan/i,
    tip: 'Scanning needs its own software on top of the print driver, so first check the scanner app from the manufacturer is installed.',
    deeper: 'Make sure the scanner is selected in that app, and that the printer is connected the same way as when you print.',
  },
  {
    key: 'driver',
    test: /driver|install|download|software|setup|update/i,
    tip: 'The safest route is the official support page for your exact model, where you pick your operating system and download the matching driver.',
    deeper: 'Close other print apps before installing, and restart the computer once the driver finishes.',
  },
  {
    key: 'ink',
    test: /ink|toner|cartridge|cartridges|faded|streak|blank page|smudge/i,
    tip: 'For ink or toner issues, take the cartridge out, reseat it firmly, and run the printer\'s own cleaning or alignment routine from its menu.',
    deeper: 'If the message stays, check the cartridge is the right one for your model and is not past its expiry.',
  },
  {
    key: 'slow',
    test: /slow|takes (long|forever)|stuck in (queue|spool)|spool|queue|pending|won'?t print|not printing|doesn'?t print/i,
    tip: 'When print jobs get stuck, cancel everything in the print queue, restart the printer, and send a single test page.',
    deeper: 'If the queue keeps freezing, restarting the computer\'s print service often clears it.',
  },
];

const OPENERS = ['Got it.', 'Okay, thanks for that.', 'Alright, that helps.', 'Understood.', 'Thanks, noted.'];

function facts(user: string) {
  const brand = BRANDS.find((b) => new RegExp(`\\b${b}\\b`, 'i').test(user));
  const model = user.match(/\b[A-Za-z]{1,4}[- ]?\d{2,5}[A-Za-z]{0,3}\b/)?.[0];
  const os = /mac|os x|macos|apple/i.test(user) ? 'Mac' : /windows|win ?\d+/i.test(user) ? 'Windows' : /linux|ubuntu/i.test(user) ? 'Linux' : /iphone|ipad|ios/i.test(user) ? 'iPhone' : /android/i.test(user) ? 'Android' : null;
  const conn = /usb/i.test(user) ? 'USB' : /ethernet|lan cable/i.test(user) ? 'Ethernet' : /wi-?fi|wireless|network/i.test(user) ? 'Wi-Fi' : null;
  return { brand, model, os, conn };
}

export function fallbackAnswer(history: Msg[]): string {
  const userText = history.filter((m) => m.role === 'user').map((m) => m.content).join(' ');
  const said = history.filter((m) => m.role === 'assistant').map((m) => m.content).join(' ');
  const last = [...history].reverse().find((m) => m.role === 'user')?.content ?? '';
  const f = facts(userText);
  const turn = history.filter((m) => m.role === 'assistant').length;
  const parts: string[] = [OPENERS[turn % OPENERS.length]];

  const known = [f.brand && f.model ? `${f.brand} ${f.model}` : f.model || f.brand, f.os && `on a ${f.os}`, f.conn && `over ${f.conn}`].filter(Boolean);
  if (known.length && turn <= 2 && !said.includes(known[0] as string)) parts[0] = `Got it, ${known.join(' ')}.`;

  // Tip for what they just said; if that tip was already given, give the deeper one instead.
  const topic = TIPS.find((t) => t.test.test(last)) ?? TIPS.find((t) => t.test.test(userText));
  if (topic) parts.push(said.includes(topic.tip) ? (said.includes(topic.deeper) ? '' : topic.deeper) : topic.tip);

  const questions: [boolean, string][] = [
    [!f.brand && !f.model, 'Which printer brand and model are you using?'],
    [!f.os, 'Are you printing from a Windows PC, a Mac or a phone?'],
    [!f.conn, 'Is the printer connected over Wi-Fi, USB or Ethernet?'],
    [true, 'Do you see any error message or blinking light on the printer? If so, what does it say?'],
    [true, 'Did that change anything when you tried it?'],
  ];
  const next = questions.find(([need, q]) => need && !said.includes(q)) ?? questions[questions.length - 1];
  parts.push(next[1]);
  return parts.filter(Boolean).join(' ');
}
