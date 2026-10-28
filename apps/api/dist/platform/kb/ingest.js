import { createHash } from 'node:crypto';
import { sql } from '../../db/client.js';
import { getEmbedding } from '../providers/index.js';
import { chunkText } from './chunk.js';
import { extractFile, htmlToText } from './extract.js';
const EARTHORA = sql `SELECT id FROM tenants WHERE slug = 'earthora'`;
export async function tenantId() { return (await EARTHORA)[0].id; }
const sha = (s) => createHash('sha256').update(s).digest('hex');
/** Upserts a document, re-chunks + re-embeds it, swaps chunks atomically. Returns chunk count. */
export async function indexDocument(input) {
    const tid = await tenantId();
    const hash = sha(input.text);
    // Product UUID, unlike its editable display name/slug, survives renaming.
    // Other document types retain their existing identity rules.
    const productId = input.stableProductIdentity && input.productIds?.length === 1 ? input.productIds[0] : null;
    const [existing] = productId
        ? await sql `SELECT id, content_hash, title, uri FROM kb_documents
        WHERE tenant_id = ${tid} AND uri LIKE 'product:%' AND product_ids = ARRAY[${productId}]::uuid[]
        ORDER BY updated_at DESC, id LIMIT 1`
        : await sql `SELECT id, content_hash, title, uri FROM kb_documents WHERE tenant_id = ${tid} AND uri = ${input.uri ?? null} AND title = ${input.title} LIMIT 1`;
    if (existing && existing.content_hash === hash && existing.title === input.title && existing.uri === (input.uri ?? null)) {
        if (productId)
            await sql `DELETE FROM kb_documents WHERE tenant_id = ${tid} AND uri LIKE 'product:%'
      AND product_ids = ARRAY[${productId}]::uuid[] AND id <> ${existing.id}`;
        return { documentId: existing.id, chunks: 0, skipped: true };
    }
    const chunks = chunkText(input.text, { docTitle: input.title, docSummary: input.summary });
    const embed = getEmbedding();
    const vectors = chunks.length ? await embed.embed(chunks.map((c) => `${c.contextHeader}\n${c.content}`)) : [];
    const documentId = await sql.begin(async (tx) => {
        let docId;
        if (existing) {
            docId = existing.id;
            await tx `UPDATE kb_documents SET title = ${input.title}, uri = ${input.uri ?? null}, content_hash = ${hash}, mime = ${input.mime ?? 'text/plain'}, language = ${input.language ?? 'en'},
        tags = ${input.tags ?? []}, workflow_ids = ${(input.workflowIds ?? [])}, product_ids = ${(input.productIds ?? [])},
        authority = ${input.authority ?? 3}, visibility = ${input.visibility ?? 'public'}, summary = ${input.summary ?? ''},
        collection_id = ${input.collectionId}, status = 'indexed', version = version + 1, tokens = ${chunks.reduce((s, c) => s + c.tokens, 0)}, updated_at = now() WHERE id = ${docId}`;
            await tx `DELETE FROM kb_chunks WHERE document_id = ${docId}`;
        }
        else {
            const [d] = await tx `INSERT INTO kb_documents (tenant_id, source_id, collection_id, title, uri, mime, content_hash, language, tags, workflow_ids, product_ids, authority, visibility, summary, status, tokens)
        VALUES (${tid}, ${input.sourceId}, ${input.collectionId}, ${input.title}, ${input.uri ?? null}, ${input.mime ?? 'text/plain'}, ${hash}, ${input.language ?? 'en'}, ${input.tags ?? []}, ${(input.workflowIds ?? [])}, ${(input.productIds ?? [])}, ${input.authority ?? 3}, ${input.visibility ?? 'public'}, ${input.summary ?? ''}, 'indexed', ${chunks.reduce((s, c) => s + c.tokens, 0)}) RETURNING id`;
            docId = d.id;
        }
        for (let i = 0; i < chunks.length; i++) {
            const c = chunks[i];
            await tx `INSERT INTO kb_chunks (tenant_id, document_id, collection_id, ordinal, content, context_header, tokens, embedding, embed_model, tags, workflow_ids, visibility)
        VALUES (${tid}, ${docId}, ${input.collectionId}, ${c.ordinal}, ${c.content}, ${c.contextHeader}, ${c.tokens}, ${toVector(vectors[i])}, ${embed.model}, ${input.tags ?? []}, ${(input.workflowIds ?? [])}, ${input.visibility ?? 'public'})`;
        }
        if (productId)
            await tx `DELETE FROM kb_documents WHERE tenant_id = ${tid} AND uri LIKE 'product:%'
      AND product_ids = ARRAY[${productId}]::uuid[] AND id <> ${docId}`;
        return docId;
    });
    return { documentId, chunks: chunks.length, skipped: false };
}
function toVector(v) { return v ? `[${v.join(',')}]` : null; }
/** Crawl a website (BFS, same-origin, depth/page-limited) and index each page. */
export async function crawlWebsite(sourceId, collectionId, opts) {
    const maxPages = opts.maxPages ?? 40;
    const maxDepth = opts.maxDepth ?? 3;
    const origin = new URL(opts.startUrl).origin;
    const seen = new Set();
    const queue = [{ url: opts.startUrl, depth: 0 }];
    let pages = 0;
    let totalChunks = 0;
    while (queue.length && pages < maxPages) {
        const { url, depth } = queue.shift();
        const clean = url.split('#')[0];
        if (seen.has(clean))
            continue;
        seen.add(clean);
        let html;
        try {
            const res = await fetch(clean, { headers: { 'User-Agent': 'EarthoraKB/1.0' }, signal: AbortSignal.timeout(20_000) });
            if (!res.ok || !(res.headers.get('content-type') || '').includes('text/html'))
                continue;
            html = await res.text();
        }
        catch {
            continue;
        }
        const { title, text } = htmlToText(html, clean);
        if (text.length > 120) {
            const r = await indexDocument({ sourceId, collectionId, title: title || clean, uri: clean, mime: 'text/html', text, tags: opts.tags });
            totalChunks += r.chunks;
            pages++;
        }
        if (depth < maxDepth) {
            for (const m of html.matchAll(/href=["']([^"'#]+)["']/g)) {
                try {
                    const abs = new URL(m[1], clean);
                    if (abs.origin === origin && /^https?:/.test(abs.protocol) && !abs.pathname.match(/\.(png|jpe?g|svg|webp|pdf|zip|css|js|ico|woff2?)$/i))
                        queue.push({ url: abs.href, depth: depth + 1 });
                }
                catch { /* skip */ }
            }
        }
    }
    return { pages, chunks: totalChunks };
}
/** DB-sync: one document per active product from its DB fields + approved knowledge. */
/** The collection that holds one synced document per active product. */
export async function productsCollectionId() {
    const tid = await tenantId();
    const [row] = await sql `INSERT INTO kb_collections (tenant_id, slug, name, description, authority)
    VALUES (${tid}, 'products', 'Product information', 'Synced from the live catalogue + approved facts', 2)
    ON CONFLICT (tenant_id, slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
    return row.id;
}
/** Product documents whose product is no longer active (or whose slug changed) are removed with their
 *  chunks; the next sync re-creates a document when the product is active again. */
export async function removeStaleProductDocuments() {
    const tid = await tenantId();
    const rows = await sql `DELETE FROM kb_documents
    WHERE tenant_id = ${tid} AND uri LIKE 'product:%'
      AND uri NOT IN (SELECT 'product:' || slug FROM products WHERE status = 'active') RETURNING id`;
    return rows.length;
}
/** One document per public storefront page, from the copy extracted at build time (dist/kb/pages.json). */
export async function syncPageDocuments(collectionId, pages) {
    const tid = await tenantId();
    let docs = 0;
    let chunks = 0;
    for (const page of pages) {
        const r = await indexDocument({ sourceId: null, collectionId, title: page.title, uri: `page:${page.path}`, mime: 'text/markdown', text: page.text,
            tags: ['website', 'page'], authority: 3, summary: `Website page ${page.path}` });
        docs++;
        chunks += r.chunks;
    }
    const removed = await sql `DELETE FROM kb_documents WHERE tenant_id = ${tid} AND uri LIKE 'page:%'
    AND uri <> ALL(${pages.map((page) => 'page:' + page.path)}::text[]) RETURNING id`;
    return { documents: docs, chunks, removed: removed.length };
}
/** The collection that holds the storefront page documents. */
export async function pagesCollectionId() {
    const tid = await tenantId();
    const [row] = await sql `INSERT INTO kb_collections (tenant_id, slug, name, description, authority)
    VALUES (${tid}, 'website', 'Website content', 'Auto-indexed pages from the storefront', 3)
    ON CONFLICT (tenant_id, slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
    return row.id;
}
export async function syncProductDocuments(collectionId) {
    // Hold a dedicated transaction-scoped lock while reading and indexing. Two
    // delayed minute batches (or a manual reindex) cannot race older snapshots.
    // Ordinary product/admin writes remain outside this advisory lock.
    return sql.begin(async (lock) => {
        await lock `SELECT pg_advisory_xact_lock(hashtextextended('earthora-kb-products', 0))`;
        return syncCurrentProductDocuments(collectionId);
    });
}
async function syncCurrentProductDocuments(collectionId) {
    const products = await sql `SELECT p.id, p.name, p.slug, p.description, p.highlights, p.price, p.mrp, p.category,
    COALESCE(i.total_stock,0) AS stock FROM products p LEFT JOIN inventory i ON i.product_id = p.id WHERE p.status = 'active'`;
    let docs = 0;
    let chunks = 0;
    for (const p of products) {
        const facts = await sql `SELECT category, question, content FROM product_knowledge WHERE product_id = ${p.id} AND status = 'approved' ORDER BY category`;
        const parts = [`# ${p.name}`, p.description || '', ''];
        if (Array.isArray(p.highlights) && p.highlights.length)
            parts.push('## Highlights', p.highlights.map((h) => `- ${h}`).join('\n'), '');
        for (const f of facts)
            parts.push(`## ${f.category}${f.question ? ` — ${f.question}` : ''}`, f.content, '');
        const r = await indexDocument({ sourceId: null, collectionId, title: p.name, uri: `product:${p.slug}`, mime: 'text/markdown', text: parts.join('\n'), tags: ['product', p.slug], productIds: [p.id], authority: 2, summary: `Product information for ${p.name}`, stableProductIdentity: true });
        docs++;
        chunks += r.chunks;
    }
    return { documents: docs, chunks };
}
export async function ingestFile(input) {
    const { title, text } = await extractFile(input.bytes, input.mime, input.filename);
    const r = await indexDocument({ sourceId: input.sourceId, collectionId: input.collectionId, title: title || input.filename, uri: `file:${input.filename}`, mime: input.mime, text, tags: input.tags, workflowIds: input.workflowIds });
    return { documentId: r.documentId, chunks: r.chunks };
}
//# sourceMappingURL=ingest.js.map