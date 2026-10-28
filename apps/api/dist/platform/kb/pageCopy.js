/** Extract the readable copy of the storefront's static pages from their source files.

The storefront is a client-rendered app, so crawling the live site returns an empty
shell. Its page copy lives in React source (JSX text and content arrays), which this
build-time extractor turns into plain text: `npm run build` for the API writes
`dist/kb/pages.json`, and the worker indexes it so page content follows every deploy.
The TypeScript compiler is a build-time dependency only; the worker never needs it. */
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
/** Public pages whose copy the assistant may quote. Product and account pages come from live data. */
export const PAGE_SOURCES = [
    { path: '/faq', title: 'Frequently Asked Questions (website)', file: 'faq.tsx' },
    { path: '/our-story', title: 'Our Story and Farm (website)', file: 'our-story.tsx' },
    { path: '/health-benefits', title: 'Moringa Health Benefits (website)', file: 'health-benefits.tsx' },
    { path: '/shipping-policy', title: 'Shipping and Delivery Policy (website)', file: 'shipping-policy.tsx' },
    { path: '/privacy-policy', title: 'Privacy Policy (website)', file: 'privacy-policy.tsx' },
    { path: '/terms-of-use', title: 'Terms of Use (website)', file: 'terms-of-use.tsx' },
    { path: '/contact', title: 'Contact Earthora Farms (website)', file: 'contact.tsx' },
];
// Inline elements whose text belongs to the surrounding sentence.
const INLINE_TAGS = new Set(['span', 'strong', 'em', 'b', 'i', 'u', 'a', 'small', 'br', 'sup', 'sub', 'code', 'abbr', 'time', 'mark', 'Link']);
const UTILITY_WORDS = new Set(['flex', 'grid', 'block', 'hidden', 'relative', 'absolute', 'container', 'italic', 'uppercase', 'truncate', 'sticky',
    'fixed', 'inline', 'border', 'rounded', 'shadow', 'transition', 'underline', 'group', 'overflow', 'capitalize', 'antialiased', 'sr-only']);
const CODE_LIKE = /[{}<>]|=>|\bfunction\b|\bconst\b|^https?:\/\/|^\/[\w-]|^mailto:|^tel:|^[#.][\w-]+$/;
function words(text) {
    return text.trim().split(/\s+/).filter(Boolean).length;
}
function classy(token) {
    if (!/^[\w\-:/\[\]#.%()!]+$/.test(token))
        return false;
    return /[-:/\[]/.test(token) || UTILITY_WORDS.has(token) || /^\d/.test(token);
}
/** Keep sentences a person would read on the page; drop class lists, code, URLs and UI crumbs. */
export function keepable(text) {
    const value = text.replace(/\s+/g, ' ').trim();
    if (words(value) < 3 || value.length < 12)
        return false;
    if (CODE_LIKE.test(value))
        return false;
    if (!/[a-zA-Zऀ-૿]{3}/.test(value))
        return false;
    const tokens = value.split(' ');
    if (tokens.filter(classy).length * 2 >= tokens.length)
        return false;
    return true;
}
function normalize(text) {
    return text.replace(/\s+/g, ' ').trim();
}
export async function extractPageCopy(source, title) {
    const ts = await import('typescript');
    const file = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const parts = [];
    const seen = new Set();
    const push = (text) => {
        const value = normalize(text);
        if (!keepable(value) || seen.has(value))
            return;
        seen.add(value);
        parts.push(value);
    };
    const tagName = (node) => ts.isJsxElement(node) ? node.openingElement.tagName.getText() : node.tagName.getText();
    const literalText = (node) => {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
            return node.text;
        if (ts.isTemplateExpression(node))
            return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(' ');
        return null;
    };
    // The text of an element made only of text and inline elements, or null when it holds blocks.
    const inlineText = (node) => {
        const pieces = [];
        for (const child of node.children) {
            if (ts.isJsxText(child))
                pieces.push(child.text);
            else if (ts.isJsxExpression(child)) {
                if (!child.expression)
                    continue;
                const text = literalText(child.expression);
                if (text === null)
                    return null;
                pieces.push(text);
            }
            else if (ts.isJsxSelfClosingElement(child)) {
                if (!INLINE_TAGS.has(tagName(child)))
                    return null;
            }
            else if (ts.isJsxElement(child)) {
                if (!INLINE_TAGS.has(tagName(child)))
                    return null;
                const inner = inlineText(child);
                if (inner === null)
                    return null;
                pieces.push(inner);
            }
            else
                return null;
        }
        return pieces.join(' ');
    };
    const visit = (node) => {
        if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
            const text = inlineText(node);
            if (text !== null) {
                push(text);
                return;
            }
            for (const child of node.children)
                visit(child);
            return;
        }
        if (ts.isJsxText(node)) {
            push(node.text);
            return;
        }
        if (ts.isJsxAttribute(node) || ts.isImportDeclaration(node))
            return;
        const text = literalText(node);
        if (text !== null) {
            push(text);
            return;
        }
        ts.forEachChild(node, visit);
    };
    visit(file);
    return [`# ${title}`, ...parts].join('\n');
}
export async function extractPages(pagesDir, sources = PAGE_SOURCES) {
    const pages = [];
    for (const page of sources) {
        const source = await readFile(join(pagesDir, basename(page.file)), 'utf8');
        const text = await extractPageCopy(source, page.title);
        pages.push({ path: page.path, title: page.title, text, words: words(text) });
    }
    return pages;
}
//# sourceMappingURL=pageCopy.js.map