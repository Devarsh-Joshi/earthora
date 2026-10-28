import { claimJob, completeJob, failJob } from './queue.js';
const handlers = new Map();
export function registerJobHandler(kind, handler) { handlers.set(kind, handler); }
export function registeredJobKinds() { return [...handlers.keys()]; }
const schedules = [];
export function registerSchedule(s) { schedules.push(s); }
/** Long-running loop: claims jobs for registered kinds, runs schedules, exits cleanly on stop(). */
export function startWorker(log, opts = {}) {
    const concurrency = opts.concurrency ?? 3;
    const pollMs = opts.pollMs ?? 750;
    let stopped = false;
    let inflight = 0;
    const kinds = registeredJobKinds();
    log.info({ kinds, concurrency }, 'job worker starting');
    const runOne = async (job) => {
        const handler = handlers.get(job.kind);
        if (!handler) {
            await failJob(job, new Error(`no handler for ${job.kind}`));
            return;
        }
        const started = Date.now();
        try {
            const result = await handler(job, log.child({ job: job.id, kind: job.kind }));
            await completeJob(job.id, result);
            log.info({ job: job.id, kind: job.kind, ms: Date.now() - started }, 'job done');
        }
        catch (err) {
            const uncertain = err instanceof Error && err.uncertain === true;
            log.error({ job: job.id, kind: job.kind, err, uncertain }, 'job failed');
            await failJob(job, err, { uncertain });
        }
    };
    const loop = async () => {
        while (!stopped) {
            let claimed = false;
            if (inflight < concurrency && kinds.length) {
                try {
                    const job = await claimJob(kinds);
                    if (job) {
                        claimed = true;
                        inflight++;
                        void runOne(job).finally(() => { inflight--; });
                    }
                }
                catch (err) {
                    log.error({ err }, 'claim failed');
                }
            }
            const now = Date.now();
            for (const s of schedules) {
                if (!s.lastRun || now - s.lastRun >= s.everyMs) {
                    s.lastRun = now;
                    s.run(log.child({ schedule: s.name })).catch((err) => log.error({ err, schedule: s.name }, 'schedule failed'));
                }
            }
            if (!claimed)
                await new Promise((r) => setTimeout(r, pollMs));
        }
    };
    const done = loop();
    return {
        stop: async () => { stopped = true; await done; const deadline = Date.now() + 30_000; while (inflight > 0 && Date.now() < deadline)
            await new Promise((r) => setTimeout(r, 200)); },
    };
}
//# sourceMappingURL=worker.js.map