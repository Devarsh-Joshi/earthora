import { z } from 'zod';

// Razorpay documents GET callbacks with a JSON request body. Accept both that
// form and query parameters, since proxies commonly strip bodies from GETs.
const addressSchema = z.object({
  id: z.string().min(1).max(100),
  zipcode: z.string().max(20),
  state_code: z.string().max(10).optional(),
  country: z.string().max(2),
});

export const shippingInfoSchema = z.object({
  order_id: z.string().min(1).max(40),
  razorpay_order_id: z.string().max(100).optional(),
  addresses: z.array(addressSchema).min(1).max(20),
});

export const promotionQuerySchema = z.object({
  order_id: z.string().min(1).max(40),
  contact: z.string().max(30).optional(),
  email: z.string().max(255).optional(),
});

export const applyPromotionSchema = promotionQuerySchema.extend({ code: z.string().min(1).max(100) });

export function callbackFields(query: unknown, body: unknown): Record<string, unknown> {
  const merged = { ...(query && typeof query === 'object' ? query : {}), ...(body && typeof body === 'object' ? body : {}) };
  const fields = merged as Record<string, unknown>;
  if (typeof fields.addresses === 'string') {
    try { fields.addresses = JSON.parse(fields.addresses); } catch { /* Zod rejects malformed addresses. */ }
  }
  return fields;
}

/** Free prepaid delivery to valid Indian PIN codes; COD is not offered. */
export function shippingInfoFor(addresses: z.infer<typeof addressSchema>[]) {
  return {
    addresses: addresses.map((address) => ({
      id: address.id,
      zipcode: address.zipcode,
      state_code: address.state_code,
      country: address.country,
      shipping_methods: [{
        id: 'earthora-free',
        name: 'Free delivery',
        description: 'Free shipping across India',
        serviceable: address.country.toUpperCase() === 'IN' && /^\d{6}$/.test(address.zipcode),
        shipping_fee: 0,
        cod: false,
        cod_fee: 0,
      }],
    })),
  };
}

export function isCapturedPrepaidOrder(input: {
  expectedOrderId: string;
  expectedAmountPaise: number;
  payment: { order_id: string; status: string; currency: string; amount: number };
  order: { id: string; status: string; currency: string; amount_paid: number };
}): boolean {
  const { expectedOrderId, expectedAmountPaise, payment, order } = input;
  return payment.order_id === expectedOrderId && order.id === expectedOrderId &&
    payment.status === 'captured' && order.status === 'paid' &&
    payment.currency === 'INR' && order.currency === 'INR' &&
    payment.amount === expectedAmountPaise && order.amount_paid === payment.amount;
}
