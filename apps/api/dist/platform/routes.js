import { providerStatus } from './providers/index.js';
import { platformAdminRoutes } from './admin.js';
import { chatChannelRoutes } from './channels/chat.js';
import { checkoutLinkRoutes } from './channels/checkoutLink.js';
/** All AI-platform HTTP routes (mounted under /api). */
export async function platformRoutes(app) {
    app.get('/platform/health', async () => ({ ok: true, providers: providerStatus() }));
    await app.register(platformAdminRoutes);
    await app.register(chatChannelRoutes);
    await app.register(checkoutLinkRoutes);
}
//# sourceMappingURL=routes.js.map