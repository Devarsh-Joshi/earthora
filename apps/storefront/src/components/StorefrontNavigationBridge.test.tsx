// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
const router=vi.hoisted(()=>({navigate:vi.fn()}));
vi.mock('wouter',()=>({useLocation:()=>['/',router.navigate]}));
import {StorefrontNavigationBridge} from './StorefrontNavigationBridge';

let root:Root;
beforeEach(()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  window.history.replaceState(null,'','/');
  window.matchMedia=vi.fn(()=>({matches:true} as MediaQueryList));
  HTMLElement.prototype.scrollIntoView=vi.fn();
  vi.spyOn(HTMLElement.prototype,'getClientRects').mockReturnValue([new DOMRect(0,0,100,100)] as unknown as DOMRectList);
  vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>setTimeout(()=>fn(0),0));
  vi.stubGlobal('cancelAnimationFrame',(id:number)=>clearTimeout(id));
  const mount=document.createElement('div');document.body.appendChild(mount);root=createRoot(mount);
  router.navigate.mockReset();
  act(()=>root.render(<StorefrontNavigationBridge/>));
});
afterEach(()=>{act(()=>root.unmount());document.body.innerHTML='';vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('persistent storefront navigation bridge',()=>{
  it('acknowledges only after the matching lazy route target exists and focuses it with reduced motion',async()=>{
    router.navigate.mockImplementation((path:string)=>window.history.pushState(null,'',path));
    const promise=window.EarthoraStorefrontNavigation!.navigate({id:'contact_form',path:'/contact',anchor:'contact-form',label:'Contact'},new AbortController().signal);
    let complete=false;void promise.then(()=>complete=true);
    await new Promise(resolve=>setTimeout(resolve,5));expect(complete).toBe(false);
    const page=document.createElement('div');page.dataset.earthoraPage='/contact';page.innerHTML='<form id="contact-form"></form>';document.body.appendChild(page);
    expect(await promise).toEqual({ok:true});expect(document.activeElement?.id).toBe('contact-form');
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({block:'start',behavior:'auto'});
  });
  it('does not move a visitor away from an active nonempty form field',async()=>{
    const input=document.createElement('input');document.body.appendChild(input);input.value='Draft enquiry';input.focus();
    const result=await window.EarthoraStorefrontNavigation!.navigate({id:'home',path:'/',anchor:null,label:'Home'},new AbortController().signal);
    expect(result).toEqual({ok:false,reason:'form_active'});expect(router.navigate).not.toHaveBeenCalled();expect(input.value).toBe('Draft enquiry');
  });
  it('aborts pending target observation when the agent cancels navigation',async()=>{
    const controller=new AbortController();
    const promise=window.EarthoraStorefrontNavigation!.navigate({id:'contact',path:'/contact',anchor:null,label:'Contact'},controller.signal);
    controller.abort();expect(await promise).toEqual({ok:false,reason:'navigation_cancelled'});
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});
