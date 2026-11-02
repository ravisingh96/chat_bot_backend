import { Injectable, Logger } from '@nestjs/common';
import { createConnection, createPool, Pool } from 'mysql2/promise';
import { config } from '../config';

type Param = string | number | null;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(190) NOT NULL UNIQUE,
    password_hash VARCHAR(100) NOT NULL,
    role ENUM('admin','manager') NOT NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id CHAR(36) PRIMARY KEY,
    persona VARCHAR(40) NOT NULL,
    name VARCHAR(120) NULL,
    email VARCHAR(190) NULL,
    phone VARCHAR(60) NULL,
    questions_asked INT NOT NULL DEFAULT 0,
    answers INT NOT NULL DEFAULT 0,
    pending_field VARCHAR(10) NULL,
    retried VARCHAR(40) NOT NULL DEFAULT '',
    skipped VARCHAR(40) NOT NULL DEFAULT '',
    message_count INT NOT NULL DEFAULT 0,
    page_url VARCHAR(300) NULL,
    ip VARCHAR(64) NULL,
    user_agent VARCHAR(300) NULL,
    started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_message_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_sessions_last (last_message_at)
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    session_id CHAR(36) NOT NULL,
    role ENUM('user','assistant') NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_messages_session (session_id, id),
    CONSTRAINT fk_messages_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS leads (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_id CHAR(36) NOT NULL UNIQUE,
    name VARCHAR(120) NULL,
    email VARCHAR(190) NULL,
    phone VARCHAR(60) NULL,
    issue VARCHAR(500) NULL,
    status ENUM('partial','complete') NOT NULL DEFAULT 'partial',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_leads_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  )`,
];

/** Thin MySQL wrapper. Every query waits for the connection and schema to be ready first. */
@Injectable()
export class DatabaseService {
  private readonly logger = new Logger(DatabaseService.name);
  private pool: Pool;
  private readonly ready: Promise<void>;

  constructor() {
    this.ready = this.init();
    this.ready.catch((e) => this.logger.error(`Database setup failed: ${e.message}`));
  }

  private async init() {
    const { host, port, user, password, name, ssl } = config.db;

    // Create the database when we are allowed to (local WAMP). Hosted databases usually already exist.
    try {
      const c = await createConnection({ host, port, user, password, ssl: ssl ? { rejectUnauthorized: true } : undefined });
      await c.query(`CREATE DATABASE IF NOT EXISTS \`${name.replace(/`/g, '')}\` CHARACTER SET utf8mb4`);
      await c.end();
    } catch (e) {
      this.logger.warn(`Skipped CREATE DATABASE: ${(e as Error).message}`);
    }

    this.pool = createPool({
      host,
      port,
      user,
      password,
      database: name,
      ssl: ssl ? { rejectUnauthorized: true } : undefined,
      waitForConnections: true,
      connectionLimit: config.isServerless ? 3 : 10,
      dateStrings: true, // timestamps come back as 'YYYY-MM-DD HH:MM:SS' strings
      charset: 'utf8mb4',
    });
    // All timestamps are stored and compared in UTC.
    this.pool.pool.on('connection', (c: any) => c.query("SET time_zone = '+00:00'"));

    for (const sql of SCHEMA) await this.pool.query(sql);
    this.logger.log(`MySQL ready (${host}:${port}/${name})`);
  }

  async all<T = any>(sql: string, ...params: Param[]): Promise<T[]> {
    await this.ready;
    const [rows] = await this.pool.query(sql, params);
    return rows as T[];
  }

  async get<T = any>(sql: string, ...params: Param[]): Promise<T | undefined> {
    return (await this.all<T>(sql, ...params))[0];
  }

  async run(sql: string, ...params: Param[]) {
    await this.ready;
    const [r]: any = await this.pool.query(sql, params);
    return { changes: Number(r.affectedRows), lastId: Number(r.insertId) };
  }

  async count(sql: string, ...params: Param[]) {
    const row = await this.get<{ n: number | string }>(sql, ...params);
    return Number(row?.n ?? 0);
  }
}
