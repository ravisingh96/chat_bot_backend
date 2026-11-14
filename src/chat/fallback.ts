// Used when the AI call fails or no OPENAI_API_KEY is set. It runs a short intake like a plumber would:
// it works out which question each customer reply answered (even one-word replies like "yes" or "no"), says
// something specific about it, and then asks for the next detail that is still missing.
import { isGreeting } from './greeting';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

type Slot = 'fixture' | 'when' | 'supply' | 'damage' | 'city' | 'photo' | 'else';
type Topic = 'burst' | 'leak' | 'drain' | 'toilet' | 'tank' | 'geyser' | 'pressure' | 'nowater' | 'gas' | 'fitting';

// Each question has a marker so a later turn can tell which one the customer was answering.
const QUESTIONS: Record<Slot, { marker: RegExp; text: string }> = {
  fixture: { marker: /which tap, pipe or fixture/i, text: 'Which tap, pipe or fixture is it, and where in the house (kitchen, bathroom, outside)?' },
  when: { marker: /When did this start/i, text: 'When did this start, and did it happen suddenly or get worse slowly?' },
  supply: { marker: /water supply to that fixture/i, text: 'Is the water supply to that fixture turned off right now, or is it still running?' },
  damage: { marker: /visible damage/i, text: 'Is there any visible damage, such as water stains on the wall or ceiling, a cracked pipe or rust?' },
  city: { marker: /Which city or area/i, text: 'Which city or area are you in, so I can check if a plumber can visit you?' },
  photo: { marker: /photo or a short video/i, text: 'Can you share a photo or a short video of the problem? It helps the plumber a lot.' },
  else: { marker: /anything else/i, text: 'Is there anything else I should note for the plumber?' },
};

const TIPS: { topic: Topic; test: RegExp; tip: string; deeper: string }[] = [
  {
    topic: 'gas',
    test: /\bgas\b/i,
    tip: 'If you smell gas, do not use switches or flames, open the windows and leave the area. Gas work should only be done by a licensed gas fitter, so a visiting plumber is needed here.',
    deeper: 'Please keep the area ventilated and the gas supply off until a licensed professional has inspected it.',
  },
  {
    topic: 'burst',
    test: /burst|flood|gushing|pouring|water everywhere|pipe (broke|broken|cracked)|main (pipe|line)/i,
    tip: 'Turn off the main water valve right away (usually near the meter or where the pipe enters the house), then open a tap to drain the pipe. If water is near sockets, switch off the electricity at the breaker too.',
    deeper: 'Move valuables away from the water and mop up standing water, but keep clear of electrics until a plumber has looked at it.',
  },
  {
    topic: 'geyser',
    test: /geyser|water heater|hot water|heater|boiler|not heating|no hot|cold water only|lukewarm/i,
    tip: 'Safety first: a geyser mixes electricity and water, so switch it off at the breaker before touching anything. Then check whether its thermostat, fuse or the power supply has tripped.',
    deeper: 'If the geyser is leaking, dripping from the valve or making loud noises, switch it off and shut its inlet valve; a plumber should inspect it rather than you opening it up.',
  },
  {
    topic: 'toilet',
    test: /toilet|commode|flush|cistern|\bwc\b/i,
    tip: 'Lift the cistern lid and check whether the float is stuck or the flapper is not sealing; a constantly running flush is often a worn flapper or a float set too high. You can close the small valve behind the toilet to stop the water meanwhile.',
    deeper: 'If it will not flush at all, check the chain is still attached to the handle and that the float rises freely.',
  },
  {
    topic: 'tank',
    test: /overflow|tank|overhead|sump|float valve|ball ?cock/i,
    tip: 'An overflowing tank usually means the float valve is stuck or faulty, so turn off the pump or the inlet valve to the tank first and then check the float moves freely.',
    deeper: 'If the float valve is cracked or corroded, it needs replacing; a plumber can do this quickly.',
  },
  {
    topic: 'drain',
    test: /drain|block|clog|choke|sewer|smell|gurgl|standing water|backing up/i,
    tip: 'Avoid pouring chemical drain cleaners in straight away; first try a plunger over the opening (cover the overflow hole) and run hot water afterwards.',
    deeper: 'Remove and clean the sink trap or strainer, since hair and grease collect there. If several drains are slow, the main line may be blocked and needs a plumber with a drain machine.',
  },
  {
    topic: 'pressure',
    test: /pressure|weak flow|low flow|trickle|barely (any )?water/i,
    tip: 'Check whether it is one tap or the whole house: if it is one tap, the aerator or shower head is often clogged with scale, so unscrew it and soak it in vinegar.',
    deeper: 'If the whole house is affected, check the main valve is fully open and ask neighbours whether supply is low; a partly closed valve or a leak can both cause it.',
  },
  {
    topic: 'nowater',
    test: /no water|water (stopped|is gone|not coming)|dry tap|nothing comes out|no supply|water cut/i,
    tip: 'First check whether it is only your home: see if neighbours have water, and confirm the main valve and tank/pump are on.',
    deeper: 'If only one tap is dry, the shut-off valve under it may be closed or the pipe blocked, and a plumber can trace it.',
  },
  {
    topic: 'leak',
    test: /leak|drip|seep|wet|damp|moisture|puddle|spray|water (is )?coming/i,
    tip: 'Turn off the shut-off valve under the fixture (or the main valve if there is none) and put a bucket or towel underneath to stop further damage.',
    deeper: 'Dry the pipe with a cloth and watch where the first drop appears; it usually shows whether the joint, the washer or the pipe itself is at fault.',
  },
  {
    topic: 'fitting',
    test: /\btap\b|faucet|mixer|shower|basin|sink|bathroom|kitchen|bidet|install|fitting|replace|washer/i,
    tip: 'Close the shut-off valve for that fixture before you touch it, and keep the old part so the plumber can match the size.',
    deeper: 'Note the make or type of the fitting if it is printed on it, since that makes the replacement faster.',
  },
];

