import { config } from './config.js';
import { closeDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { seedStaffFromLegacy } from './modules/auth/service.js';
import { startWorker } from './modules/jobs/worker.js';
import { registerNotificationJobs } from './modules/notifications/handlers.js';
import { registerPlatformJobs } from './platform/jobs.js';
import { seedPlatform } from './platform/seed.js';
import { buildServer } from './server.js';
async function main() {
    const app = await buildServer();
    const log = app.log;
    await runMigrations((m) => log.info(m));
    await seedStaffFromLegacy((m) => log.info(m));
    await seedPlatform((m) => log.info(m)).catch((e) => log.error({ err: e }, 'platform seed failed'));
    let worker = null;
    if (config.ROLE === 'worker' || config.ROLE === 'all') {
        registerNotificationJobs();
        registerPlatformJobs();
        worker = startWorker(log, { concurrency: config.ROLE === 'worker' ? 4 : 2 });
    }
    if (config.ROLE === 'api' || config.ROLE === 'all') {
        await app.listen({ port: config.PORT, host: '0.0.0.0' });
    }
    else {
        log.info('worker-only process; HTTP disabled');
    }
    const shutdown = async (signal) => {
        log.info({ signal }, 'shutting down');
        // Stop taking new connections first, let in-flight requests/sockets drain, then stop the worker.
        await app.close().catch(() => { });
        if (worker)
            await worker.stop();
        await closeDb();
        process.exit(0);
    };
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
}
main().catch((err) => { console.error(err); process.exit(1); });
//# sourceMappingURL=main.js.map