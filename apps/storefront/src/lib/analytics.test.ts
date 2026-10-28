// @vitest-environment jsdom
import {beforeEach,expect,it,vi} from 'vitest';
const insert=vi.hoisted(()=>vi.fn().mockResolvedValue({}));
vi.mock('./supabase',()=>({supabase:{from:()=>({insert})}}));
import {trackPageView} from './analytics';
beforeEach(()=>{sessionStorage.clear();insert.mockClear();});
it.each(['/ai-checkout/vc1.secret.capability.token'])('does not retain checkout capabilities from %s',async path=>{
  await trackPageView(path);
  expect(insert).toHaveBeenCalledWith(expect.objectContaining({page_name:'/checkout-review'}));
  expect(JSON.stringify(insert.mock.calls)).not.toContain('token');
});
