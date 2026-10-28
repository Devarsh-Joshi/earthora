import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { config } from '../../config.js';
import { sql } from '../../db/client.js';
import { randomDigits, randomToken, sha256Hex } from '../../lib/crypto.js';
import { brandedEmail, escapeHtml, sendEmail } from '../../lib/email.js';
import { badRequest, forbidden, tooMany, unauthorized } from '../../lib/errors.js';
export const ALL_ROLES = ['owner', 'admin', 'developer', 'kacc', 'editor', 'viewer'];
const OTP_TTL_MIN = 10;
const OTP_MAX_ATTEMPTS = 5;
export const hashPassword = (pw) => argonHash(pw, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
export const verifyPassword = (hashed, pw) => argonVerify(hashed, pw).catch(() => false);
export function hasRole(user, ...roles) {
    if (user.roles.includes('owner'))
        return true;
    return roles.some((r) => user.roles.includes(r));
}
export async function getUserByEmail(email) {
    const [u] = await sql `SELECT * FROM staff_users WHERE lower(email) = lower(${email.trim()}) LIMIT 1`;
    return u ?? null;
}
export async function listUsers() {
    return sql `SELECT id, email, name, roles, status, otp_email, last_login_at, created_at FROM staff_users ORDER BY created_at`;
}
export async function createUser(input) {
    if (input.password.length < 8)
        throw badRequest('Password must be at least 8 characters');
    const [u] = await sql `
    INSERT INTO staff_users (email, name, password_hash, roles, otp_email)
    VALUES (${input.email.trim().toLowerCase()}, ${input.name ?? ''}, ${await hashPassword(input.password)}, ${input.roles}, ${input.otpEmail ?? null})
    RETURNING id, email, name, roles, status, otp_email, last_login_at, created_at`;
    return u;
}
export async function updateUser(id, patch) {
    if (patch.password !== undefined) {
        if (patch.password.length < 8)
            throw badRequest('Password must be at least 8 characters');
        await sql `UPDATE staff_users SET password_hash = ${await hashPassword(patch.password)}, updated_at = now() WHERE id = ${id}`;
    }
    if (patch.name !== undefined)
        await sql `UPDATE staff_users SET name = ${patch.name}, updated_at = now() WHERE id = ${id}`;
    if (patch.roles !== undefined)
        await sql `UPDATE staff_users SET roles = ${patch.roles}, updated_at = now() WHERE id = ${id}`;
    if (patch.status !== undefined)
        await sql `UPDATE staff_users SET status = ${patch.status}, updated_at = now() WHERE id = ${id}`;
    if (patch.otpEmail !== undefined)
        await sql `UPDATE staff_users SET otp_email = ${patch.otpEmail}, updated_at = now() WHERE id = ${id}`;
}
export async function deleteUser(id) {
    await sql `DELETE FROM staff_users WHERE id = ${id} AND NOT ('owner' = ANY(roles))`;
}
/** Step 1: password check → OTP emailed. Returns the challenge id the client must echo back. */
export async function startLogin(email, password, ip) {
    const recent = await sql `SELECT count(*)::text AS n FROM staff_login_challenges WHERE ip = ${ip} AND created_at > now() - interval '15 minutes'`;
    if (Number(recent[0]?.n ?? 0) >= 10)
        throw tooMany('Too many login attempts. Try again in 15 minutes.');
    const user = await getUserByEmail(email);
    const ok = user ? await verifyPassword(user.password_hash, password) : false;
    if (!user || !ok) {
        await sql `INSERT INTO audit_log (actor_email, action, detail, ip) VALUES (${email}, 'auth.login_failed', '{}'::jsonb, ${ip})`;
        throw unauthorized('Incorrect email or password');
    }
    if (user.status !== 'active')
        throw forbidden('This account is disabled');
    const devFixed = config.NODE_ENV !== 'production' && process.env.DEV_LOGIN_OTP ? process.env.DEV_LOGIN_OTP : null;
    const otp = devFixed ?? randomDigits(6);
    const [ch] = await sql `INSERT INTO staff_login_challenges (user_id, otp_hash, expires_at, ip) VALUES (${user.id}, ${sha256Hex(otp)}, now() + make_interval(mins => ${OTP_TTL_MIN}), ${ip}) RETURNING id`;
    const to = user.otp_email || user.email;
    let devOtp;
    if (devFixed) {
        const [local, domain] = to.split('@');
        return { challengeId: ch.id, otpEmailHint: `${local.slice(0, 2)}***@${domain}`, devOtp: otp };
    }
    try {
        const id = await sendEmail({
            to, kind: 'staff_otp', subject: `${otp} is your Earthora sign-in code`,
            html: brandedEmail('Your sign-in code', `<p style="font-size:15px">Use this code to finish signing in. It expires in ${OTP_TTL_MIN} minutes.</p><p style="font-size:32px;letter-spacing:8px;font-weight:700;margin:16px 0">${escapeHtml(otp)}</p><p style="color:#6b7a70;font-size:13px">If you did not try to sign in, ignore this email.</p>`),
            text: `Your Earthora sign-in code is ${otp}. It expires in ${OTP_TTL_MIN} minutes.`,
        });
        if (id === null && config.NODE_ENV !== 'production')
            devOtp = otp;
    }
    catch (err) {
        if (config.NODE_ENV !== 'production')
            devOtp = otp;
        else
            throw err;
    }
    if (devFixed)
        devOtp = otp;
    const [local, domain] = to.split('@');
    return { challengeId: ch.id, otpEmailHint: `${local.slice(0, 2)}***@${domain}`, devOtp };
}
/** Step 2: OTP check → session token (raw token returned once; only its hash is stored). */
export async function completeLogin(challengeId, otp, meta) {
    const [ch] = await sql `SELECT *, (expires_at > now()) AS is_valid FROM staff_login_challenges WHERE id = ${challengeId} LIMIT 1`;
    if (!ch || ch.consumed_at || !ch.is_valid)
        throw unauthorized('Code expired. Sign in again.');
    if (ch.attempts >= OTP_MAX_ATTEMPTS)
        throw tooMany('Too many wrong codes. Sign in again.');
    if (sha256Hex(otp.trim()) !== ch.otp_hash) {
        await sql `UPDATE staff_login_challenges SET attempts = attempts + 1 WHERE id = ${challengeId}`;
        throw unauthorized('Incorrect code');
    }
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + config.SESSION_TTL_HOURS * 3600_000);
    const user = await sql.begin(async (tx) => {
        await tx `UPDATE staff_login_challenges SET consumed_at = now() WHERE id = ${challengeId}`;
        await tx `INSERT INTO staff_sessions (user_id, token_hash, ip, user_agent, expires_at) VALUES (${ch.user_id}, ${sha256Hex(token)}, ${meta.ip}, ${meta.userAgent}, ${expiresAt})`;
        await tx `UPDATE staff_users SET last_login_at = now() WHERE id = ${ch.user_id}`;
        await tx `INSERT INTO audit_log (actor_id, action, ip) VALUES (${ch.user_id}, 'auth.login', ${meta.ip})`;
        const [u] = await tx `SELECT id, email, name, roles, status, otp_email, last_login_at, created_at FROM staff_users WHERE id = ${ch.user_id}`;
        return u;
    });
    return { token, user, expiresAt };
}
export async function resolveSession(token) {
    const [row] = await sql `
    UPDATE staff_sessions s SET last_seen_at = now()
    FROM staff_users u
    WHERE s.token_hash = ${sha256Hex(token)} AND s.revoked_at IS NULL AND s.expires_at > now() AND u.id = s.user_id AND u.status = 'active'
    RETURNING u.id, u.email, u.name, u.roles, u.status, u.otp_email, u.last_login_at, u.created_at`;
    return row ?? null;
}
export async function revokeSession(token) {
    await sql `UPDATE staff_sessions SET revoked_at = now() WHERE token_hash = ${sha256Hex(token)}`;
}
export async function changePassword(userId, current, next) {
    const [u] = await sql `SELECT password_hash FROM staff_users WHERE id = ${userId}`;
    if (!u || !(await verifyPassword(u.password_hash, current)))
        throw unauthorized('Current password is incorrect');
    if (next.length < 12)
        throw badRequest('New password must be at least 12 characters');
    await sql `UPDATE staff_users SET password_hash = ${await hashPassword(next)}, updated_at = now() WHERE id = ${userId}`;
    await sql `UPDATE staff_sessions SET revoked_at = now() WHERE user_id = ${userId} AND revoked_at IS NULL`;
}
/** First boot: migrate the legacy admin password + kacc_users rows into staff_users. */
export async function seedStaffFromLegacy(log) {
    const [{ n }] = await sql `SELECT count(*)::text AS n FROM staff_users`;
    if (Number(n) > 0)
        return;
    const [adminPw] = await sql `SELECT value FROM admin_settings WHERE key = 'admin_password'`;
    const ownerEmail = process.env.OWNER_EMAIL || 'devarsh@earthorafarms.com';
    const ownerPassword = process.env.OWNER_INITIAL_PASSWORD || adminPw?.value || randomToken(12);
    await createUser({ email: ownerEmail, name: 'Owner', password: ownerPassword, roles: ['owner'] });
    await sql `DELETE FROM admin_settings WHERE key = 'admin_password'`; // legacy shared password retired
    log(`seeded owner ${ownerEmail} (password = legacy admin password${process.env.OWNER_INITIAL_PASSWORD ? ' override' : ''})`);
    const kacc = await sql `SELECT email, password FROM kacc_users`;
    for (const k of kacc) {
        if (k.email.toLowerCase() === ownerEmail.toLowerCase())
            continue;
        try {
            await createUser({ email: k.email, name: 'KACC', password: k.password.length >= 8 ? k.password : `${k.password}${randomToken(6)}`, roles: ['kacc'] });
            log(`seeded kacc user ${k.email}`);
        }
        catch (e) {
            log(`kacc seed skipped ${k.email}: ${e.message}`);
        }
    }
}
//# sourceMappingURL=service.js.map