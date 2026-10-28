/** Builtin function registry — the tools the AI can call. Operate on the conversation's in-memory cart/state. */
import { sql } from '../../db/client.js';
import { enqueueJob } from '../../modules/jobs/queue.js';
import { config } from '../../config.js';
import { listProducts, priceCart } from '../../modules/commerce/pricing.js';
import { retrieve } from '../kb/retrieve.js';
import { tenantId } from '../kb/ingest.js';
import type { ToolDef } from '../providers/types.js';
import { checkoutCustomerSchema, createCheckoutSnapshot } from '../channels/checkoutLink.js';

export interface FunctionContext {
  conversationId: string; channelType: string;
  state: { cart: { productId: string; slug: string; name: string; quantity: number; unitPrice: number }[]; checkout: Record<string, string>; language: string };
  contact: { phone?: string; email?: string; name?: string; verified?: boolean };
  workflowId?: string;
}
export interface FunctionResult { ok: boolean; data?: unknown; message?: string; sideEffect?: string }
export interface BuiltinFunction { name: string; description: string; parameters: Record<string, unknown>; requiresConfirmation?: boolean; run: (args: Record<string, unknown>, ctx: FunctionContext) => Promise<FunctionResult> }

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));

/** Retail cart ceiling per product. Larger quantities are wholesale enquiries for the team, never a stock refusal. */
export const RETAIL_CART_LIMIT = 50;

function resolveProduct<T extends { id: string; slug: string; name: string; status: string }>(products: T[], ref: string): T | undefined {
  const r = str(ref).toLowerCase().trim();
  return products.find((x) => x.id === ref || x.slug === ref)
    || products.find((x) => x.name.toLowerCase() === r || x.slug === r)
    || products.find((x) => x.status === 'active' && (x.name.toLowerCase().includes(r) || r.includes(x.slug) || r.split(/\s+/).some((w) => w.length > 3 && x.name.toLowerCase().includes(w))))
    || (products.filter((x) => x.status === 'active').length === 1 ? products.find((x) => x.status === 'active') : undefined);
}


