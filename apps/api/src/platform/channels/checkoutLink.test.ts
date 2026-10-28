import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../config.js', () => ({config: {PII_ENCRYPTION_KEY: 'a'.repeat(64), TOKEN_SIGNING_SECRET: 'test-signing-secret'}}));
vi.mock('../../modules/commerce/pricing.js', () => ({priceCart: vi.fn(async () => ({lines: [{productId:'p1',name:'Live product',unitPrice:9,quantity:2}],subtotal:18,total:18,unavailable:[],outOfStock:[]}))}));
import { createCheckoutSnapshot, readCheckoutSnapshot, checkoutSnapshotView, checkoutCustomerSchema } from './checkoutLink.js';
import { priceCart } from '../../modules/commerce/pricing.js';
const customer = {name:'Synthetic Customer',email:'synthetic@example.invalid',phone:'9876543210',address:'Test road 12',city:'Ahmedabad',state:'Gujarat',zip:'380001',country:'India'};
afterEach(() => vi.useRealTimers());
describe('private chat checkout snapshots', () => {
  it('encrypts customer details, reloads an authenticated snapshot and reprices current products', async () => {
    const token = createCheckoutSnapshot('conversation1','hi',customer,[{productId:'p1',quantity:2}]);
    expect(token).toMatch(/^vc1\./); expect(token).not.toContain(customer.email);
    expect(readCheckoutSnapshot(token)).toMatchObject({customer,language:'hi',items:[{productId:'p1',quantity:2}]});
    expect(await checkoutSnapshotView(token)).toMatchObject({available:true,customer,pricing:{total:18}});
    expect(priceCart).toHaveBeenCalledWith([{productId:'p1',quantity:2}],{country:'India',state:'Gujarat'});
  });
  it('rejects tampering, cross-purpose tokens, expired and overlong tokens', () => {
    vi.useFakeTimers();
    const token = createCheckoutSnapshot('c','en',customer,[{productId:'p1',quantity:1}]);
    expect(readCheckoutSnapshot(token.replace('vc1.','invoice.'))).toBeNull();
    expect(readCheckoutSnapshot(token.slice(0,-3)+'abc')).toBeNull();
    expect(readCheckoutSnapshot('x'.repeat(9000))).toBeNull();
    vi.advanceTimersByTime(60 * 60 * 1000 + 1);
    expect(readCheckoutSnapshot(token)).toBeNull();
  });
  it('rejects payment fields and invalid customer details at the schema boundary', () => {
    expect(checkoutCustomerSchema.safeParse({...customer,card:'1234'}).success).toBe(false);
    expect(checkoutCustomerSchema.safeParse({...customer,email:'not email'}).success).toBe(false);
    expect(checkoutCustomerSchema.safeParse({...customer,phone:'not a number'}).success).toBe(false);
  });
});
