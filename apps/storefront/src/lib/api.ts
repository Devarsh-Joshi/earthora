import { api } from './apiClient';
import { fetchCatalog, invalidateCatalog } from './catalog';
export { fetchCatalog } from './catalog';
export type { Catalog } from './catalog';
import type { DbProduct, DbReview, Product } from '@/types';
import { productImageFallback } from './productImageFallback';

function mapProduct(p: DbProduct, dbReviews: DbReview[]): Product {
  const inv = Array.isArray(p.inventory) ? p.inventory[0] : p.inventory;
  const images = Array.isArray(p.images) ? p.images : [];
  const fallback = productImageFallback(p.name, p.slug);
  const rawPrimary = images.find((i) => i.is_primary)?.url || images[0]?.url;
  const rawSecondary = images.find((i) => !i.is_primary)?.url;
  const primaryImg = rawPrimary && !rawPrimary.includes('undefined') ? rawPrimary : fallback.main;
  const secondaryImg = rawSecondary && !rawSecondary.includes('undefined') ? rawSecondary : primaryImg;
  const stockQty = inv?.total_stock ?? 0;
  const mrp = Number(p.mrp);
  const price = Number(p.price);
  const prodReviews = dbReviews.filter((r) => r.review_product_id === p.id);
  const reviewCount = prodReviews.length;
  const avgRating = reviewCount > 0 ? Number((prodReviews.reduce((acc, r) => acc + Number(r.review_rating), 0) / reviewCount).toFixed(1)) : Number(p.rating) || 4.5;
  return {
    id: p.id, name: p.name, mrp, price,
    discount: mrp > 0 ? Math.round(((mrp - price) / mrp) * 100) : 0,
    rating: avgRating, reviewCount, tag: p.tag || '', imageMain: primaryImg, imageHover: secondaryImg,
    allImages: (() => { const urls = images.map((i) => i.url).filter((u) => u && !u.includes('undefined')); if (urls.length > 0) return urls; return secondaryImg !== primaryImg ? [primaryImg, secondaryImg] : [primaryImg]; })(),
    badge: p.badge || '', stock: stockQty > 15 ? 'In Stock' : stockQty > 0 ? 'Low Stock' : 'Out of Stock',
    highlights: Array.isArray(p.highlights) ? p.highlights : [], description: p.description || '',
  };
}

export async function fetchPublicProducts(force = false): Promise<Product[]> {
  const { products, reviews } = await fetchCatalog(force);
  return products.filter((p) => p.status === 'active').map((p) => mapProduct(p, reviews));
}

export function refreshPublicProducts(): Promise<Product[]> {
  return fetchPublicProducts(true);
}

export async function fetchReviews(): Promise<DbReview[]> {
  return (await fetchCatalog()).reviews;
}

export async function submitReview(input: { productId: string; name: string; rating: number; comment: string }): Promise<void> {
  await api('/api/store/reviews', { method: 'POST', json: input });
  invalidateCatalog();
}

export async function submitContact(input: { name: string; email: string; phone: string; topic: string; message: string; marketingConsent: boolean }): Promise<void> {
  await api('/api/store/contact', { method: 'POST', json: input });
}

export async function subscribeNewsletter(email: string): Promise<void> {
  await api('/api/store/newsletter', { method: 'POST', json: { email } });
}

export async function requestRestock(productId: string, phone: string): Promise<void> {
  await api('/api/store/restock-request', { method: 'POST', json: { productId, phone } });
}
