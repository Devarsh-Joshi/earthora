import { config } from '../config.js';
import { hmacHex, safeEqual } from './crypto.js';
import { upstream } from './errors.js';
const BASE = 'https://api.razorpay.com/v1';
function authHeader() {
    return 'Basic ' + Buffer.from(`${config.RAZORPAY_KEY_ID}:${config.RAZORPAY_KEY_SECRET}`).toString('base64');
}
export function razorpayConfigured() {
    return Boolean(config.RAZORPAY_KEY_ID && config.RAZORPAY_KEY_SECRET);
}
async function rz(method, path, body) {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (!res.ok)
        throw upstream(`Razorpay ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
}
export function createOrder(input) {
    return rz('POST', '/orders', {
        amount: input.amountPaise,
        currency: input.currency,
        receipt: input.receipt,
        line_items_total: input.amountPaise,
        line_items: input.lineItems,
        notes: input.notes,
    });
}
export const fetchPayment = (paymentId) => rz('GET', `/payments/${encodeURIComponent(paymentId)}`);
export const fetchOrderExpanded = (orderId) => rz('GET', `/orders/${encodeURIComponent(orderId)}?expand[]=customer_details`);
export function verifyCheckoutSignature(orderId, paymentId, signature) {
    const expected = hmacHex(config.RAZORPAY_KEY_SECRET, `${orderId}|${paymentId}`);
    return safeEqual(expected, signature);
}
export function verifyWebhookSignature(rawBody, signature) {
    if (!config.RAZORPAY_WEBHOOK_SECRET)
        return false;
    return safeEqual(hmacHex(config.RAZORPAY_WEBHOOK_SECRET, rawBody), signature);
}
export function createPaymentLink(input) {
    return rz('POST', '/payment_links', {
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
//# sourceMappingURL=razorpay.js.map