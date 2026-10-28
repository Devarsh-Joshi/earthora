import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { sql } from '../db/client.js';
import { localAssetPath } from '../lib/assets.js';
import { brandedEmail, escapeHtml, sendEmail } from '../lib/email.js';
import { registerJobHandler, registerSchedule } from '../modules/jobs/worker.js';
import { getEmbedding } from './providers/index.js';
import { crawlWebsite, ingestFile, pagesCollectionId, productsCollectionId, removeStaleProductDocuments, syncPageDocuments, syncProductDocuments, tenantId } from './kb/ingest.js';
import { KB_PAGES_JOB, KB_SYNC_JOB, runAutoSyncTick } from './kb/sync.js';

const PAGES_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'kb', 'pages.json');

export function registerPlatformJobs(): void {
  registerJobHandler('kb_ingest_file', async (job) => {
    const p = job.payload as { assetKey: string; filename: string; mime: string; collectionId: string | null; tags: string[] };
    const bytes = await readFile(localAssetPath(p.assetKey));
    const r = await ingestFile({ sourceId: null, collectionId: p.collectionId, filename: p.filename, mime: p.mime, bytes, tags: p.tags });
    return r;
  });

  registerJobHandler('kb_index_website', async (job, log) => {
    const p = job.payload as { url?: string; maxPages?: number };
    const tid = await tenantId();
    const [coll] = await sql<any[]>`INSERT INTO kb_collections (tenant_id, slug, name, description, authority) VALUES (${tid}, 'website', 'Website content', 'Auto-indexed pages from the storefront', 3) ON CONFLICT (tenant_id, slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
    const url = p.url || config.PUBLIC_STORE_URL;
    log.info({ url }, 'crawling website');
    const web = await crawlWebsite(null, coll.id, { startUrl: url, maxPages: p.maxPages ?? 40, tags: ['website'] });
    const prod = await syncProductDocuments(await productsCollectionId());
    return { website: web, products: prod };
  });

  // Product documents follow the live catalogue: every admin product, stock or
  // knowledge change enqueues this (see kb/sync.ts), and it also runs on a
  // schedule. Unchanged documents are skipped by content hash, so an idle
  // run costs a few catalogue queries and no embedding calls.
  registerJobHandler(KB_SYNC_JOB, async (job, log) => {
    const products = await syncProductDocuments(await productsCollectionId());
    const removed = await removeStaleProductDocuments();
    log.info({ ...products, removed, reason: (job.payload as { reason?: string }).reason }, 'product documents synced');
    return { ...products, removed };
  });
  // Page copy is extracted from the storefront source at API build time, so the
  // assistant's view of the FAQ, policies and story follows every deployment.
  registerJobHandler(KB_PAGES_JOB, async (job, log) => {
    const bundle = JSON.parse(await readFile(PAGES_FILE, 'utf8')) as { generated_at: string; pages: { path: string; title: string; text: string }[] };
    const result = await syncPageDocuments(await pagesCollectionId(), bundle.pages);
    log.info({ ...result, generated_at: bundle.generated_at, reason: (job.payload as { reason?: string }).reason }, 'page documents synced');
    return { ...result, generated_at: bundle.generated_at };
  });
  registerSchedule({ name: 'kb_auto_sync', everyMs: 60_000, run: async (log) => {
    const due = await runAutoSyncTick();
    if (due.length) log.info({ due }, 'knowledge base syncs queued');
  } });

  registerJobHandler('kb_reindex_source', async (job) => {
    const [s] = await sql<any[]>`SELECT * FROM kb_sources WHERE id = ${job.payload.sourceId as string}`;
    if (!s) return { skipped: true };
    await sql`UPDATE kb_sources SET status = 'running', last_run_at = now() WHERE id = ${s.id}`;
    try {
      let result: unknown;
      if (s.type === 'website') result = await crawlWebsite(s.id, s.collection_id, { startUrl: s.config.url || config.PUBLIC_STORE_URL, maxPages: s.config.maxPages ?? 40, tags: s.config.tags });
      else if (s.type === 'db_sync') result = await syncProductDocuments(s.collection_id);
      await sql`UPDATE kb_sources SET status = 'idle', last_error = NULL WHERE id = ${s.id}`;
      return result as any;
    } catch (err) {
      await sql`UPDATE kb_sources SET status = 'error', last_error = ${(err as Error).message} WHERE id = ${s.id}`;
      throw err;
    }
  });

  registerJobHandler('workflow_embed_examples', async (job) => {
    const rows = await sql<any[]>`SELECT id, text FROM workflow_examples WHERE workflow_id = ${job.payload.workflowId as string} AND embedding IS NULL`;
    if (!rows.length) return { embedded: 0 };
    const vecs = await getEmbedding().embed(rows.map((r) => r.text));
    for (let i = 0; i < rows.length; i++) await sql`UPDATE workflow_examples SET embedding = ${`[${vecs[i].join(',')}]`}::vector WHERE id = ${rows[i].id}`;
    return { embedded: rows.length };
  });

  registerJobHandler('escalation_notify', async (job) => {
    const p = job.payload as { conversationId: string; reason: string; contact: { name?: string; phone?: string; email?: string } };
    const html = brandedEmail('New callback request', `<p>A customer asked for a callback via the assistant.</p>
      <p><b>${escapeHtml(p.contact.name || 'Customer')}</b> · ${escapeHtml(p.contact.phone || '')} · ${escapeHtml(p.contact.email || '')}</p>
      <p style="color:#3b4a40">Reason: ${escapeHtml(p.reason)}</p>
      <p><a href="${config.PUBLIC_CONSOLE_URL}/platform/conversations/${p.conversationId}">Open the conversation</a></p>`);
    const email = { to: config.ADMIN_NOTIFY_EMAIL, kind: 'escalation', subject: `Callback request — ${p.contact.name || 'customer'}`, html };
    const id = await sendEmail(email);
    return { emailId: id };
  });
}
