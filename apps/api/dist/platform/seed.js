import { sql } from '../db/client.js';
import { randomToken } from '../lib/crypto.js';
import { enqueueJob } from '../modules/jobs/queue.js';
import { seedFunctions } from './engine/functions.js';
import { tenantId } from './kb/ingest.js';
const WORKFLOWS = [
    {
        slug: 'product-recommendation', name: 'Product recommendation', priority: 2, mode: 'playbook',
        description: 'Use when the customer wants help choosing which Earthora product suits them (their goal, preferred form, or budget).',
        definition: {
            slots: [{ key: 'goal', type: 'text', required: true, question: { en: 'What are you hoping moringa helps you with?', hi: 'आप मोरिंगा से किसमें मदद चाहते हैं?', gu: 'તમે મોરિંગાથી શેમાં મદદ ઇચ્છો છો?' } }],
            ask_policy: { max_questions_per_turn: 1, skip_known: true },
            retrieval: { enabled: true, tags: ['product', 'website'], top_k: 6 },
            tools: [{ function: 'list_products' }, { function: 'get_product_details' }, { function: 'add_to_cart' }, { function: 'create_checkout_link' }],
            prompt: { objective: 'Understand the goal, recommend at most two suitable products with one clear reason each grounded in evidence, then offer to add to cart.', playbook: ['Acknowledge their goal', 'Recommend 1-2 products with a grounded reason', 'Offer to add to cart or answer more'], style: 'warm and concise' },
            outcomes: [{ name: 'recommended', action: 'offer_tool' }, { name: 'needs_human', action: 'escalate' }],
        },
        examples: [
            { text: 'which one should I take for energy' }, { text: 'powder or tablets, what do you recommend?' }, { text: 'suggest a product for immunity' },
            { text: 'what is best for daily wellness' }, { text: 'help me pick a moringa product' }, { text: 'where is my order', kind: 'negative' },
        ],
    },
    {
        slug: 'product-information', name: 'Product information', priority: 3, mode: 'playbook',
        description: 'Use when the customer asks about a specific product or topic — ingredients, benefits, dosage, usage, price.',
        definition: {
            retrieval: { enabled: true, tags: ['product', 'website'], top_k: 6 },
            tools: [{ function: 'get_product_details' }, { function: 'search_knowledge' }, { function: 'add_to_cart' }],
            prompt: { objective: 'Answer the specific question directly from approved evidence. Clarify only if the product or question is ambiguous.', playbook: ['Identify the product/topic', 'Answer from evidence', 'Offer to add to cart if relevant'], style: 'precise and friendly' },
        },
        examples: [
            { text: 'what are the benefits of moringa tablets' }, { text: 'how do I take the powder' }, { text: 'what is the price of morilife' },
            { text: 'is it safe during pregnancy' }, { text: 'what are the ingredients' }, { text: 'recommend something for me', kind: 'negative' },
        ],
    },
    {
        slug: 'order-support', name: 'Order support', priority: 2, mode: 'stepped',
        description: 'Use when the customer asks about an existing order — its status, tracking, or a problem with it.',
        definition: {
            retrieval: { enabled: false },
            tools: [{ function: 'get_order_status' }, { function: 'capture_callback' }],
            prompt: { objective: 'Verify the customer against the order, share its current status/tracking, and escalate anything you cannot resolve.', playbook: ['Ask for the order number', 'Verify with phone or email', 'Share status/tracking', 'Offer a callback for anything unresolved'], style: 'reassuring' },
        },
        examples: [
            { text: 'where is my order' }, { text: 'track my order' }, { text: 'my order has not arrived' }, { text: 'order status for WEB-123' },
            { text: 'what products do you have', kind: 'negative' },
        ],
    },
    {
        slug: 'policies', name: 'Policies & company info', priority: 4, mode: 'playbook',
        description: 'Use for questions about shipping, returns, refunds, privacy, or the Earthora company and farm.',
        definition: { retrieval: { enabled: true, tags: ['website', 'policy'], top_k: 6 }, tools: [{ function: 'search_knowledge' }], prompt: { objective: 'Answer from the effective approved policy or company content; escalate genuine disputes.', playbook: ['Find the relevant policy', 'Answer clearly', 'Escalate disputes'], style: 'clear and honest' } },
        examples: [
            { text: 'what is your return policy' }, { text: 'do you ship internationally' }, { text: 'how long does delivery take' }, { text: 'tell me about your farm' },
        ],
    },
    {
        slug: 'cart-checkout', name: 'Cart & checkout', priority: 1, mode: 'stepped',
        description: 'Use when the customer wants to buy, add items to cart, change quantities, or check out.',
        definition: {
            retrieval: { enabled: false },
            tools: [{ function: 'get_cart' }, { function: 'add_to_cart' }, { function: 'update_cart' }, { function: 'set_customer_detail' }, { function: 'create_checkout_link' }],
            prompt: { objective: 'Build the cart, collect name/phone/email and full delivery address, then create the secure review + payment link. Never take payment yourself.', playbook: ['Confirm items and quantities', 'Collect missing delivery details one at a time', 'Create the review link and share it'], style: 'efficient and clear' },
        },
        examples: [
            { text: 'I want to buy 2 tablets' }, { text: 'add to cart' }, { text: 'checkout' }, { text: 'place an order' }, { text: 'make that three' },
        ],
    },
    {
        slug: 'general', name: 'General', priority: 9, mode: 'playbook', fallback: true,
        description: 'Greetings, small talk, or anything not covered by another workflow.',
        definition: { retrieval: { enabled: true, tags: ['website'], top_k: 4 }, tools: [{ function: 'search_knowledge' }, { function: 'list_products' }, { function: 'capture_callback' }], prompt: { objective: 'Be a warm brand concierge; answer from public knowledge or guide them to the right topic.', style: 'welcoming' } },
        examples: [{ text: 'hi' }, { text: 'hello' }, { text: 'what is earthora' }, { text: 'namaste' }],
    },
];
const CHANNELS = [
    { type: 'chat', slug: 'earthora', name: 'Website Chat', config: { name: 'Eva', greeting: 'Hi, I\'m Eva from Earthora Farms 🌿 Ask me about our moringa products, your order, or anything else.', starters: ['Recommend a product for me', 'Benefits of moringa tablets', 'Where is my order?'], appearance: { primary: '#26593b', accent: '#DC9950', position: 'right' }, persona: { tone: 'Warm, natural, concise — like a knowledgeable friend.' } } },
];
/** Idempotently seeds functions, workflows, example utterances, channels, and kicks off KB indexing on first run. */
export async function seedPlatform(log) {
    const tid = await tenantId();
    await seedFunctions(tid);
    const [{ n: wfCount }] = await sql `SELECT count(*)::text AS n FROM workflows WHERE tenant_id = ${tid}`;
    if (Number(wfCount) === 0) {
        for (const w of WORKFLOWS) {
            const [row] = await sql `INSERT INTO workflows (tenant_id, slug, name, description, mode, priority, is_fallback, status, definition, published_definition, version)
        VALUES (${tid}, ${w.slug}, ${w.name}, ${w.description}, ${w.mode}, ${w.priority}, ${w.fallback ?? false}, 'published', ${sql.json(w.definition)}, ${sql.json(w.definition)}, 1) RETURNING id`;
            for (const ex of w.examples)
                await sql `INSERT INTO workflow_examples (tenant_id, workflow_id, text, kind) VALUES (${tid}, ${row.id}, ${ex.text}, ${ex.kind ?? 'positive'})`;
            await enqueueJob('workflow_embed_examples', { workflowId: row.id }, { dedupeKey: `wf-embed-seed:${row.id}` });
        }
        log(`seeded ${WORKFLOWS.length} workflows`);
    }
    for (const ch of CHANNELS) {
        await sql `INSERT INTO channels (tenant_id, type, slug, name, public_key, draft_config, published_config, version, published_at)
      VALUES (${tid}, ${ch.type}, ${ch.slug}, ${ch.name}, ${'pk_' + randomToken(16)}, ${sql.json(ch.config)}, ${sql.json(ch.config)}, 1, now())
      ON CONFLICT (tenant_id, type, slug) DO NOTHING`;
    }
    const [{ n: docCount }] = await sql `SELECT count(*)::text AS n FROM kb_documents WHERE tenant_id = ${tid}`;
    if (Number(docCount) === 0) {
        await enqueueJob('kb_index_website', { maxPages: 40 }, { dedupeKey: 'kb-initial-index' });
        log('queued initial website + product KB indexing');
    }
}
//# sourceMappingURL=seed.js.map