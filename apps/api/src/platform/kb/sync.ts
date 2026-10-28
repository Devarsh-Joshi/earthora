/** Keep the knowledge base in step with the live website: products, page copy, and (optionally) a crawl.

The catalogue and approved product facts are read live by every chat turn, but the
indexed documents used by keyword/semantic search were only rebuilt by a manual
"index website" job. Now:
- any product, stock or knowledge change enqueues a product-document sync;
- the worker runs the syncs on a schedule that the console can switch off, tune or
  trigger immediately ("Sync now");
- page copy (FAQ, policies, story) ships with every API build and is indexed too. */
import { sql } from '../../db/client.js';
import { enqueueJob } from '../../modules/jobs/queue.js';

export const KB_SYNC_JOB = 'kb_sync_products';
export const KB_PAGES_JOB = 'kb_sync_pages';
export const KB_WEBSITE_JOB = 'kb_index_website';
export const KB_SYNC_EVERY_MS = 10 * 60_000;
export const SETTINGS_KEY = 'kb_auto_sync';

export interface AutoSyncSettings {
  enabled: boolean;
  products_every_minutes: number;
  pages_every_hours: number;
  /** The storefront is a client-rendered app, so a plain crawl finds almost no text; off unless the owner turns it on. */
  website_crawl_enabled: boolean;
  website_crawl_every_hours: number;
}

export const DEFAULT_AUTO_SYNC: AutoSyncSettings = {
  enabled: true, products_every_minutes: 10, pages_every_hours: 6, website_crawl_enabled: false, website_crawl_every_hours: 24,
};

const BOUNDS = { products_every_minutes: [1, 24 * 60], pages_every_hours: [1, 24 * 14], website_crawl_every_hours: [1, 24 * 30] } as const;

export function normalizeAutoSync(input: unknown): AutoSyncSettings {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: AutoSyncSettings = { ...DEFAULT_AUTO_SYNC };
  for (const key of ['enabled', 'website_crawl_enabled'] as const) {
    if (typeof raw[key] === 'boolean') out[key] = raw[key] as boolean;
  }
  for (const key of ['products_every_minutes', 'pages_every_hours', 'website_crawl_every_hours'] as const) {
    const value = Number(raw[key]);
    const [min, max] = BOUNDS[key];
    if (Number.isFinite(value)) out[key] = Math.min(max, Math.max(min, Math.round(value)));
  }
  return out;
}

export async function readAutoSync(): Promise<AutoSyncSettings> {
  const [row] = await sql<{ value: string }[]>`SELECT value FROM admin_settings WHERE key = ${SETTINGS_KEY}`;
  if (!row) return { ...DEFAULT_AUTO_SYNC };
  try { return normalizeAutoSync(JSON.parse(row.value)); } catch { return { ...DEFAULT_AUTO_SYNC }; }
}

export async function writeAutoSync(input: unknown): Promise<AutoSyncSettings> {
  const settings = normalizeAutoSync(input);
  await sql`INSERT INTO admin_settings (key, value, updated_at) VALUES (${SETTINGS_KEY}, ${JSON.stringify(settings)}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  return settings;
}

/** At most one queued sync per minute per kind, whatever triggered it; the jobs are idempotent. */
export function syncDedupeKey(kind: string, now = Date.now()): string {
  return `${kind}:${Math.floor(now / 60_000)}`;
}

/** Best effort: an admin save must never fail because the job queue is unavailable. */
async function enqueueSync(kind: string, reason: string, payload: Record<string, unknown> = {}): Promise<string | null> {
  try {
    const now = Date.now();
    // Product creation saves an unpublished row, inventory, then the active
    // product. The bucket must not run before all of that minute's writes:
    // generic job dedupe intentionally never rearms a completed job.
    const productBatch = kind === KB_SYNC_JOB;
    return await enqueueJob(kind, { reason, ...payload }, {
      dedupeKey: syncDedupeKey(kind, now) + (productBatch ? ':deferred-v1' : ''), maxAttempts: 3,
      ...(productBatch ? { runAt: new Date((Math.floor(now / 60_000) + 1) * 60_000) } : {}),
    });
  } catch (err) {
    console.warn(`[kb] ${kind} enqueue failed (${reason}): ${(err as Error).message}`);
    return null;
  }
}

export const enqueueKbSync = (reason: string) => enqueueSync(KB_SYNC_JOB, reason);
export const enqueuePagesSync = (reason: string) => enqueueSync(KB_PAGES_JOB, reason);
export const enqueueWebsiteIndex = (reason: string) => enqueueSync(KB_WEBSITE_JOB, reason, { maxPages: 40 });

export type LastRuns = Partial<Record<string, number>>;

/** Which syncs are due, from the settings and the time each kind last succeeded (ms since epoch). */
export function dueSyncs(settings: AutoSyncSettings, lastRuns: LastRuns, now = Date.now()): string[] {
  if (!settings.enabled) return [];
  const due: string[] = [];
  const overdue = (kind: string, everyMs: number) => (lastRuns[kind] === undefined) || now - (lastRuns[kind] as number) >= everyMs;
  if (overdue(KB_SYNC_JOB, settings.products_every_minutes * 60_000)) due.push(KB_SYNC_JOB);
  if (overdue(KB_PAGES_JOB, settings.pages_every_hours * 3_600_000)) due.push(KB_PAGES_JOB);
  if (settings.website_crawl_enabled && overdue(KB_WEBSITE_JOB, settings.website_crawl_every_hours * 3_600_000)) due.push(KB_WEBSITE_JOB);
  return due;
}

/** Last successful completion per sync kind, plus anything still queued or running. */
export async function syncActivity(): Promise<{ lastRuns: LastRuns; pending: string[] }> {
  const rows = await sql<{ kind: string; finished_at: string | null; status: string }[]>`
    SELECT kind, status, max(finished_at)::text AS finished_at FROM jobs
    WHERE kind IN (${KB_SYNC_JOB}, ${KB_PAGES_JOB}, ${KB_WEBSITE_JOB}) GROUP BY kind, status`;
  const lastRuns: LastRuns = {};
  const pending: string[] = [];
  for (const row of rows) {
    if (row.status === 'succeeded' && row.finished_at) lastRuns[row.kind] = new Date(row.finished_at).getTime();
    if (row.status === 'pending' || row.status === 'running') pending.push(row.kind);
  }
  return { lastRuns, pending };
}

/** One scheduler tick: enqueue whatever the settings say is due. */
export async function runAutoSyncTick(now = Date.now()): Promise<string[]> {
  const settings = await readAutoSync();
  const { lastRuns, pending } = await syncActivity();
  const due = dueSyncs(settings, lastRuns, now).filter((kind) => !pending.includes(kind));
  for (const kind of due) await enqueueSync(kind, 'schedule', kind === KB_WEBSITE_JOB ? { maxPages: 40 } : {});
  return due;
}
