import { api } from './apiClient';
import type { DbProduct, DbReview } from '@/types';

export interface Catalog { products: DbProduct[]; reviews: DbReview[] }

const CHANGE_KEY = 'earthora-catalog-changed';
const CACHE_TTL = 30_000;
let cache: { at: number; promise: Promise<Catalog> } | null = null;
const listeners = new Set<() => void>();

// Public anon key (RLS-gated) — used only when the owned API is unreachable,
// e.g. local dev without `dev:api` or a static deploy without an /api proxy.
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || '';
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || '';

async function sbGet<T>(path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    cache: 'no-store',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Supabase REST ${res.status}`);
  return res.json() as Promise<T>;
}

async function fetchCatalogFromSupabase(): Promise<Catalog> {
  const [products, reviews] = await Promise.all([
    sbGet<DbProduct[]>('products?select=id,name,slug,price,mrp,status,tag,badge,description,highlights,images,rating,created_at,inventory(total_stock)&status=eq.active&order=created_at.asc'),
    sbGet<DbReview[]>('review_details?select=review_product_id,review_user_id,review_rating,review_comment,review_created_at&order=review_created_at.desc&limit=500').catch(() => []),
  ]);
  return { products, reviews };
}

/** Dedupe nearby reads, but never reuse an HTTP cache containing old prices/stock. */
export function fetchCatalog(force = false): Promise<Catalog> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL) return cache.promise;
  const promise = api<Catalog>('/api/store/catalog', {
    cache: 'no-store', signal: AbortSignal.timeout(4_000),
  }).catch((error) => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw error;
    // Report the API's own failure if the fallback cannot help either.
    return fetchCatalogFromSupabase().catch(() => { throw error; });
  }).catch((error) => {
    if (cache?.promise === promise) cache = null;
    throw error;
  });
  cache = { at: Date.now(), promise };
  return promise;
}

function changed(): void {
  cache = null;
  listeners.forEach(listener => listener());
}

function onStorage(event: StorageEvent): void {
  if (event.key === CHANGE_KEY) changed();
}

/** Same-tab update plus a data-free signal to other storefront/admin tabs. */
export function invalidateCatalog(): void {
  changed();
  try { localStorage.setItem(CHANGE_KEY, `${Date.now()}:${Math.random()}`); } catch { /* Storage may be disabled. */ }
}

export function subscribeCatalogChanges(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('storage', onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}
