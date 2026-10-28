import { config } from '../config.js';
import { sql } from '../db/client.js';
export function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
/** Exact provider payload sent to the email provider. */
export function emailPayload(input) {
    return {
        from: config.RESEND_FROM_EMAIL,
        to: Array.isArray(input.to) ? input.to : [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        reply_to: input.replyTo,
        attachments: input.attachments?.map((a) => ({ filename: a.filename, content: a.content.toString('base64'), content_type: a.contentType })),
    };
}
/** Sends through Resend; every attempt is recorded in email_log. Returns provider id or null when email is unconfigured. */
export async function sendEmail(input) {
    const to = Array.isArray(input.to) ? input.to : [input.to];
    if (input.idempotencyKey !== undefined && (!input.idempotencyKey.length || input.idempotencyKey.length > 256 || /[\r\n]/.test(input.idempotencyKey)))
        throw new Error('Invalid email idempotency key');
    if (!config.RESEND_API_KEY) {
        await sql `INSERT INTO email_log (to_email, subject, kind, status, error) VALUES (${to.join(',')}, ${input.subject}, ${input.kind}, 'skipped', 'RESEND_API_KEY not configured')`;
        return null;
    }
    const body = emailPayload(input);
    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.RESEND_API_KEY}`, 'Content-Type': 'application/json',
            ...(input.idempotencyKey ? { 'Idempotency-Key': input.idempotencyKey } : {}) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (!res.ok) {
        const detail = input.idempotencyKey ? String(res.status) : `${res.status}: ${text.slice(0, 500)}`;
        await sql `INSERT INTO email_log (to_email, subject, kind, status, error) VALUES (${to.join(',')}, ${input.subject}, ${input.kind}, 'failed', ${detail})`;
        throw new Error(input.idempotencyKey ? `Resend ${res.status}` : `Resend ${res.status}: ${text.slice(0, 200)}`);
    }
    const id = (() => { try {
        return JSON.parse(text).id ?? null;
    }
    catch {
        return null;
    } })();
    if (input.idempotencyKey && (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(id)))
        throw new Error('Email provider did not confirm a message identifier');
    await sql `INSERT INTO email_log (to_email, subject, kind, provider_id, status) VALUES (${to.join(',')}, ${input.subject}, ${input.kind}, ${id}, 'sent')`;
    return id;
}
export function brandedEmail(title, bodyHtml) {
    return `<!doctype html><html><body style="margin:0;background:#f6f5f0;font-family:Inter,Segoe UI,Arial,sans-serif;color:#15271d">
  <div style="max-width:560px;margin:24px auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e3e8e4">
    <div style="background:#26593b;color:#faf8f3;padding:18px 24px;font-size:18px;font-weight:600">Earthora Farms</div>
    <div style="padding:24px"><h2 style="margin:0 0 12px;font-size:20px">${escapeHtml(title)}</h2>${bodyHtml}</div>
    <div style="padding:14px 24px;color:#6b7a70;font-size:12px;border-top:1px solid #eef1ee">Pure. Potent. Alive. — earthorafarms.com</div>
  </div></body></html>`;
}
//# sourceMappingURL=email.js.map