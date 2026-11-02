import { createApp } from './app';

// The Nest app is built once per warm function instance and reused for later requests.
let handler: ((req: any, res: any) => void) | undefined;

export default async function (req: any, res: any) {
  if (!handler) {
    const app = await createApp();
    await app.init();
    handler = app.getHttpAdapter().getInstance();
  }
  return handler!(req, res);
}
