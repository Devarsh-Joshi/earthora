/** Build step: write the storefront's page copy to dist/kb/pages.json for the knowledge-base page sync. */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractPages } from '../platform/kb/pageCopy.js';
const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(here, '..', '..');
const pagesDir = join(apiRoot, '..', 'storefront', 'src', 'pages');
const target = join(apiRoot, 'dist', 'kb', 'pages.json');
const pages = await extractPages(pagesDir);
await mkdir(dirname(target), { recursive: true });
await writeFile(target, JSON.stringify({ generated_at: new Date().toISOString(), pages }, null, 1));
console.log(`[kb] ${pages.length} pages, ${pages.reduce((n, p) => n + p.words, 0)} words -> ${target}`);
//# sourceMappingURL=extractPages.js.map