import { hostname } from 'node:os';
import { sql } from '../../db/client.js';
/** Inserts a job; a dedupe_key makes the enqueue idempotent (existing job returned instead). */
export async function enqueueJob(kind, payload, opts = {}) {
    const rows = await sql `
    INSERT INTO jobs (kind, payload, dedupe_key, run_at, max_attempts, priority)
    VALUES (${kind}, ${sql.json(payload)}, ${opts.dedupeKey ?? null}, ${opts.runAt ?? new Date()}, ${opts.maxAttempts ?? 5}, ${opts.priority ?? 5})
    ON CONFLICT (dedupe_key) DO UPDATE SET updated_at = now()
    RETURNING id`;
    return rows[0].id;
}
export const workerId = `${hostname()}:${process.pid}`;
/** Claims one runnable job with a lease (SKIP LOCKED). Stale leases are reclaimed automatically. */
export async function claimJob(kinds, leaseSeconds = 300) {
    const rows = await sql `
    WITH next AS (
      SELECT id FROM jobs
      WHERE ((status = 'pending' AND run_at <= now()) OR (status = 'running' AND locked_until < now()))
        AND attempts < max_attempts
        ${kinds ? sql `AND kind = ANY(${kinds})` : sql ``}
      ORDER BY priority ASC, run_at ASC
      FOR UPDATE SKIP LOCKED LIMIT 1)
    UPDATE jobs j SET status = 'running', locked_by = ${workerId}, locked_until = now() + make_interval(secs => ${leaseSeconds}),
                      attempts = j.attempts + 1, updated_at = now()
    FROM next WHERE j.id = next.id
    RETURNING j.id, j.kind, j.payload, j.attempts, j.max_attempts, j.run_at, j.dedupe_key`;
    return rows[0] ?? null;
}
export async function completeJob(id, result) {
    await sql `UPDATE jobs SET status = 'succeeded', result = ${result === undefined ? null : sql.json(result)}, finished_at = now(), updated_at = now(), locked_by = NULL, locked_until = NULL WHERE id = ${id}`;
}
export async function failJob(job, error, opts = {}) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    const exhausted = job.attempts >= job.max_attempts;
    const backoffSeconds = Math.min(3600, 10 * 2 ** job.attempts);
    const status = opts.uncertain ? 'uncertain' : exhausted ? 'failed' : 'pending';
    await sql `UPDATE jobs SET status = ${status}, last_error = ${message.slice(0, 2000)}, run_at = now() + make_interval(secs => ${backoffSeconds}),
            updated_at = now(), locked_by = NULL, locked_until = NULL, finished_at = ${status === 'failed' || status === 'uncertain' ? sql `now()` : null} WHERE id = ${job.id}`;
}
export async function retryJob(id) {
    await sql `UPDATE jobs SET status = 'pending', attempts = 0, run_at = now(), last_error = NULL, finished_at = NULL, updated_at = now() WHERE id = ${id}`;
}
//# sourceMappingURL=queue.js.map