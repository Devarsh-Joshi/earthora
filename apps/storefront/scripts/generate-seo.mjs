import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const origin = 'https://www.earthorafarms.com';
const pages = JSON.parse(await readFile(path.join(root, 'src/seo/pages.json'), 'utf8'));
const shell = await readFile(path.join(dist, 'index.html'), 'utf8');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function canonical(pathname) {
  return `${origin}${pathname === '/' ? '/' : `${pathname}/`}`;
}

function setMeta(html, attribute, name, content) {
  const pattern = new RegExp(`<meta\\s+${attribute}="${name}"[^>]*>`, 'i');
  const tag = `<meta ${attribute}="${name}" content="${escapeHtml(content)}" />`;
  return pattern.test(html) ? html.replace(pattern, tag) : html.replace('</head>', `    ${tag}\n  </head>`);
}

function absoluteImage(image) {
  if (!image) return `${origin}/og-image.png`;
  try {
    const parsed = new URL(image, origin);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : `${origin}/og-image.png`;
  } catch {
    return `${origin}/og-image.png`;
  }
}

function renderPage(page, productLinks = [], product = null) {
  const url = canonical(page.path);
  let html = shell.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(page.title)}</title>`);
  html = setMeta(html, 'name', 'description', page.description);
  html = setMeta(html, 'name', 'robots', 'index, follow, max-image-preview:large');
  html = html.replace(/<link rel="canonical"[^>]*>/i, `<link rel="canonical" href="${url}" />`);
  for (const [attribute, name, content] of [
    ['property', 'og:type', product ? 'product' : 'website'],
    ['property', 'og:url', url],
    ['property', 'og:title', page.title],
    ['property', 'og:description', page.description],
    ['property', 'og:image', absoluteImage(product?.images?.find((image) => image.is_primary)?.url ?? product?.images?.[0]?.url)],
    ['name', 'twitter:title', page.title],
    ['name', 'twitter:description', page.description],
    ['name', 'twitter:image', absoluteImage(product?.images?.find((image) => image.is_primary)?.url ?? product?.images?.[0]?.url)],
  ]) html = setMeta(html, attribute, name, content);

  if (product) {
    const image = absoluteImage(product.images?.find((item) => item.is_primary)?.url ?? product.images?.[0]?.url);
    const stock = product.inventory?.[0]?.total_stock ?? product.stockQty ?? 0;
    const data = {
      '@context': 'https://schema.org', '@type': 'Product',
      name: product.name, description: product.description || page.description,
      image: [image], sku: product.slug || product.id,
      brand: { '@type': 'Brand', name: 'Earthora Farms' },
      offers: { '@type': 'Offer', url, priceCurrency: 'INR', price: Number(product.price),
        availability: stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock' },
    };
    html = html.replace('</head>', `    <script type="application/ld+json" id="product-schema">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>\n  </head>`);
  }

  const links = pages.filter((item) => item.path !== '/').map((item) =>
    `<a href="${canonical(item.path)}">${escapeHtml(item.heading)}</a>`).join(' · ');
  const catalogLinks = productLinks.map((item) =>
    `<li><a href="${canonical(`/product/${item.id}`)}">${escapeHtml(item.name)}</a></li>`).join('');
  const fallback = `<main style="max-width:68rem;margin:3rem auto;padding:1rem;font:1rem/1.6 system-ui,sans-serif;color:#0e1f13"><a href="${origin}/">Earthora Farms</a><h1>${escapeHtml(page.heading)}</h1><p>${escapeHtml(page.description)}</p>${page.path === '/' && catalogLinks ? `<h2>Our products</h2><ul>${catalogLinks}</ul>` : ''}<nav aria-label="Explore Earthora Farms">${links}</nav></main>`;
  return html.replace('<div id="root"></div>', `<div id="root">${fallback}</div>`);
}

let products = [];
try {
  const response = await fetch(process.env.SEO_CATALOG_URL || `${origin}/api/store/catalog`, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`catalog returned HTTP ${response.status}`);
  const catalog = await response.json();
  if (!Array.isArray(catalog.products)) throw new Error('catalog did not contain products');
  products = catalog.products.filter((product) => product.status === 'active' && /^[0-9a-f-]{36}$/i.test(product.id));
} catch (error) {
  console.warn(`SEO: product pages omitted because the public catalog was unavailable (${error.message}).`);
}

for (const page of pages) {
  const destination = page.path === '/' ? dist : path.join(dist, page.path.slice(1));
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, 'index.html'), renderPage(page, products));
}
for (const product of products) {
  const page = {
    path: `/product/${product.id}`,
    title: `${product.name} | Earthora Farms`,
    description: String(product.description || `Shop ${product.name} from Earthora Farms.`).replace(/<[^>]*>/g, '').slice(0, 155),
    heading: product.name,
  };
  const destination = path.join(dist, 'product', product.id);
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, 'index.html'), renderPage(page, [], product));
}

const urls = [...pages.map((page) => canonical(page.path)), ...products.map((product) => canonical(`/product/${product.id}`))];
await writeFile(path.join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((url) => `  <url><loc>${escapeHtml(url)}</loc></url>`).join('\n')}\n</urlset>\n`);
console.log(`SEO: generated ${pages.length} public pages, ${products.length} product pages and ${urls.length} sitemap URLs.`);
