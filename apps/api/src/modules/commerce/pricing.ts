/**
 * The single pricing contract for storefront, admin, channels and the AI functions.
 */
import { sql } from '../../db/client.js';

export interface GstBreakdown {
  isIndia: boolean; isGujarat: boolean;
  cgstRate: number; cgstAmount: number; sgstRate: number; sgstAmount: number; igstRate: number; igstAmount: number;
  taxableValue: number; totalGstAmount: number; label: string;
}

export function computeGst(totalAmount: number, country: string, state: string): GstBreakdown {
  const cleanCountry = (country || '').trim().toLowerCase();
  const isIndia = cleanCountry === 'india' || cleanCountry === 'भारत' || cleanCountry === 'ભારત';
  const cleanState = (state || '').trim().toLowerCase();
  const isGujarat = cleanState.includes('gujarat') || cleanState === 'gj' || cleanState === 'guj' ||
    cleanState.includes('गुजरात') || cleanState.includes('ગુજરાત');
  const taxableValue = totalAmount / 1.18;
  const totalGstAmount = totalAmount - taxableValue;
  if (!isIndia) {
    return { isIndia: false, isGujarat: false, cgstRate: 0, cgstAmount: 0, sgstRate: 0, sgstAmount: 0, igstRate: 0, igstAmount: 0, taxableValue, totalGstAmount: 0, label: 'Exempt / International' };
  }
  if (isGujarat) {
    return { isIndia: true, isGujarat: true, cgstRate: 9, cgstAmount: totalGstAmount / 2, sgstRate: 9, sgstAmount: totalGstAmount / 2, igstRate: 0, igstAmount: 0, taxableValue, totalGstAmount, label: 'Intra-State GST (Gujarat)' };
  }
  return { isIndia: true, isGujarat: false, cgstRate: 0, cgstAmount: 0, sgstRate: 0, sgstAmount: 0, igstRate: 18, igstAmount: totalGstAmount, taxableValue, totalGstAmount, label: 'Inter-State IGST' };
}

export interface ProductSummary {
  id: string; slug: string; name: string; description: string; highlights: string[]; price: number; mrp: number; status: string;
  tag: string; badge: string; images: { url: string; is_primary?: boolean }[]; rating: number; stockQty: number; lowStockThreshold: number;
  hsn: string; created_at: string;
}

export async function listProducts(opts: { includeArchived?: boolean } = {}): Promise<ProductSummary[]> {
  const rows = await sql<any[]>`
    SELECT p.id, p.slug, p.name, p.description, p.highlights, p.price, p.mrp, p.status, p.tag, p.badge, p.images, p.rating, p.hsn_code, p.created_at,
           COALESCE(i.total_stock, 0) AS total_stock, COALESCE(i.low_stock_threshold, 15) AS low_stock_threshold
    FROM products p LEFT JOIN inventory i ON i.product_id = p.id
    WHERE ${opts.includeArchived ? sql`true` : sql`p.status <> 'archived'`}
    ORDER BY p.created_at ASC`;
  return rows.map((r) => ({
    id: r.id, slug: r.slug, name: r.name, description: r.description ?? '', highlights: Array.isArray(r.highlights) ? r.highlights : [],
    price: Number(r.price), mrp: Number(r.mrp), status: r.status, tag: r.tag ?? '', badge: r.badge ?? '',
    images: Array.isArray(r.images) ? r.images : [], rating: Number(r.rating ?? 4.5), stockQty: Number(r.total_stock), lowStockThreshold: Number(r.low_stock_threshold),
    hsn: r.hsn_code ?? '', created_at: r.created_at,
  }));
}

export interface CartLineInput { productId: string; quantity: number }
export interface PricedLine { productId: string; slug: string; name: string; quantity: number; unitPrice: number; mrp: number; lineTotal: number; hsn: string; stockQty: number }
export interface PricedCart {
  lines: PricedLine[]; subtotal: number;
  shipping: number; total: number; gst: GstBreakdown; unavailable: string[]; outOfStock: { productId: string; requested: number; available: number }[];
}

/** Authoritative pricing: live products, GST split. Never trust client amounts. */
export async function priceCart(lines: CartLineInput[], opts: { country?: string; state?: string } = {}): Promise<PricedCart> {
  const products = await listProducts();
  const byKey = new Map<string, ProductSummary>();
  for (const p of products) { byKey.set(p.id, p); byKey.set(p.slug, p); }
  const merged = new Map<string, number>();
  for (const l of lines) {
    const p = byKey.get(String(l.productId));
    const key = p ? p.id : String(l.productId);
    merged.set(key, (merged.get(key) ?? 0) + Math.max(1, Math.round(Number(l.quantity) || 1)));
  }
  const priced: PricedLine[] = []; const unavailable: string[] = []; const outOfStock: PricedCart['outOfStock'] = [];
  for (const [key, qty] of merged) {
    const p = byKey.get(key);
    if (!p || p.status !== 'active') { unavailable.push(key); continue; }
    if (p.stockQty < qty) outOfStock.push({ productId: p.id, requested: qty, available: p.stockQty });
    priced.push({ productId: p.id, slug: p.slug, name: p.name, quantity: qty, unitPrice: p.price, mrp: p.mrp, lineTotal: p.price * qty, hsn: p.hsn, stockQty: p.stockQty });
  }
  const subtotal = priced.reduce((s, l) => s + l.lineTotal, 0);
  const shipping = 0;
  const total = Math.max(0, Math.round((subtotal + shipping) * 100) / 100);
  return { lines: priced, subtotal, shipping, total, gst: computeGst(total, opts.country ?? 'India', opts.state ?? ''), unavailable, outOfStock };
}
