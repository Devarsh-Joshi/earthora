import { sql } from '../../db/client.js';
const emptyState = (language = 'en') => ({ slots: {}, cart: [], checkout: {}, language, summary: '' });
/** Finds or creates a conversation by (channelType, externalId) and returns its durable state + recent history. */
export async function loadConversation(input) {
    const [conv] = await sql `
    INSERT INTO conversations (tenant_id, channel_type, external_id, channel_id, language)
    VALUES (${input.tenantId}, ${input.channelType}, ${input.externalId}, ${input.channelId ?? null}, 'en')
    ON CONFLICT (tenant_id, channel_type, external_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id
    RETURNING id`;
    const convId = conv.id;
    await sql `INSERT INTO conversation_state (conversation_id) VALUES (${convId}) ON CONFLICT (conversation_id) DO NOTHING`;
    const [st] = await sql `SELECT * FROM conversation_state WHERE conversation_id = ${convId}`;
    const history = await sql `SELECT role, content FROM messages WHERE conversation_id = ${convId} AND role IN ('user','assistant') ORDER BY seq DESC LIMIT 16`;
    const state = {
        activeWorkflowId: st.active_workflow_id ?? undefined, activeWorkflowSlug: undefined,
        slots: st.slots ?? {}, cart: st.cart ?? [], checkout: st.checkout ?? {}, language: st.language ?? 'en', summary: st.summary ?? '', pendingSlot: st.pending?.slot ?? null,
    };
    let contact = {};
    if (input.contact?.phone || input.contact?.email) {
        const [c] = await sql `INSERT INTO contacts (tenant_id, phone, email, name) VALUES (${input.tenantId}, ${input.contact.phone ?? null}, ${input.contact.email ?? null}, ${input.contact.name ?? null})
      ON CONFLICT (tenant_id, phone) DO UPDATE SET email = COALESCE(EXCLUDED.email, contacts.email), name = COALESCE(EXCLUDED.name, contacts.name) RETURNING id, phone, email, name, verified_at`;
        if (c) {
            contact = { phone: c.phone, email: c.email, name: c.name, verified: Boolean(c.verified_at) };
            await sql `UPDATE conversations SET contact_id = ${c.id} WHERE id = ${convId}`;
        }
    }
    return { id: convId, state: { ...emptyState(), ...state }, history: history.reverse(), contact };
}
export async function appendMessage(conversationId, role, content, extra = {}) {
    await sql `INSERT INTO messages (conversation_id, role, content, tool_calls, latency_ms) VALUES (${conversationId}, ${role}, ${content}, ${extra.toolCalls ? sql.json(extra.toolCalls) : null}, ${extra.latencyMs ?? null})`;
}
export async function saveState(conversationId, state) {
    await sql `UPDATE conversation_state SET active_workflow_id = ${state.activeWorkflowId ?? null}, slots = ${sql.json(state.slots)}, cart = ${sql.json(state.cart)},
    checkout = ${sql.json(state.checkout)}, pending = ${state.pendingSlot ? sql.json({ slot: state.pendingSlot }) : null}, language = ${state.language}, summary = ${state.summary},
    revision = revision + 1, updated_at = now() WHERE conversation_id = ${conversationId}`;
}
export async function endConversation(conversationId) {
    await sql `UPDATE conversations SET status = 'ended', ended_at = now() WHERE id = ${conversationId} AND status = 'active'`;
}
//# sourceMappingURL=conversation.js.map