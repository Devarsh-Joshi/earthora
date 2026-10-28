import { sql } from '../../db/client.js';
export async function getChannelByKey(key) {
    const [ch] = await sql `SELECT * FROM channels WHERE public_key = ${key} LIMIT 1`;
    return ch ?? null;
}
export async function getChannel(tenantId, type, slug) {
    const [ch] = await sql `SELECT * FROM channels WHERE tenant_id = ${tenantId} AND type = ${type} AND slug = ${slug} LIMIT 1`;
    return ch ?? null;
}
export function publishedConfig(ch) { return ch.published_config && Object.keys(ch.published_config).length ? ch.published_config : ch.draft_config; }
export async function publishChannel(channelId, publishedBy) {
    await sql.begin(async (tx) => {
        const [ch] = await tx `SELECT * FROM channels WHERE id = ${channelId}`;
        const version = ch.version + 1;
        await tx `UPDATE channels SET published_config = draft_config, version = ${version}, published_at = now(), updated_at = now() WHERE id = ${channelId}`;
        await tx `INSERT INTO channel_versions (channel_id, version, config, published_by) VALUES (${channelId}, ${version}, ${sql.json(ch.draft_config)}, ${publishedBy})`;
    });
}
//# sourceMappingURL=config.js.map