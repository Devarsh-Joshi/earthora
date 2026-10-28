import { createHash } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config.js';
import { sql } from '../db/client.js';
let s3 = null;
function r2() {
    if (!config.R2_ENDPOINT || !config.R2_ACCESS_KEY_ID || !config.R2_BUCKET)
        return null;
    s3 ??= new S3Client({ region: 'auto', endpoint: config.R2_ENDPOINT, credentials: { accessKeyId: config.R2_ACCESS_KEY_ID, secretAccessKey: config.R2_SECRET_ACCESS_KEY } });
    return s3;
}
function safeSegment(s) {
    return s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'file';
}
/**
 * Stores bytes under ASSETS_DIR (served by nginx/@fastify/static at ASSETS_PUBLIC_BASE) and, when R2 is configured,
 * mirrors them to the bucket. Records an assets row. Public URL is always the ASSETS_PUBLIC_BASE one.
 */
export async function storeAsset(input) {
    const sha256 = createHash('sha256').update(input.bytes).digest('hex');
    const ext = (input.filename.match(/\.[a-z0-9]{1,6}$/i)?.[0] ?? '').toLowerCase();
    const base = safeSegment(input.filename.replace(/\.[a-z0-9]{1,6}$/i, ''));
    const key = posix.join(safeSegment(input.kind), safeSegment(input.folder), `${Date.now()}-${base}${ext}`);
    const localPath = join(config.ASSETS_DIR, ...key.split('/'));
    await mkdir(dirname(localPath), { recursive: true });
    await writeFile(localPath, input.bytes);
    const client = r2();
    if (client) {
        await client.send(new PutObjectCommand({ Bucket: config.R2_BUCKET, Key: key, Body: input.bytes, ContentType: input.mime }));
    }
    const url = `${config.ASSETS_PUBLIC_BASE.replace(/\/$/, '')}/${key}`;
    const [row] = await sql `
    INSERT INTO assets (kind, storage, storage_key, public_url, mime, bytes, sha256, original_name, ref_table, ref_id, created_by)
    VALUES (${input.kind}, ${client ? 'local+r2' : 'local'}, ${key}, ${input.public === false ? null : url}, ${input.mime}, ${input.bytes.length}, ${sha256}, ${input.filename}, ${input.refTable ?? null}, ${input.refId ?? null}, ${input.createdBy ?? null})
    RETURNING id`;
    return { id: row.id, key, url, bytes: input.bytes.length, mime: input.mime, sha256 };
}
export async function deleteAsset(key) {
    await unlink(join(config.ASSETS_DIR, ...key.split('/'))).catch(() => { });
    const client = r2();
    if (client)
        await client.send(new DeleteObjectCommand({ Bucket: config.R2_BUCKET, Key: key })).catch(() => { });
    await sql `DELETE FROM assets WHERE storage_key = ${key}`;
}
export function localAssetPath(key) {
    return join(config.ASSETS_DIR, ...key.split('/'));
}
//# sourceMappingURL=assets.js.map