const EMPATHY: Partial<Record<Topic, string>> = {
  burst: "I'm sorry, a burst pipe is stressful. Let's get the water stopped first.",
  leak: "I'm sorry about the leak. It's common and usually quick to fix once we know where it comes from.",
  drain: 'A blocked drain is unpleasant, but it is usually fixable.',
  toilet: 'A toilet problem is annoying, but it is usually an easy repair.',
  tank: 'An overflowing tank wastes a lot of water, but it is normally a simple fix.',
  geyser: "I'm sorry to hear your hot water isn't working. Let's find out why.",
  pressure: 'Low water pressure is frustrating, but there are a few likely causes.',
  nowater: "I'm sorry you have no water. Let's work out where the problem is.",
  gas: 'Safety comes first with anything involving gas.',
  fitting: 'Thanks for explaining, that helps me understand the job.',
};

interface Facts {
  issue?: string;
  fixture?: string;
  fixtureText?: string;
  location?: string;
  when?: string;
  supply?: string;
  damage?: string;
  city?: string;
  topic?: Topic;
  /** which question the latest customer message answered; 'issue' for the first problem description */
  answered: Slot | 'issue' | null;
}

const NO_RE = /^\s*(no|nope|nah|nothing|none|not really|nil)\b/i;

const FIXTURES: [RegExp, string][] = [
  [/geyser|water heater|boiler/i, 'geyser'],
  [/toilet|commode|cistern|flush|\bwc\b/i, 'toilet'],
  [/shower/i, 'shower'],
  [/\btap\b|faucet|mixer/i, 'tap'],
  [/basin|washbasin/i, 'basin'],
  [/\bsink\b/i, 'sink'],
  [/drain|sewer/i, 'drain'],
  [/\btank\b/i, 'water tank'],
  [/pipe|pipeline|joint/i, 'pipe'],
];

function findFixture(text: string) {
  return FIXTURES.find(([re]) => re.test(text))?.[1];
}

function findLocation(text: string) {
  if (/kitchen/i.test(text)) return 'kitchen';
  if (/bath ?room|washroom|restroom/i.test(text)) return 'bathroom';
  if (/outside|garden|terrace|roof|balcony|yard/i.test(text)) return 'outdoors';
  return undefined;
}

