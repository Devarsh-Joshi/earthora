import { config } from '../config.js';
import { hmacHex, safeEqual } from './crypto.js';
import { upstream } from './errors.js';

const BASE = 'https://api.razorpay.com/v1';

function authHeader(): string {
  return 'Basic ' + Buffer.from(`${config.RAZORPAY_KEY_ID}:${config.RAZORPAY_KEY_SECRET}`).toString('base64');
}

export function razorpayConfigured(): boolean {
  return Boolean(config.RAZORPAY_KEY_ID && config.RAZORPAY_KEY_SECRET);
}

async function rz<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw upstream(`Razorpay ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

export interface RazorpayLineItem {
  sku: string; variant_id: string; price: number; offer_price: number; quantity: number;
  name: string; description: string; image_url?: string; product_url?: string;
}

export interface RazorpayOrder { id: string; amount: number; amount_paid: number; currency: string; receipt?: string; status: string; notes?: Record<string, string> }

export function createOrder(input: { amountPaise: number; currency: string; receipt: string; lineItems: RazorpayLineItem[]; notes?: Record<string, string> }): Promise<RazorpayOrder> {
  return rz<RazorpayOrder>('POST', '/orders', {
    amount: input.amountPaise,
    currency: input.currency,
    receipt: input.receipt,
    line_items_total: input.amountPaise,
    line_items: input.lineItems,
    notes: input.notes,
  });
}

export interface RazorpayPayment {
  id: string; order_id: string; amount: number; currency: string; status: string; method?: string; email?: string; contact?: string;
  notes?: Record<string, string>; created_at: number;
}

export interface RazorpayOrderExpanded extends RazorpayOrder {
  customer_details?: {
    name?: string; email?: string; contact?: string;
    shipping_address?: { line1?: string; line2?: string; city?: string; state?: string; country?: string; zipcode?: string; name?: string; contact?: string };
    billing_address?: { line1?: string; line2?: string; city?: string; state?: string; country?: string; zipcode?: string };
  };
}

export const fetchPayment = (paymentId: string) => rz<RazorpayPayment>('GET', `/payments/${encodeURIComponent(paymentId)}`);
export const fetchOrderExpanded = (orderId: string) => rz<RazorpayOrderExpanded>('GET', `/orders/${encodeURIComponent(orderId)}?expand[]=customer_details`);

export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
  const expected = hmacHex(config.RAZORPAY_KEY_SECRET, `${orderId}|${paymentId}`);
  return safeEqual(expected, signature);
}

export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  if (!config.RAZORPAY_WEBHOOK_SECRET) return false;
  return safeEqual(hmacHex(config.RAZORPAY_WEBHOOK_SECRET, rawBody), signature);
}

export interface RazorpayPaymentLink { id: string; short_url: string; status: string; amount: number; reference_id?: string }

export function createPaymentLink(input: { amountPaise: number; referenceId: string; description: string; customer: { name?: string; email?: string; contact?: string }; callbackUrl?: string; notes?: Record<string, string> }): Promise<RazorpayPaymentLink> {
  return rz<RazorpayPaymentLink>('POST', '/payment_links', {
    amount: input.amountPaise,
    currency: 'INR',
    accept_partial: false,
    reference_id: input.referenceId,
    description: input.description,
    customer: input.customer,
    notify: { sms: false, email: false },
    reminder_enable: false,
    notes: input.notes,
    callback_url: input.callbackUrl,
    callback_method: input.callbackUrl ? 'get' : undefined,
  });
}
