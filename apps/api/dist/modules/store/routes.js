import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { config } from '../../config.js';
import { sql } from '../../db/client.js';
import { badRequest, notFound, upstream } from '../../lib/errors.js';
import { brandedEmail, escapeHtml, sendEmail } from '../../lib/email.js';
import { createOrder, fetchOrderExpanded, fetchPayment, razorpayConfigured, verifyCheckoutSignature, verifyWebhookSignature } from '../../lib/razorpay.js';
import { verifySigned } from '../../lib/crypto.js';
import { computeGst, listProducts, priceCart } from '../commerce/pricing.js';
import { finalizeOrder, getOrderBundle } from '../commerce/orders.js';
import { renderInvoiceForOrder } from '../notifications/invoice.js';
import { enqueueJob } from '../jobs/queue.js';
import { checkoutCustomerSchema } from '../../platform/channels/checkoutLink.js';
import { applyPromotionSchema, callbackFields, isCapturedPrepaidOrder, promotionQuerySchema, shippingInfoFor, shippingInfoSchema } from './magicCheckout.js';
const cartSchema = z.object({
    cartItems: z.array(z.object({ productId: z.string().min(1), quantity: z.number().int().min(1).max(50) })).min(1).max(30),
    currency: z.literal('INR').optional(),
});
function noScript(s) {
    return !/<\s*script|javascript:|on\w+\s*=|<\s*iframe/i.test(s);
}
async function magicCheckoutSnapshot(receipt, razorpayOrderId) {
    const [event] = await sql `
    SELECT payload FROM payment_webhook_events
    WHERE provider = 'razorpay' AND event_type = 'order.created.local' AND payload->>'receipt' = ${receipt}
    LIMIT 1`;
    if (!event || (razorpayOrderId && event.payload.razorpay_order_id !== `order_${razorpayOrderId.replace(/^order_/, '')}`))
        return null;
    return event.payload;
}
async function finalizeMagicCheckoutPayment(razorpayOrderId, razorpayPaymentId) {
    const [event] = await sql `SELECT payload FROM payment_webhook_events WHERE provider_event_id = ${`order-created:${razorpayOrderId}`} AND event_type = 'order.created.local'`;
    if (!event?.payload?.cart || event.payload.razorpay_order_id !== razorpayOrderId)
        throw badRequest('Unknown checkout order');
    const [payment, order] = await Promise.all([fetchPayment(razorpayPaymentId), fetchOrderExpanded(razorpayOrderId)]);
    const expectedAmountPaise = event.payload.amountPaise ?? Math.round(Number(event.payload.cart?.total) * 100);
    if (!isCapturedPrepaidOrder({ expectedOrderId: razorpayOrderId, expectedAmountPaise, payment, order }))
        throw badRequest('Payment is not fully captured for this checkout order');
    const details = order.customer_details ?? {};
    const shipping = details.shipping_address ?? {};
    const saved = checkoutCustomerSchema.safeParse(event.payload.customer);
    const delivery = saved.success ? saved.data : null;
    const customer = {
        name: details.name || shipping.name || delivery?.name || (payment.email ?? '').split('@')[0] || 'Guest',
        email: details.email || payment.email || delivery?.email || '',
        phone: details.contact || shipping.contact || payment.contact || delivery?.phone || '',
        address: [shipping.line1, shipping.line2].filter(Boolean).join(', ') || delivery?.address || '',
        city: shipping.city || delivery?.city || '', state: shipping.state || delivery?.state || '', zip: shipping.zipcode || delivery?.zip || '', country: shipping.country || delivery?.country || 'India',
    };
    if (!customer.phone || !customer.address || !customer.city || !/^\d{6}$/.test(customer.zip) || !['in', 'india'].includes(customer.country.toLowerCase()))
        throw badRequest('Delivery address was not provided by Magic Checkout');
    const cart = event.payload.cart;
    if (!Array.isArray(cart.lines) || !cart.lines.length || Math.round(cart.total * 100) !== payment.amount)
        throw badRequest('Checkout amount does not match the priced cart');
    cart.gst = computeGst(cart.total, customer.country, customer.state);
    const result = await finalizeOrder({
        source: 'website', cart, customer,
        payment: { method: 'RAZORPAY', transactionId: razorpayPaymentId, status: 'completed', amount: payment.amount / 100, context: { razorpay_order_id: razorpayOrderId, method: payment.method ?? null } },
    });
    return { success: true, orderId: result.orderId, orderNumber: result.orderNumber, amount: payment.amount, currency: payment.currency, customer, shipping_address: shipping };
}
export async function storeRoutes(app) {
    /** Everything the storefront catalogue needs in one call (products + inventory, reviews). */
    app.get('/store/catalog', async (_req, reply) => {
        const [products, reviews] = await Promise.all([
            listProducts(),
            sql `SELECT review_product_id, review_user_id, review_rating, review_comment, review_created_at FROM review_details ORDER BY review_created_at DESC LIMIT 500`,
        ]);
        reply.header('Cache-Control', 'no-store');
        return {
            products: products.filter(p => p.status === 'active').map((p) => ({ id: p.id, name: p.name, slug: p.slug, price: p.price, mrp: p.mrp, status: p.status, tag: p.tag, badge: p.badge, description: p.description, highlights: p.highlights, images: p.images, rating: p.rating, created_at: p.created_at, inventory: [{ total_stock: p.stockQty }] })),
            reviews,
        };
    });
    app.get('/store/products/:slug', async (req) => {
        const { slug } = req.params;
        const products = await listProducts();
        const p = products.find((x) => x.status === 'active' && (x.slug === slug || x.id === slug));
        if (!p)
            throw notFound('Product not found');
        return { product: p };
    });
    app.post('/store/reviews', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req) => {
        const body = z.object({ productId: z.string().uuid(), name: z.string().min(1).max(80), rating: z.number().min(1).max(5), comment: z.string().max(1000) }).safeParse(req.body);
        if (!body.success)
            throw badRequest('Invalid review');
        if (!noScript(body.data.comment) || !noScript(body.data.name))
            throw badRequest('Invalid characters');
        await sql `INSERT INTO review_details (review_product_id, review_user_id, review_rating, review_comment) VALUES (${body.data.productId}, ${body.data.name}, ${body.data.rating}, ${body.data.comment})`;
        return { ok: true };
    });
    app.post('/store/contact', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req) => {
        const body = z.object({ name: z.string().min(1).max(120), email: z.string().email(), phone: z.string().max(30).optional().default(''), topic: z.string().max(120).optional().default('General'), message: z.string().min(1).max(4000), marketingConsent: z.boolean().optional().default(false) }).safeParse(req.body);
        if (!body.success)
            throw badRequest('Please fill the form correctly');
        const d = body.data;
        if (![d.name, d.message, d.topic].every(noScript))
            throw badRequest('Invalid characters in message');
        await sql `INSERT INTO "Contact_details" (contact_name, contact_email, contact_phone, contact_topic, contact_message, contact_marketing_consent) VALUES (${d.name}, ${d.email}, ${d.phone}, ${d.topic}, ${d.message}, ${d.marketingConsent})`;
        await enqueueJob('contact_email', { ...d });
        return { ok: true };
    });
    app.post('/store/newsletter', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req) => {
        const body = z.object({ email: z.string().email() }).safeParse(req.body);
        if (!body.success)
            throw badRequest('Enter a valid email');
        await sql `INSERT INTO "Contact_details" (contact_name, contact_email, contact_topic, contact_message, contact_marketing_consent) VALUES ('Newsletter', ${body.data.email}, 'newsletter', 'Newsletter signup', true)`;
        return { ok: true };
    });
    app.post('/store/restock-request', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req) => {
        const body = z.object({ productId: z.string().uuid(), phone: z.string().min(8).max(20) }).safeParse(req.body);
        if (!body.success)
            throw badRequest('Product and phone are required');
        await sql `INSERT INTO customer_restock_requests (product_id, customer_phone) VALUES (${body.data.productId}, ${body.data.phone}) ON CONFLICT (product_id, customer_phone) DO NOTHING`;
        return { ok: true };
    });
    app.post('/store/analytics', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
        const body = z.object({ page: z.string().max(200), device: z.string().max(60).optional(), os: z.string().max(60).optional(), browser: z.string().max(60).optional(), country: z.string().max(60).optional(), city: z.string().max(60).optional() }).safeParse(req.body);
        if (!body.success)
            return { ok: false };
        const d = body.data;
        await sql `INSERT INTO "Admin_analytics" (page_name, visitor_ip, visitor_device, visitor_os, visitor_browser, visitor_country, visitor_city) VALUES (${d.page}, ${req.ip}, ${d.device ?? ''}, ${d.os ?? ''}, ${d.browser ?? ''}, ${d.country ?? ''}, ${d.city ?? ''})`;
        return { ok: true };
    });
    /** Price a cart (used by the cart page to show live totals). */
    app.post('/store/checkout/price', async (req) => {
        const body = cartSchema.safeParse(req.body);
        if (!body.success)
            throw badRequest('Invalid cart');
        return priceCart(body.data.cartItems);
    });
    // Public, unauthenticated URLs for Razorpay's Magic Checkout dashboard.
    // An unguessable receipt binds every callback to a server-created cart.
    app.route({ method: ['GET', 'POST'], url: '/store/checkout/magic/shipping-info', config: { rateLimit: { max: 120, timeWindow: '1 minute' } }, handler: async (req, reply) => {
            reply.header('Cache-Control', 'no-store');
            const parsed = shippingInfoSchema.safeParse(callbackFields(req.query, req.body));
            if (!parsed.success)
                throw badRequest('Invalid shipping information');
            const snapshot = await magicCheckoutSnapshot(parsed.data.order_id, parsed.data.razorpay_order_id);
            if (!snapshot)
                throw notFound('Checkout order not found');
            return shippingInfoFor(parsed.data.addresses);
        } });
    app.route({ method: ['GET', 'POST'], url: '/store/checkout/magic/promotions', config: { rateLimit: { max: 120, timeWindow: '1 minute' } }, handler: async (req, reply) => {
            reply.header('Cache-Control', 'no-store');
            const parsed = promotionQuerySchema.safeParse(callbackFields(req.query, req.body));
            if (!parsed.success)
                throw badRequest('Invalid promotion request');
            if (!await magicCheckoutSnapshot(parsed.data.order_id))
                throw notFound('Checkout order not found');
            // No store coupon policy is active. The checkout UI hides coupon entry.
            return { promotions: [] };
        } });
    app.route({ method: ['GET', 'POST'], url: '/store/checkout/magic/apply-promotion', config: { rateLimit: { max: 120, timeWindow: '1 minute' } }, handler: async (req, reply) => {
            reply.header('Cache-Control', 'no-store');
            const parsed = applyPromotionSchema.safeParse(callbackFields(req.query, req.body));
            if (!parsed.success)
                throw badRequest('Invalid promotion request');
            if (!await magicCheckoutSnapshot(parsed.data.order_id))
                throw notFound('Checkout order not found');
            return { failure_code: 'INVALID_PROMOTION', failure_reason: 'This promotion is not available.' };
        } });
    /** Creates the Razorpay order from server-side prices (Magic Checkout collects the address). */
    app.post('/store/checkout/order', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req) => {
        if (!razorpayConfigured())
            throw upstream('Payments are not configured');
        const body = cartSchema.extend({ customer: checkoutCustomerSchema.optional() }).safeParse(req.body);
        if (!body.success)
            throw badRequest('Invalid cart');
        const cart = await priceCart(body.data.cartItems, { country: body.data.customer?.country, state: body.data.customer?.state });
        if (cart.unavailable.length)
            throw badRequest('Some products are no longer available');
        if (cart.outOfStock.length)
            throw badRequest('Some products are out of stock', cart.outOfStock);
        const amountPaise = Math.round(cart.total * 100);
        if (amountPaise < 100)
            throw badRequest('Order total is below the minimum amount');
        const products = await listProducts();
        const productById = new Map(products.map((p) => [p.id, p]));
        const lineItems = cart.lines.map((line) => {
            const product = productById.get(line.productId);
            const image = product?.images.find((item) => item.is_primary)?.url || product?.images[0]?.url || '';
            const imageUrl = image.startsWith('http') ? image : image ? new URL(image, config.PUBLIC_STORE_URL).toString() : '';
            return {
                sku: line.slug, variant_id: line.productId,
                price: Math.round(Math.max(line.mrp, line.unitPrice) * 100),
                offer_price: Math.round(line.unitPrice * 100), quantity: line.quantity,
                name: line.name, description: product?.description || line.name,
                ...(imageUrl ? { image_url: imageUrl } : {}),
                product_url: `${config.PUBLIC_STORE_URL}/our-product?open=${line.productId}`,
            };
        });
        const receipt = `mc_${randomBytes(16).toString('hex')}`;
        const order = await createOrder({ amountPaise, currency: 'INR', receipt, lineItems, notes: { source: 'website' } });
        await sql `INSERT INTO payment_webhook_events (provider, provider_event_id, event_type, signature_valid, payload, processing_status) VALUES ('razorpay', ${`order-created:${order.id}`}, 'order.created.local', true, ${sql.json({ cart: cart, receipt, amountPaise, razorpay_order_id: order.id, customer: body.data.customer ?? null })}, 'processed')`;
        return { order_id: order.id, amount: order.amount, currency: order.currency, key_id: config.RAZORPAY_KEY_ID };
    });
    /** Verifies the checkout signature, pulls customer + shipping from Razorpay, finalizes the order server-side. */
    app.post('/store/checkout/verify', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req) => {
        const body = z.object({ razorpay_order_id: z.string(), razorpay_payment_id: z.string(), razorpay_signature: z.string() }).safeParse(req.body);
        if (!body.success)
            throw badRequest('Missing payment fields');
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body.data;
        const [event] = await sql `SELECT payload FROM payment_webhook_events WHERE provider_event_id = ${`order-created:${razorpay_order_id}`} AND event_type = 'order.created.local'`;
        if (!event?.payload?.cart || event.payload.razorpay_order_id !== razorpay_order_id)
            throw badRequest('Unknown checkout order');
        if (!verifyCheckoutSignature(event.payload.razorpay_order_id, razorpay_payment_id, razorpay_signature))
            throw badRequest('Payment signature mismatch');
        return finalizeMagicCheckoutPayment(razorpay_order_id, razorpay_payment_id);
    });
    /** Signed provider callback recovers a paid order when the browser never returns. */
    app.post('/store/checkout/magic/webhook', async (req) => {
        if (!config.RAZORPAY_WEBHOOK_SECRET)
            throw upstream('Payment webhook is not configured');
        const signature = String(req.headers['x-razorpay-signature'] ?? '');
        const raw = req.rawBody ?? '';
        if (!signature || !verifyWebhookSignature(raw, signature))
            throw badRequest('Invalid webhook signature');
        const parsed = z.object({
            event: z.string(),
            payload: z.object({ payment: z.object({ entity: z.object({ id: z.string(), order_id: z.string().nullable() }) }) }).passthrough(),
        }).safeParse(req.body);
        if (!parsed.success || parsed.data.event !== 'payment.captured' || !parsed.data.payload.payment.entity.order_id)
            return { ok: true, ignored: true };
        const { id: paymentId, order_id: orderId } = parsed.data.payload.payment.entity;
        const [created] = await sql `SELECT id FROM payment_webhook_events WHERE provider_event_id = ${`order-created:${orderId}`}`;
        if (!created)
            return { ok: true, ignored: true };
        const eventId = String(req.headers['x-razorpay-event-id'] || `payment.captured:${paymentId}`).slice(0, 200);
        const inboxKey = `magic-webhook:${eventId}`;
        const [inbox] = await sql `
      INSERT INTO payment_webhook_events (provider, provider_event_id, event_type, signature_valid, payload, processing_status, attempt_count)
      VALUES ('razorpay', ${inboxKey}, 'payment.captured', true, ${sql.json(req.body)}, 'received', 1)
      ON CONFLICT (provider_event_id) DO UPDATE SET attempt_count = payment_webhook_events.attempt_count + 1
      RETURNING processing_status`;
        if (inbox.processing_status === 'processed')
            return { ok: true, duplicate: true };
        try {
            await finalizeMagicCheckoutPayment(orderId, paymentId);
            await sql `UPDATE payment_webhook_events SET processing_status = 'processed', processed_at = now(), last_error = NULL WHERE provider_event_id = ${inboxKey}`;
            return { ok: true };
        }
        catch (error) {
            await sql `UPDATE payment_webhook_events SET processing_status = 'failed', last_error = ${error instanceof Error ? error.message.slice(0, 500) : 'Unknown error'} WHERE provider_event_id = ${inboxKey}`;
            throw error;
        }
    });
    app.get('/store/orders/:orderId', async (req) => {
        const { orderId } = req.params;
        const { email, phone } = req.query;
        const bundle = await getOrderBundle(orderId);
        if (!bundle)
            throw notFound('Order not found');
        const o = bundle.order;
        const match = (email && o.customer_email && email.toLowerCase() === String(o.customer_email).toLowerCase()) || (phone && o.customer_phone && phone.replace(/\D/g, '').slice(-10) === String(o.customer_phone).replace(/\D/g, '').slice(-10));
        if (!match)
            throw notFound('Order not found');
        return { order: { id: o.id, order_number: o.order_number, status: o.status, total_amount: o.total_amount, created_at: o.created_at, tracking_url: o.tracking_url ?? null, items: bundle.items.map((i) => ({ name: i.product_name, quantity: i.quantity, unit_price: i.unit_price, total_price: i.total_price })) } };
    });
    /** Signed invoice download: token = signPayload(orderId). */
    app.get('/store/invoice/:token', async (req, reply) => {
        const orderId = verifySigned(req.params.token);
        if (!orderId)
            throw notFound('Invoice link is invalid');
        const pdf = await renderInvoiceForOrder(orderId, 'en');
        reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `inline; filename="invoice-${orderId}.pdf"`);
        return reply.send(pdf);
    });
    app.get('/store/health', async () => ({ ok: true, products: (await listProducts()).length }));
    // Contact-form email is sent by the worker, but keep a direct helper for tests
    app.post('/store/_preview-email', { preHandler: app.requireStaff('developer') }, async (req) => {
        const body = z.object({ to: z.string().email() }).parse(req.body);
        await sendEmail({ to: body.to, kind: 'preview', subject: 'Earthora email preview', html: brandedEmail('Preview', `<p>${escapeHtml('Hello from the new Earthora platform.')}</p>`) });
        return { ok: true };
    });
}
//# sourceMappingURL=routes.js.map