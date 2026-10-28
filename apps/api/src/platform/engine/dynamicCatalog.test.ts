import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config.js', () => ({ config: { PUBLIC_STORE_URL: 'https://store.example', PII_ENCRYPTION_KEY: 'b'.repeat(64) } }));
vi.mock('../../db/client.js', () => ({ sql: vi.fn() }));
vi.mock('../../modules/jobs/queue.js', () => ({ enqueueJob: vi.fn() }));
vi.mock('../kb/retrieve.js', () => ({ retrieve: vi.fn() }));
vi.mock('../kb/ingest.js', () => ({ tenantId: vi.fn() }));
vi.mock('../../modules/commerce/pricing.js', () => ({ listProducts: vi.fn(), priceCart: vi.fn() }));

import { listProducts } from '../../modules/commerce/pricing.js';
import { BUILTIN_MAP, type FunctionContext } from './functions.js';
import { groundedChatCompanyReply } from './chatGrounding.js';

const product = (id: string, name: string, status = 'active') => ({
  id, name, slug: id, status, description: `Description of ${name}`, highlights: ['Source description'],
  images: [], price: 249, mrp: 299, stockQty: 20, lowStockThreshold: 5,
});
const context = (channelType: string): FunctionContext => ({
  conversationId: 'synthetic-session', channelType, contact: {}, state: { cart: [], checkout: {}, language: 'en' },
});
beforeEach(() => vi.resetAllMocks());

describe('published product data refresh without code or model changes', () => {
  it.each(['chat'])('updates catalogue, detail and price in the same %s conversation', async channel => {
    const rows = [product('tablets', 'Synthetic Leaf Tablets'), product('new-tea', 'Synthetic Herbal Tea', 'archived'),
      product('draft', 'Unpublished Draft', 'draft'), product('old', 'Archived Product', 'archived')];
    vi.mocked(listProducts).mockImplementation(async () => rows as any);
    const ctx = context(channel);
    const list = () => BUILTIN_MAP.get('list_products')!.run({}, ctx);
    expect((await list()).data).toEqual([expect.objectContaining({ id: 'tablets' })]);
    for (const productId of ['draft', 'old', 'new-tea']) {
      expect(await BUILTIN_MAP.get('get_product_details')!.run({ productId }, ctx))
        .toEqual({ ok: false, message: 'Product not found' });
    }

    rows[1].status = 'active';
    const published = await list();
    expect(published.data).toEqual([expect.objectContaining({ id: 'tablets' }),
      expect.objectContaining({ id: 'new-tea', name: 'Synthetic Herbal Tea', price: 249 })]);
    expect(groundedChatCompanyReply('What is Earthora Farms?', published, 'en')).toContain('Synthetic Herbal Tea');
    expect((await BUILTIN_MAP.get('get_product_details')!.run({ productId: 'new-tea' }, ctx)).data)
      .toMatchObject({ id: 'new-tea', description: 'Description of Synthetic Herbal Tea', price: 249 });

    rows[1].price = 279;
    rows[1].stockQty = 0;
    expect((await list()).data).toEqual([expect.objectContaining({ id: 'tablets' }),
      expect.objectContaining({ id: 'new-tea', price: 279, stock: 'out of stock' })]);
    rows[1].status = 'archived';
    expect((await list()).data).toEqual([expect.objectContaining({ id: 'tablets' })]);
    expect((await BUILTIN_MAP.get('add_to_cart')!.run({ productId: 'new-tea', quantity: 1 }, ctx)).ok).toBe(false);
    expect(ctx.state.cart).toEqual([]);
  });
});
