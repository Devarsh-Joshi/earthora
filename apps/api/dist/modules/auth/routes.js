import { z } from 'zod';
import { badRequest } from '../../lib/errors.js';
import { SESSION_COOKIE, sessionCookieOptions } from './plugin.js';
import { ALL_ROLES, changePassword, completeLogin, createUser, deleteUser, listUsers, revokeSession, startLogin, updateUser } from './service.js';
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const verifySchema = z.object({ challengeId: z.string().uuid(), otp: z.string().regex(/^\d{6}$/) });
export async function authRoutes(app) {
    app.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req) => {
        const body = loginSchema.safeParse(req.body);
        if (!body.success)
            throw badRequest('Email and password are required');
        return startLogin(body.data.email, body.data.password, req.ip);
    });
    app.post('/auth/verify', { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } }, async (req, reply) => {
        const body = verifySchema.safeParse(req.body);
        if (!body.success)
            throw badRequest('A 6-digit code is required');
        const { token, user, expiresAt } = await completeLogin(body.data.challengeId, body.data.otp, { ip: req.ip, userAgent: req.headers['user-agent'] ?? null });
        reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
        return { user };
    });
    app.post('/auth/logout', async (req, reply) => {
        const raw = req.cookies?.[SESSION_COOKIE];
        if (raw) {
            const u = req.unsignCookie(raw);
            if (u.valid && u.value)
                await revokeSession(u.value);
        }
        reply.clearCookie(SESSION_COOKIE, { path: '/' });
        return { ok: true };
    });
    app.get('/auth/me', async (req) => ({ user: req.staff }));
    app.post('/auth/password', { preHandler: app.requireStaff() }, async (req, reply) => {
        const body = z.object({ currentPassword: z.string(), newPassword: z.string() }).safeParse(req.body);
        if (!body.success)
            throw badRequest('Both passwords are required');
        await changePassword(req.staff.id, body.data.currentPassword, body.data.newPassword);
        reply.clearCookie(SESSION_COOKIE, { path: '/' });
        return { ok: true, reauth: true };
    });
    // Team management (owner/admin/developer)
    app.get('/staff', { preHandler: app.requireStaff('admin', 'developer') }, async () => ({ users: await listUsers() }));
    app.post('/staff', { preHandler: app.requireStaff('admin', 'developer') }, async (req) => {
        const body = z.object({ email: z.string().email(), name: z.string().optional(), password: z.string().min(8), roles: z.array(z.enum(ALL_ROLES)).min(1), otpEmail: z.string().email().nullable().optional() }).safeParse(req.body);
        if (!body.success)
            throw badRequest('Invalid user', body.error.flatten());
        if (body.data.roles.includes('owner') && !req.staff.roles.includes('owner'))
            throw badRequest('Only an owner can create owners');
        return { user: await createUser(body.data) };
    });
    app.patch('/staff/:id', { preHandler: app.requireStaff('admin', 'developer') }, async (req) => {
        const body = z.object({ name: z.string().optional(), password: z.string().min(8).optional(), roles: z.array(z.enum(ALL_ROLES)).optional(), status: z.enum(['active', 'disabled']).optional(), otpEmail: z.string().email().nullable().optional() }).safeParse(req.body);
        if (!body.success)
            throw badRequest('Invalid patch', body.error.flatten());
        await updateUser(req.params.id, body.data);
        return { ok: true };
    });
    app.delete('/staff/:id', { preHandler: app.requireStaff('admin', 'developer') }, async (req) => {
        await deleteUser(req.params.id);
        return { ok: true };
    });
}
//# sourceMappingURL=routes.js.map