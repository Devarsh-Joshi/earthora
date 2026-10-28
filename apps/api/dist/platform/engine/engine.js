import { sql } from '../../db/client.js';
import { getLlm } from '../providers/index.js';
import { retrieve, evidenceBlock } from '../kb/retrieve.js';
import { routeTurn } from './router.js';
import { BUILTIN_MAP, toolDefsFor } from './functions.js';
import { checkOutput, safeDeflection } from './outputPolicy.js';
import { CHAT_CATALOGUE_RULE, CHAT_LOCATION_RULE, groundedChatCompanyReply } from './chatGrounding.js';
const LANG_NAME = { en: 'English', hi: 'Hindi', gu: 'Gujarati' };
/** One conversation turn: route → (ask slot | retrieve + generate with tools) → output policy → persist trace. */
export async function runTurn(input) {
    const t0 = Date.now();
    const timings = {};
    const [activeWf] = input.state.activeWorkflowId
        ? await sql `SELECT id, slug, name, description, mode, priority, published_definition AS definition, is_fallback FROM workflows WHERE id = ${input.state.activeWorkflowId}`
        : [null];
    const route = await routeTurn({ tenantId: input.tenantId, message: input.message, recentTurns: input.history, activeWorkflow: activeWf, pendingSlot: input.state.pendingSlot, knownSlots: input.state.slots, language: input.state.language });
    timings.route = Date.now() - t0;
    const language = route.language || input.state.language || 'en';
    Object.assign(input.state.slots, route.slots);
    input.state.activeWorkflowId = route.workflowId || input.state.activeWorkflowId;
    input.state.activeWorkflowSlug = route.slug;
    input.state.language = language;
    const [wf] = route.workflowId ? await sql `SELECT id, slug, name, description, mode, priority, published_definition AS definition, is_fallback FROM workflows WHERE id = ${route.workflowId}` : [null];
    const def = wf?.definition || {};
    // Typed chat uses the same live product source as the store. Its older persona
    // and page index are not authoritative for current availability or farm location.
    let chatCatalogue = null;
    if (input.channelType === 'chat') {
        try {
            chatCatalogue = await BUILTIN_MAP.get('list_products').run({}, { conversationId: input.conversationId, channelType: input.channelType, state: input.state, contact: input.contact, workflowId: wf?.id });
        }
        catch {
            chatCatalogue = { ok: false, message: 'Current catalogue lookup unavailable' };
        }
        const factualReply = groundedChatCompanyReply(input.message, chatCatalogue, language);
        if (factualReply) {
            const toolCalls = [{ name: 'list_products', ok: chatCatalogue.ok }];
            await persistTrace(input.conversationId, route, { evidence: [], tools: toolCalls }, { ...timings, total: Date.now() - t0 }, wf?.slug ?? 'general');
            return { reply: factualReply, state: input.state, workflow: route.slug, confidence: route.confidence, toolCalls, sources: [], trace: { route: route.reason, grounding: 'live-catalogue-and-location-uncertainty' } };
        }
    }
    // Slot filling: ask one missing required slot (deterministic short-circuit, no retrieval).
    const requiredSlots = (def.slots || []).filter((s) => s.required);
    const missing = requiredSlots.find((s) => !String(input.state.slots[s.key] ?? '').trim());
    if (missing && (def.ask_policy?.skip_known !== false)) {
        input.state.pendingSlot = missing.key;
        const q = missing.question?.[language] || missing.question?.en || `Could you tell me your ${missing.key}?`;
        await persistTrace(input.conversationId, route, null, { ...timings, total: Date.now() - t0 }, wf?.slug ?? 'general');
        return { reply: q, state: input.state, workflow: route.slug, confidence: route.confidence, toolCalls: [], sources: [], trace: { route: route.reason, askedSlot: missing.key } };
    }
    input.state.pendingSlot = null;
    // Retrieval scoped to the workflow.
    let evidence = '';
    let sources = [];
    if (def.retrieval?.enabled !== false) {
        const rt = Date.now();
        const hits = await retrieve([input.message, ...Object.values(input.state.slots)].join(' '), {
            workflowId: wf?.id, collections: def.retrieval?.collections, tags: def.retrieval?.tags,
            topK: def.retrieval?.top_k ?? 6, vectorWeight: def.retrieval?.hybrid?.vector, keywordWeight: def.retrieval?.hybrid?.keyword, minScore: def.retrieval?.min_score ?? 0,
        });
        timings.retrieve = Date.now() - rt;
        const ev = evidenceBlock(hits);
        evidence = ev.block;
        sources = ev.sources.map((s) => ({ id: s.id, title: s.title }));
    }
    if (chatCatalogue)
        evidence += chatCatalogue.ok && Array.isArray(chatCatalogue.data)
            ? `\n\nLIVE CATALOGUE (current listed products, prices and stock; supersedes website/persona claims):\n${JSON.stringify(chatCatalogue.data)}`
            : '\n\nLIVE CATALOGUE: lookup unavailable. This does not mean there are no products; do not invent availability.';
    const system = compilePrompt({ persona: input.persona, workflow: def, language, evidence, cart: input.state.cart, checkout: input.state.checkout, channel: input.channelType });
    const toolNames = uniq([...(def.tools || []).map((t) => t.function), 'search_knowledge', 'capture_callback']).filter((n) => BUILTIN_MAP.has(n));
    const tools = toolDefsFor(toolNames);
    const messages = [{ role: 'system', content: system }, ...input.history.slice(-8).map((h) => ({ role: h.role, content: h.content })), { role: 'user', content: input.message }];
    const fnCtx = { conversationId: input.conversationId, channelType: input.channelType, state: input.state, contact: input.contact, workflowId: wf?.id };
    const toolCalls = [];
    let reply = '';
    const gt = Date.now();
    for (let iter = 0; iter < 6; iter++) {
        const res = await getLlm().chat(messages, { tools, temperature: 0.3, maxTokens: input.persona?.maxWords ? Math.min(700, input.persona.maxWords * 3) : 500 });
        if (res.toolCalls.length) {
            messages.push({ role: 'assistant', content: res.text ?? '', tool_calls: res.toolCalls });
            for (const call of res.toolCalls) {
                const fn = BUILTIN_MAP.get(call.name);
                let result = { ok: false, message: 'unknown function' };
                if (fn) {
                    try {
                        result = await fn.run(call.arguments, fnCtx);
                    }
                    catch (e) {
                        result = { ok: false, message: e.message };
                    }
                }
                toolCalls.push({ name: call.name, ok: result.ok });
                messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: JSON.stringify(result).slice(0, 4000) });
            }
            continue;
        }
        reply = res.text?.trim() || '';
        break;
    }
    timings.generate = Date.now() - gt;
    // Output policy: one repair, then a safe deflection.
    const validate = (text) => checkOutput(text);
    let policy = validate(reply);
    if (!policy.ok) {
        const res2 = await getLlm().chat([...messages, { role: 'system', content: `Your reply violated policy (${policy.reason}). Rewrite it without claiming an order is placed or payment received, and never ask for card/OTP/PIN. Keep it in ${LANG_NAME[language]}.` }, { role: 'user', content: reply }], { temperature: 0.2, maxTokens: 400 });
        reply = res2.text?.trim() || reply;
        policy = validate(reply);
        if (!policy.ok)
            reply = safeDeflection(policy.reason, language);
    }
    if (!reply)
        reply = fallbackReply(language);
    await persistTrace(input.conversationId, route, { evidence: sources, tools: toolCalls }, { ...timings, total: Date.now() - t0 }, wf?.slug ?? 'general');
    return { reply, state: input.state, workflow: route.slug, confidence: route.confidence, toolCalls, sources, trace: { route: route.reason, timings } };
}
function compilePrompt(a) {
    const p = a.persona || {};
    const lang = LANG_NAME[a.language] || 'English';
    const wordCap = 'Keep replies concise — a few short lines, no long essays.';
    const blocks = [];
    blocks.push(`LANGUAGE: Reply only in ${lang}. Match the customer's language and script. Localise rupee amounts (₹), dates and units; never translate a product's canonical name.`);
    blocks.push(`# Identity\nYou are ${p.name || 'Eva'}, the assistant for Earthora Farms. Use current evidence for product names and company facts. ${p.personality || 'Warm, precise, genuinely helpful; you sound like a real person, not a script.'}`);
    if (p.environment)
        blocks.push(`# Context\n${p.environment}`);
    blocks.push(`# Objective\n${a.workflow.prompt?.objective || p.objective || 'Help the customer with product questions, recommendations, orders and support.'}`);
    if (a.workflow.prompt?.playbook?.length)
        blocks.push(`# Playbook\n${a.workflow.prompt.playbook.map((s, i) => `${i + 1}. ${s}`).join('\n')}`);
    blocks.push(`# Style\n${p.tone || 'Natural, friendly, confident.'} ${wordCap} Ask at most one question at a time. Do not repeat facts the customer already gave.`);
    const rules = [
        'Only state product facts, prices, availability, benefits or policies that appear in the EVIDENCE below or come from a tool result this turn. If it is not there, say you will check or offer a callback — never guess.',
        'Never claim an order is placed or a payment is received; the customer confirms and pays on the secure link. Never ask for card numbers, CVV, OTP or UPI PIN.',
        'For health questions, only use approved evidence; do not give medical advice or diagnose.',
        p.rules || '',
    ].filter(Boolean);
    blocks.push(`# Rules\n${rules.map((r) => `- ${r}`).join('\n')}`);
    if (p.custom)
        blocks.push(`# Notes\n${p.custom}`);
    if (a.channel === 'chat')
        blocks.push(`# Current factual boundaries\n- ${CHAT_CATALOGUE_RULE}\n- ${CHAT_LOCATION_RULE}`);
    if (a.cart.length)
        blocks.push(`# Current cart\n${a.cart.map((c) => `${c.name} x${c.quantity} @ ₹${c.unitPrice}`).join('\n')}`);
    const known = Object.entries(a.checkout).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
    if (known.length)
        blocks.push(`# Known customer details\n${known.join('\n')}`);
    blocks.push(a.evidence ? `# EVIDENCE (cite by staying grounded; do not print [S#] tags to the customer)\n${a.evidence}` : '# EVIDENCE\n(none retrieved this turn — rely on tools or offer to check)');
    return blocks.join('\n\n');
}
async function persistTrace(conversationId, route, retrieval, timings, workflow) {
    await sql `INSERT INTO turn_traces (conversation_id, routed_workflow, router_confidence, router_reason, retrieval, model, timings)
    VALUES (${conversationId}, ${workflow}, ${route.confidence}, ${route.reason}, ${retrieval ? sql.json(retrieval) : null}, ${getLlm().name}, ${sql.json(timings)})`;
}
function fallbackReply(lang) {
    return { en: "I want to get this right — could you rephrase that for me?", hi: 'मैं इसे सही से समझना चाहता हूँ — क्या आप इसे थोड़ा और स्पष्ट कर सकते हैं?', gu: 'હું આ બરાબર સમજવા માંગું છું — શું તમે થોડું સ્પષ્ટ કરી શકશો?' }[lang] || "Could you rephrase that?";
}
function uniq(a) { return [...new Set(a)]; }
//# sourceMappingURL=engine.js.map