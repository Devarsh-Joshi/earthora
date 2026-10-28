/**
 * One order-finalization contract for every channel. Writes orders / order_items / Payments / Order_history
 * (+ User_details upsert) atomically. Stock is deducted by the existing order_items trigger — never here.
 * Idempotent on the payment transaction id.
 */
import { randomBytes } from 'node:crypto';
import { sql } from '../../db/client.js';
import { conflict } from '../../lib/errors.js';
import { enqueueJob } from '../jobs/queue.js';
const PREFIX = { website: 'WEB', offline: 'OFF', chat: 'CH' };
export function newOrderNumber(source) {
    return `${PREFIX[source]}-${randomBytes(5).toString('hex').toUpperCase()}`;
}
export async function finalizeOrder(input) {
    const { cart, customer } = input;
    if (cart.lines.length === 0)
        throw conflict('Cart is empty');
    const orderId = input.orderId ?? newOrderNumber(input.source);
    const status = input.status ?? (input.payment.status === 'completed' ? 'processing' : 'pending');
    const result = await sql.begin(async (tx) => {
        // Serialize finalization attempts for the same provider transaction.
        await tx `SELECT pg_advisory_xact_lock(hashtextextended(${input.payment.transactionId}, 0))`;
        const existing = await tx `SELECT payment_order_id FROM "Payments" WHERE payment_transaction_id = ${input.payment.transactionId} LIMIT 1`;
        if (existing[0])
            return { orderId: existing[0].payment_order_id, created: false };
        if (customer.email) {
            await tx `INSERT INTO "User_details" (user_email, user_name, user_password, user_phone, user_address, user_city, user_state, user_zip, user_country, user_gst)
               VALUES (${customer.email}, ${customer.name}, '', ${customer.phone}, ${customer.address}, ${customer.city}, ${customer.state}, ${customer.zip}, ${customer.country}, ${customer.gst ?? ''})
               ON CONFLICT (user_email) DO UPDATE SET user_name = EXCLUDED.user_name, user_phone = EXCLUDED.user_phone, user_address = EXCLUDED.user_address,
                 user_city = EXCLUDED.user_city, user_state = EXCLUDED.user_state, user_zip = EXCLUDED.user_zip, user_country = EXCLUDED.user_country, user_updated_at = now()`;
        }
        await tx `INSERT INTO orders (id, order_number, user_id, status, total_amount, shipping_address, customer_name, customer_email, customer_phone, customer_address,
               customer_city, customer_state, customer_zip, customer_country, customer_gst)
             VALUES (${orderId}, ${orderId}, ${customer.email || customer.phone || 'guest'}, ${status}, ${cart.total},
               ${sql.json({ name: customer.name, email: customer.email, phone: customer.phone, address: customer.address, city: customer.city, state: customer.state, zip: customer.zip, country: customer.country, source: input.source, ...(input.notes ?? {}) })},
               ${customer.name}, ${customer.email}, ${customer.phone}, ${customer.address}, ${customer.city}, ${customer.state}, ${customer.zip}, ${customer.country}, ${customer.gst ?? ''})`;
        for (const line of cart.lines) {
            await tx `INSERT INTO order_items (order_id, product_id, quantity, unit_price, total_price) VALUES (${orderId}, ${line.productId}, ${line.quantity}, ${line.unitPrice}, ${line.lineTotal})`;
        }
        await tx `INSERT INTO "Payments" (payment_order_id, payment_amount, payment_status, payment_method, payment_transaction_id, payment_context)
             VALUES (${orderId}, ${String(input.payment.amount)}, ${input.payment.status}, ${input.payment.method}, ${input.payment.transactionId}, ${sql.json((input.payment.context ?? {}))})`;
        await tx `INSERT INTO "Order_history" (order_id, order_status) VALUES (${orderId}, ${status})`;
        return { orderId, created: true };
    });
    if (result.created) {
        await enqueueJob('send_invoice', { orderId: result.orderId }, { dedupeKey: `invoice:${result.orderId}` });
        await enqueueJob('order_notify_admin', { orderId: result.orderId }, { dedupeKey: `order-admin:${result.orderId}` });
    }
    return { orderId: result.orderId, orderNumber: result.orderId, total: cart.total, created: result.created };
}
export async function getOrderBundle(orderId) {
    const [order] = await sql `SELECT * FROM orders WHERE id = ${orderId} OR order_number = ${orderId} LIMIT 1`;
    if (!order)
        return null;
    const items = await sql `SELECT oi.*, p.name AS product_name, p.hsn_code, p.slug FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ${order.id} ORDER BY oi.id`;
    const [payment] = await sql `SELECT * FROM "Payments" WHERE payment_order_id = ${order.id} ORDER BY id DESC LIMIT 1`;
    const history = await sql `SELECT * FROM "Order_history" WHERE order_id = ${order.id} ORDER BY id`;
    return { order, items, payment: payment ?? null, history };
}
export async function setOrderStatus(orderId, status, actor) {
    await sql.begin(async (tx) => {
        await tx `UPDATE orders SET status = ${status} WHERE id = ${orderId}`;
        await tx `INSERT INTO "Order_history" (order_id, order_status) VALUES (${orderId}, ${status})`;
        await tx `INSERT INTO audit_log (actor_email, action, target, detail) VALUES (${actor ?? null}, 'order.status', ${orderId}, ${sql.json({ status })})`;
    });
}
//# sourceMappingURL=orders.js.map