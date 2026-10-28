/** A short-lived, authenticated checkout snapshot. No order or notification is created. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { notFound } from '../../lib/errors.js';
import { decryptText, encryptText } from '../../lib/crypto.js';
import { priceCart } from '../../modules/commerce/pricing.js';

export const checkoutCustomerSchema = z.object({
  name: z.string().trim().min(1).max(120), email: z.string().trim().email().max(255),
  phone: z.string().trim().min(8).max(30).regex(/^\+?[\d\s()-]+$/),
  address: z.string().trim().min(3).max(500), city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100), zip: z.string().trim().min(3).max(20),
  country: z.string().trim().min(1).max(80).default('India'),
}).strict();
const snapshotSchema = z.object({
  kind: z.literal('earthora-checkout-link'), expires: z.number().int(),
  conversation: z.string().min(1).max(180), language: z.enum(['en', 'hi', 'gu']),
  customer: checkoutCustomerSchema,
  items: z.array(z.object({ productId: z.string().min(1).max(120), quantity: z.number().int().min(1).max(50) }).strict()).min(1).max(30),
}).strict();
export type CheckoutCustomer = z.infer<typeof checkoutCustomerSchema>;

export function createCheckoutSnapshot(conversation: string, language: string, customer: CheckoutCustomer, items: {productId: string; quantity: number}[]): string {
  const value = snapshotSchema.parse({ kind: 'earthora-checkout-link', expires: Date.now() + 60 * 60 * 1000, conversation,
    language: ['hi', 'gu'].includes(language) ? language : 'en', customer, items });
  return 'vc1.' + encryptText(JSON.stringify(value));
}

export function readCheckoutSnapshot(token: string) {
  if (!/^vc1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) || token.length > 8192) return null;
  try {
    const value = snapshotSchema.parse(JSON.parse(decryptText(token.slice(4))));
    if (value.expires <= Date.now() || value.expires > Date.now() + 61 * 60 * 1000) return null;
    return value;
  } catch { return null; }
}

export async function checkoutSnapshotView(token: string) {
  const snapshot = readCheckoutSnapshot(token);
  if (!snapshot) return null;
  const priced = await priceCart(snapshot.items, { country: snapshot.customer.country, state: snapshot.customer.state });
  return { customer: snapshot.customer, language: snapshot.language, expires_at: snapshot.expires,
    items: priced.lines, pricing: { subtotal: priced.subtotal, total: priced.total, currency: 'INR' },
    available: !priced.unavailable.length && !priced.outOfStock.length };
}

/** Read-only review data for the /ai-checkout page the chat assistant links to. */
export async function checkoutLinkRoutes(app: FastifyInstance): Promise<void> {
  // The encrypted snapshot exceeds Fastify's 100-character named-parameter limit.
  // The wildcard is still strictly bounded and authenticated by readCheckoutSnapshot.
  app.get('/platform/checkout/*', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
    const view = await checkoutSnapshotView(String((req.params as { '*': string })['*']));
    if (!view) throw notFound('This checkout link is invalid or expired. Ask Eva for a new one.');
    return view;
  });
}
