import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from './client.js';
const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(here, 'migrations');
/**
 * Applies src/db/migrations/*.sql in filename order, once each, inside one transaction,
 * guarded by an advisory lock so only one process migrates at a time.
 */
export async function runMigrations(log = console.log) {
    await sql `CREATE TABLE IF NOT EXISTS app_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    const applied = new Set((await sql `SELECT name FROM app_migrations`).map((r) => r.name));
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const done = [];
    await sql.begin(async (tx) => {
        await tx `SELECT pg_advisory_xact_lock(7241001)`;
        for (const file of files) {
            if (applied.has(file))
                continue;
            const body = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
            await tx.unsafe(body);
            await tx `INSERT INTO app_migrations (name) VALUES (${file})`;
            done.push(file);
            log(`migration applied: ${file}`);
        }
    });
    return done;
}
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
    runMigrations()
        .then(async (d) => { console.log(`${d.length} migration(s) applied`); await sql.end(); })
        .catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
}
//# sourceMappingURL=migrate.js.map