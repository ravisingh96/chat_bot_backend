# AskAnythingAnswers chat server (NestJS + MySQL)

Chat API, lead capture and admin panel. Data lives in MySQL (tables are created automatically on first start).

## Run locally

```bash
cd server
npm install
cp .env.example .env      # set JWT_SECRET, SEED_ADMIN_PASSWORD, OPENAI_API_KEY and the DB_* values
npm run build
npm start                 # or: npm run start:dev  (watch mode)
```

- API: http://localhost:3001/api
- Admin panel: http://localhost:3001/admin
- Local database defaults to WAMP's MySQL (`root`, no password, database `chatbot`, created automatically).
- The React site proxies `/api` to this server in dev (`npm run dev` in the project root).

The first admin is created from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` when the users table is empty.

## Deploy on Vercel

Two Vercel projects: the React site (project root) and this server (`server/` as the root directory).
Vercel cannot reach a MySQL on your own PC, so the server needs a MySQL that is reachable from the internet.

Environment variables for the server project:

| Name | Value |
|---|---|
| `DATABASE_URL` | `mysql://user:password@host:3306/dbname` |
| `DB_SSL` | `true` if the host requires TLS |
| `JWT_SECRET` | long random string |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | first admin login (required on Vercel) |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | OpenAI key and model (default `gpt-4.1-nano`) |
| `CORS_ORIGINS` | the React site's URL |

The React project's `vercel.json` forwards `/api/*` and `/admin` to the server project, so the site, the chat and
the admin panel all work from one domain.

## Roles

| | Admin | Manager |
|---|---|---|
| View chats, transcripts, leads | yes | yes |
| Download leads CSV | yes | yes |
| Delete chats / leads | yes | no |
| Create users, change roles, reset passwords, disable | yes | no |

## Chat behaviour

- Each visitor gets a random persona name ("Michael C."). The reply is delayed 2-3 seconds (`REPLY_DELAY_*`).
- A plain "hello" gets a greeting back. The next 4 messages (`ANSWER_TURNS`) each get a proper answer plus one follow-up
  question that depends on what the customer said (model, error message, connection...). After that the bot asks for
  name, email and phone, one per reply. Details the customer already gave are not asked again, and a field that fails
  twice is skipped.
- A lead is saved as soon as any contact detail is captured (status `partial`), and becomes `complete` when
  name, email and phone are all present.
- A user message over 50 words (`MAX_USER_WORDS`) gets a generic "please send the short version" reply, no AI call.
- With no valid `OPENAI_API_KEY` the bot uses a built-in rule-based fallback; with a key it uses `OPENAI_MODEL`
  and the system prompt in `src/chat/prompt.ts`.
