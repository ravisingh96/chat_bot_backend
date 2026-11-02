import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

const iso = (s: string | null) => (s ? s.replace(' ', 'T') + 'Z' : null);
// '|' is the LIKE escape character (see "ESCAPE '|'" below).
const like = (s: string) => `%${s.replace(/[|%_]/g, (c) => '|' + c)}%`;
const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

export interface LeadFilters {
  search?: string;
  status?: string;
  from?: string;
  to?: string;
}

@Injectable()
export class AdminService {
  constructor(private readonly db: DatabaseService) {}

  async stats() {
    const [totalChats, chatsToday, totalLeads, completeLeads, leadsToday] = await Promise.all([
      this.db.count('SELECT COUNT(*) AS n FROM sessions WHERE message_count > 0'),
      this.db.count('SELECT COUNT(*) AS n FROM sessions WHERE message_count > 0 AND DATE(started_at) = UTC_DATE()'),
      this.db.count('SELECT COUNT(*) AS n FROM leads'),
      this.db.count("SELECT COUNT(*) AS n FROM leads WHERE status = 'complete'"),
      this.db.count('SELECT COUNT(*) AS n FROM leads WHERE DATE(created_at) = UTC_DATE()'),
    ]);
    return {
      totalChats,
      chatsToday,
      totalLeads,
      completeLeads,
      leadsToday,
      conversionRate: totalChats ? Math.round((totalLeads / totalChats) * 1000) / 10 : 0,
    };
  }

  async listChats(q: { search?: string; lead?: string; page?: string; limit?: string }) {
    const where: string[] = ['s.message_count > 0'];
    const params: (string | number)[] = [];
    if (q.search?.trim()) {
      const p = like(q.search.trim());
      where.push(`(s.persona LIKE ? ESCAPE '|' OR s.name LIKE ? ESCAPE '|' OR s.email LIKE ? ESCAPE '|' OR s.phone LIKE ? ESCAPE '|'
        OR EXISTS (SELECT 1 FROM messages m WHERE m.session_id = s.id AND m.content LIKE ? ESCAPE '|'))`);
      params.push(p, p, p, p, p);
    }
    if (q.lead === '1') where.push('EXISTS (SELECT 1 FROM leads l WHERE l.session_id = s.id)');
    const limit = clampInt(q.limit, 1, 100, 25);
    const page = clampInt(q.page, 1, 100000, 1);
    const w = where.join(' AND ');

    const total = await this.db.count(`SELECT COUNT(*) AS n FROM sessions s WHERE ${w}`, ...params);
    const rows = await this.db.all<any>(
      `SELECT s.id, s.persona, s.name, s.email, s.phone, s.message_count, s.questions_asked, s.started_at, s.last_message_at,
         (SELECT content FROM messages m WHERE m.session_id = s.id AND m.role = 'user' ORDER BY m.id LIMIT 1) AS preview,
         (SELECT status FROM leads l WHERE l.session_id = s.id) AS lead_status
       FROM sessions s WHERE ${w} ORDER BY s.last_message_at DESC LIMIT ? OFFSET ?`,
      ...params,
      limit,
      (page - 1) * limit,
    );
    return {
      total,
      page,
      limit,
      items: rows.map((r) => ({
        id: r.id,
        persona: r.persona,
        name: r.name,
        email: r.email,
        phone: r.phone,
        exchanges: r.message_count,
        questionsAsked: r.questions_asked,
        preview: (r.preview ?? '').slice(0, 140),
        leadStatus: r.lead_status,
        startedAt: iso(r.started_at),
        lastMessageAt: iso(r.last_message_at),
      })),
    };
  }

