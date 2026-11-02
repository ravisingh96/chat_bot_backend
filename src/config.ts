import 'dotenv/config';

const num = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && value !== undefined && value !== '' ? n : fallback;
};

// DATABASE_URL (mysql://user:pass@host:3306/dbname) wins; otherwise the DB_* parts are used.
function database() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: Number(u.port) || 3306,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      name: u.pathname.replace(/^\//, ''),
    };
  }
  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: num(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    name: process.env.DB_NAME || 'chatbot',
  };
}

export const config = {
  port: num(process.env.PORT, 3001),
  isServerless: !!process.env.VERCEL,
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  db: { ...database(), ssl: process.env.DB_SSL === 'true' },
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me',
  seedAdminEmail: process.env.SEED_ADMIN_EMAIL || 'admin@askanythinganswers.com',
  seedAdminPassword: process.env.SEED_ADMIN_PASSWORD || '',
  openaiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4.1-nano',
  // Customer messages answered (each with one follow-up question) before name, email and phone are asked for.
  answerTurns: num(process.env.ANSWER_TURNS, 4),
  maxUserWords: num(process.env.MAX_USER_WORDS, 50),
  delayMinMs: num(process.env.REPLY_DELAY_MIN_MS, 2000),
  delayMaxMs: num(process.env.REPLY_DELAY_MAX_MS, 3000),
  maxMessagesPerSession: 80,
};
