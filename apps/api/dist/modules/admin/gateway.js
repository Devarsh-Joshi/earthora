/**
 * Server-enforced table gateway for the admin portals. Mirrors the small supabase-js query surface the admin
 * pages already use (select/insert/update/upsert/delete + eq/neq/in/gte/lt/order/limit + embedded relations),
 * but every table, operation and column is allow-listed per role and executed with parameterized SQL.
 */
import { z } from 'zod';
import { sql } from '../../db/client.js';
import { badRequest, forbidden } from '../../lib/errors.js';
import { enqueueKbSync } from '../../platform/kb/sync.js';
const ADMIN = ['owner', 'admin'];
const DEV = ['owner', 'developer'];
const KACC = ['owner', 'kacc'];
const ADMIN_DEV = ['owner', 'admin', 'developer'];
const ALL_STAFF = ['owner', 'admin', 'developer', 'kacc', 'editor', 'viewer'];
const PRODUCT_TEXT_ARRAY_COLUMNS = new Set(['highlights', 'health_benefits', 'certifications']);
const RULES = {
    products: { read: ALL_STAFF, write: ADMIN, pk: 'id' },
    inventory: { read: ALL_STAFF, write: ADMIN, pk: 'id' },
    orders: { read: [...ADMIN, ...KACC, 'developer'], write: ADMIN, pk: 'id' },
    order_items: { read: [...ADMIN, ...KACC, 'developer'], write: ADMIN, pk: 'id' },
    Payments: { read: [...ADMIN, ...KACC, 'developer'], write: ADMIN, pk: 'id' },
    Order_history: { read: [...ADMIN, ...KACC], write: ADMIN, pk: 'id' },
    User_details: { read: ADMIN, write: ADMIN, pk: 'id', hidden: ['user_password'] },
    product_knowledge: { read: ADMIN_DEV, write: [], pk: 'id' },
    review_details: { read: ADMIN, write: ADMIN, pk: 'id' },
    Contact_details: { read: ADMIN, write: [], pk: 'id' },
    Admin_analytics: { read: ADMIN_DEV, write: [], pk: 'id' },
    admin_settings: { read: DEV, write: DEV, pk: 'key' },
    customer_restock_requests: { read: ADMIN, write: ADMIN, pk: 'id' },
    sms_alert_logs: { read: ADMIN, write: ADMIN, pk: 'id' },
    jobs: { read: DEV, write: [], pk: 'id' },
    email_log: { read: DEV, write: [], pk: 'id' },
    audit_log: { read: DEV, write: [], pk: 'id' },
};
const RELATIONS = {
    products: { inventory: { table: 'inventory', fk: 'product_id', localKey: 'id', many: false } },
    orders: { order_items: { table: 'order_items', fk: 'order_id', localKey: 'id', many: true } },
    order_items: { products: { table: 'products', fk: 'id', localKey: 'product_id', many: false } },
};
const filterSchema = z.object({ op: z.enum(['eq', 'neq', 'in', 'gte', 'lte', 'gt', 'lt', 'ilike', 'is']), col: z.string(), value: z.unknown() });
const querySchema = z.object({
    table: z.string(), op: z.enum(['select', 'insert', 'update', 'upsert', 'delete']),
    columns: z.string().optional(), filters: z.array(filterSchema).optional().default([]),
    order: z.array(z.object({ col: z.string(), asc: z.boolean().optional().default(true) })).optional().default([]),
    limit: z.number().int().min(1).max(2000).optional(), offset: z.number().int().min(0).optional(),
    values: z.union([z.record(z.unknown()), z.array(z.record(z.unknown()))]).optional(),
    onConflict: z.string().optional(), count: z.boolean().optional(), head: z.boolean().optional(),
});
let columnCache = null;
async function columnsOf(table) {
    if (!columnCache) {
        columnCache = new Map();
        const rows = await sql `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`;
        for (const r of rows) {
            if (!columnCache.has(r.table_name))
                columnCache.set(r.table_name, new Set());
            columnCache.get(r.table_name).add(r.column_name);
        }
    }
    const cols = columnCache.get(table);
    if (!cols)
        throw badRequest(`Unknown table ${table}`);
    return cols;
}
export function invalidateColumnCache() { columnCache = null; }
// Writes to these tables change what the chat assistant can say about the
// catalogue; the knowledge base's product documents follow them.
const KB_SYNC_TABLES = new Set(['products', 'inventory']);
function afterWrite(table, op) {
    if (KB_SYNC_TABLES.has(table))
        void enqueueKbSync(`gateway-${table}-${op}`);
}
function parseSelect(s) {
    const text = (s ?? '*').replace(/\s+/g, '');
    const columns = [];
    const embeds = [];
    let i = 0;
    let star = false;
    while (i < text.length) {
        let j = i;
        while (j < text.length && text[j] !== ',' && text[j] !== '(')
            j++;
        const name = text.slice(i, j);
        if (text[j] === '(') {
            let depth = 1;
            let k = j + 1;
            while (k < text.length && depth > 0) {
                if (text[k] === '(')
                    depth++;
                if (text[k] === ')')
                    depth--;
                k++;
            }
            embeds.push({ name, select: parseSelect(text.slice(j + 1, k - 1)) });
            i = k + 1;
        }
        else {
            if (name === '*')
                star = true;
            else if (name)
                columns.push(name);
            i = j + 1;
        }
    }
    return { columns: star ? '*' : columns, embeds };
}
function assertCols(table, cols, requested, rule) {
    for (const c of requested) {
        if (!cols.has(c))
            throw badRequest(`Unknown column ${table}.${c}`);
        if (rule.hidden?.includes(c))
            throw forbidden(`Column ${table}.${c} is not exposed`);
    }
}
function whereClause(filters, cols, table) {
    if (!filters.length)
        return sql ``;
    const parts = filters.map((f) => {
        if (!cols.has(f.col))
            throw badRequest(`Unknown filter column ${table}.${f.col}`);
        const c = sql(f.col);
        switch (f.op) {
            case 'eq': return f.value === null ? sql `${c} IS NULL` : sql `${c} = ${f.value}`;
            case 'neq': return f.value === null ? sql `${c} IS NOT NULL` : sql `${c} <> ${f.value}`;
            case 'in': return sql `${c} = ANY(${(Array.isArray(f.value) ? f.value : [f.value]).map(String)})`;
            case 'gte': return sql `${c} >= ${f.value}`;
            case 'lte': return sql `${c} <= ${f.value}`;
            case 'gt': return sql `${c} > ${f.value}`;
            case 'lt': return sql `${c} < ${f.value}`;
            case 'ilike': return sql `${c}::text ILIKE ${String(f.value)}`;
            case 'is': return f.value === null ? sql `${c} IS NULL` : sql `${c} IS ${f.value ? sql `TRUE` : sql `FALSE`}`;
        }
    });
    return sql `WHERE ${parts.reduce((acc, p, i) => (i === 0 ? p : sql `${acc} AND ${p}`))}`;
}
async function attachEmbeds(table, rows, embeds, roles) {
    for (const e of embeds) {
        const rel = RELATIONS[table]?.[e.name];
        if (!rel)
            throw badRequest(`Unknown relation ${table}.${e.name}`);
        const rule = RULES[rel.table];
        if (!rule || !rule.read.some((r) => roles.includes(r)))
            throw forbidden(`No access to ${rel.table}`);
        const keys = [...new Set(rows.map((r) => r[rel.localKey]).filter((v) => v !== null && v !== undefined).map(String))];
        if (!keys.length) {
            for (const r of rows)
                r[e.name] = rel.many ? [] : null;
            continue;
        }
        const cols = await columnsOf(rel.table);
        const sel = e.select.columns === '*' ? [...cols].filter((c) => !rule.hidden?.includes(c)) : [...e.select.columns];
        for (const n of e.select.embeds) {
            const nrel = RELATIONS[rel.table]?.[n.name];
            if (nrel && !sel.includes(nrel.localKey))
                sel.push(nrel.localKey);
        }
        assertCols(rel.table, cols, sel, rule);
        if (!sel.includes(rel.fk))
            sel.push(rel.fk);
        const related = await sql `SELECT ${sql(sel)} FROM ${sql(rel.table)} WHERE ${sql(rel.fk)}::text = ANY(${keys})`;
        await attachEmbeds(rel.table, related, e.select.embeds, roles);
        const byKey = new Map();
        for (const r of related) {
            const k = String(r[rel.fk]);
            if (!byKey.has(k))
                byKey.set(k, []);
            byKey.get(k).push(r);
        }
        for (const r of rows) {
            const list = byKey.get(String(r[rel.localKey])) ?? [];
            r[e.name] = rel.many ? list : (list[0] ?? null);
        }
    }
}
export async function runGatewayQuery(raw, roles) {
    const q = querySchema.safeParse(raw);
    if (!q.success)
        throw badRequest('Invalid query', q.error.flatten());
    const { table, op } = q.data;
    const rule = RULES[table];
    if (!rule)
        throw forbidden(`Table ${table} is not exposed`);
    const canRead = rule.read.some((r) => roles.includes(r));
    const canWrite = rule.write.some((r) => roles.includes(r));
    if (op === 'select' ? !canRead : !canWrite)
        throw forbidden(`Your role cannot ${op} ${table}`);
    const cols = await columnsOf(table);
    const parsed = parseSelect(q.data.columns);
    const selectCols = parsed.columns === '*' ? [...cols].filter((c) => !rule.hidden?.includes(c)) : [...parsed.columns];
    for (const e of parsed.embeds) {
        const rel = RELATIONS[table]?.[e.name];
        if (rel && !selectCols.includes(rel.localKey))
            selectCols.push(rel.localKey);
    }
    assertCols(table, cols, selectCols, rule);
    const where = whereClause(q.data.filters, cols, table);
    const order = q.data.order.length ? sql `ORDER BY ${q.data.order.map((o) => { if (!cols.has(o.col))
        throw badRequest(`Unknown order column ${o.col}`); return sql `${sql(o.col)} ${o.asc ? sql `ASC` : sql `DESC`}`; }).reduce((a, b, i) => (i === 0 ? b : sql `${a}, ${b}`))}` : sql ``;
    const limit = q.data.limit ? sql `LIMIT ${q.data.limit}` : sql ``;
    const offset = q.data.offset ? sql `OFFSET ${q.data.offset}` : sql ``;
    if (op === 'select') {
        let count = null;
        if (q.data.count) {
            const [c] = await sql `SELECT count(*)::text AS n FROM ${sql(table)} ${where}`;
            count = Number(c.n);
        }
        if (q.data.head)
            return { data: null, count };
        const rows = await sql `SELECT ${sql(selectCols)} FROM ${sql(table)} ${where} ${order} ${limit} ${offset}`;
        await attachEmbeds(table, rows, parsed.embeds, roles);
        return { data: rows, count };
    }
    const sanitize = (v) => {
        const out = {};
        for (const [k, val] of Object.entries(v)) {
            if (!cols.has(k))
                throw badRequest(`Unknown column ${table}.${k}`);
            if (rule.hidden?.includes(k))
                throw forbidden(`Column ${table}.${k} is not writable`);
            // These schema-defined columns are text[], unlike images/faqs/seo (jsonb).
            // Use text[] OID 1009 explicitly: element OID 25 depends on the driver's
            // warmed type-array map and can be encoded as scalar text on a cold pool.
            if (table === 'products' && PRODUCT_TEXT_ARRAY_COLUMNS.has(k) && val !== null) {
                if (!Array.isArray(val) || val.some(item => typeof item !== 'string'))
                    throw badRequest(`Product ${k} must be an array of strings`);
                out[k] = sql.array(val, 1009);
            }
            else {
                out[k] = val !== null && typeof val === 'object' ? sql.json(val) : val;
            }
        }
        return out;
    };
    if (op === 'insert' || op === 'upsert') {
        const values = (Array.isArray(q.data.values) ? q.data.values : q.data.values ? [q.data.values] : []).map(sanitize);
        if (!values.length)
            throw badRequest('No values');
        const keys = [...new Set(values.flatMap((v) => Object.keys(v)))];
        const normalized = values.map((v) => Object.fromEntries(keys.map((k) => [k, k in v ? v[k] : null])));
        if (op === 'upsert') {
            const conflict = q.data.onConflict ?? rule.pk;
            if (!cols.has(conflict))
                throw badRequest('Bad onConflict');
            const updates = keys.filter((k) => k !== conflict);
            const rows = updates.length
                ? await sql `INSERT INTO ${sql(table)} ${sql(normalized, keys)} ON CONFLICT (${sql(conflict)}) DO UPDATE SET ${updates.map((k) => sql `${sql(k)} = EXCLUDED.${sql(k)}`).reduce((a, b, i) => (i === 0 ? b : sql `${a}, ${b}`))} RETURNING ${sql(selectCols)}`
                : await sql `INSERT INTO ${sql(table)} ${sql(normalized, keys)} ON CONFLICT (${sql(conflict)}) DO NOTHING RETURNING ${sql(selectCols)}`;
            afterWrite(table, op);
            return { data: rows, count: null };
        }
        const rows = await sql `INSERT INTO ${sql(table)} ${sql(normalized, keys)} RETURNING ${sql(selectCols)}`;
        afterWrite(table, op);
        return { data: rows, count: null };
    }
    if (!q.data.filters.length)
        throw badRequest(`${op} requires at least one filter`);
    if (op === 'update') {
        const v = sanitize((Array.isArray(q.data.values) ? q.data.values[0] : q.data.values) ?? {});
        if (!Object.keys(v).length)
            throw badRequest('No values');
        const rows = await sql `UPDATE ${sql(table)} SET ${sql(v, Object.keys(v))} ${where} RETURNING ${sql(selectCols)}`;
        afterWrite(table, op);
        return { data: rows, count: null };
    }
    const rows = await sql `DELETE FROM ${sql(table)} ${where} RETURNING ${sql(selectCols)}`;
    afterWrite(table, op);
    return { data: rows, count: null };
}
//# sourceMappingURL=gateway.js.map