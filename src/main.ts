import { Logger } from '@nestjs/common';
import { join } from 'node:path';
import { createApp } from './app';
import { config } from './config';

async function bootstrap() {
  const app = await createApp();

  // Admin panel is a static page served from /admin (on Vercel the CDN serves public/ instead)
  app.useStaticAssets(join(__dirname, '..', 'public', 'admin'), { prefix: '/admin' });

  // Hidden sign-up page: same SPA, it shows the register form when the path is /register. No link points here.
  app.getHttpAdapter().get('/register', (_req: any, res: any) => res.sendFile(join(__dirname, '..', 'public', 'admin', 'index.html')));

  await app.listen(config.port);
  const log = new Logger('Bootstrap');
  log.log(`API      http://localhost:${config.port}/api`);
  log.log(`Admin    http://localhost:${config.port}/admin`);
  log.log(config.openaiKey ? `AI       OpenAI ${config.openaiModel}` : 'AI       no OPENAI_API_KEY set, using built-in replies');
}
bootstrap();
