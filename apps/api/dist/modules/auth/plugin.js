import fp from 'fastify-plugin';
import { config, isProd } from '../../config.js';
import { forbidden, unauthorized } from '../../lib/errors.js';
import { hasRole, resolveSession } from './service.js';
export const SESSION_COOKIE = 'earthora_staff';
export const authPlugin = fp(async (app) => {
    app.decorateRequest('staff', null);
    app.addHook('onRequest', async (req) => {
        const raw = req.cookies?.[SESSION_COOKIE];
        if (!raw)
            return;
        const unsigned = req.unsignCookie(raw);
        if (!unsigned.valid || !unsigned.value)
            return;
        req.staff = await resolveSession(unsigned.value);
    });
    app.decorate('requireStaff', (...roles) => async (req) => {
        if (!req.staff)
            throw unauthorized('Sign in required');
        if (roles.length && !hasRole(req.staff, ...roles))
            throw forbidden('Your role cannot do this');
    });
});
export function sessionCookieOptions(expiresAt) {
    return { path: '/', httpOnly: true, secure: isProd, sameSite: 'lax', signed: true, expires: expiresAt, maxAge: Math.floor((expiresAt.getTime() - Date.now()) / 1000) };
}
export const cookieSecret = config.COOKIE_SECRET;
//# sourceMappingURL=plugin.js.map