  async chat(id: string) {
    const s = await this.db.get<any>('SELECT * FROM sessions WHERE id = ?', id);
    if (!s) throw new NotFoundException('Chat not found');
    const messages = await this.db.all<any>('SELECT role, content, created_at FROM messages WHERE session_id = ? ORDER BY id', id);
    const lead = await this.db.get<any>('SELECT * FROM leads WHERE session_id = ?', id);
    return {
      id: s.id,
      persona: s.persona,
      name: s.name,
      email: s.email,
      phone: s.phone,
      questionsAsked: s.questions_asked,
      pageUrl: s.page_url,
      ip: s.ip,
      userAgent: s.user_agent,
      startedAt: iso(s.started_at),
      lastMessageAt: iso(s.last_message_at),
      lead: lead ? this.leadOut(lead) : null,
      messages: messages.map((m) => ({ role: m.role, content: m.content, at: iso(m.created_at) })),
    };
  }

  async deleteChat(id: string) {
    if (!(await this.db.run('DELETE FROM sessions WHERE id = ?', id)).changes) throw new NotFoundException('Chat not found');
    return { ok: true };
  }

  private leadWhere(f: LeadFilters) {
    const where: string[] = ['1=1'];
    const params: string[] = [];
    if (f.search?.trim()) {
      const p = like(f.search.trim());
      where.push(`(l.name LIKE ? ESCAPE '|' OR l.email LIKE ? ESCAPE '|' OR l.phone LIKE ? ESCAPE '|' OR l.issue LIKE ? ESCAPE '|')`);
      params.push(p, p, p, p);
    }
    if (f.status === 'complete' || f.status === 'partial') {
      where.push('l.status = ?');
      params.push(f.status);
    }
    if (isDate(f.from)) {
      where.push('DATE(l.created_at) >= ?');
      params.push(f.from);
    }
    if (isDate(f.to)) {
      where.push('DATE(l.created_at) <= ?');
      params.push(f.to);
    }
    return { sql: where.join(' AND '), params };
  }

  private leadOut(r: any) {
    return {
      id: r.id,
      chatId: r.session_id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      issue: r.issue,
      status: r.status,
      persona: r.persona,
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
    };
  }

  async listLeads(f: LeadFilters & { page?: string; limit?: string }) {
    const { sql, params } = this.leadWhere(f);
    const limit = clampInt(f.limit, 1, 100, 25);
    const page = clampInt(f.page, 1, 100000, 1);
    const total = await this.db.count(`SELECT COUNT(*) AS n FROM leads l WHERE ${sql}`, ...params);
    const rows = await this.db.all<any>(
      `SELECT l.*, s.persona FROM leads l JOIN sessions s ON s.id = l.session_id
       WHERE ${sql} ORDER BY l.id DESC LIMIT ? OFFSET ?`,
      ...params,
      limit,
      (page - 1) * limit,
    );
    return { total, page, limit, items: rows.map((r) => this.leadOut(r)) };
  }

  async deleteLead(id: number) {
    if (!(await this.db.run('DELETE FROM leads WHERE id = ?', id)).changes) throw new NotFoundException('Lead not found');
    return { ok: true };
  }

  async exportLeadsCsv(f: LeadFilters) {
    const { sql, params } = this.leadWhere(f);
    const rows = await this.db.all<any>(
      `SELECT l.*, s.persona FROM leads l JOIN sessions s ON s.id = l.session_id WHERE ${sql} ORDER BY l.id DESC`,
      ...params,
    );
    // Cells starting with = + - @ are prefixed so spreadsheets do not run them as formulas.
    const cell = (v: unknown) => {
      let s = v == null ? '' : String(v).replace(/\r?\n/g, ' ');
      // Plain phone numbers like "+1 415 555 0132" are left alone.
      if (/^[=+\-@\t\r]/.test(s) && !/^\+[\d\s().-]+$/.test(s)) s = "'" + s;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const header = ['Lead ID', 'Name', 'Email', 'Phone', 'Status', 'Issue', 'Agent persona', 'Chat ID', 'Created (UTC)'];
    const lines = [header.map(cell).join(',')];
    for (const r of rows) {
      lines.push([r.id, r.name, r.email, r.phone, r.status, r.issue, r.persona, r.session_id, r.created_at].map(cell).join(','));
    }
    return '﻿' + lines.join('\r\n') + '\r\n';
  }
}
