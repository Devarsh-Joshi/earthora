import { sql } from '../../db/client.js';
import { getEmbedding, getLlm } from '../providers/index.js';

export interface WorkflowRow { id: string; slug: string; name: string; description: string; mode: string; priority: number; definition: any; is_fallback: boolean }
export interface RouteDecision { workflowId: string; slug: string; confidence: number; reason: string; slots: Record<string, string>; language: string; needsClarification: boolean }

/** Stage A: embedding kNN over workflow_examples → top candidate workflows. */
async function candidatesByEmbedding(tenantId: string, text: string, k = 3): Promise<{ workflowId: string; slug: string; score: number }[]> {
  const [vec] = await getEmbedding().embed([text]);
  const rows = await sql<any[]>`
    SELECT w.id AS workflow_id, w.slug, 1 - (e.embedding <=> ${`[${vec.join(',')}]`}::vector) AS score, e.kind
    FROM workflow_examples e JOIN workflows w ON w.id = e.workflow_id
    WHERE e.tenant_id = ${tenantId} AND w.status = 'published' AND e.embedding IS NOT NULL
    ORDER BY e.embedding <=> ${`[${vec.join(',')}]`}::vector LIMIT 20`;
  const best = new Map<string, { workflowId: string; slug: string; score: number }>();
  for (const r of rows) {
    const signed = r.kind === 'negative' ? -Number(r.score) : Number(r.score);
    const cur = best.get(r.slug);
    if (!cur || signed > cur.score) best.set(r.slug, { workflowId: r.workflow_id, slug: r.slug, score: signed });
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, k);
}

/**
 * Routes the turn and extracts slots in one LLM call. Sticky: if the active workflow has a pending required
 * slot and the message plausibly answers it, stays. Falls back to `general` on low confidence.
 */
export async function routeTurn(input: {
  tenantId: string; message: string; recentTurns: { role: string; content: string }[];
  activeWorkflow?: WorkflowRow | null; pendingSlot?: string | null; knownSlots: Record<string, string>;
  language?: string;
}): Promise<RouteDecision> {
  const workflows = await sql<WorkflowRow[]>`SELECT id, slug, name, description, mode, priority, published_definition AS definition, is_fallback FROM workflows WHERE tenant_id = ${input.tenantId} AND status = 'published'`;
  if (!workflows.length) return { workflowId: '', slug: 'general', confidence: 0, reason: 'no workflows', slots: {}, language: 'en', needsClarification: false };
  const fallback = workflows.find((w) => w.is_fallback) ?? workflows[0];

  const cands = await candidatesByEmbedding(input.tenantId, [input.activeWorkflow?.name, input.message].filter(Boolean).join(' — '));
  const candWorkflows = cands.map((c) => workflows.find((w) => w.id === c.workflowId)).filter(Boolean) as WorkflowRow[];
  const pool = uniqueBy([...(input.activeWorkflow ? [input.activeWorkflow] : []), ...candWorkflows, fallback], (w) => w.id);

  const topScore = cands[0]?.score ?? 0;
  const margin = topScore - (cands[1]?.score ?? 0);
  // Confident direct route without an LLM call when no slot is pending.
  if (!input.pendingSlot && topScore >= 0.62 && margin >= 0.12 && candWorkflows[0]) {
    return { workflowId: candWorkflows[0].id, slug: candWorkflows[0].slug, confidence: topScore, reason: 'embedding match', slots: {}, language: detectScript(input.message), needsClarification: false };
  }

  const schema = pool.map((w) => `- ${w.slug}: ${w.description}${(w.definition?.slots || []).length ? ` (collects: ${(w.definition.slots as any[]).map((s) => s.key).join(', ')})` : ''}`).join('\n');
  const sys = `You are the router for Earthora Farms' assistant. Choose the single best workflow for the customer's latest message and extract any facts it provides.
Workflows:
${schema}
- general: anything else / greetings / small talk.

Rules: If a specific workflow clearly fits, pick it; otherwise pick "general". Keep the active workflow when the message answers its pending question. Extract slot values the customer stated. Detect language as en, hi, or gu (Roman-script Hindi/Gujarati count as hi/gu).
Reply as JSON: {"workflow": "<slug>", "confidence": 0..1, "reason": "<short>", "slots": {<key>:<value>}, "language": "en|hi|gu", "needs_clarification": <bool>}`;
  const ctx = input.activeWorkflow ? `Active workflow: ${input.activeWorkflow.slug}. Pending question slot: ${input.pendingSlot ?? 'none'}. Known: ${JSON.stringify(input.knownSlots)}` : 'No active workflow.';
  const recent = input.recentTurns.slice(-4).map((t) => `${t.role}: ${t.content}`).join('\n');

  try {
    const res = await getLlm().chat([
      { role: 'system', content: sys },
      { role: 'user', content: `${ctx}\n\nRecent:\n${recent}\n\nLatest message: "${input.message}"` },
    ], { json: true, temperature: 0, maxTokens: 300 });
    const parsed = JSON.parse(res.text || '{}');
    const chosen = workflows.find((w) => w.slug === parsed.workflow) ?? (parsed.workflow === 'general' ? fallback : null) ?? fallback;
    return {
      workflowId: chosen.id, slug: chosen.slug,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
      reason: String(parsed.reason || 'llm route'),
      slots: typeof parsed.slots === 'object' && parsed.slots ? Object.fromEntries(Object.entries(parsed.slots).map(([k, v]) => [k, String(v)])) : {},
      language: ['en', 'hi', 'gu'].includes(parsed.language) ? parsed.language : detectScript(input.message),
      needsClarification: Boolean(parsed.needs_clarification),
    };
  } catch {
    const chosen = candWorkflows[0] ?? fallback;
    return { workflowId: chosen.id, slug: chosen.slug, confidence: topScore, reason: 'fallback route', slots: {}, language: detectScript(input.message), needsClarification: false };
  }
}

function detectScript(s: string): string { if (/[઀-૿]/.test(s)) return 'gu'; if (/[ऀ-ॿ]/.test(s)) return 'hi'; return 'en'; }
function uniqueBy<T>(arr: T[], key: (t: T) => string): T[] { const m = new Map<string, T>(); for (const a of arr) if (!m.has(key(a))) m.set(key(a), a); return [...m.values()]; }
