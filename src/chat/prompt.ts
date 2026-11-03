import { caseSummary } from './fallback';
import { isGreeting } from './greeting';
import { firstName } from './persona';

export { isGreeting };

export type Turn =
  | { kind: 'answer' }
  | { kind: 'ask'; field: 'name' | 'email' | 'phone'; retry: boolean }
  | { kind: 'close'; hasContact: boolean };

export function systemPrompt(persona: string) {
  return `You are ${firstName(persona)}, a friendly printer and computer support technician on the AskAnythingAnswers help desk.
You help customers with printer, scanner, printing, driver, Wi-Fi/USB connection and related computer problems in a natural chat, like an experienced support technician.

PERSONALITY
- Friendly, patient, reassuring, practical. Sound like a real technician, not an FAQ.
- Plain English for non-technical customers. No headings, no bullet dumps.
- Never repeat your introduction.

STYLE
- Respond directly to what the customer just said. If they greet you, greet them back warmly in one short sentence.
- When they ask a question or describe a problem, answer it properly: give the most likely cause and the practical next steps in simple words.
- Remember everything said earlier in the chat and never ask for something already told to you.
- A very short reply such as "hp", "mac" or "no" is the answer to your last question: acknowledge it naturally (for example "Thanks, an HP printer") and move on. Briefly restate what you understood so the customer feels heard.
- Sound like one person talking, not a form: vary your wording, and do not repeat the same opener twice in a row.
- Keep replies short: 2-4 sentences, under 70 words. Use numbered steps only for physical instructions.

ACCURACY AND SAFETY
- Never invent printer specs, drivers, URLs or compatibility. If you are unsure, say so.
- Prefer official manufacturer support sites; do not paste links you cannot verify.
- Start with low-risk checks. Do not suggest uninstalling drivers, resetting the print system or firmware updates early on.
- Never ask for Wi-Fi passwords, account passwords or remote access.
- You cannot see or touch the customer's device; do not claim you checked or fixed anything.

SCOPE
- Only help with printers, scanners, printing, drivers, connectivity and closely related computer setup. For anything else, politely say this desk specializes in printer and device support.

HONESTY
- You are an AI-assisted support desk assistant. If the customer sincerely asks whether you are a real person or a bot, answer honestly that you are an AI assistant and that a human specialist can follow up. Never claim to be human.

Always follow the instruction for THIS reply given at the end of the conversation.`;
}

const FIELD_PHRASE = {
  name: 'their first name so the specialist can note it on the case',
  email: 'their email address so a specialist can send the full steps and follow up',
  phone: 'the best phone number to reach them in case a specialist needs to call',
};

export function turnInstruction(turn: Turn) {
  switch (turn.kind) {
    case 'answer':
      return "INSTRUCTION FOR THIS REPLY: First answer the customer's last message properly and helpfully with the most likely cause and a practical step. Then end with exactly ONE short follow-up question that depends on what they just said (for example the printer model, the exact error message, when it started, how it is connected, or what happened after a step you gave). Never ask for something they already told you and do not ask for contact details. Under 70 words.";
    case 'ask': {
      const retry = turn.retry
        ? ` Their last answer did not contain a valid ${turn.field}; politely say so and ask again, and skip the answer part.`
        : '';
      return `INSTRUCTION FOR THIS REPLY: First answer their last message helpfully in 1-3 short sentences (skip this if it was only an answer to your previous question). Then ask for ${FIELD_PHRASE[turn.field]}. The reply must contain exactly ONE question, at the very end.${retry} Under 70 words.`;
    }
    case 'close':
      return `INSTRUCTION FOR THIS REPLY: Do NOT ask any question. Answer their last message helpfully and briefly.${
        turn.hasContact ? ' Mention that a specialist will follow up using the contact details they shared.' : ''
      } Under 70 words.`;
  }
}

export function scriptedReply(turn: Turn, history: { role: 'user' | 'assistant'; content: string }[] = []) {
  const summary = caseSummary(history);
  switch (turn.kind) {
    case 'answer':
      return 'Thanks for explaining. A good first step is to turn the printer off, wait 30 seconds and switch it back on. Which printer brand and model are you using?';
    case 'ask':
      if (turn.field === 'name' && !turn.retry && summary) {
        return `Thank you for the details. So that's ${summary}. I'll pass this to a specialist so you don't have to repeat anything. May I have your first name?`;
      }
      return scriptedAsk(turn.field, turn.retry);
    case 'close':
      return turn.hasContact
        ? `Thanks, I've noted everything${summary ? ` about ${summary}` : ''}. A specialist will follow up with you using the details you shared. Meanwhile, try turning the printer off, waiting 30 seconds and switching it back on.`
        : 'Thanks for the details. Try turning the printer off, waiting 30 seconds and switching it back on, then print a test page.';
  }
}

export function scriptedAsk(field: 'name' | 'email' | 'phone', retry: boolean) {
  if (field === 'name') return retry ? "Sorry, I didn't catch that. What first name should I put on your case?" : 'So I can note this on your case, may I have your first name?';
  if (field === 'email')
    return retry
      ? "That email doesn't look quite right. Could you type it again, like name@example.com?"
      : "Thanks! What's the best email address for a specialist to send the full steps to?";
  return retry
    ? "That number doesn't look complete. Could you share it again with the area code?"
    : 'Last thing: what is the best phone number to reach you in case a specialist needs to call?';
}

export const greetingReply = (persona: string) => {
  const name = firstName(persona);
  const options = [
    `Hello! I'm ${name} from the support desk. Tell me what's going on with your printer or device and I'll help you out.`,
    `Hi there! ${name} here. Go ahead and describe the problem you're having and we'll get it sorted.`,
    `Hello, welcome! I'm ${name}. What issue are you facing with your printer or computer today?`,
  ];
  return options[Math.floor(Math.random() * options.length)];
};

// Statements, not questions, so they never use up the bot's question budget.
export const GENERIC_LONG_REPLIES = [
  "Thanks for the details! That's quite a lot to go through at once. Please send me the short version: your printer's brand and model, and what it does when you try to print.",
  "I appreciate the explanation. To help you faster, please sum it up in a sentence or two, mainly the printer model and the exact problem you're seeing.",
  "Thanks for sharing all that. Let's keep it simple so I can point you to the right fix: tell me the printer brand and model, and the main issue right now.",
];