export const BUILTINS: BuiltinFunction[] = [
  {
    name: 'list_products',
    description: 'List Earthora products with live price and stock. Use to see the catalogue or find a product by name.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Optional name/keyword filter' } } },
    run: async (args) => {
      const products = (await listProducts()).filter(product => product.status === 'active');
      const q = str(args.query).toLowerCase().trim();
      const filtered = q ? products.filter((p) => p.name.toLowerCase().includes(q) || p.slug.includes(q) || p.description.toLowerCase().includes(q)) : products;
      const list = (filtered.length ? filtered : products).map((p) => ({ id: p.id, name: p.name, price: p.price, mrp: p.mrp, currency: 'INR', stock: p.stockQty > 0 ? (p.stockQty > p.lowStockThreshold ? 'in stock' : 'low stock') : 'out of stock' }));
      return { ok: true, data: list };
    },
  },
  {
    name: 'get_product_details',
    description: 'Get full details (description, highlights, price, stock, image) for one product by its id.',
    parameters: { type: 'object', properties: { productId: { type: 'string' } }, required: ['productId'] },
    run: async (args) => {
      const products = await listProducts();
      const p = resolveProduct(products, str(args.productId));
      if (!p || p.status !== 'active') return { ok: false, message: 'Product not found' };
      return { ok: true, data: { id: p.id, name: p.name, description: p.description, highlights: p.highlights, price: p.price, mrp: p.mrp, currency: 'INR', stock: p.stockQty, image: p.images.find((i) => i.is_primary)?.url ?? p.images[0]?.url ?? null } };
    },
  },
  {
    name: 'search_knowledge',
    description: 'Search Earthora knowledge (guides, benefits, policies, product info) for facts to answer a question. Returns grounded passages.',
    parameters: { type: 'object', properties: { query: { type: 'string' }, productId: { type: 'string' } }, required: ['query'] },
    run: async (args, ctx) => {
      const hits = await retrieve(str(args.query), { workflowId: ctx.workflowId, topK: 6 });
      return { ok: true, data: hits.map((h, i) => ({ ref: `S${i + 1}`, title: h.documentTitle, text: h.content.slice(0, 600) })) };
    },
  },
  {
    name: 'add_to_cart',
    description: 'Add a product to the customer cart. Ask for quantity first if not given.',
    parameters: { type: 'object', properties: { productId: { type: 'string' }, quantity: { type: 'integer', minimum: 1 } }, required: ['productId', 'quantity'] },
    run: async (args, ctx) => {
      const products = await listProducts();
      const p = resolveProduct(products, str(args.productId));
      if (!p || p.status !== 'active') return { ok: false, message: 'That product is not available' };
      const requested = Math.round(Number(args.quantity) || 1);
      const qty = Math.max(1, Math.min(RETAIL_CART_LIMIT, requested));
      const existing = ctx.state.cart.find((c) => c.productId === p.id);
      const totalQuantity = (existing?.quantity ?? 0) + qty;
      if (requested > RETAIL_CART_LIMIT || totalQuantity > RETAIL_CART_LIMIT) {
        return { ok: false, message: `The retail cart holds at most ${RETAIL_CART_LIMIT} units of a product. Larger quantities are wholesale supply enquiries for the Earthora team, not limited by shop stock; offer to record an enquiry instead.` };
      }
      if (p.stockQty < totalQuantity) return { ok: false, message: `Maximum available quantity is ${Math.min(RETAIL_CART_LIMIT, p.stockQty)}` };
      if (existing) existing.quantity += qty; else ctx.state.cart.push({ productId: p.id, slug: p.slug, name: p.name, quantity: qty, unitPrice: p.price });
      return { ok: true, data: { cart: ctx.state.cart, added: { name: p.name, quantity: qty } }, sideEffect: 'cart' };
    },
  },
  {
    name: 'update_cart',
    description: 'Set the quantity of a product in the cart (0 removes it).',
    parameters: { type: 'object', properties: { productId: { type: 'string' }, quantity: { type: 'integer', minimum: 0 } }, required: ['productId', 'quantity'] },
    run: async (args, ctx) => {
      const qty = Math.max(0, Math.round(Number(args.quantity) || 0));
      const item = ctx.state.cart.find(c => c.productId === args.productId);
      if (!item) return { ok: false, message: 'That product is not in your cart.' };
      if (qty > 0) {
        const product = (await listProducts()).find(p => p.id === item.productId && p.status === 'active');
        if (!product) return { ok: false, message: 'That product is not available' };
        if (qty > RETAIL_CART_LIMIT) return { ok: false, message: `The retail cart holds at most ${RETAIL_CART_LIMIT} units of a product. Larger quantities are wholesale supply enquiries for the Earthora team; offer to record an enquiry instead.` };
        if (qty > product.stockQty) return { ok: false, message: 'That quantity is not available. Please choose a smaller quantity.' };
      }
      ctx.state.cart = ctx.state.cart.flatMap((c) => (c.productId === args.productId ? (qty === 0 ? [] : [{ ...c, quantity: qty }]) : [c]));
      return { ok: true, data: { cart: ctx.state.cart }, sideEffect: 'cart' };
    },
  },
  {
    name: 'get_cart',
    description: 'Show the current cart contents and total.',
    parameters: { type: 'object', properties: {} },
    run: async (_args, ctx) => {
      const priced = await priceCart(ctx.state.cart.map((c) => ({ productId: c.productId, quantity: c.quantity })), { state: ctx.state.checkout.state });
      return { ok: true, data: { items: priced.lines, subtotal: priced.subtotal, total: priced.total } };
    },
  },
  {
    name: 'create_checkout_link',
    description: 'Create a secure review + payment link for the current cart. Requires a non-empty cart and the customer\'s name, phone, email and full delivery address.',
    parameters: { type: 'object', properties: {} },
    requiresConfirmation: true,
    run: async (_args, ctx) => {
      if (!ctx.state.cart.length) return { ok: false, message: 'Cart is empty' };
      const need = ['name', 'phone', 'email', 'address', 'city', 'state', 'zip'].filter((f) => !str(ctx.state.checkout[f]).trim());
      if (need.length) return { ok: false, message: `Missing: ${need.join(', ')}` };
      const customer = checkoutCustomerSchema.safeParse({ ...ctx.state.checkout, country: ctx.state.checkout.country || 'India' });
      if (!customer.success) return { ok: false, message: 'Please correct these delivery details: ' + [...new Set(customer.error.issues.map(issue => issue.path[0]))].join(', ') };
      const priced = await priceCart(ctx.state.cart.map((c) => ({ productId: c.productId, quantity: c.quantity })), { state: ctx.state.checkout.state, country: ctx.state.checkout.country || 'India' });
      if (priced.unavailable.length || priced.outOfStock.length) return { ok: false, message: 'Some cart items are no longer available in that quantity. Please update the cart.' };
      const token = createCheckoutSnapshot(ctx.conversationId, ctx.state.language, customer.data, ctx.state.cart.map(c => ({ productId: c.productId, quantity: c.quantity })));
      const url = `${config.PUBLIC_STORE_URL}/ai-checkout/${encodeURIComponent(token)}`;
      return { ok: true, data: { url, total: priced.total, order_placed: false, payment_required: true }, sideEffect: 'checkout' };
    },
  },
  {
    name: 'get_order_status',
    description: 'Look up an order status by order number, verified with the customer\'s phone or email.',
    parameters: { type: 'object', properties: { orderNumber: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' } }, required: ['orderNumber'] },
    run: async (args, ctx) => {
      const [o] = await sql<any[]>`SELECT id, order_number, status, total_amount, created_at, tracking_url, customer_phone, customer_email FROM orders WHERE order_number = ${str(args.orderNumber)} OR id = ${str(args.orderNumber)} LIMIT 1`;
      if (!o) return { ok: false, message: 'Order not found' };
      const phone = str(args.phone || ctx.contact.phone).replace(/\D/g, '').slice(-10);
      const email = str(args.email || ctx.contact.email).toLowerCase();
      const match = (phone && str(o.customer_phone).replace(/\D/g, '').slice(-10) === phone) || (email && str(o.customer_email).toLowerCase() === email);
      if (!match) return { ok: false, message: 'Please confirm the phone number or email on the order to view its status.' };
      return { ok: true, data: { orderNumber: o.order_number, status: o.status, total: o.total_amount, placed: o.created_at, tracking: o.tracking_url } };
    },
  },
  {
    name: 'capture_callback',
    description: 'Save a callback / follow-up request so the human team can call the customer back. Use when you cannot fully help or the customer asks for a person.',
    parameters: { type: 'object', properties: { name: { type: 'string' }, phone: { type: 'string' }, reason: { type: 'string' } }, required: ['reason'] },
    run: async (args, ctx) => {
      const contact = { name: str(args.name || ctx.contact.name), phone: str(args.phone || ctx.contact.phone), email: str(ctx.contact.email) };
      await sql`INSERT INTO escalations (tenant_id, conversation_id, kind, contact, payload, status) VALUES (${await tenantId()}, ${ctx.conversationId}, 'callback', ${sql.json(contact)}, ${sql.json({ reason: str(args.reason) })}, 'open')`;
      await sql`UPDATE conversations SET needs_follow_up = true, escalated = true WHERE id = ${ctx.conversationId}`;
      await enqueueJob('escalation_notify', { conversationId: ctx.conversationId, reason: str(args.reason), contact }, { dedupeKey: `esc:${ctx.conversationId}:${Date.now()}` });
      return { ok: true, data: { captured: true }, sideEffect: 'escalation' };
    },
  },
  {
    name: 'set_customer_detail',
    description: 'Record a customer checkout detail (name, phone, email, address, city, state, zip, country).',
    parameters: { type: 'object', properties: { field: { type: 'string', enum: ['name', 'phone', 'email', 'address', 'city', 'state', 'zip', 'country'] }, value: { type: 'string' } }, required: ['field', 'value'] },
    run: async (args, ctx) => {
      const field = str(args.field), value = str(args.value).trim();
      if (!['name', 'phone', 'email', 'address', 'city', 'state', 'zip', 'country'].includes(field) || !value || value.length > 500)
        return { ok: false, message: 'Provide a valid delivery field and value. Payment credentials are never collected.' };
      ctx.state.checkout[field] = value;
      return { ok: true, data: { checkout: ctx.state.checkout }, sideEffect: 'checkout' };
    },
  },
];

export const BUILTIN_MAP = new Map(BUILTINS.map((f) => [f.name, f]));

export function toolDefsFor(names: string[]): ToolDef[] {
  return names.map((n) => BUILTIN_MAP.get(n)).filter(Boolean).map((f) => ({ name: f!.name, description: f!.description, parameters: f!.parameters }));
}

/** Seed the functions table from the builtin registry (id-stable by name). */
export async function seedFunctions(tid: string): Promise<void> {
  for (const f of BUILTINS) {
    await sql`INSERT INTO functions (tenant_id, name, kind, description, schema, requires_confirmation)
      VALUES (${tid}, ${f.name}, 'builtin', ${f.description}, ${sql.json(f.parameters as any)}, ${f.requiresConfirmation ?? false})
      ON CONFLICT (tenant_id, name) DO UPDATE SET description = EXCLUDED.description, schema = EXCLUDED.schema`;
  }
}
