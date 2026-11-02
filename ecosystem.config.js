// PM2 process file: `npm ci && npm run build && pm2 start ecosystem.config.js`
// Secrets (DB_*, JWT_SECRET, OPENAI_API_KEY, ...) come from server/.env, not from this file.
module.exports = {
  apps: [
    {
      name: 'chatbot-api',
      script: 'dist/main.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
    },
  ],
};
