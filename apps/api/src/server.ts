import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import fastifyStatic from '@fastify/static';
import { resolve } from 'node:path';
import { config, isProd } from './config.js';
import { sql } from './db/client.js';
import { HttpError } from './lib/errors.js';
import { authPlugin, cookieSecret } from './modules/auth/plugin.js';
import { authRoutes } from './modules/auth/routes.js';
import { storeRoutes } from './modules/store/routes.js';
import { adminRoutes } from './modules/admin/routes.js';
import { platformRoutes } from './platform/routes.js';

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL, ...(isProd ? {} : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }) },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 2 * 1024 * 1024,
    disableRequestLogging: isProd,
  });

  const origins = [config.PUBLIC_STORE_URL, config.PUBLIC_CONSOLE_URL, ...config.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)];
  await app.register(cors, { origin: (origin, cb) => cb(null, !origin || origins.includes(origin) || !isProd), credentials: true });
  await app.register(cookie, { secret: cookieSecret });
  await app.register(sensible);
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute', allowList: (req) => req.url.startsWith('/media/') });
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
  await app.register(fastifyStatic, { root: resolve(config.ASSETS_DIR), prefix: '/media/', decorateReply: false, cacheControl: true, maxAge: '7d', index: false });
  await app.register(authPlugin);

  // Raw body for webhooks (Razorpay/Meta signatures are computed over the exact bytes).
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as any).rawBody = body;
    if (!body || (typeof body === 'string' && body.length === 0)) return done(null, {});
    try { done(null, JSON.parse(body as string)); } catch (e) { const err = e as Error & { statusCode?: number }; err.statusCode = 400; done(err, undefined); }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: err.message, code: err.code, details: err.details });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, 'unhandled error');
    return reply.status(status).send({ error: status >= 500 ? 'Something went wrong' : (err as Error).message, code: (err as { code?: string }).code ?? 'error' });
  });

  app.get('/healthz', async () => ({ ok: true, role: config.ROLE, time: new Date().toISOString() }));
  app.get('/readyz', async () => { await sql`SELECT 1`; return { ok: true }; });

  // Embeddable widget + hosted assistant page (public).
  const { readFile } = await import('node:fs/promises');
  const widgetPath = resolve(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '..', 'public', 'widget.js');
  app.get('/widget.js', async (_req, reply) => {
    const js = await readFile(widgetPath, 'utf8').catch(() => readFile(resolve('public/widget.js'), 'utf8'));
    reply.header('Content-Type', 'application/javascript').header('Cache-Control', 'public, max-age=300');
    return reply.send(js);
  });
  app.get('/assistant/:channelKey', async (req, reply) => {
    const key = (req.params as { channelKey: string }).channelKey;
    reply.header('Content-Type', 'text/html');
    return reply.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Earthora Assistant</title><style>body{margin:0;height:100vh;background:linear-gradient(135deg,#1b3327,#0f1a13);font-family:system-ui}.h{position:absolute;top:0;left:0;right:0;text-align:center;color:#cfe0d4;padding:40px 20px}.h h1{font-family:Georgia,serif;font-weight:600}</style></head><body><div class="h"><h1>Earthora Farms Assistant</h1><p>Ask about our moringa products, your order, or anything else.</p></div><script src="/widget.js" data-channel="${key.replace(/[^a-zA-Z0-9_-]/g,'')}" data-api="" defer></script><script>window.addEventListener('load',function(){setTimeout(function(){document.querySelector('.ea-fab')&&document.querySelector('.ea-fab').click()},600)})</script></body></html>`);
  });

  await app.register(async (api) => {
    await api.register(authRoutes);
    await api.register(storeRoutes);
    await api.register(adminRoutes);
    await api.register(platformRoutes);
  }, { prefix: '/api' });

  return app;
}
