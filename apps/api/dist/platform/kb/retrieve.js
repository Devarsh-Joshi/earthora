import { sql } from '../../db/client.js';
import { getEmbedding } from '../providers/index.js';
/** Hybrid retrieval: exact-kNN cosine (pgvector) + tsvector/trigram keyword, merged with reciprocal-rank fusion. */
export async function retrieve(query, opts = {}) {
    const q = query.trim();
    if (!q)
        return [];
    const topK = opts.topK ?? 6;
    const candidate = Math.max(topK * 4, 20);
    const [vec] = await getEmbedding().embed([q]);
    const vecLit = `[${vec.join(',')}]`;
    const tagFilter = opts.tags?.length ? sql `AND c.tags && ${opts.tags}` : sql ``;
    const wfFilter = opts.workflowId ? sql `AND (cardinality(c.workflow_ids) = 0 OR ${opts.workflowId}::uuid = ANY(c.workflow_ids))` : sql ``;
    const visFilter = opts.includeInternal ? sql `` : sql `AND c.visibility = 'public'`;
    const collFilter = opts.collections?.length
        ? sql `AND c.collection_id IN (SELECT id FROM kb_collections WHERE slug = ANY(${opts.collections}))`
        : sql ``;
    const effFilter = sql `AND d.status = 'indexed' AND (d.effective_until IS NULL OR d.effective_until > now()) AND (d.effective_from IS NULL OR d.effective_from <= now())`;
    const vectorRows = await sql `
    SELECT c.id, c.document_id, d.title AS document_title, d.uri, d.authority, c.content, c.context_header,
           1 - (c.embedding <=> ${vecLit}::vector) AS vscore
    FROM kb_chunks c JOIN kb_documents d ON d.id = c.document_id
    WHERE c.embedding IS NOT NULL ${tagFilter} ${wfFilter} ${visFilter} ${collFilter} ${effFilter}
    ORDER BY c.embedding <=> ${vecLit}::vector LIMIT ${candidate}`;
    const keywordQuery = sql `plainto_tsquery('simple', ${q})`;
    const keywordRows = await sql `
    SELECT c.id, c.document_id, d.title AS document_title, d.uri, d.authority, c.content, c.context_header,
           ts_rank(c.tsv, ${keywordQuery}) + similarity(c.content, ${q}) AS kscore
    FROM kb_chunks c JOIN kb_documents d ON d.id = c.document_id
    WHERE (c.tsv @@ ${keywordQuery} OR c.content % ${q}) ${tagFilter} ${wfFilter} ${visFilter} ${collFilter} ${effFilter}
    ORDER BY kscore DESC LIMIT ${candidate}`;
    const kw = opts.keywordWeight ?? 0.4;
    const vw = opts.vectorWeight ?? 0.6;
    const byId = new Map();
    vectorRows.forEach((r, i) => {
        byId.set(r.id, { id: r.id, documentId: r.document_id, documentTitle: r.document_title, uri: r.uri, authority: r.authority, content: r.content, contextHeader: r.context_header, vectorScore: Number(r.vscore), keywordScore: 0, score: vw * (1 / (i + 1)) });
    });
    keywordRows.forEach((r, i) => {
        const ex = byId.get(r.id);
        if (ex) {
            ex.keywordScore = Number(r.kscore);
            ex.score += kw * (1 / (i + 1));
        }
        else
            byId.set(r.id, { id: r.id, documentId: r.document_id, documentTitle: r.document_title, uri: r.uri, authority: r.authority, content: r.content, contextHeader: r.context_header, vectorScore: 0, keywordScore: Number(r.kscore), score: kw * (1 / (i + 1)) });
    });
    const merged = [...byId.values()].sort((a, b) => (b.score - a.score) || (a.authority - b.authority));
    const min = opts.minScore ?? 0;
    return merged.filter((h) => h.vectorScore >= min || h.keywordScore > 0).slice(0, topK);
}
/** Build an evidence block with [S1..Sn] source ids for the prompt. */
export function evidenceBlock(hits) {
    const sources = hits.map((h, i) => ({ id: `S${i + 1}`, title: h.documentTitle, uri: h.uri }));
    const block = hits.map((h, i) => `[S${i + 1}] ${h.contextHeader ? h.contextHeader + '\n' : ''}${h.content}`).join('\n\n');
    return { block, sources };
}
//# sourceMappingURL=retrieve.js.map