function findCity(text: string) {
  return text.match(/\b(?:in|from|at|near)\s+([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)\b/)?.[1];
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
    f.fixture ??= findFixture(text);
    f.location ??= findLocation(text);
    f.topic = findTopic(text) ?? f.topic;

    f.answered = asked;
    if (asked === 'fixture') f.fixtureText = text;
    else if (asked === 'when') f.when = text;
    else if (asked === 'supply') f.supply = text;
    else if (asked === 'damage') f.damage = text;
    else if (asked === 'city') f.city = findCity(text) ?? (text.split(/\s+/).length <= 4 ? text : undefined);
    else if (!f.issue) {
      f.issue = text;
      f.answered = 'issue';
    }
    asked = null;
  }
  return f;
}

function fixtureName(f: Facts) {
  if (!f.fixture) return 'the problem';
  return f.location && f.location !== 'outdoors' && !f.fixture.includes(f.location) ? `the ${f.location} ${f.fixture}` : `the ${f.fixture}`;
}

function symptom(f: Facts) {
  const t = `${f.issue ?? ''} ${f.when ?? ''}`;
  if (/burst|gushing|flood/i.test(t)) return 'has burst';
  if (/leak|drip/i.test(t)) return 'is leaking';
  if (/block|clog|choke|won'?t drain|slow drain/i.test(t)) return 'is blocked';
  if (/not heating|no hot|cold water/i.test(t)) return "isn't heating";
  if (/keeps running|running/i.test(t)) return 'keeps running';
  if (/overflow/i.test(t)) return 'is overflowing';
  if (/pressure|trickle|weak/i.test(t)) return 'has low water pressure';
  return '';
}

/** One-line description of the case so far, e.g. "the kitchen tap that is leaking". */
export function caseSummary(history: Msg[]): string {
  const f = collect(history);
  const sym = symptom(f);
  if (!f.fixture && !sym) return '';
  return `${fixtureName(f)}${sym ? ` that ${sym}` : ''}`;
}

function acknowledge(f: Facts, last: string, turn: number): string {
  switch (f.answered) {
    case 'issue':
      return EMPATHY[f.topic as Topic] ?? "I'm sorry to hear that. Let's get it sorted.";
    case 'fixture': {
      const label = f.fixture ? fixtureName(f).replace(/^the /, '') : f.fixtureText && f.fixtureText.split(/\s+/).length <= 5 ? f.fixtureText : '';
      return label ? `Thanks, the ${label}, noted.` : 'Thanks, noted.';
    }
    case 'when': {
      const s = symptom({ ...f, issue: '', when: last });
      if (s) return `I see, ${fixtureName(f)} ${s}.`;
      return /yesterday|today|morning|night|week|ago|since|after|suddenly|month/i.test(last) ? 'Okay, that timing helps.' : 'Okay, thanks for explaining that.';
    }
    case 'supply':
      return /\b(off|closed|stopped)\b/i.test(last) && !NO_RE.test(last) ? 'Good, that will limit the damage.' : "Okay, thanks. Let's try to stop it soon.";
    case 'damage':
      return NO_RE.test(last) ? 'Good to hear there is no visible damage.' : "Thanks, I'll note that damage down for the plumber.";
    case 'city':
      return f.city ? `Thanks, ${f.city}, noted.` : 'Thanks for that.';
    case 'photo':
      return 'Thanks for letting me know.';
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

  const wet = ['burst', 'leak', 'tank', 'toilet'].includes(f.topic ?? '');
  const order: [boolean, Slot][] = [
    [!f.fixture && !f.fixtureText, 'fixture'],
    [!f.when, 'when'],
    [wet && !f.supply, 'supply'],
    [wet && !f.damage, 'damage'],
    [!f.city, 'city'],
    [true, 'photo'],
    [true, 'else'],
  ];
  const next = order.find(([need, slot]) => need && !QUESTIONS[slot].marker.test(said)) ?? order[order.length - 1];
  parts.push(QUESTIONS[next[1]].text);
  return parts.filter(Boolean).join(' ');
}
