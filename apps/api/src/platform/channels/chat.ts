import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomToken } from '../../lib/crypto.js';
import { sql } from '../../db/client.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { getChannelByKey, publishedConfig } from './config.js';
import { loadConversation, appendMessage, saveState } from '../engine/conversation.js';
import { runTurn, type PersonaConfig } from '../engine/engine.js';
import { tenantId } from '../kb/ingest.js';

const sendSchema = z.object({ channelKey: z.string(), conversationId: z.string().nullish(), message: z.string().min(1).max(2000), contact: z.object({ phone: z.string().optional(), email: z.string().optional(), name: z.string().optional() }).optional() });

/** Public chat endpoints for the hosted page and embeddable widget. Streams the reply over SSE. */
export async function chatChannelRoutes(app: FastifyInstance): Promise<void> {
  app.get('/platform/chat/:channelKey/config', async (req) => {
    const ch = await getChannelByKey((req.params as any).channelKey);
    if (!ch || ch.type !== 'chat') throw notFound('Channel not found');
    const cfg = publishedConfig(ch);
    return {
      name: cfg.name || 'Earthora Assistant',
      greeting: cfg.greeting || 'Hi! How can I help you today?',
      starters: cfg.starters || ['Recommend a product for me', 'What are moringa benefits?', 'Where is my order?'],
      appearance: cfg.appearance || {},
    };
  });

  app.post('/platform/chat/:channelKey/session', async (req) => {
    const ch = await getChannelByKey((req.params as any).channelKey);
    if (!ch || ch.type !== 'chat') throw notFound('Channel not found');
    return { conversationId: `web_${randomToken(12)}` };
  });

  app.post('/platform/chat/send', async (req, reply) => {
    const body = sendSchema.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid message');
    const ch = await getChannelByKey(body.data.channelKey);
    if (!ch || ch.type !== 'chat' || !ch.enabled) throw notFound('Channel not available');
    const cfg = publishedConfig(ch);
    const external = body.data.conversationId || `web_${randomToken(12)}`;
    const tid = await tenantId();
    const conv = await loadConversation({ tenantId: tid, channelType: 'chat', externalId: external, channelId: ch.id, contact: body.data.contact });

    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const send = (event: string, data: unknown) => reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send('meta', { conversationId: conv.id });

    const t0 = Date.now();
    try {
      const persona: PersonaConfig = { ...(cfg.persona || {}), name: cfg.name, channel: 'chat' };
      await appendMessage(conv.id, 'user', body.data.message);
      const result = await runTurn({ tenantId: tid, conversationId: conv.id, channelType: 'chat', message: body.data.message, state: conv.state, contact: conv.contact, history: conv.history, persona });
      // stream the (already-generated) reply word-by-word for a live feel
      for (const word of result.reply.split(/(\s+)/)) { send('delta', { text: word }); await new Promise((r) => setTimeout(r, 8)); }
      await appendMessage(conv.id, 'assistant', result.reply, { latencyMs: Date.now() - t0, toolCalls: result.toolCalls });
      await saveState(conv.id, result.state);
      send('done', { reply: result.reply, workflow: result.workflow, sources: result.sources, conversationId: conv.id });
    } catch (err) {
      req.log.error({ err }, 'chat turn failed');
      send('error', { message: 'Something went wrong. Please try again.' });
    }
    reply.raw.end();
  });

  app.post('/platform/chat/feedback', async (req) => {
    const body = z.object({ conversationId: z.string().uuid(), rating: z.number().min(1).max(5) }).safeParse(req.body);
    if (!body.success) throw badRequest('Invalid feedback');
    await sql`UPDATE conversations SET rating = ${body.data.rating} WHERE id = ${body.data.conversationId}`;
    return { ok: true };
  });
}
