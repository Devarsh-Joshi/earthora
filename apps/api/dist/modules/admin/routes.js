import { z } from 'zod';
import { sql } from '../../db/client.js';
import { storeAsset } from '../../lib/assets.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { getOrderBundle, setOrderStatus } from '../commerce/orders.js';
import { enqueueJob, retryJob } from '../jobs/queue.js';
import { enqueueKbSync } from '../../platform/kb/sync.js';
import { runGatewayQuery } from './gateway.js';
const KNOWLEDGE_CATEGORIES = ['description', 'benefits', 'dosage', 'directions', 'ingredients', 'warnings', 'contraindications', 'storage', 'faq'];
export async function adminRoutes(app) {
    app.post('/admin/query', { preHandler: app.requireStaff() }, async (req) => runGatewayQuery(req.body, req.staff.roles));
    /** Multipart image upload → asset store → products.images jsonb (is_primary handling as before). */
    app.post('/admin/products/:id/images', { preHandler: app.requireStaff('admin') }, async (req) => {
        const { id } = req.params;
        const file = await req.file({ limits: { fileSize: 10 * 1024 * 1024 } });
        if (!file)
            throw badRequest('No file uploaded');
        if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(file.mimetype))
            throw badRequest('Only JPG, PNG, WEBP, GIF or AVIF images are allowed');
        const bytes = await file.toBuffer();
        // Consume the file first so metadata sent after it is also available.
        const fields = Object.fromEntries(Object.entries(file.fields).map(([k, v]) => [k, v?.value]));
        const isPrimary = String(fields.is_primary ?? 'false') === 'true';
        const [product] = await sql `SELECT id, slug, images FROM products WHERE id = ${id}`;
        if (!product)
            throw notFound('Product not found');
        const asset = await storeAsset({ kind: 'product-images', folder: product.slug, filename: file.filename || 'image', mime: file.mimetype, bytes, refTable: 'products', refId: id, createdBy: req.staff.id });
        const images = Array.isArray(product.images) ? product.images : [];
        const next = images.map((i) => ({ ...i, is_primary: isPrimary ? false : i.is_primary }));
        next.push({ url: asset.url, is_primary: isPrimary || next.length === 0, alt: String(fields.alt ?? '') });
        // Staged uploads are durable assets; the admin save publishes the complete
        // image list only after every upload succeeds. Existing consumers still append.
        if (String(fields.persist ?? 'true') !== 'false') {
            await sql `UPDATE products SET images = ${sql.json(next)} WHERE id = ${id}`;
        }
        return { success: true, url: asset.url, images: next };
    });
    app.post('/admin/inventory/restock', { preHandler: app.requireStaff('admin') }, async (req) => {
        const body = z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(100000), note: z.string().max(200).optional() }).safeParse(req.body);
        if (!body.success)
            throw badRequest('Invalid restock');
        await sql `SELECT restock_product(${body.data.productId}::uuid, ${body.data.quantity}::int, ${body.data.note ?? 'admin restock'}::text)`;
        await sql `INSERT INTO audit_log (actor_id, actor_email, action, target, detail) VALUES (${req.staff.id}, ${req.staff.email}, 'inventory.restock', ${body.data.productId}, ${sql.json(body.data)})`;
        const [inv] = await sql `SELECT total_stock, low_stock_threshold FROM inventory WHERE product_id = ${body.data.productId}`;
        return { ok: true, inventory: inv ?? null };
    });
    app.post('/admin/orders/:id/status', { preHandler: app.requireStaff('admin') }, async (req) => {
        const body = z.object({ status: z.string().min(2).max(40) }).safeParse(req.body);
        if (!body.success)
            throw badRequest('Status required');
        await setOrderStatus(req.params.id, body.data.status, req.staff.email);
        return { ok: true };
    });
    app.post('/admin/orders/:id/tracking', { preHandler: app.requireStaff('admin') }, async (req) => {
        const { id } = req.params;
        const body = z.object({ trackingUrl: z.string().url().max(500) }).safeParse(req.body);
        if (!body.success)
            throw badRequest('A valid http(s) tracking URL is required');
        const bundle = await getOrderBundle(id);
        if (!bundle)
            throw notFound('Order not found');
        const now = new Date();
        await sql.begin(async (tx) => {
            await tx `UPDATE orders SET tracking_url = ${body.data.trackingUrl}, tracking_sent_at = ${now}, status = 'out_for_delivery' WHERE id = ${bundle.order.id}`;
            await tx `INSERT INTO "Order_history" (order_id, order_status) VALUES (${bundle.order.id}, 'out_for_delivery')`;
            await tx `INSERT INTO audit_log (actor_id, actor_email, action, target, detail) VALUES (${req.staff.id}, ${req.staff.email}, 'order.tracking', ${bundle.order.id}, ${sql.json(body.data)})`;
        });
        await enqueueJob('tracking_notification', { orderId: bundle.order.id, trackingUrl: body.data.trackingUrl });
        return { ok: true, trackingSentAt: now.toISOString(), status: 'out_for_delivery' };
    });
    app.post('/admin/orders/:id/resend-invoice', { preHandler: app.requireStaff('admin') }, async (req) => {
        const { id } = req.params;
        await enqueueJob('send_invoice', { orderId: id }, { dedupeKey: `invoice:${id}:${Date.now()}` });
        return { ok: true };
    });
    /** Product knowledge: content edits always land as draft; approval is a separate explicit action. */
    app.post('/admin/knowledge', { preHandler: app.requireStaff('admin') }, async (req) => {
        const base = z.object({ action: z.enum(['create', 'update', 'status', 'delete']) });
        const head = base.safeParse(req.body);
        if (!head.success)
            throw badRequest('action required');
        const body = req.body;
        const actor = req.staff.email;
        if (head.data.action === 'create') {
            const d = z.object({ product_id: z.string().uuid(), category: z.enum(KNOWLEDGE_CATEGORIES), question: z.string().max(500).optional().nullable(), content: z.string().min(1).max(8000), locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).optional().default('en-IN') }).safeParse(body);
            if (!d.success)
                throw badRequest('Invalid knowledge entry', d.error.flatten());
            const [row] = await sql `INSERT INTO product_knowledge (product_id, category, question, content, locale, status) VALUES (${d.data.product_id}, ${d.data.category}, ${d.data.question ?? null}, ${d.data.content}, ${d.data.locale}, 'draft') RETURNING *`;
            void enqueueKbSync('knowledge-create');
            return { ok: true, row };
        }
        const id = z.string().uuid().safeParse(body.id);
        if (!id.success)
            throw badRequest('id required');
        if (head.data.action === 'update') {
            const d = z.object({ question: z.string().max(500).optional().nullable(), content: z.string().min(1).max(8000).optional(), category: z.enum(KNOWLEDGE_CATEGORIES).optional(), locale: z.string().optional() }).safeParse(body);
            if (!d.success)
                throw badRequest('Invalid patch');
            const [row] = await sql `UPDATE product_knowledge SET question = COALESCE(${d.data.question ?? null}, question), content = COALESCE(${d.data.content ?? null}, content), category = COALESCE(${d.data.category ?? null}, category), locale = COALESCE(${d.data.locale ?? null}, locale), status = 'draft', approved_by = NULL, approved_at = NULL, version = version + 1 WHERE id = ${id.data} RETURNING *`;
            void enqueueKbSync('knowledge-update');
            return { ok: true, row };
        }
        if (head.data.action === 'status') {
            const d = z.object({ status: z.enum(['draft', 'approved', 'archived']) }).safeParse(body);
            if (!d.success)
                throw badRequest('status required');
            const [row] = await sql `UPDATE product_knowledge SET status = ${d.data.status}, approved_by = ${d.data.status === 'approved' ? actor : null}, approved_at = ${d.data.status === 'approved' ? sql `now()` : null} WHERE id = ${id.data} RETURNING *`;
            void enqueueKbSync('knowledge-status');
            return { ok: true, row };
        }
        await sql `DELETE FROM product_knowledge WHERE id = ${id.data}`;
        void enqueueKbSync('knowledge-delete');
        return { ok: true };
    });
    app.get('/admin/summary', { preHandler: app.requireStaff() }, async () => {
        const [s] = await sql `SELECT
      (SELECT count(*) FROM orders) AS orders, (SELECT coalesce(sum(total_amount),0) FROM orders WHERE status <> 'cancelled') AS revenue,
      (SELECT count(*) FROM products WHERE status = 'active') AS active_products,
      (SELECT count(*) FROM inventory WHERE total_stock <= low_stock_threshold) AS low_stock,
      (SELECT count(*) FROM customer_restock_requests WHERE status = 'waiting') AS restock_requests,
      (SELECT count(*) FROM jobs WHERE status IN ('failed','uncertain')) AS failed_jobs`;
        return s;
    });
    app.post('/admin/jobs/:id/retry', { preHandler: app.requireStaff('developer', 'admin') }, async (req) => { await retryJob(req.params.id); return { ok: true }; });
    app.get('/admin/audit', { preHandler: app.requireStaff('developer', 'admin') }, async () => ({ rows: await sql `SELECT * FROM audit_log ORDER BY id DESC LIMIT 200` }));
}
//# sourceMappingURL=routes.js.map