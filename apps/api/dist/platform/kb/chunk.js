const approxTokens = (s) => Math.ceil(s.length / 4);
function splitParagraphs(text) {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const blocks = [];
    let heading = '';
    let buf = [];
    const flush = () => { const body = buf.join('\n').trim(); if (body)
        blocks.push({ heading, body }); buf = []; };
    for (const line of lines) {
        const h = line.match(/^(#{1,6})\s+(.*)$/) || line.match(/^([A-Z][A-Za-z0-9 &/'-]{2,60})$/);
        if (line.match(/^#{1,6}\s+/)) {
            flush();
            heading = line.replace(/^#{1,6}\s+/, '').trim();
        }
        else if (line.trim() === '' && buf.length) {
            flush();
        }
        else
            buf.push(line);
    }
    flush();
    return blocks;
}
export function chunkText(text, opts = { docTitle: '' }) {
    const target = opts.targetTokens ?? 420;
    const overlap = opts.overlapTokens ?? 60;
    const blocks = splitParagraphs(text);
    const chunks = [];
    let cur = '';
    let curHeading = '';
    let ordinal = 0;
    const header = (heading) => [opts.docTitle, heading, opts.docSummary].filter(Boolean).join(' — ').slice(0, 240);
    const push = (heading) => {
        const content = cur.trim();
        if (!content)
            return;
        chunks.push({ content, contextHeader: header(heading), ordinal: ordinal++, tokens: approxTokens(content) });
        // carry overlap
        const words = content.split(/\s+/);
        cur = words.slice(Math.max(0, words.length - Math.ceil(overlap * 0.75))).join(' ') + '\n';
    };
    for (const b of blocks) {
        const isTable = /\|.*\|/.test(b.body) && b.body.split('\n').length > 1;
        if (isTable) {
            if (cur.trim())
                push(curHeading);
            curHeading = b.heading || curHeading;
            cur = b.body;
            push(curHeading);
            cur = '';
            continue;
        }
        curHeading = b.heading || curHeading;
        for (const sentence of b.body.split(/(?<=[.!?।])\s+/)) {
            if (approxTokens(cur + ' ' + sentence) > target && cur.trim())
                push(curHeading);
            cur += (cur ? ' ' : '') + sentence;
        }
        cur += '\n';
    }
    if (cur.trim())
        push(curHeading);
    return chunks.filter((c) => c.content.length > 2);
}
//# sourceMappingURL=chunk.js.map