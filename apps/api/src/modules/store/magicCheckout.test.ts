import { describe, expect, it } from 'vitest';
import { callbackFields, isCapturedPrepaidOrder, shippingInfoFor, shippingInfoSchema } from './magicCheckout.js';

describe('Magic Checkout callbacks', () => {
  it('accepts Razorpay GET query parameters with serialized addresses', () => {
    const input = callbackFields({
      order_id: 'mc_0123456789abcdef',
      razorpay_order_id: 'test123',
      addresses: JSON.stringify([{ id: 'home', zipcode: '380001', state_code: 'GJ', country: 'IN' }]),
    }, undefined);
    expect(shippingInfoSchema.parse(input).addresses[0].zipcode).toBe('380001');
  });

  it('returns prepaid free shipping only for valid Indian PIN codes', () => {
    const result = shippingInfoFor([
      { id: '1', zipcode: '380001', country: 'IN' },
      { id: '2', zipcode: 'abc', country: 'IN' },
      { id: '3', zipcode: '10001', country: 'US' },
    ]);
    expect(result.addresses.map((a) => a.shipping_methods[0].serviceable)).toEqual([true, false, false]);
    expect(result.addresses[0].shipping_methods[0]).toMatchObject({ shipping_fee: 0, cod: false, cod_fee: 0 });
  });

  it('requires a captured INR payment matching the server-created order and amount', () => {
    const original = {
      expectedOrderId: 'order_abc', expectedAmountPaise: 29900,
      payment: { order_id: 'order_abc', status: 'captured', currency: 'INR', amount: 29900 },
      order: { id: 'order_abc', status: 'paid', currency: 'INR', amount_paid: 29900 },
    };
    expect(isCapturedPrepaidOrder(original)).toBe(true);
    expect(isCapturedPrepaidOrder({ ...original, payment: { ...original.payment, status: 'authorized' } })).toBe(false);
    expect(isCapturedPrepaidOrder({ ...original, payment: { ...original.payment, amount: 1 } })).toBe(false);
    expect(isCapturedPrepaidOrder({ ...original, order: { ...original.order, status: 'attempted' } })).toBe(false);
    expect(isCapturedPrepaidOrder({ ...original, expectedOrderId: 'order_other' })).toBe(false);
  });
});
