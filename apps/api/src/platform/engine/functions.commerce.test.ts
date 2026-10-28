import {beforeEach,describe,it,expect,vi} from 'vitest';
vi.mock('../../config.js',()=>({config:{PUBLIC_STORE_URL:'https://store.example',PII_ENCRYPTION_KEY:'b'.repeat(64)}}));
vi.mock('../../db/client.js',()=>({sql:vi.fn()}));
vi.mock('../../modules/jobs/queue.js',()=>({enqueueJob:vi.fn()}));
vi.mock('../kb/retrieve.js',()=>({retrieve:vi.fn()}));
vi.mock('../kb/ingest.js',()=>({tenantId:vi.fn()}));
vi.mock('../../modules/commerce/pricing.js',()=>({listProducts:vi.fn(),priceCart:vi.fn()}));
import {BUILTIN_MAP,type FunctionContext} from './functions.js';
import {listProducts,priceCart} from '../../modules/commerce/pricing.js';
import {sql} from '../../db/client.js';
const context=():FunctionContext=>({conversationId:'c1',channelType:'chat',contact:{},state:{cart:[],language:'en',checkout:{name:'Synthetic',email:'synthetic@example.invalid',phone:'9876543210',address:'Test road 12',city:'Ahmedabad',state:'Gujarat',zip:'380001',country:'India'}}});
beforeEach(()=>{vi.clearAllMocks();vi.mocked(listProducts).mockResolvedValue([{id:'p1',slug:'product',name:'Product',status:'active',stockQty:3,price:10}] as any);vi.mocked(priceCart).mockResolvedValue({lines:[],total:20,unavailable:[],outOfStock:[]} as any);});
describe('assistant purchase preparation',()=>{
  it('lists only active catalogue products, including when archived or draft names match the search',async()=>{
    vi.mocked(listProducts).mockResolvedValue([
      {id:'p1',slug:'tablets',name:'Current Tablets',description:'Leaf powder pressed into tablets',status:'active',stockQty:3,price:999},
      {id:'p2',slug:'powder',name:'Old Powder',description:'Powder',status:'archived',stockQty:3,price:799},
      {id:'p3',slug:'new',name:'Unpublished Draft',description:'Draft',status:'draft',stockQty:3,price:599},
    ] as any);
    const result=await BUILTIN_MAP.get('list_products')!.run({query:'Old Powder'},context());
    expect(result.data).toEqual([expect.objectContaining({id:'p1',name:'Current Tablets'})]);
  });
  it('checks resulting quantity on repeat add and stock on updates',async()=>{
    const ctx=context();
    expect((await BUILTIN_MAP.get('add_to_cart')!.run({productId:'p1',quantity:2},ctx)).ok).toBe(true);
    expect((await BUILTIN_MAP.get('add_to_cart')!.run({productId:'p1',quantity:2},ctx)).ok).toBe(false);
    expect(ctx.state.cart[0].quantity).toBe(2);
    expect((await BUILTIN_MAP.get('update_cart')!.run({productId:'p1',quantity:4},ctx)).ok).toBe(false);
    expect((await BUILTIN_MAP.get('update_cart')!.run({productId:'p1',quantity:0},ctx)).ok).toBe(true);
    expect(ctx.state.cart).toEqual([]);
  });
  it('creates an actual review link without order, escalation or notification writes',async()=>{
    const ctx=context();await BUILTIN_MAP.get('add_to_cart')!.run({productId:'p1',quantity:2},ctx);
    const result=await BUILTIN_MAP.get('create_checkout_link')!.run({},ctx);
    expect(result).toMatchObject({ok:true,data:{url:expect.stringContaining('/ai-checkout/vc1.'),order_placed:false,payment_required:true}});
    expect(sql).not.toHaveBeenCalled();
  });
  it('never exposes browser actions and never records payment details',async()=>{
    const ctx=context();await BUILTIN_MAP.get('add_to_cart')!.run({productId:'p1',quantity:1},ctx);
    expect((await BUILTIN_MAP.get('create_checkout_link')!.run({},ctx)).data).not.toHaveProperty('browser_action');
    expect((await BUILTIN_MAP.get('set_customer_detail')!.run({field:'card_number',value:'1234'},ctx)).ok).toBe(false);
    expect(ctx.state.checkout).not.toHaveProperty('card_number');
  });
});
describe('bulk quantities are wholesale enquiries, never a stock refusal',()=>{
  it('explains the retail cart ceiling and points to an enquiry instead of quoting stock',async()=>{
    const ctx=context();
    vi.mocked(listProducts).mockResolvedValue([{id:'p1',slug:'product',name:'Product',status:'active',stockQty:119,price:10}] as any);
    const bulk=await BUILTIN_MAP.get('add_to_cart')!.run({productId:'p1',quantity:5000},ctx);
    expect(bulk.ok).toBe(false);expect(bulk.message).toContain('at most 50 units');expect(bulk.message).toContain('wholesale');expect(bulk.message).not.toContain('119');
    expect(ctx.state.cart).toEqual([]);
    expect((await BUILTIN_MAP.get('add_to_cart')!.run({productId:'p1',quantity:30},ctx)).ok).toBe(true);
    const over=await BUILTIN_MAP.get('add_to_cart')!.run({productId:'p1',quantity:30},ctx);
    expect(over.ok).toBe(false);expect(over.message).toContain('at most 50 units');expect(ctx.state.cart[0].quantity).toBe(30);
    const update=await BUILTIN_MAP.get('update_cart')!.run({productId:'p1',quantity:60},ctx);
    expect(update.ok).toBe(false);expect(update.message).toContain('wholesale');expect(ctx.state.cart[0].quantity).toBe(30);
  });
  it('still reports real retail stock limits below the ceiling',async()=>{
    const ctx=context();
    const result=await BUILTIN_MAP.get('add_to_cart')!.run({productId:'p1',quantity:4},ctx);
    expect(result).toEqual({ok:false,message:'Maximum available quantity is 3'});
    expect((await BUILTIN_MAP.get('add_to_cart')!.run({productId:'p1',quantity:3},ctx)).ok).toBe(true);
    expect((await BUILTIN_MAP.get('update_cart')!.run({productId:'p1',quantity:4},ctx)).message).toContain('smaller quantity');
  });
});
