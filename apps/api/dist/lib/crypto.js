import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
export function sha256Hex(input) {
    return createHash('sha256').update(input).digest('hex');
}
export function hmacHex(secret, input) {
    return createHmac('sha256', secret).update(input).digest('hex');
}
export function safeEqual(a, b) {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length)
        return false;
    return timingSafeEqual(ab, bb);
}
export function randomToken(bytes = 32) {
    return randomBytes(bytes).toString('base64url');
}
export function randomDigits(n = 6) {
    const max = 10 ** n;
    const value = randomBytes(4).readUInt32BE(0) % max;
    return String(value).padStart(n, '0');
}
/** Signed opaque token: payload.hmac, verifiable without a DB lookup (used for invoice links). */
export function signPayload(payload, secret = config.TOKEN_SIGNING_SECRET) {
    return `${Buffer.from(payload).toString('base64url')}.${hmacHex(secret, payload)}`;
}
export function verifySigned(token, secret = config.TOKEN_SIGNING_SECRET) {
    const [b64, mac] = token.split('.');
    if (!b64 || !mac)
        return null;
    const payload = Buffer.from(b64, 'base64url').toString();
    return safeEqual(hmacHex(secret, payload), mac) ? payload : null;
}
const keyBuffer = () => Buffer.from(config.PII_ENCRYPTION_KEY, 'hex');
/** AES-256-GCM envelope: base64url(iv).base64url(tag).base64url(ciphertext) — used for checkout-link tokens. */
export function encryptText(plain) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', keyBuffer(), iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
}
export function decryptText(envelope) {
    const [iv, tag, data] = envelope.split('.').map((p) => Buffer.from(p, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', keyBuffer(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
//# sourceMappingURL=crypto.js.map