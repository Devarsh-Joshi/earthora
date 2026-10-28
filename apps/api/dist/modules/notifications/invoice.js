/** Indian tax-invoice PDF, data read from the owned DB. Older orders may still carry WhatsApp/voice sources. */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { config } from '../../config.js';
import { getOrderBundle } from '../commerce/orders.js';
import { computeGst } from '../commerce/pricing.js';
const here = dirname(fileURLToPath(import.meta.url));
const FONT_DIR = join(here, '..', '..', '..', 'assets', 'fonts');
const A4 = [595.28, 841.89];
const INK = rgb(0.08, 0.14, 0.1);
const MUTED = rgb(0.35, 0.4, 0.36);
const GREEN = rgb(0.12, 0.33, 0.21);
const PALE_GREEN = rgb(0.93, 0.96, 0.93);
const RULE = rgb(0.62, 0.69, 0.64);
const COPY = {
    en: { invoice: 'TAX INVOICE', original: 'ORIGINAL', billTo: 'BILL TO', shipTo: 'SHIP TO', invoiceNo: 'Invoice No.', invoiceDate: 'Invoice Date', source: 'Order source', item: 'Description of goods', hsn: 'HSN/SAC', quantity: 'Qty.', rate: 'Rate', taxable: 'Taxable value', amount: 'Amount', cgst: 'CGST @ 9%', sgst: 'SGST @ 9%', igst: 'IGST @ 18%', totalTax: 'Total tax', total: 'TOTAL', amountWords: 'Amount chargeable (in words)', payment: 'Payment status', declaration: 'Declaration', authorized: 'Authorised signatory', terms: 'Terms and notes', generated: 'This is a computer generated invoice.', reference: 'Payment reference', method: 'Method' },
    hi: { invoice: 'टैक्स इनवॉइस', original: 'मूल', billTo: 'बिल प्राप्तकर्ता', shipTo: 'भेजने का पता', invoiceNo: 'इनवॉइस नंबर', invoiceDate: 'इनवॉइस तारीख', source: 'ऑर्डर स्रोत', item: 'सामान का विवरण', hsn: 'एचएसएन/एसएसी', quantity: 'मात्रा', rate: 'दर', taxable: 'कर योग्य मूल्य', amount: 'राशि', cgst: 'सीजीएसटी @ 9%', sgst: 'एसजीएसटी @ 9%', igst: 'आईजीएसटी @ 18%', totalTax: 'कुल कर', total: 'कुल', amountWords: 'शब्दों में राशि', payment: 'पेमेंट स्थिति', declaration: 'घोषणा', authorized: 'अधिकृत हस्ताक्षर', terms: 'शर्तें और नोट्स', generated: 'यह कंप्यूटर द्वारा बनाया गया इनवॉइस है।', reference: 'पेमेंट संदर्भ', method: 'तरीका' },
    gu: { invoice: 'ટેક્સ ઇન્વોઇસ', original: 'મૂળ', billTo: 'બિલ મેળવનાર', shipTo: 'મોકલવાનું સરનામું', invoiceNo: 'ઇન્વોઇસ નંબર', invoiceDate: 'ઇન્વોઇસ તારીખ', source: 'ઓર્ડર સ્ત્રોત', item: 'વસ્તુની વિગતો', hsn: 'એચએસએન/એસએસી', quantity: 'જથ્થો', rate: 'દર', taxable: 'કરપાત્ર મૂલ્ય', amount: 'રકમ', cgst: 'સીજીએસટી @ 9%', sgst: 'એસજીએસટી @ 9%', igst: 'આઇજીએસટી @ 18%', totalTax: 'કુલ કર', total: 'કુલ', amountWords: 'શબ્દોમાં રકમ', payment: 'પેમેન્ટ સ્થિતિ', declaration: 'ઘોષણા', authorized: 'અધિકૃત સહી', terms: 'શરતો અને નોંધો', generated: 'આ કમ્પ્યુટર દ્વારા બનાવેલ ઇનવોઇસ છે.', reference: 'પેમેન્ટ સંદર્ભ', method: 'રીત' },
};
const money = (n) => `INR ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function wrap(text, font, size, maxWidth) {
    const words = text.trim().split(/\s+/u).filter(Boolean);
    const lines = [];
    let line = '';
    for (const word of words) {
        const c = line ? `${line} ${word}` : word;
        if (line && font.widthOfTextAtSize(c, size) > maxWidth) {
            lines.push(line);
            line = word;
        }
        else
            line = c;
    }
    if (line)
        lines.push(line);
    return lines.length ? lines : [''];
}
function drawWrapped(page, text, x, y, width, font, size, color = INK, leading = 3) {
    const lines = wrap(text, font, size, width);
    lines.forEach((l, i) => page.drawText(l, { x, y: y - i * (size + leading), size, font, color }));
    return y - lines.length * (size + leading);
}
function rightText(page, text, right, y, size, font, color = INK) { page.drawText(text, { x: right - font.widthOfTextAtSize(text, size), y, size, font, color }); }
function numberToWords(num) {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const chunk = (v) => v < 20 ? ones[v] : v < 100 ? `${tens[Math.floor(v / 10)]}${v % 10 ? ` ${ones[v % 10]}` : ''}` : `${ones[Math.floor(v / 100)]} Hundred${v % 100 ? ` and ${chunk(v % 100)}` : ''}`;
    let r = Math.max(0, Math.round(num));
    if (!r)
        return 'Zero Rupees Only';
    const parts = [];
    const crore = Math.floor(r / 10_000_000);
    r %= 10_000_000;
    const lakh = Math.floor(r / 100_000);
    r %= 100_000;
    const thousand = Math.floor(r / 1_000);
    r %= 1_000;
    if (crore)
        parts.push(`${chunk(crore)} Crore`);
    if (lakh)
        parts.push(`${chunk(lakh)} Lakh`);
    if (thousand)
        parts.push(`${chunk(thousand)} Thousand`);
    if (r)
        parts.push(chunk(r));
    return `${parts.join(' ')} Rupees Only`;
}
function shippingValue(order, key) {
    const s = order.shipping_address ?? {};
    const direct = order[`customer_${key}`];
    const fb = s[key] ?? (key === 'zip' ? s.postalCode : undefined);
    return String(direct ?? fb ?? '').trim();
}
function sourceLabel(order) {
    const s = String(order.shipping_address?.source ?? '').toLowerCase();
    if (s.includes('whatsapp'))
        return 'WhatsApp';
    if (s.includes('voice') || s.includes('smartflo'))
        return 'Voice agent';
    if (s.includes('chat'))
        return 'Chat assistant';
    if (s.includes('offline') || s.includes('manual'))
        return 'Offline order';
    return 'Website';
}
async function embedInvoiceFont(pdf, language) {
    if (language === 'en')
        return pdf.embedFont(StandardFonts.Helvetica);
    pdf.registerFontkit(fontkit);
    const bytes = await readFile(join(FONT_DIR, language === 'hi' ? 'NotoSansDevanagari-Regular.ttf' : 'NotoSansGujarati-Regular.ttf'));
    return pdf.embedFont(bytes, { subset: true });
}
function drawCell(page, text, x, y, width, font, size, align = 'left') {
    const value = wrap(text, font, size, width - 8)[0];
    const tw = font.widthOfTextAtSize(value, size);
    page.drawText(value, { x: align === 'right' ? x + width - tw - 5 : align === 'center' ? x + (width - tw) / 2 : x + 5, y, size, font, color: INK });
}
export async function renderInvoicePdf(data) {
    const { order, items, payment, language } = data;
    const copy = COPY[language];
    const pdf = await PDFDocument.create();
    const page = pdf.addPage(A4);
    const font = await embedInvoiceFont(pdf, language);
    const bold = language === 'en' ? await pdf.embedFont(StandardFonts.HelveticaBold) : font;
    const width = A4[0];
    const left = 28;
    const right = width - left;
    const contentWidth = right - left;
    const sellerName = config.COMPANY_NAME;
    const sellerAddress = config.COMPANY_ADDRESS;
    const sellerEmail = config.COMPANY_EMAIL;
    const sellerPhone = config.COMPANY_PHONE;
    const sellerGstin = config.COMPANY_GSTIN;
    const orderNumber = order.order_number || order.id;
    const date = new Date(order.created_at ?? Date.now()).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
    const total = Number(order.total_amount ?? items.reduce((s, i) => s + i.total, 0));
    const gst = computeGst(total, shippingValue(order, 'country') || 'India', shippingValue(order, 'state'));
    let y = A4[1] - 34;
    page.drawText(copy.invoice, { x: left, y, size: 16, font: bold, color: INK });
    page.drawRectangle({ x: left + 108, y: y - 2, width: 52, height: 13, borderColor: GREEN, borderWidth: 0.8 });
    page.drawText(copy.original, { x: left + 113, y: y + 2, size: 7.5, font: bold, color: GREEN });
    y -= 22;
    const metaTop = y;
    const metaX = 356;
    page.drawRectangle({ x: left, y: metaTop - 78, width: contentWidth, height: 78, borderColor: RULE, borderWidth: 0.8 });
    page.drawLine({ start: { x: metaX - 10, y: metaTop }, end: { x: metaX - 10, y: metaTop - 78 }, thickness: 0.8, color: RULE });
    page.drawText(sellerName, { x: left + 8, y: metaTop - 16, size: 10, font: bold, color: INK });
    const sellerY = drawWrapped(page, sellerAddress, left + 8, metaTop - 29, 270, font, 7.5, INK, 1.5);
    page.drawText(`${sellerEmail}${sellerPhone ? `  |  ${sellerPhone}` : ''}`, { x: left + 8, y: sellerY - 3, size: 7.5, font, color: MUTED });
    if (sellerGstin)
        page.drawText(`GSTIN: ${sellerGstin}`, { x: left + 8, y: sellerY - 15, size: 7.5, font: bold, color: INK });
    page.drawText(copy.invoiceNo, { x: metaX, y: metaTop - 16, size: 7.5, font: bold, color: MUTED });
    page.drawText(orderNumber, { x: metaX, y: metaTop - 28, size: 9, font: bold, color: INK });
    page.drawText(copy.invoiceDate, { x: 456, y: metaTop - 16, size: 7.5, font: bold, color: MUTED });
    page.drawText(date, { x: 456, y: metaTop - 28, size: 9, font: bold, color: INK });
    page.drawText(copy.source, { x: metaX, y: metaTop - 48, size: 7.5, font: bold, color: MUTED });
    page.drawText(sourceLabel(order), { x: metaX, y: metaTop - 60, size: 8.5, font, color: INK });
    page.drawText(copy.payment, { x: 456, y: metaTop - 48, size: 7.5, font: bold, color: MUTED });
    page.drawText((payment?.payment_status || 'pending').toUpperCase(), { x: 456, y: metaTop - 60, size: 8.5, font: bold, color: GREEN });
    y = metaTop - 90;
    const partyH = 92;
    const half = contentWidth / 2;
    page.drawRectangle({ x: left, y: y - partyH, width: contentWidth, height: partyH, borderColor: RULE, borderWidth: 0.8 });
    page.drawLine({ start: { x: left + half, y }, end: { x: left + half, y: y - partyH }, thickness: 0.8, color: RULE });
    const name = order.customer_name || String(order.shipping_address?.name ?? '') || 'Customer';
    const addr = [shippingValue(order, 'address'), [shippingValue(order, 'city'), shippingValue(order, 'state')].filter(Boolean).join(', '), [shippingValue(order, 'zip'), shippingValue(order, 'country')].filter(Boolean).join(' ')].filter(Boolean).join('\n');
    for (const [i, label] of [copy.billTo, copy.shipTo].entries()) {
        const x = left + 8 + i * half;
        page.drawText(label, { x, y: y - 14, size: 7.5, font: bold, color: MUTED });
        page.drawText(name, { x, y: y - 27, size: 9, font: bold, color: INK });
        let ay = y - 40;
        for (const line of addr.split('\n'))
            ay = drawWrapped(page, line, x, ay, half - 20, font, 7.8, INK, 1.5);
        const contact = [order.customer_phone, order.customer_email].filter(Boolean).join('  |  ');
        if (contact)
            page.drawText(contact, { x, y: ay - 3, size: 7.5, font, color: MUTED });
        if (i === 0 && order.customer_gst)
            page.drawText(`GSTIN: ${order.customer_gst}`, { x, y: ay - 15, size: 7.5, font: bold, color: INK });
    }
    y -= partyH + 12;
    const cols = [{ key: 'sn', w: 26, label: '#' }, { key: 'item', w: 208, label: copy.item }, { key: 'hsn', w: 62, label: copy.hsn }, { key: 'qty', w: 44, label: copy.quantity }, { key: 'rate', w: 78, label: copy.rate }, { key: 'amount', w: contentWidth - 26 - 208 - 62 - 44 - 78, label: copy.amount }];
    const rowH = 20;
    page.drawRectangle({ x: left, y: y - rowH, width: contentWidth, height: rowH, color: PALE_GREEN, borderColor: RULE, borderWidth: 0.8 });
    let cx = left;
    for (const c of cols) {
        drawCell(page, c.label, cx, y - 14, c.w, bold, 7.8, c.key === 'item' ? 'left' : 'center');
        cx += c.w;
    }
    y -= rowH;
    items.forEach((it, idx) => {
        page.drawRectangle({ x: left, y: y - rowH, width: contentWidth, height: rowH, borderColor: RULE, borderWidth: 0.5 });
        let x = left;
        const taxableUnit = it.unitPrice / 1.18;
        const vals = { sn: String(idx + 1), item: it.name, hsn: it.hsn || '12119029', qty: String(it.quantity), rate: money(taxableUnit).replace('INR ', ''), amount: money(it.total / 1.18).replace('INR ', '') };
        for (const c of cols) {
            drawCell(page, vals[c.key], x, y - 14, c.w, font, 8, c.key === 'item' ? 'left' : c.key === 'sn' || c.key === 'qty' || c.key === 'hsn' ? 'center' : 'right');
            x += c.w;
        }
        y -= rowH;
    });
    const totalsX = left + contentWidth - 220;
    const totalsRows = [[copy.taxable, money(gst.taxableValue), false]];
    if (gst.isGujarat)
        totalsRows.push([copy.cgst, money(gst.cgstAmount), false], [copy.sgst, money(gst.sgstAmount), false]);
    else if (gst.isIndia)
        totalsRows.push([copy.igst, money(gst.igstAmount), false]);
    totalsRows.push([copy.totalTax, money(gst.totalGstAmount), false], [copy.total, money(total), true]);
    for (const [label, value, strong] of totalsRows) {
        page.drawRectangle({ x: totalsX, y: y - rowH, width: 220, height: rowH, borderColor: RULE, borderWidth: 0.5, color: strong ? PALE_GREEN : undefined });
        page.drawText(label, { x: totalsX + 6, y: y - 14, size: strong ? 8.5 : 7.8, font: strong ? bold : font, color: INK });
        rightText(page, value, totalsX + 214, y - 14, strong ? 8.5 : 7.8, strong ? bold : font);
        y -= rowH;
    }
    y -= 10;
    page.drawText(copy.amountWords, { x: left, y, size: 7.5, font: bold, color: MUTED });
    page.drawText(numberToWords(total), { x: left, y: y - 12, size: 8.5, font: bold, color: INK });
    y -= 30;
    if (payment?.payment_transaction_id) {
        page.drawText(`${copy.reference}: ${payment.payment_transaction_id}   ${copy.method}: ${payment.payment_method ?? '-'}`, { x: left, y, size: 7.5, font, color: MUTED });
        y -= 14;
    }
    if (config.BANK_ACCOUNT_NO) {
        page.drawText(`Bank: ${config.BANK_BRANCH}  A/C ${config.BANK_ACCOUNT_NO}  IFSC ${config.BANK_IFSC}`, { x: left, y, size: 7.5, font, color: MUTED });
        y -= 14;
    }
    page.drawText(copy.declaration, { x: left, y: y - 4, size: 7.5, font: bold, color: MUTED });
    drawWrapped(page, 'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct. Goods once sold are subject to our shipping and return policy.', left, y - 16, contentWidth - 180, font, 7.2, INK, 1.5);
    page.drawText(`For ${sellerName}`, { x: right - 150, y: y - 4, size: 8, font: bold, color: INK });
    page.drawText(copy.authorized, { x: right - 150, y: y - 40, size: 7.5, font, color: MUTED });
    page.drawText(copy.generated, { x: left, y: 30, size: 7, font, color: MUTED });
    return Buffer.from(await pdf.save());
}
export async function renderInvoiceForOrder(orderId, language = 'en') {
    const bundle = await getOrderBundle(orderId);
    if (!bundle)
        throw new Error(`Order ${orderId} not found`);
    return renderInvoicePdf({
        order: bundle.order,
        items: bundle.items.map((i) => ({ name: i.product_name ?? 'Product', quantity: Number(i.quantity), unitPrice: Number(i.unit_price), total: Number(i.total_price), hsn: i.hsn_code ?? undefined })),
        payment: bundle.payment, language,
    });
}
//# sourceMappingURL=invoice.js.map