import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db/client.js';
import { badRequest, notFound } from '../lib/errors.js';
import { randomToken } from '../lib/crypto.js';
import { storeAsset } from '../lib/assets.js';
import { enqueueJob } from '../modules/jobs/queue.js';
import { providerStatus } from './providers/index.js';
import { retrieve } from './kb/retrieve.js';
import { tenantId } from './kb/ingest.js';
import { KB_PAGES_JOB, KB_SYNC_JOB, KB_WEBSITE_JOB, dueSyncs, enqueueKbSync, enqueuePagesSync, enqueueWebsiteIndex, readAutoSync, syncActivity, writeAutoSync } from './kb/sync.js';
import { publishChannel } from './channels/config.js';
import { getLlm, getEmbedding } from './providers/index.js';

/** Console API for the five modules. All under /api/platform, staff-gated. */
export async function platformAdminRoutes(app: FastifyInstance): Promise<void> {
  const staff = { preHandler: app.requireStaff('admin', 'developer') };

  app.get('/platform/status', staff, async () => {
    const tid = await tenantId();
    const [counts] = await sql<any[]>`SELECT
      (SELECT count(*) FROM kb_documents WHERE tenant_id=${tid} AND status='indexed') AS documents,
      (SELECT count(*) FROM kb_chunks WHERE tenant_id=${tid}) AS chunks,
      (SELECT count(*) FROM workflows WHERE tenant_id=${tid} AND status='published') AS workflows,
      (SELECT count(*) FROM functions WHERE tenant_id=${tid} AND enabled) AS functions,
      (SELECT count(*) FROM channels WHERE tenant_id=${tid}) AS channels,
      (SELECT count(*) FROM conversations WHERE tenant_id=${tid}) AS conversations,
      (SELECT count(*) FROM escalations WHERE tenant_id=${tid} AND status='open') AS open_escalations`;
    return { providers: providerStatus(), counts };
  });

  // ── Knowledgebase ──────────────────────────────────────────────────────────
  app.get('/platform/kb/collections', staff, async () => ({ collections: await sql`SELECT * FROM kb_collections WHERE tenant_id = ${await tenantId()} ORDER BY name` }));
  app.post('/platform/kb/collections', staff, async (req) => {
    const b = z.object({ slug: z.string().regex(/^[a-z0-9-]+$/), name: z.string().min(1), description: z.string().optional(), authority: z.number().min(1).max(5).optional(), visibility: z.enum(['public', 'internal']).optional() }).parse(req.body);
    const [c] = await sql`INSERT INTO kb_collections (tenant_id, slug, name, description, authority, visibility) VALUES (${await tenantId()}, ${b.slug}, ${b.name}, ${b.description ?? ''}, ${b.authority ?? 3}, ${b.visibility ?? 'public'}) ON CONFLICT (tenant_id, slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description RETURNING *`;
    return { collection: c };
  });

  app.get('/platform/kb/documents', staff, async (req) => {
    const q = (req.query as any).collection;
    const rows = q
      ? await sql`SELECT d.*, (SELECT count(*) FROM kb_chunks c WHERE c.document_id = d.id) AS chunk_count FROM kb_documents d WHERE d.tenant_id = ${await tenantId()} AND d.collection_id = ${q} ORDER BY d.updated_at DESC`
      : await sql`SELECT d.*, (SELECT count(*) FROM kb_chunks c WHERE c.document_id = d.id) AS chunk_count FROM kb_documents d WHERE d.tenant_id = ${await tenantId()} ORDER BY d.updated_at DESC LIMIT 200`;
    return { documents: rows };
  });
  app.patch('/platform/kb/documents/:id', staff, async (req) => {
    const b = z.object({ collection_id: z.string().uuid().nullable().optional(), tags: z.array(z.string()).optional(), workflow_ids: z.array(z.string().uuid()).optional(), status: z.enum(['draft', 'indexed', 'disabled']).optional(), authority: z.number().optional(), visibility: z.enum(['public', 'internal']).optional() }).parse(req.body);
    const id = (req.params as any).id;
    if (b.collection_id !== undefined) await sql`UPDATE kb_documents SET collection_id = ${b.collection_id} WHERE id = ${id}`;
    if (b.tags) await sql`UPDATE kb_documents SET tags = ${b.tags} WHERE id = ${id}`;
    if (b.workflow_ids) await sql`UPDATE kb_documents SET workflow_ids = ${b.workflow_ids as any} WHERE id = ${id}`;
    if (b.status) await sql`UPDATE kb_documents SET status = ${b.status} WHERE id = ${id}`;
    if (b.authority) await sql`UPDATE kb_documents SET authority = ${b.authority} WHERE id = ${id}`;
    if (b.visibility) await sql`UPDATE kb_documents SET visibility = ${b.visibility} WHERE id = ${id}`;
    return { ok: true };
  });
  app.delete('/platform/kb/documents/:id', staff, async (req) => { await sql`DELETE FROM kb_documents WHERE id = ${(req.params as any).id}`; return { ok: true }; });

  app.post('/platform/kb/upload', staff, async (req) => {
    const file = await req.file({ limits: { fileSize: 25 * 1024 * 1024 } });
    if (!file) throw badRequest('No file');
    const fields = Object.fromEntries(Object.entries(file.fields).map(([k, v]) => [k, (v as any)?.value]));
    const bytes = await file.toBuffer();
    const asset = await storeAsset({ kind: 'kb_file', folder: 'uploads', filename: file.filename, mime: file.mimetype, bytes });
    const job = await enqueueJob('kb_ingest_file', { assetKey: asset.key, filename: file.filename, mime: file.mimetype, collectionId: fields.collectionId || null, tags: fields.tags ? String(fields.tags).split(',').map((s) => s.trim()) : [] });
    return { ok: true, jobId: job, asset: { name: file.filename } };
  });

  app.get('/platform/kb/sources', staff, async () => ({ sources: await sql`SELECT * FROM kb_sources WHERE tenant_id = ${await tenantId()} ORDER BY created_at DESC` }));
  app.post('/platform/kb/sources', staff, async (req) => {
    const b = z.object({ type: z.enum(['website', 'db_sync']), name: z.string(), config: z.record(z.unknown()).optional(), collectionId: z.string().uuid().nullable().optional() }).parse(req.body);
    const [s] = await sql`INSERT INTO kb_sources (tenant_id, collection_id, type, name, config) VALUES (${await tenantId()}, ${b.collectionId ?? null}, ${b.type}, ${b.name}, ${sql.json((b.config ?? {}) as any)}) RETURNING *`;
    return { source: s };
  });
  app.post('/platform/kb/sources/:id/reindex', staff, async (req) => {
    const [s] = await sql<any[]>`SELECT * FROM kb_sources WHERE id = ${(req.params as any).id}`;
    if (!s) throw notFound('Source not found');
    const job = await enqueueJob('kb_reindex_source', { sourceId: s.id }, { dedupeKey: `kb-reindex:${s.id}:${Date.now()}` });
    return { ok: true, jobId: job };
  });
  /** Automatic sync: what the worker keeps current on its own, and a way to run everything now. */
  app.get('/platform/kb/auto-sync', staff, async () => {
    const settings = await readAutoSync();
    const { lastRuns, pending } = await syncActivity();
    const iso = (kind: string) => (lastRuns[kind] ? new Date(lastRuns[kind] as number).toISOString() : null);
    return { settings, last_runs: { products: iso(KB_SYNC_JOB), pages: iso(KB_PAGES_JOB), website: iso(KB_WEBSITE_JOB) },
             due_now: dueSyncs(settings, lastRuns), pending };
  });
  app.put('/platform/kb/auto-sync', staff, async (req) => {
    const b = z.object({ enabled: z.boolean().optional(), products_every_minutes: z.number().optional(), pages_every_hours: z.number().optional(),
      website_crawl_enabled: z.boolean().optional(), website_crawl_every_hours: z.number().optional() }).parse(req.body ?? {});
    const current = await readAutoSync();
    return { settings: await writeAutoSync({ ...current, ...b }) };
  });
  app.post('/platform/kb/sync-now', staff, async (req) => {
    const b = z.object({ website: z.boolean().optional() }).parse(req.body ?? {});
    const jobs: Record<string, string | null> = { products: await enqueueKbSync('console'), pages: await enqueuePagesSync('console') };
    if (b.website) jobs.website = await enqueueWebsiteIndex('console');
    return { ok: true, jobs };
  });
  /** One-click: index the whole website + sync product docs (works even with no uploaded files). */
  app.post('/platform/kb/index-website', staff, async (req) => {
    const b = z.object({ url: z.string().url().optional(), maxPages: z.number().optional() }).parse(req.body ?? {});
    const job = await enqueueJob('kb_index_website', { url: b.url, maxPages: b.maxPages ?? 40 }, { dedupeKey: `kb-website:${Date.now()}` });
    return { ok: true, jobId: job };
  });

  app.post('/platform/kb/ingest-text', staff, async (req) => {
    const b = z.object({ title: z.string().min(1), text: z.string().min(20), uri: z.string().optional(), collection: z.string().optional(), tags: z.array(z.string()).optional(), workflowSlugs: z.array(z.string()).optional() }).parse(req.body);
    const tid = await tenantId();
    let collectionId: string | null = null;
    if (b.collection) { const [c] = await sql<any[]>`INSERT INTO kb_collections (tenant_id, slug, name) VALUES (${tid}, ${b.collection}, ${b.collection}) ON CONFLICT (tenant_id, slug) DO UPDATE SET name = kb_collections.name RETURNING id`; collectionId = c.id; }
    let workflowIds: string[] = [];
    if (b.workflowSlugs?.length) { const rows = await sql<any[]>`SELECT id FROM workflows WHERE tenant_id = ${tid} AND slug = ANY(${b.workflowSlugs})`; workflowIds = rows.map((r) => r.id); }
    const { indexDocument } = await import('./kb/ingest.js');
    const r = await indexDocument({ sourceId: null, collectionId, title: b.title, uri: b.uri, mime: 'text/plain', text: b.text, tags: b.tags, workflowIds });
    return { ok: true, ...r };
  });

  app.post('/platform/kb/test-retrieval', staff, async (req) => {
    const b = z.object({ query: z.string().min(1), workflowId: z.string().uuid().optional(), collections: z.array(z.string()).optional(), topK: z.number().optional() }).parse(req.body);
    const hits = await retrieve(b.query, { workflowId: b.workflowId, collections: b.collections, topK: b.topK ?? 8, includeInternal: true });
    return { hits: hits.map((h) => ({ title: h.documentTitle, uri: h.uri, score: Number(h.score.toFixed(4)), vector: Number(h.vectorScore.toFixed(4)), keyword: Number(h.keywordScore.toFixed(4)), snippet: h.content.slice(0, 400) })) };
  });

  // ── Workflows ──────────────────────────────────────────────────────────────
  app.get('/platform/workflows', staff, async () => ({ workflows: await sql`SELECT id, slug, name, description, mode, status, priority, is_fallback, version, updated_at FROM workflows WHERE tenant_id = ${await tenantId()} ORDER BY priority, name` }));
  app.get('/platform/workflows/:id', staff, async (req) => {
    const [w] = await sql<any[]>`SELECT * FROM workflows WHERE id = ${(req.params as any).id}`;
    if (!w) throw notFound('Workflow not found');
    const examples = await sql`SELECT id, text, kind FROM workflow_examples WHERE workflow_id = ${w.id} ORDER BY kind, text`;
    return { workflow: w, examples };
  });
  app.post('/platform/workflows', staff, async (req) => {
    const b = z.object({ slug: z.string().regex(/^[a-z0-9-]+$/), name: z.string(), description: z.string().optional(), mode: z.enum(['playbook', 'stepped']).optional() }).parse(req.body);
    const [w] = await sql`INSERT INTO workflows (tenant_id, slug, name, description, mode) VALUES (${await tenantId()}, ${b.slug}, ${b.name}, ${b.description ?? ''}, ${b.mode ?? 'playbook'}) ON CONFLICT (tenant_id, slug) DO UPDATE SET name = EXCLUDED.name RETURNING *`;
    return { workflow: w };
  });
  app.patch('/platform/workflows/:id', staff, async (req) => {
    const b = z.object({ name: z.string().optional(), description: z.string().optional(), mode: z.enum(['playbook', 'stepped']).optional(), priority: z.number().optional(), definition: z.record(z.unknown()).optional() }).parse(req.body);
    const id = (req.params as any).id;
    if (b.name !== undefined) await sql`UPDATE workflows SET name = ${b.name} WHERE id = ${id}`;
    if (b.description !== undefined) await sql`UPDATE workflows SET description = ${b.description} WHERE id = ${id}`;
    if (b.mode) await sql`UPDATE workflows SET mode = ${b.mode} WHERE id = ${id}`;
    if (b.priority !== undefined) await sql`UPDATE workflows SET priority = ${b.priority} WHERE id = ${id}`;
    if (b.definition) await sql`UPDATE workflows SET definition = ${sql.json(b.definition as any)} WHERE id = ${id}`;
    await sql`UPDATE workflows SET updated_at = now() WHERE id = ${id}`;
    return { ok: true };
  });
  app.post('/platform/workflows/:id/publish', staff, async (req) => {
    const id = (req.params as any).id;
    await sql`UPDATE workflows SET status = 'published', published_definition = definition, version = version + 1, updated_at = now() WHERE id = ${id}`;
    // (re)embed example utterances
    await enqueueJob('workflow_embed_examples', { workflowId: id }, { dedupeKey: `wf-embed:${id}:${Date.now()}` });
    return { ok: true };
  });
  app.post('/platform/workflows/:id/examples', staff, async (req) => {
    const b = z.object({ text: z.string().min(2), kind: z.enum(['positive', 'negative']).optional() }).parse(req.body);
    const id = (req.params as any).id;
    const [e] = await sql`INSERT INTO workflow_examples (tenant_id, workflow_id, text, kind) VALUES (${await tenantId()}, ${id}, ${b.text}, ${b.kind ?? 'positive'}) RETURNING *`;
    await enqueueJob('workflow_embed_examples', { workflowId: id }, { dedupeKey: `wf-embed:${id}:${Date.now()}` });
    return { example: e };
  });
  app.delete('/platform/workflows/:id/examples/:exId', staff, async (req) => { await sql`DELETE FROM workflow_examples WHERE id = ${(req.params as any).exId}`; return { ok: true }; });

  /** AI-assisted authoring: describe a scenario → draft a workflow definition. */
  app.post('/platform/workflows/draft', staff, async (req) => {
    const b = z.object({ description: z.string().min(4) }).parse(req.body);
    const sys = `You design workflow definitions for the Earthora Farms assistant. Given a scenario description, output a JSON workflow definition with keys: name, slug (kebab), mode ("playbook" or "stepped"), description (when to use), triggers {examples:[5 short customer utterances], negatives:[2]}, slots:[{key,type,required,question:{en,hi,gu}}], retrieval:{enabled,tags,top_k}, tools:[{function}], prompt:{objective, playbook:[steps], style}, outcomes:[{name,action}]. Only use these function names: list_products, get_product_details, search_knowledge, add_to_cart, update_cart, get_cart, create_checkout_link, get_order_status, capture_callback, set_customer_detail. Do not invent business policies. Reply with JSON only.`;
    const res = await getLlm().chat([{ role: 'system', content: sys }, { role: 'user', content: b.description }], { json: true, temperature: 0.3, maxTokens: 1200 });
    let draft: any = {}; try { draft = JSON.parse(res.text); } catch { throw badRequest('Could not draft — try rephrasing.'); }
    return { draft };
  });

  // ── Functions ──────────────────────────────────────────────────────────────
  app.get('/platform/functions', staff, async () => ({ functions: await sql`SELECT * FROM functions WHERE tenant_id = ${await tenantId()} ORDER BY name` }));
  app.patch('/platform/functions/:id', staff, async (req) => {
    const b = z.object({ description: z.string().optional(), enabled: z.boolean().optional(), requires_confirmation: z.boolean().optional(), allowed_channels: z.array(z.string()).optional() }).parse(req.body);
    const id = (req.params as any).id;
    if (b.description !== undefined) await sql`UPDATE functions SET description = ${b.description} WHERE id = ${id}`;
    if (b.enabled !== undefined) await sql`UPDATE functions SET enabled = ${b.enabled} WHERE id = ${id}`;
    if (b.requires_confirmation !== undefined) await sql`UPDATE functions SET requires_confirmation = ${b.requires_confirmation} WHERE id = ${id}`;
    if (b.allowed_channels) await sql`UPDATE functions SET allowed_channels = ${b.allowed_channels} WHERE id = ${id}`;
    return { ok: true };
  });

  // ── Channels ───────────────────────────────────────────────────────────────
  app.get('/platform/channels', staff, async () => ({ channels: await sql`SELECT id, type, slug, name, public_key, enabled, version, published_at, draft_config, published_config FROM channels WHERE tenant_id = ${await tenantId()} AND type = 'chat' ORDER BY type` }));
  app.patch('/platform/channels/:id', staff, async (req) => {
    const b = z.object({ name: z.string().optional(), enabled: z.boolean().optional(), draft_config: z.record(z.unknown()).optional() }).parse(req.body);
    const id = (req.params as any).id;
    if (b.name !== undefined) await sql`UPDATE channels SET name = ${b.name} WHERE id = ${id}`;
    if (b.enabled !== undefined) await sql`UPDATE channels SET enabled = ${b.enabled} WHERE id = ${id}`;
    if (b.draft_config) await sql`UPDATE channels SET draft_config = ${sql.json(b.draft_config as any)}, updated_at = now() WHERE id = ${id}`;
    return { ok: true };
  });
  app.post('/platform/channels/:id/publish', staff, async (req) => { await publishChannel((req.params as any).id, req.staff!.email); return { ok: true }; });

  // ── Dashboard / Conversations / Escalations ─────────────────────────────────
  app.get('/platform/dashboard', staff, async () => {
    const tid = await tenantId();
    const [kpi] = await sql<any[]>`SELECT
      (SELECT count(*) FROM conversations WHERE tenant_id=${tid}) AS conversations,
      (SELECT count(*) FROM conversations WHERE tenant_id=${tid} AND escalated) AS escalated,
      (SELECT count(*) FROM conversations WHERE tenant_id=${tid} AND needs_follow_up) AS follow_ups,
      (SELECT round(avg(rating),2) FROM conversations WHERE tenant_id=${tid} AND rating IS NOT NULL) AS avg_rating,
      (SELECT count(*) FROM escalations WHERE tenant_id=${tid} AND status='open') AS open_escalations`;
    const byWorkflow = await sql`SELECT routed_workflow, count(*) AS n, round(avg(router_confidence),2) AS conf FROM turn_traces tt JOIN conversations c ON c.id = tt.conversation_id WHERE c.tenant_id=${tid} GROUP BY routed_workflow ORDER BY n DESC LIMIT 10`;
    const recent = await sql`SELECT id, channel_type, status, language, rating, escalated, started_at, (SELECT content FROM messages m WHERE m.conversation_id=c.id AND role='user' ORDER BY seq LIMIT 1) AS first_message FROM conversations c WHERE tenant_id=${tid} ORDER BY started_at DESC LIMIT 20`;
    return { kpi, byWorkflow, recent };
  });
  app.get('/platform/conversations/:id', staff, async (req) => {
    const id = (req.params as any).id;
    const [conv] = await sql<any[]>`SELECT * FROM conversations WHERE id = ${id}`;
    if (!conv) throw notFound('Conversation not found');
    const messages = await sql`SELECT role, content, tool_calls, created_at FROM messages WHERE conversation_id = ${id} ORDER BY seq`;
    const traces = await sql`SELECT routed_workflow, router_confidence, router_reason, retrieval, timings, created_at FROM turn_traces WHERE conversation_id = ${id} ORDER BY created_at`;
    return { conversation: conv, messages, traces };
  });
  app.get('/platform/escalations', staff, async () => ({ escalations: await sql`SELECT * FROM escalations WHERE tenant_id = ${await tenantId()} ORDER BY status, created_at DESC LIMIT 100` }));
  app.post('/platform/escalations/:id/resolve', staff, async (req) => {
    await sql`UPDATE escalations SET status = 'resolved', resolved_at = now(), notes = ${(req.body as any)?.notes ?? null} WHERE id = ${(req.params as any).id}`;
    return { ok: true };
  });

  app.get('/platform/jobs', staff, async () => ({ jobs: await sql`SELECT id, kind, status, attempts, last_error, created_at, finished_at FROM jobs ORDER BY created_at DESC LIMIT 50` }));
}
