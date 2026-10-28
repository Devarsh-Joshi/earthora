import { config } from '../../config.js';
import { sql } from '../../db/client.js';
import { signPayload } from '../../lib/crypto.js';
import { brandedEmail, escapeHtml, sendEmail } from '../../lib/email.js';
import { getOrderBundle } from '../commerce/orders.js';
import { registerJobHandler, registerSchedule } from '../jobs/worker.js';
import { enqueueJob } from '../jobs/queue.js';
import { renderInvoiceForOrder } from './invoice.js';

const inr = (n: number | string) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

export function registerNotificationJobs(): void {
  registerJobHandler('send_invoice', async (job) => {
    const orderId = String(job.payload.orderId);
    const bundle = await getOrderBundle(orderId);
    if (!bundle) throw new Error(`order ${orderId} missing`);
    const o = bundle.order;
    const pdf = await renderInvoiceForOrder(o.id, 'en');
    const link = `${config.PUBLIC_STORE_URL}/api/store/invoice/${signPayload(o.id)}`;
    const rows = bundle.items.map((i) => `<tr><td style="padding:6px 0">${escapeHtml(i.product_name)} × ${i.quantity}</td><td style="text-align:right">${inr(i.total_price)}</td></tr>`).join('');
    const html = brandedEmail(`Thank you for your order ${escapeHtml(o.order_number)}`, `
      <p>Hi ${escapeHtml(o.customer_name || 'there')}, your order is confirmed. Your tax invoice is attached and also available <a href="${link}">here</a>.</p>
      <table style="width:100%;border-collapse:collapse;margin:12px 0">${rows}<tr><td style="padding-top:8px;font-weight:600">Total paid</td><td style="text-align:right;font-weight:600">${inr(o.total_amount)}</td></tr></table>
      <p style="color:#6b7a70;font-size:13px">Delivery to: ${escapeHtml([o.customer_address, o.customer_city, o.customer_state, o.customer_zip].filter(Boolean).join(', '))}</p>`);
    const to: string[] = [];
    if (o.customer_email) to.push(o.customer_email);
    if (!to.length) return { skipped: 'no customer email' };
    const id = await sendEmail({ to, kind: 'invoice', subject: `Your Earthora Farms invoice — ${o.order_number}`, html, attachments: [{ filename: `invoice-${o.order_number}.pdf`, content: pdf, contentType: 'application/pdf' }] });
    return { emailId: id };
  });

  registerJobHandler('order_notify_admin', async (job) => {
    const bundle = await getOrderBundle(String(job.payload.orderId));
    if (!bundle) return { skipped: true };
    const o = bundle.order;
    const html = brandedEmail(`New order ${escapeHtml(o.order_number)} — ${inr(o.total_amount)}`, `
      <p><b>${escapeHtml(o.customer_name)}</b> · ${escapeHtml(o.customer_phone || '')} · ${escapeHtml(o.customer_email || '')}</p>
      <p>${bundle.items.map((i) => `${escapeHtml(i.product_name)} × ${i.quantity}`).join('<br>')}</p>
      <p style="color:#6b7a70">${escapeHtml([o.customer_address, o.customer_city, o.customer_state, o.customer_zip].filter(Boolean).join(', '))}</p>
      <p><a href="${config.PUBLIC_STORE_URL}/sun-earthora/orders">Open in admin</a></p>`);
    const id = await sendEmail({ to: config.ADMIN_NOTIFY_EMAIL, kind: 'order_admin', subject: `New order ${o.order_number} (${inr(o.total_amount)})`, html });
    return { emailId: id };
  });

  registerJobHandler('contact_email', async (job) => {
    const p = job.payload as Record<string, string>;
    const ack = brandedEmail('We received your message', `<p>Hi ${escapeHtml(p.name)}, thanks for reaching out about <b>${escapeHtml(p.topic)}</b>. Our team will reply within one working day.</p><blockquote style="border-left:3px solid #dce7c5;margin:12px 0;padding:6px 12px;color:#3b4a40">${escapeHtml(p.message)}</blockquote>`);
    const notice = brandedEmail(`Contact form: ${escapeHtml(p.topic)}`, `<p><b>${escapeHtml(p.name)}</b> &lt;${escapeHtml(p.email)}&gt; ${escapeHtml(p.phone || '')}</p><p>${escapeHtml(p.message).replace(/\n/g, '<br>')}</p><p style="color:#6b7a70">Marketing consent: ${p.marketingConsent ? 'yes' : 'no'}</p>`);
    const acknowledgement = { to: p.email, kind: 'contact_ack', subject: 'We received your message — Earthora Farms', html: ack };
    const notification = { to: config.ADMIN_NOTIFY_EMAIL, kind: 'contact_notice', subject: `Contact form — ${p.topic} — ${p.name}`, html: notice, replyTo: p.email };
    const a = await sendEmail(acknowledgement);
    const b = await sendEmail(notification);
    return { ack: a, notice: b };
  });

  registerJobHandler('low_stock_alert', async (job) => {
    const p = job.payload as { logId: number; productName: string; stock: number; threshold: number };
    const recipients = config.LOW_STOCK_ALERT_EMAILS.split(',').map((s) => s.trim()).filter(Boolean);
    const to = recipients.length ? recipients : [config.ADMIN_NOTIFY_EMAIL];
    const html = brandedEmail(`Low stock: ${escapeHtml(p.productName)}`, `<p><b>${escapeHtml(p.productName)}</b> is down to <b>${p.stock}</b> units (threshold ${p.threshold}).</p><p><a href="${config.PUBLIC_STORE_URL}/sun-earthora/products">Restock in admin</a></p>`);
    const id = await sendEmail({ to, kind: 'low_stock', subject: `Low stock: ${p.productName} (${p.stock} left)`, html });
    await sql`UPDATE sms_alert_logs SET status = 'delivered', provider_message_id = ${id ?? 'email'} WHERE id = ${p.logId}`;
    return { emailId: id };
  });

  registerJobHandler('tracking_notification', async (job) => {
    const p = job.payload as { orderId: string; trackingUrl: string };
    const bundle = await getOrderBundle(p.orderId);
    if (!bundle) return { skipped: true };
    const o = bundle.order;
    const html = brandedEmail(`Your order ${escapeHtml(o.order_number)} is on its way`, `<p>Hi ${escapeHtml(o.customer_name || 'there')}, your Earthora order has been shipped.</p><p><a href="${escapeHtml(p.trackingUrl)}" style="display:inline-block;background:#26593b;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Track shipment</a></p>`);
    const id = o.customer_email ? await sendEmail({ to: o.customer_email, kind: 'tracking', subject: `Your order ${o.order_number} has shipped`, html }) : null;
    return { emailId: id };
  });

  // The low-stock trigger writes sms_alert_logs rows; the worker turns them into jobs (replaces the Supabase DB webhook).
  registerSchedule({
    name: 'low_stock_drain', everyMs: 15_000,
    run: async () => {
      const rows = await sql<any[]>`UPDATE sms_alert_logs SET status = 'processing' WHERE id IN (SELECT id FROM sms_alert_logs WHERE status = 'pending' ORDER BY id LIMIT 20) RETURNING id, product_name, stock_at_alert, threshold`;
      for (const r of rows) await enqueueJob('low_stock_alert', { logId: r.id, productName: r.product_name, stock: r.stock_at_alert, threshold: r.threshold }, { dedupeKey: `low-stock:${r.id}` });
    },
  });
  registerSchedule({
    name: 'housekeeping', everyMs: 3_600_000,
    run: async () => {
      await sql`DELETE FROM rate_limit_attempts WHERE attempted_at < now() - interval '1 day'`;
      await sql`DELETE FROM staff_login_challenges WHERE created_at < now() - interval '1 day'`;
      await sql`DELETE FROM staff_sessions WHERE expires_at < now() - interval '7 days'`;
      await sql`DELETE FROM jobs WHERE status = 'succeeded' AND finished_at < now() - interval '14 days'`;
    },
  });
}
