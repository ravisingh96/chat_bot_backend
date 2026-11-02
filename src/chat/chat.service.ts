import { BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { DatabaseService } from '../database/database.service';
import { AiService, ChatMsg } from './ai.service';
import { fallbackAnswer } from './fallback';
import { countWords, findEmail, findName, findPhone } from './extract';
import { GREETING, randomPersona } from './persona';
import { GENERIC_LONG_REPLIES, greetingReply, isGreeting, scriptedReply, systemPrompt, Turn, turnInstruction } from './prompt';

interface SessionRow {
  id: string;
  persona: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  questions_asked: number;
  pending_field: 'name' | 'email' | 'phone' | null;
  retried: string;
  skipped: string;
  answers: number;
  message_count: number;
}

type Field = 'name' | 'email' | 'phone';
const FIELDS: Field[] = ['name', 'email', 'phone'];

const csvList = (s: string) => s.split(',').filter(Boolean) as Field[];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const randomDelay = () => config.delayMinMs + Math.random() * Math.max(0, config.delayMaxMs - config.delayMinMs);

@Injectable()
export class ChatService implements OnModuleInit {
  private busy = new Set<string>();

  constructor(
    private readonly db: DatabaseService,
    private readonly ai: AiService,
  ) {}

  /** The site opens a session on page load, so drop the ones nobody ever typed into. */
  async onModuleInit() {
    await this.db.run('DELETE FROM sessions WHERE message_count = 0 AND started_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY)');
  }

  async start(meta: { ip?: string; userAgent?: string; pageUrl?: string }) {
    const id = randomUUID();
    const persona = randomPersona();
    await this.db.run(
      'INSERT INTO sessions (id, persona, ip, user_agent, page_url) VALUES (?, ?, ?, ?, ?)',
      id,
      persona,
      meta.ip ?? null,
      (meta.userAgent ?? '').slice(0, 300),
      (meta.pageUrl ?? '').slice(0, 300),
    );
    await this.db.run('INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)', id, 'assistant', GREETING);
    return { sessionId: id, persona, greeting: GREETING };
  }

  async history(sessionId: string) {
    const s = await this.session(sessionId);
    const messages = await this.db.all<{ role: string; content: string; created_at: string }>(
      'SELECT role, content, created_at FROM messages WHERE session_id = ? ORDER BY id',
      sessionId,
    );
    return {
      sessionId,
      persona: s.persona,
      messages: messages.map((m) => ({ role: m.role, content: m.content, at: m.created_at })),
    };
  }

  async message(sessionId: string, rawText: string) {
    const s = await this.session(sessionId);
    const text = rawText.trim().slice(0, 4000);
    if (!text) throw new BadRequestException('Message is empty');
    if (this.busy.has(sessionId)) throw new HttpException('Please wait for the reply', HttpStatus.TOO_MANY_REQUESTS);

    this.busy.add(sessionId);
    try {
      const startedAt = Date.now();
      await this.db.run('INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)', sessionId, 'user', text);

      await this.captureContact(s, text);
      const fresh = await this.session(sessionId);
      await this.upsertLead(fresh);

      let reply: string;
      let askedQuestion = false;
      let answered = false;
      let pending: Field | null = null;
      const retried = csvList(fresh.retried);
      const skipped = csvList(fresh.skipped);

      if (fresh.message_count >= config.maxMessagesPerSession) {
        reply = 'This chat has reached its length limit. A specialist can pick it up from here using the details you shared.';
      } else if (isGreeting(text)) {
        // A plain "hello" gets a greeting back and does not use up one of the answered turns.
        reply = greetingReply(fresh.persona);
        pending = fresh.pending_field;
      } else if (countWords(text) > config.maxUserWords) {
        // Long messages get a generic nudge instead of an AI answer.
        reply = GENERIC_LONG_REPLIES[Math.floor(Math.random() * GENERIC_LONG_REPLIES.length)];
        pending = fresh.pending_field;
      } else {
        // A field that was asked twice and still has no usable answer is dropped instead of nagging.
        const prev = s.pending_field;
        if (prev && !fresh[prev] && retried.includes(prev) && !skipped.includes(prev)) skipped.push(prev);

        const turn = this.decide(fresh, prev, skipped);
        reply = await this.generate(fresh, turn);
        answered = true;
        askedQuestion = turn.kind !== 'close';
        pending = turn.kind === 'ask' ? turn.field : null;
        if (turn.kind === 'ask' && turn.retry && !retried.includes(turn.field)) retried.push(turn.field);
      }

      // Wait out the human-like typing delay, counted from when the message arrived.
      const remaining = randomDelay() - (Date.now() - startedAt);
      if (remaining > 0) await sleep(remaining);

      await this.db.run('INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)', sessionId, 'assistant', reply);
      await this.db.run(
        `UPDATE sessions SET questions_asked = questions_asked + ?, answers = answers + ?, pending_field = ?, retried = ?, skipped = ?,
           message_count = message_count + 1, last_message_at = UTC_TIMESTAMP() WHERE id = ?`,
        askedQuestion ? 1 : 0,
        answered ? 1 : 0,
        pending,
        retried.join(','),
        skipped.join(','),
        sessionId,
      );

      const done = await this.session(sessionId);
      return {
        reply,
        persona: done.persona,
        leadComplete: !!(done.name && done.email && done.phone),
      };
    } finally {
      this.busy.delete(sessionId);
    }
  }

  /**
   * The first ANSWER_TURNS real messages each get a proper answer plus one follow-up question that depends on
   * what the customer said. After that the bot asks for name, email and phone, one per reply. Details already
   * given are never asked again, and a field that fails twice is skipped.
   */
  private decide(s: SessionRow, previousPending: Field | null, skipped: string[]): Turn {
    const missing = FIELDS.filter((f) => !s[f] && !skipped.includes(f));
    const hasContact = !!(s.email || s.phone);

    if (!missing.length) return { kind: 'close', hasContact };
    if (s.answers >= config.answerTurns) {
      const field = missing[0];
      return { kind: 'ask', field, retry: previousPending === field };
    }
    return { kind: 'answer' };
  }

  private async captureContact(s: SessionRow, text: string) {
    const email = findEmail(text);
    const phone = findPhone(text);
    // Names are only taken as the answer to the question that asked for one.
    const name = s.pending_field === 'name' && !s.name ? findName(text) : null;
    await this.db.run(
      'UPDATE sessions SET email = COALESCE(email, ?), phone = COALESCE(phone, ?), name = COALESCE(name, ?) WHERE id = ?',
      email,
      phone,
      name,
      s.id,
    );
  }

  private async upsertLead(s: SessionRow) {
    if (!s.name && !s.email && !s.phone) return;
    const issue = (
      await this.db.all<{ content: string }>("SELECT content FROM messages WHERE session_id = ? AND role = 'user' ORDER BY id LIMIT 8", s.id)
    ).find((m) => !isGreeting(m.content))?.content;
    const status = s.name && s.email && s.phone ? 'complete' : 'partial';
    await this.db.run(
      `INSERT INTO leads (session_id, name, email, phone, issue, status) VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), email = VALUES(email), phone = VALUES(phone), status = VALUES(status)`,
      s.id,
      s.name,
      s.email,
      s.phone,
      (issue ?? '').slice(0, 500),
      status,
    );
  }

  private async generate(s: SessionRow, turn: Turn) {
    const history = (
      await this.db.all<{ role: 'user' | 'assistant'; content: string }>(
        'SELECT role, content FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 14',
        s.id,
      )
    ).reverse();
    const messages: ChatMsg[] = [
      { role: 'system', content: systemPrompt(s.persona) },
      ...history,
      { role: 'system', content: turnInstruction(turn) },
    ];

    const raw = await this.ai.complete(messages);
    const text = raw ? this.enforceQuestions(raw, turn) : '';
    if (text) return text;
    return turn.kind === 'answer' ? fallbackAnswer(history) : scriptedReply(turn);
  }

  /** Guarantees the reply asks exactly one question on ask turns and none on the others. */
  private enforceQuestions(text: string, turn: Turn) {
    if (turn.kind === 'close') {
      const sentences = text.match(/[^.!?]+[.!?]*/g) || [text];
      return sentences.filter((x) => !x.trim().endsWith('?')).join('').trim();
    }
    const first = text.indexOf('?');
    if (first === -1) return ''; // no question in the reply: use the scripted one instead
    return text.slice(0, first + 1).trim();
  }

  private async session(id: string) {
    const s = await this.db.get<SessionRow>('SELECT * FROM sessions WHERE id = ?', id);
    if (!s) throw new NotFoundException('Chat session not found');
    return s;
  }
}
