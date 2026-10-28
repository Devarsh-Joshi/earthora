import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { publicProductsQuery } from '@/lib/catalogQuery';
import type { Product } from '@/types';
import pages from './pages.json';

const origin = 'https://www.earthorafarms.com';

function meta(attribute: 'name' | 'property', name: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${name}"]`);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, name);
    document.head.appendChild(element);
  }
  element.content = content;
}

function canonical(pathname: string) {
  return `${origin}${pathname === '/' ? '/' : `${pathname.replace(/\/$/, '')}/`}`;
}

function productImage(product: Product) {
  try {
    const url = new URL(product.imageMain, origin);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
  } catch {
    // Fall back to the shared social image.
  }
  return `${origin}/og-image.png`;
}

export function SeoManager() {
  const [location] = useLocation();
  const path = location.replace(/\/$/, '') || '/';
  const productId = /^\/product\/([^/]+)$/.exec(path)?.[1];
  const { data: products = [], isLoading } = useQuery<Product[]>({
    ...publicProductsQuery,
    enabled: Boolean(productId),
  });
  const product = productId ? products.find((item) => item.id === productId || (item as Product & { slug?: string }).slug === productId) : undefined;

  useEffect(() => {
    const page = pages.find((item) => item.path === path);
    if (productId && isLoading) return; // Preserve the build-time product metadata until the catalog arrives.
    const indexable = Boolean(page || product);
    const pageUrl = product ? canonical(`/product/${product.id}`) : canonical(path);
    const title = product ? `${product.name} | Earthora Farms` : page?.title || 'Page Not Found | Earthora Farms';
    const description = product
      ? (product.description || `Shop ${product.name} from Earthora Farms.`).replace(/<[^>]*>/g, '').slice(0, 155)
      : page?.description || 'Explore the Earthora Farms website.';
    const image = product ? productImage(product) : `${origin}/og-image.png`;
    document.title = title;
    meta('name', 'description', description);
    meta('name', 'robots', indexable ? 'index, follow, max-image-preview:large' : 'noindex, nofollow');
    meta('property', 'og:type', product ? 'product' : 'website');
    meta('property', 'og:title', title);
    meta('property', 'og:description', description);
    meta('property', 'og:image', image);
    meta('name', 'twitter:title', title);
    meta('name', 'twitter:description', description);
    meta('name', 'twitter:image', image);

    const oldCanonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (indexable) {
      const url = pageUrl;
      const link = oldCanonical || document.createElement('link');
      link.rel = 'canonical'; link.href = url;
      if (!oldCanonical) document.head.appendChild(link);
      meta('property', 'og:url', url);
    } else {
      oldCanonical?.remove();
      meta('property', 'og:url', `${origin}${path}`);
    }

    document.getElementById('product-schema')?.remove();
    if (product) {
      const schema = {
        '@context': 'https://schema.org', '@type': 'Product',
        name: product.name, description, image: [image], sku: product.id,
        brand: { '@type': 'Brand', name: 'Earthora Farms' },
        offers: { '@type': 'Offer', url: pageUrl, priceCurrency: 'INR', price: product.price,
          availability: product.stock === 'Out of Stock' ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock' },
      };
      const script = document.createElement('script');
      script.id = 'product-schema'; script.type = 'application/ld+json'; script.textContent = JSON.stringify(schema).replace(/</g, '\\u003c');
      document.head.appendChild(script);
    }
  }, [path, productId, product, isLoading]);

  return null;
}
